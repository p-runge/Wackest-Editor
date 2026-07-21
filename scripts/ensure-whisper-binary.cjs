// Builds the whisper.cpp `whisper-cli` binary from source for the host platform/arch and places
// it at resources/bin/<platform>-<arch>/whisper-cli[.exe], so whisper.cpp never has to be
// installed separately by users or contributors (mirrors ensure-ffmpeg-binary.cjs's
// skip-if-present style, but there's no prebuilt-binary npm package for whisper.cpp to download
// from, so this compiles it instead).
//
// Unlike ffmpeg-static (a download, so any target platform/arch works from any host),
// whisper.cpp is compiled here, so this can only produce a binary for the host it runs on. Each
// release CI job (macOS/Windows/Linux) already builds natively on a matching runner, so that's
// fine for `build:mac`/`build:win`/`build:linux` as configured today — it would NOT work to
// cross-build e.g. `build:win` from a macOS host, unlike the ffmpeg hook.
'use strict'

const { execFileSync } = require('node:child_process')
const { existsSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const WHISPER_CPP_TAG = 'v1.9.1'
const REPO_ROOT = path.join(__dirname, '..')

function destinationPath(platform, arch) {
  const exe = platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  return path.join(REPO_ROOT, 'resources', 'bin', `${platform}-${arch}`, exe)
}

function ensureWhisperBinary({ platform, arch } = {}) {
  platform = platform || process.platform
  arch = arch || process.arch

  if (platform !== process.platform || arch !== process.arch) {
    throw new Error(
      `[ensure-whisper-binary] Cannot build whisper.cpp for ${platform}/${arch} on host ` +
        `${process.platform}/${process.arch} — whisper.cpp is compiled from source, not ` +
        `downloaded, so it must be built natively on a matching OS/arch.`
    )
  }

  const binaryPath = destinationPath(platform, arch)
  if (existsSync(binaryPath)) return

  console.log(
    `[ensure-whisper-binary] Building whisper.cpp ${WHISPER_CPP_TAG} for ${platform}/${arch}...`
  )

  const workDir = mkdtempSync(path.join(os.tmpdir(), 'whisper-cpp-build-'))
  try {
    execFileSync(
      'git',
      [
        'clone',
        '--branch',
        WHISPER_CPP_TAG,
        '--depth',
        '1',
        'https://github.com/ggml-org/whisper.cpp',
        workDir
      ],
      { stdio: 'inherit' }
    )

    const cmakeArgs = [
      '-B',
      'build',
      '-DCMAKE_BUILD_TYPE=Release',
      '-DBUILD_SHARED_LIBS=OFF',
      '-DWHISPER_BUILD_EXAMPLES=ON',
      '-DWHISPER_BUILD_SERVER=OFF',
      '-DWHISPER_BUILD_TESTS=OFF'
    ]
    if (platform === 'darwin') {
      cmakeArgs.push('-DGGML_METAL=ON', '-DGGML_METAL_EMBED_LIBRARY=ON')
    }

    execFileSync('cmake', cmakeArgs, { cwd: workDir, stdio: 'inherit' })
    execFileSync('cmake', ['--build', 'build', '--config', 'Release', '-j'], {
      cwd: workDir,
      stdio: 'inherit'
    })

    const exeName = platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
    const builtCandidates = [
      path.join(workDir, 'build', 'bin', 'Release', exeName),
      path.join(workDir, 'build', 'bin', exeName)
    ]
    const builtPath = builtCandidates.find((candidate) => existsSync(candidate))
    if (!builtPath) {
      throw new Error(
        `[ensure-whisper-binary] Built whisper.cpp but couldn't find ${exeName} in any of: ` +
          builtCandidates.join(', ')
      )
    }

    mkdirSync(path.dirname(binaryPath), { recursive: true })
    copyFileSync(builtPath, binaryPath)
    if (platform !== 'win32') {
      execFileSync('chmod', ['+x', binaryPath])
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }

  if (!existsSync(binaryPath)) {
    throw new Error(
      `[ensure-whisper-binary] Expected whisper-cli at ${binaryPath} but it's missing.`
    )
  }
  console.log(`[ensure-whisper-binary] Built ${binaryPath}`)
}

module.exports = { ensureWhisperBinary, destinationPath, WHISPER_CPP_TAG }

if (require.main === module) {
  ensureWhisperBinary()
}
