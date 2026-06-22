import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const reviewSlicesPath = path.join(root, 'docs', 'superpowers', 'status', '2026-06-19-vela-review-slices.md')

let failed = 0
function assert(condition, label) {
  if (!condition) {
    console.error(`FAIL: ${label}`)
    failed += 1
    process.exitCode = 1
  } else {
    console.log(`PASS: ${label}`)
  }
}

const slices = [
  {
    name: 'Mission Runtime And API',
    files: [
      'src/vela/mission-runtime.js',
      'src/vela/capability-registry.js',
      'src/vela/capability-adapters.js',
      'src/vela/desktop-adapter-bridge.js',
      'src/vela/github-reader.js',
      'src/api.js',
      'src/test-vela-mission.js',
    ],
  },
  {
    name: 'Vela Shell And Chinese UI',
    files: [
      'vela.html',
      'src/ui/vela/adapters/mission-api.js',
      'src/ui/vela/app-shell.js',
      'src/ui/vela/command-bar.js',
      'src/ui/vela/intelligence-spine.js',
      'src/ui/vela/locale.js',
      'src/ui/vela/mission-rail.js',
      'src/ui/vela/mission-surface.js',
      'src/ui/vela/mission-switcher.js',
      'src/ui/vela/mission-workspace.js',
      'src/ui/vela/state/mission-store.js',
      'src/ui/vela/styles/vela.css',
      'src/ui/vela/voice-layer.js',
    ],
  },
  {
    name: 'Screenshot And Entry Regression',
    files: [
      'scripts/vela-visual-assertions.mjs',
      'scripts/serve-vela-preview.mjs',
      'scripts/smoke-vela-shell.mjs',
      'scripts/smoke-vela-entry.mjs',
    ],
  },
  {
    name: 'Phase 5 Evals And Packaging Readiness',
    files: [
      'package.json',
      'scripts/eval-vela-golden-trace.mjs',
      'scripts/eval-vela-tool-permission.mjs',
      'scripts/eval-vela-voice-latency.mjs',
      'scripts/eval-vela-review-claim.mjs',
      'scripts/eval-vela-product-contract.mjs',
      'scripts/eval-vela-review-slices.mjs',
      'scripts/eval-vela-polish-readiness.mjs',
      'scripts/smoke-vela-packaged.mjs',
    ],
  },
  {
    name: 'Handoff Documentation',
    files: [
      'docs/superpowers/status/2026-06-19-vela-phase-5-handoff.md',
      'docs/superpowers/status/2026-06-19-vela-review-slices.md',
      'docs/superpowers/status/2026-06-20-vela-pr-draft.md',
      'docs/superpowers/status/2026-06-20-vela-validation-log.md',
      'docs/superpowers/status/2026-06-20-vela-visual-signoff.md',
      'docs/superpowers/status/2026-06-20-vela-live-browser-check.md',
    ],
  },
]

const reviewSlicesText = fs.existsSync(reviewSlicesPath) ? fs.readFileSync(reviewSlicesPath, 'utf-8') : ''
assert(reviewSlicesText.includes('Vela Review Slices'), 'review slices document has the expected title')

const assigned = new Map()
for (const slice of slices) {
  assert(reviewSlicesText.includes(`Slice ${slices.indexOf(slice) + 1}: ${slice.name}`), `review slices document lists ${slice.name}`)
  for (const file of slice.files) {
    const prior = assigned.get(file)
    assert(!prior, `${file} is assigned to only one review slice`)
    assigned.set(file, slice.name)
    assert(reviewSlicesText.includes(`\`${file}\``), `review slices document lists ${file}`)
    assert(fs.existsSync(path.join(root, file)), `${file} exists`)
  }
}

function statusPath(line) {
  const raw = line.slice(3).trim()
  if (raw.includes(' -> ')) return raw.split(' -> ').pop().trim()
  return raw.replace(/^"|"$/g, '')
}

function isVelaReviewScope(file) {
  return assigned.has(file)
    || file === 'package.json'
    || file === 'vela.html'
    || file === 'src/api.js'
    || file === 'src/test-vela-mission.js'
    || file === 'src/vela/mission-runtime.js'
    || file.startsWith('src/ui/vela/')
    || /^scripts\/(?:smoke-vela|eval-vela|vela-visual-assertions)\b/.test(file)
    || /^docs\/superpowers\/status\/2026-06-19-vela-/.test(file)
    || /^docs\/superpowers\/status\/2026-06-20-vela-/.test(file)
}

const statusOutput = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
  cwd: root,
  encoding: 'utf-8',
})
const dirtyFiles = statusOutput
  .split('\n')
  .map(line => line.trimEnd())
  .filter(Boolean)
  .map(statusPath)
const dirtyVelaFiles = dirtyFiles.filter(isVelaReviewScope)
const unassigned = dirtyVelaFiles.filter(file => !assigned.has(file))

assert(dirtyVelaFiles.length >= 0, 'review-scope dirty file scan completed')
assert(unassigned.length === 0, `all dirty Vela files are assigned to a review slice: ${unassigned.join(', ')}`)

if (failed > 0) process.exit(1)

console.log('\n[PASS] vela review slices eval')
console.log(JSON.stringify({
  slices: slices.map(slice => ({ name: slice.name, files: slice.files })),
  dirtyVelaFiles,
}, null, 2))
