import ffmpegPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import ffmpeg from 'fluent-ffmpeg'
import { readFile, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import type { ProbedMediaInfo } from '@shared/types/project'

ffmpeg.setFfmpegPath(ffmpegPath as unknown as string)
ffmpeg.setFfprobePath(ffprobeStatic.path)

const WAVEFORM_BUCKETS_PER_SEC = 10
const WAVEFORM_SAMPLE_RATE = 8000

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
      .audioFrequency(WAVEFORM_SAMPLE_RATE)
      .format('s16le')
      .on('error', reject)
      .on('end', () => resolve())
      .save(outPcmPath)
  })
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
