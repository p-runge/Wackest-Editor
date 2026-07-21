// electron-builder only accepts a single `beforePack` hook, so this combines the two
// ensure-*-binary safety nets (both idempotent — normally already satisfied by `postinstall`,
// this just guards packaging when that didn't happen).
'use strict'

const ensureFfmpegBinary = require('./ensure-ffmpeg-binary.cjs')
const { ensureWhisperBinary } = require('./ensure-whisper-binary.cjs')

const ARCH_NAMES = ['ia32', 'x64', 'armv7l', 'arm64', 'universal']

module.exports = async function beforePack(context) {
  await ensureFfmpegBinary(context)
  ensureWhisperBinary({ platform: context.electronPlatformName, arch: ARCH_NAMES[context.arch] })
}
