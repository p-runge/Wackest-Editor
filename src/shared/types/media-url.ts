const SCHEME = 'wackest-media'

/** Builds a `wackest-media://` URL the renderer can use as an <img>/<video> src for a local file. */
export function toMediaUrl(absolutePath: string): string {
  return `${SCHEME}://local/${encodeURIComponent(absolutePath)}`
}

/** Recovers the absolute file path from a `wackest-media://` URL (used by the main-process handler). */
export function fromMediaUrl(url: string): string {
  const parsed = new URL(url)
  return decodeURIComponent(parsed.pathname.replace(/^\//, ''))
}

export const MEDIA_URL_SCHEME = SCHEME
