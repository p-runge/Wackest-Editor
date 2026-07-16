import ffmpegPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import ffmpeg from 'fluent-ffmpeg'
import { readFile, writeFile, rm, readdir } from 'fs/promises'
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
