import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const minimatchModule = require('minimatch')
const minimatch = minimatchModule.minimatch || minimatchModule
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

function copyFileToResourceRoot(file, resourceRoot) {
  const src = path.join(root, file)
  const dst = path.join(resourceRoot, file)
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
}

function copyDirToResourceRoot(dir, resourceRoot) {
  const src = path.join(root, dir)
  const dst = path.join(resourceRoot, dir)
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.cpSync(src, dst, { recursive: true })
}

function patternMatches(file, pattern) {
  return minimatch(file, pattern, { dot: true })
}

function includedByBuildFiles(file, patterns) {
  let included = false
  let matchedPositive = false
  let matchedNegative = false
  for (const pattern of patterns) {
    const negated = pattern.startsWith('!')
    const body = negated ? pattern.slice(1) : pattern
    if (!patternMatches(file, body)) continue
    if (negated) {
      included = false
      matchedNegative = true
    } else {
      included = true
      matchedPositive = true
    }
  }
  return { included, matchedPositive, matchedNegative }
}

const packageJson = readJson(path.join(root, 'package.json'))
const build = packageJson.build || {}
const files = Array.isArray(build.files) ? build.files : []

const requiredPackagedFiles = [
  'package.json',
  'vela.html',
  'src/api.js',
  'src/paths.js',
  'src/vela/mission-runtime.js',
  'src/ui/vela/app-shell.js',
  'src/ui/vela/intelligence-spine.js',
  'src/ui/vela/locale.js',
  'src/ui/vela/mission-workspace.js',
  'src/ui/vela/voice-layer.js',
  'src/ui/vela/adapters/mission-api.js',
  'src/ui/vela/state/mission-store.js',
  'src/ui/vela/styles/vela.css',
]

const devOnlyFiles = [
  'scripts/smoke-vela-shell.mjs',
  'scripts/smoke-vela-entry.mjs',
  'scripts/smoke-vela-packaged.mjs',
  'scripts/vela-visual-assertions.mjs',
  'scripts/eval-vela-review-claim.mjs',
  'scripts/eval-vela-product-contract.mjs',
  'scripts/eval-vela-review-slices.mjs',
  'scripts/eval-vela-polish-readiness.mjs',
  'src/test-vela-mission.js',
]

assert(build.asar === true, 'packaged app keeps ASAR enabled')
assert(Array.isArray(build.asarUnpack) && build.asarUnpack.some(pattern => pattern.includes('better-sqlite3')), 'packaged app unpacks better-sqlite3 native module')
assert(files.includes('vela.html'), 'build.files includes Vela HTML entry')
assert(files.includes('src/**/*'), 'build.files includes src tree for Vela runtime and UI')

for (const file of requiredPackagedFiles) {
  assert(fs.existsSync(path.join(root, file)), `${file} exists`)
  const result = includedByBuildFiles(file, files)
  assert(result.matchedPositive, `${file} matches a positive build.files pattern`)
  assert(result.included, `${file} is not excluded by build.files`)
}

for (const file of devOnlyFiles) {
  const result = includedByBuildFiles(file, files)
  assert(!result.included || result.matchedNegative, `${file} is excluded from packaged app`)
}

if (failed > 0) process.exit(1)

async function assertHeadStatus(base, pathname, expectedStatus, expectedContentType, label) {
  const res = await fetch(`${base}${pathname}`, { method: 'HEAD' })
  assert(res.status === expectedStatus, `${label} returns ${expectedStatus}`)
  if (expectedContentType) {
    assert(res.headers.get('content-type')?.includes(expectedContentType), `${label} serves ${expectedContentType}`)
  }
}

async function assertGetStatus(base, pathname, expectedStatus, expectedText, label) {
  const res = await fetch(`${base}${pathname}`)
  assert(res.status === expectedStatus, `${label} returns ${expectedStatus}`)
  if (expectedText) {
    const body = await res.text()
    assert(body.includes(expectedText), `${label} includes expected content`)
  } else {
    await res.arrayBuffer()
  }
}

async function assertPackagedResourceRootServesVela() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'blm-vela-packaged-'))
  const userDir = path.join(tmpRoot, 'user')
  const resourceRoot = path.join(tmpRoot, 'resources', 'app')
  fs.mkdirSync(userDir, { recursive: true })
  fs.mkdirSync(resourceRoot, { recursive: true })

  copyFileToResourceRoot('vela.html', resourceRoot)
  copyDirToResourceRoot('src/ui/vela', resourceRoot)

  fs.writeFileSync(path.join(userDir, 'config.json'), JSON.stringify({
    schemaVersion: 1,
    provider: 'custom',
    apiKey: 'none',
    model: 'smoke-model',
    baseURL: 'http://127.0.0.1:9/v1',
  }, null, 2), 'utf-8')

  process.env.BAILONGMA_USER_DIR = userDir
  process.env.BAILONGMA_RESOURCES_DIR = resourceRoot

  let server = null

  try {
    const { startAPI } = await import('../src/api.js')
    server = startAPI(0)
    if (!server.listening) {
      await new Promise((resolve, reject) => {
        server.once('listening', resolve)
        server.once('error', reject)
      })
    }

    const address = server.address()
    const base = `http://127.0.0.1:${address.port}`

    await assertHeadStatus(base, '/', 200, 'text/html', 'packaged root Vela shell')
    await assertHeadStatus(base, '/vela.html', 200, 'text/html', 'packaged Vela HTML')
    await assertHeadStatus(base, '/src/ui/vela/app-shell.js', 200, 'text/javascript', 'packaged Vela shell asset')
    await assertHeadStatus(base, '/src/ui/vela/styles/vela.css', 200, 'text/css', 'packaged Vela stylesheet')
    await assertGetStatus(base, '/src/ui/vela/%2e%2e%2f%2e%2e%2fapi.js', 403, 'forbidden', 'packaged Vela asset traversal guard')
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve))
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
}

await assertPackagedResourceRootServesVela()
assert(true, 'packaged-like resource root serves Vela entry and assets')

if (failed > 0) process.exit(1)
console.log('\n[PASS] vela packaged smoke')
