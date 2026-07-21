// electron-builder only accepts a single `beforePack` hook, so this combines the two
// ensure-*-binary safety nets (both idempotent — normally already satisfied by `postinstall`,
// this just guards packaging when that didn't happen) with a pruning step for stray
// other-platform binaries (see pruneForeignPlatformBinaries below).
'use strict'

const { readdir, rm } = require('node:fs/promises')
const path = require('node:path')
const ensureFfmpegBinary = require('./ensure-ffmpeg-binary.cjs')
const { ensureWhisperBinary } = require('./ensure-whisper-binary.cjs')

const ARCH_NAMES = ['ia32', 'x64', 'armv7l', 'arm64', 'universal']
const REPO_ROOT = path.join(__dirname, '..')

// `ffprobe-static` keeps a `bin/<platform>/<arch>/ffprobe(.exe)` per platform/arch it has ever
// been installed for (each lives in its own subfolder, so nothing overwrites anything else when
// e.g. `pnpm build:win` runs once on a mac). `ffmpeg-static` similarly leaves both `ffmpeg` and
// `ffmpeg.exe` sitting at its package root if it's ever been installed for both a *nix and
// Windows target. `asarUnpack` in electron-builder.yml has no platform filter, so without this
// pruning step every build would silently ship every such binary that happens to be present in
// node_modules — dead weight that never runs, since each package resolves its own binary from
// `os.platform()`/`os.arch()` at runtime, not from what got bundled.
async function pruneForeignPlatformBinaries(platform, arch) {
  const ffprobeBinDir = path.join(REPO_ROOT, 'node_modules', 'ffprobe-static', 'bin')
  const platformDirs = await readdir(ffprobeBinDir, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    platformDirs
      .filter((entry) => entry.isDirectory() && entry.name !== platform)
      .map((entry) => rm(path.join(ffprobeBinDir, entry.name), { recursive: true, force: true }))
  )

  const targetArchDir = path.join(ffprobeBinDir, platform)
  const archDirs = await readdir(targetArchDir, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    archDirs
      .filter((entry) => entry.isDirectory() && entry.name !== arch)
      .map((entry) => rm(path.join(targetArchDir, entry.name), { recursive: true, force: true }))
  )

  const foreignFfmpegExecutable = platform === 'win32' ? 'ffmpeg' : 'ffmpeg.exe'
  await rm(path.join(REPO_ROOT, 'node_modules', 'ffmpeg-static', foreignFfmpegExecutable), {
    force: true
  })
}

module.exports = async function beforePack(context) {
  const platform = context.electronPlatformName
  const arch = ARCH_NAMES[context.arch]

  await ensureFfmpegBinary(context)
  ensureWhisperBinary({ platform, arch })
  await pruneForeignPlatformBinaries(platform, arch)
}
