import { protocol } from 'electron'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { extname } from 'path'
import { Readable } from 'stream'
import { fromMediaUrl, MEDIA_URL_SCHEME } from '@shared/types/media-url'

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png'
}

function mimeTypeFor(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Serves local files to the renderer with proper HTTP range-request support — required for
 * <video>/<audio> seeking. A plain `net.fetch(pathToFileURL(...))` pass-through (fine for a
 * one-shot image load) does not report Content-Length or honor Range headers, which leaves
 * <video> elements stuck on "loading metadata" indefinitely.
 */
export function registerMediaProtocolHandler(): void {
  protocol.handle(MEDIA_URL_SCHEME, async (request) => {
    const filePath = fromMediaUrl(request.url)
    const fileStat = await stat(filePath)
    const totalSize = fileStat.size
    const contentType = mimeTypeFor(filePath)

    const rangeHeader = request.headers.get('range')
    if (rangeHeader) {
      const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader)
      const start = match ? Number(match[1]) : 0
      const end = match?.[2] ? Number(match[2]) : totalSize - 1
      const chunkSize = end - start + 1

      const nodeStream = createReadStream(filePath, { start, end })
      return new Response(Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Content-Length': String(chunkSize),
          'Accept-Ranges': 'bytes'
        }
      })
    }

    const nodeStream = createReadStream(filePath)
    return new Response(Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(totalSize),
        'Accept-Ranges': 'bytes'
      }
    })
  })
}
