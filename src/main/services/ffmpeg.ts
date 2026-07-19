import ffmpegPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import ffmpeg from 'fluent-ffmpeg'
import { readFile, writeFile, rm, readdir, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import type { ProbedMediaInfo } from '@shared/types/project'

ffmpeg.setFfmpegPath(ffmpegPath as unknown as string)
ffmpeg.setFfprobePath(ffprobeStatic.path)

const WAVEFORM_BUCKETS_PER_SEC = 10
export const SYNC_SAMPLE_RATE = 8000

export function probeFile(filePath: string): Promise<ProbedMediaInfo> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err)

      const videoStream = data.streams.find((s) => s.codec_type === 'video')
      const audioStream = data.streams.find((s) => s.codec_type === 'audio')
      const durationSec = Number(
        data.format.duration ?? videoStream?.duration ?? audioStream?.duration ?? 0
      )

      let frameRate: number | undefined
      if (videoStream?.avg_frame_rate) {
        const [num, den] = videoStream.avg_frame_rate.split('/').map(Number)
        if (den) frameRate = num / den
      }

      resolve({
        durationSec,
        hasVideo: !!videoStream,
        hasAudio: !!audioStream,
        videoCodec: videoStream?.codec_name,
        audioCodec: audioStream?.codec_name,
        width: videoStream?.width,
        height: videoStream?.height,
        frameRate,
        sampleRate: audioStream?.sample_rate ? Number(audioStream.sample_rate) : undefined,
        channels: audioStream?.channels,
        container: data.format.format_name ?? ''
      })
    })
  })
}

/** Downsampled mono PCM (s16le), used for both waveform display and later cross-correlation sync. */
export function extractMonoPcm(filePath: string, outPcmPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(SYNC_SAMPLE_RATE)
      .format('s16le')
      .on('error', reject)
      .on('end', () => resolve())
      .save(outPcmPath)
  })
}

/** Extracts the full file's mono PCM into memory as Int16 samples at SYNC_SAMPLE_RATE. */
export async function extractMonoPcmSamples(filePath: string): Promise<Int16Array> {
  const tmpPath = join(tmpdir(), `wackest-sync-${randomUUID()}.pcm`)
  await extractMonoPcm(filePath, tmpPath)
  const buffer = await readFile(tmpPath)
  const samples = new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.length / 2))
  const copy = new Int16Array(samples) // detach from the Buffer's pooled memory before it's freed
  await rm(tmpPath, { force: true })
  return copy
}

export async function extractWaveformPeaks(
  filePath: string,
  cacheDir: string,
  sourceId: string,
  durationSec: number
): Promise<string> {
  const pcmPath = join(cacheDir, `${sourceId}.pcm`)
  await extractMonoPcm(filePath, pcmPath)

  const buffer = await readFile(pcmPath)
  const samples = new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.length / 2))

  const bucketCount = Math.max(1, Math.round(durationSec * WAVEFORM_BUCKETS_PER_SEC))
  const bucketSize = Math.max(1, Math.floor(samples.length / bucketCount))
  const peaks: Array<[number, number]> = []

  for (let i = 0; i < bucketCount; i++) {
    const start = i * bucketSize
    const end = Math.min(samples.length, start + bucketSize)
    let min = 0
    let max = 0
    for (let j = start; j < end; j++) {
      const v = samples[j]
      if (v < min) min = v
      if (v > max) max = v
    }
    peaks.push([min / 32768, max / 32768])
  }

  const peaksPath = join(cacheDir, `${sourceId}.waveform.json`)
  await writeFile(peaksPath, JSON.stringify(peaks), 'utf-8')
  await rm(pcmPath, { force: true })
  return peaksPath
}

/** whisper.cpp requires 16kHz mono WAV input. */
export function extractWav16kMono(filePath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .format('wav')
      .on('error', reject)
      .on('end', () => resolve())
      .save(outPath)
  })
}

// ~20 min chunks stay well under the OpenAI API's 25MB upload limit even at higher bitrates.
export const AUDIO_CHUNK_DURATION_SEC = 20 * 60

/** Splits audio into small, upload-friendly chunks in one ffmpeg pass (segment muxer). */
export function extractCompressedAudioChunks(filePath: string, outDir: string): Promise<string[]> {
  const pattern = join(outDir, 'chunk-%03d.m4a')
  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .noVideo()
      .audioChannels(1)
      .audioBitrate('64k')
      .outputOptions([
        '-f',
        'segment',
        '-segment_time',
        String(AUDIO_CHUNK_DURATION_SEC),
        '-reset_timestamps',
        '1'
      ])
      .on('error', reject)
      .on('end', () => {
        readdir(outDir)
          .then((files) =>
            resolve(
              files
                .filter((f) => f.startsWith('chunk-'))
                .sort()
                .map((f) => join(outDir, f))
            )
          )
          .catch(reject)
      })
      .save(pattern)
  })
}

export interface RenderVideoSegmentInput {
  videoFilePath: string
  videoInSec: number
  durationSec: number
  targetWidth: number
  targetHeight: number
  outputPath: string
  onProgress?: (fractionDone: number) => void
}

/**
 * Renders one export video sub-segment (no audio): trims to duration, scales+letterboxes to a
 * consistent output resolution (sources may differ in aspect ratio, e.g. a landscape camera mixed
 * with a portrait phone clip), and re-encodes. Re-encoding (rather than stream-copy) is required
 * for frame-accurate trims across differently-encoded sources. Video is split at every camera cut;
 * audio is rendered separately (see `renderExportAudioSegment`) and only split where the active
 * audio source actually changes, then muxed back together at the end — re-encoding audio once per
 * video cut instead would add an audible click at every cut from each independent encode's priming
 * samples, even when the audio source and offset are continuous across that cut.
 */
export function renderExportVideoSegment(input: RenderVideoSegmentInput): Promise<void> {
  const scaleFilter =
    `scale=${input.targetWidth}:${input.targetHeight}:force_original_aspect_ratio=decrease,` +
    `pad=${input.targetWidth}:${input.targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black`

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(input.videoFilePath)
      .inputOptions(['-ss', String(input.videoInSec), '-t', String(input.durationSec)])
      .outputOptions([
        '-map',
        '0:v:0',
        '-an',
        '-vf',
        scaleFilter,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20'
      ])
      .on('progress', (progress) => {
        if (progress.percent != null) {
          input.onProgress?.(Math.max(0, Math.min(1, progress.percent / 100)))
        }
      })
      .on('error', reject)
      .on('end', () => resolve())
      .save(input.outputPath)
  })
}

export interface RenderAudioSegmentInput {
  audioFilePath: string
  audioInSec: number
  durationSec: number
  outputPath: string
  onProgress?: (fractionDone: number) => void
}

/** Renders one continuous export audio span — see `renderExportVideoSegment` for why this is split independently of video cuts. */
export function renderExportAudioSegment(input: RenderAudioSegmentInput): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input.audioFilePath)
      .inputOptions(['-ss', String(input.audioInSec), '-t', String(input.durationSec)])
      .outputOptions([
        '-map',
        '0:a:0',
        '-vn',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        '48000',
        '-ac',
        '2'
      ])
      .on('progress', (progress) => {
        if (progress.percent != null) {
          input.onProgress?.(Math.max(0, Math.min(1, progress.percent / 100)))
        }
      })
      .on('error', reject)
      .on('end', () => resolve())
      .save(input.outputPath)
  })
}

/** Muxes a (silent) concatenated video track and a concatenated audio track into one output file, no re-encode. */
export function muxVideoAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions(['-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-shortest'])
      .on('error', reject)
      .on('end', () => resolve())
      .save(outputPath)
  })
}

/** Concatenates same-codec/resolution segment files (stream copy, no re-encode) into the final output. */
export async function concatSegments(
  segmentPaths: string[],
  outputPath: string,
  workDir: string
): Promise<void> {
  const listPath = join(workDir, 'concat-list.txt')
  const listContent = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
  await writeFile(listPath, listContent, 'utf-8')

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(listPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy'])
      .on('error', reject)
      .on('end', () => resolve())
      .save(outputPath)
  })
}

export function extractThumbnail(
  filePath: string,
  cacheDir: string,
  sourceId: string,
  atSec: number
): Promise<string> {
  const filename = `${sourceId}.thumb.jpg`
  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .on('error', reject)
      .on('end', () => resolve(join(cacheDir, filename)))
      .screenshots({
        timestamps: [Math.max(0, atSec)],
        filename,
        folder: cacheDir,
        size: '320x?'
      })
  })
}

// Tiny grayscale frames sampled at a fixed rate are all the "motion" heatmap needs: it only cares
// about how much the picture changes over time, not detail. 64x36 gray @ 4fps keeps the raw buffer
// small (2304 bytes/frame) and decoding fast even on long clips.
const MOTION_FPS = 4
const MOTION_W = 64
const MOTION_H = 36

function extractGrayFramesToFile(filePath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .noAudio()
      .outputOptions([
        '-vf',
        `fps=${MOTION_FPS},scale=${MOTION_W}:${MOTION_H},format=gray`,
        '-f',
        'rawvideo',
        '-pix_fmt',
        'gray'
      ])
      .on('error', reject)
      .on('end', () => resolve())
      .save(outPath)
  })
}

/**
 * Per-bucket visual motion score for a source: samples tiny grayscale frames, measures the mean
 * absolute pixel change between consecutive frames, and averages those changes within each
 * [start, end) range (in source-LOCAL seconds — the caller maps unified buckets to local time).
 * Returns one raw score per range (higher = more movement); normalization happens in the provider.
 */
export async function extractPerBucketMotion(
  filePath: string,
  localRanges: Array<[number, number]>
): Promise<number[]> {
  if (localRanges.length === 0) return []
  const tmpPath = join(tmpdir(), `wackest-motion-${randomUUID()}.raw`)
  try {
    await extractGrayFramesToFile(filePath, tmpPath)
    const buffer = await readFile(tmpPath)
    const frameSize = MOTION_W * MOTION_H
    const frameCount = Math.floor(buffer.length / frameSize)

    // Motion sample i is the change from frame i to i+1, timestamped at frame i's time.
    const sums = localRanges.map(() => 0)
    const counts = localRanges.map(() => 0)
    for (let f = 0; f < frameCount - 1; f++) {
      const tSec = f / MOTION_FPS
      const bucket = localRanges.findIndex(([start, end]) => tSec >= start && tSec < end)
      if (bucket === -1) continue

      let diff = 0
      const a = f * frameSize
      const b = (f + 1) * frameSize
      for (let p = 0; p < frameSize; p++) diff += Math.abs(buffer[a + p] - buffer[b + p])
      sums[bucket] += diff / frameSize
      counts[bucket] += 1
    }
    return sums.map((sum, i) => (counts[i] > 0 ? sum / counts[i] : 0))
  } finally {
    await rm(tmpPath, { force: true })
  }
}

export interface ExtractedFrame {
  timestampSec: number
  /** JPEG image encoded as a base64 string, for sending to a vision model. */
  base64: string
}

/**
 * Grabs one JPEG frame at each given timestamp (source-LOCAL seconds), returned as base64 so a
 * vision provider can send them inline. Small default size keeps image-token cost/latency low.
 */
export async function extractFramesAt(
  filePath: string,
  timestampsSec: number[],
  size = '512x?'
): Promise<ExtractedFrame[]> {
  if (timestampsSec.length === 0) return []
  const folder = join(tmpdir(), `wackest-frames-${randomUUID()}`)
  await mkdir(folder, { recursive: true })
  try {
    const frames: ExtractedFrame[] = []
    for (let i = 0; i < timestampsSec.length; i++) {
      const atSec = Math.max(0, timestampsSec[i])
      const filename = `frame-${i}.jpg`
      await new Promise<void>((resolve, reject) => {
        ffmpeg(filePath)
          .on('error', reject)
          .on('end', () => resolve())
          .screenshots({ timestamps: [atSec], filename, folder, size })
      })
      const buffer = await readFile(join(folder, filename))
      frames.push({ timestampSec: atSec, base64: buffer.toString('base64') })
    }
    return frames
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}
