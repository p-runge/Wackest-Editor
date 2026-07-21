// electron-builder `beforePack` hook.
//
// `ffmpeg-static`'s postinstall script only downloads the ffmpeg binary for the platform/arch
// `pnpm install` ran on (see node_modules/ffmpeg-static/install.js). In CI, each release target
// builds on a matching native runner (windows-latest, macos-latest, ubuntu-latest), so this is a
// no-op there. It only bites when cross-building for another OS from a local machine (e.g.
// `pnpm build:win` on macOS) — the wrong-platform binary would otherwise get bundled into
// app.asar.unpacked, silently breaking anything that shells out to ffmpeg on the target OS. This
// hook makes every `build:*` self-heal by downloading the binary for the target platform/arch if
// it isn't already present, regardless of which OS is doing the building.
'use strict'

const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')

const ARCH_NAMES = ['ia32', 'x64', 'armv7l', 'arm64', 'universal']

module.exports = async function ensureFfmpegBinary(context) {
  const platform = context.electronPlatformName
  const arch = ARCH_NAMES[context.arch]

  if (arch === 'universal') {
    console.log('[ensure-ffmpeg-binary] Skipping universal arch (unsupported by ffmpeg-static).')
    return
  }

  const ffmpegStaticDir = path.join(__dirname, '..', 'node_modules', 'ffmpeg-static')
  const executableName = 'ffmpeg' + (platform === 'win32' ? '.exe' : '')
  const binaryPath = path.join(ffmpegStaticDir, executableName)

  if (existsSync(binaryPath)) return

  console.log(`[ensure-ffmpeg-binary] Downloading ffmpeg-static binary for ${platform}/${arch}...`)
  execFileSync(process.execPath, ['install.js'], {
    cwd: ffmpegStaticDir,
    stdio: 'inherit',
    env: { ...process.env, npm_config_platform: platform, npm_config_arch: arch }
  })

  if (!existsSync(binaryPath)) {
    throw new Error(
      `[ensure-ffmpeg-binary] Expected ffmpeg-static binary at ${binaryPath} after download but it's missing.`
    )
  }
}
