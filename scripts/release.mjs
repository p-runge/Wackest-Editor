#!/usr/bin/env node
// Release helper:
//   0. Aborts unless run from the `main` branch (override with --force).
//   1. Aborts unless the git working tree is clean.
//   2. Fetches the latest GitHub release version (via `gh`).
//   3. Compares it with the local package.json version.
//   4. Picks the next version: keep the local version if it is already ahead of
//      the latest release, otherwise bump the release's patch by one.
//   5. Asks for confirmation (y/N) before making any changes.
//   6. Writes the bump to package.json (+ commit) if the version changed.
//   7. Creates an annotated `v<version>` tag and pushes branch + tag, which
//      triggers .github/workflows/release.yml.
//
// Usage: `pnpm release`

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FORCE = process.argv.includes('--force')

function run(cmd, args) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

// Like run(), but returns null instead of throwing (and stays quiet on stderr).
function tryRun(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim()
  } catch {
    return null
  }
}

function fail(message) {
  console.error(`[31m✖ ${message}[0m`)
  process.exit(1)
}

function parseSemver(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec((value ?? '').trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

const compare = (a, b) => a.major - b.major || a.minor - b.minor || a.patch - b.patch
const format = (v) => `${v.major}.${v.minor}.${v.patch}`

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase()
  rl.close()
  return answer === 'y' || answer === 'yes'
}

// 0. Must be on main.
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
if (branch !== 'main' && !FORCE) {
  fail(`Releases must be cut from "main" (current: "${branch}"). Pass --force to override.`)
}

// 1. Clean working tree.
if (run('git', ['status', '--porcelain'])) {
  fail('Working tree is not clean — commit or stash your changes first.')
}

// 2. Local version.
const pkgPath = join(ROOT, 'package.json')
const pkgRaw = readFileSync(pkgPath, 'utf8')
const local = parseSemver(JSON.parse(pkgRaw).version)
if (!local) fail('Could not parse the version in package.json.')

// 3. Latest GitHub release (null == no releases yet).
const latestTag = tryRun('gh', ['release', 'view', '--json', 'tagName', '-q', '.tagName'])
let remote
if (latestTag) {
  remote = parseSemver(latestTag)
  if (!remote) fail(`Could not parse the latest release tag "${latestTag}".`)
} else {
  remote = { major: 0, minor: 0, patch: 0 }
}

// 4. Next version.
const next = compare(local, remote) > 0 ? local : { ...remote, patch: remote.patch + 1 }
const nextStr = format(next)
const tag = `v${nextStr}`

if (tryRun('git', ['tag', '-l', tag])) {
  fail(`Tag ${tag} already exists locally.`)
}

console.log(`Branch:         ${branch}`)
console.log(`Local version:  ${format(local)}`)
console.log(`Latest release: ${latestTag ?? '(none yet)'}`)
console.log(`New release:    ${nextStr}  (tag ${tag})`)

if (!(await confirm(`\nRelease ${tag}?`))) {
  console.log('Aborted — nothing written or pushed.')
  process.exit(0)
}

// 6. Bump package.json + commit if the version changed.
if (format(local) !== nextStr) {
  writeFileSync(pkgPath, pkgRaw.replace(/("version":\s*")[^"]+(")/, `$1${nextStr}$2`))
  run('git', ['add', 'package.json'])
  run('git', ['commit', '-m', `chore: release ${tag}`])
  console.log(`\nBumped package.json to ${nextStr}`)
}

// 7. Tag + push (branch first so the tagged commit exists on the remote).
run('git', ['tag', '-a', tag, '-m', `Release ${tag}`])
run('git', ['push', 'origin', branch])
run('git', ['push', 'origin', tag])

console.log(`\n[32m✔ Released ${tag} — the Release workflow is now building the artifacts.[0m`)
