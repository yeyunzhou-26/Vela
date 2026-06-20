import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { assertVisualScreenshot } from './vela-visual-assertions.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const screenshotRoot = path.join(root, 'output', 'playwright', 'vela')
const handoffPath = path.join(root, 'docs', 'superpowers', 'status', '2026-06-19-vela-phase-5-handoff.md')
const reviewSlicesPath = path.join(root, 'docs', 'superpowers', 'status', '2026-06-19-vela-review-slices.md')
const prDraftPath = path.join(root, 'docs', 'superpowers', 'status', '2026-06-20-vela-pr-draft.md')
const validationLogPath = path.join(root, 'docs', 'superpowers', 'status', '2026-06-20-vela-validation-log.md')
const visualSignoffPath = path.join(root, 'docs', 'superpowers', 'status', '2026-06-20-vela-visual-signoff.md')
const liveBrowserCheckPath = path.join(root, 'docs', 'superpowers', 'status', '2026-06-20-vela-live-browser-check.md')
const manifestPath = path.join(screenshotRoot, 'vela-screenshot-manifest.json')
const galleryPath = path.join(screenshotRoot, 'index.html')

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

function assertScreenshot(file, width, height) {
  const filePath = path.join(screenshotRoot, file)
  assert(fs.existsSync(filePath), `${file} exists after Vela screenshot smoke`)
  if (!fs.existsSync(filePath)) return
  try {
    assertVisualScreenshot(fs.readFileSync(filePath), width, height, file)
    console.log(`PASS: ${file} has expected ${width}x${height} visual detail`)
  } catch (err) {
    failed += 1
    process.exitCode = 1
    console.error(`FAIL: ${file} screenshot regression failed: ${err?.message || String(err)}`)
  }
}

const packageJson = readJson(path.join(root, 'package.json'))
const scripts = packageJson.scripts || {}
const checkVela = scripts['check:vela'] || ''

const requiredCheckScripts = [
  'test:vela-mission',
  'smoke:vela-shell',
  'smoke:vela-entry',
  'smoke:vela-packaged',
  'eval:vela-golden-trace',
  'eval:vela-memory-recall',
  'eval:vela-tool-permission',
  'eval:vela-voice-latency',
  'eval:vela-review-claim',
  'eval:vela-product-contract',
  'eval:vela-review-slices',
  'eval:vela-polish-readiness',
]

for (const name of requiredCheckScripts) {
  assert(typeof scripts[name] === 'string' && scripts[name].trim(), `${name} script exists`)
  assert(checkVela.includes(`npm run ${name}`), `check:vela runs ${name}`)
}

const expectedScreenshots = [
  { file: 'vela-shell-desktop.png', width: 1280, height: 840, group: 'shell', state: 'desktop first screen' },
  { file: 'vela-shell-artifacts.png', width: 1280, height: 840, group: 'shell', state: 'artifact workspace' },
  { file: 'vela-shell-voice-permission.png', width: 1280, height: 840, group: 'shell', state: 'voice permission gate' },
  { file: 'vela-shell-review-blocker.png', width: 1280, height: 840, group: 'shell', state: 'review blocker' },
  { file: 'vela-shell-policy-blocked.png', width: 1280, height: 840, group: 'shell', state: 'policy blocked' },
  { file: 'vela-shell-compact.png', width: 640, height: 760, group: 'shell', state: 'compact layout' },
  { file: 'vela-entry-root.png', width: 1280, height: 840, group: 'entry', state: 'entry root first screen' },
  { file: 'vela-entry-artifacts.png', width: 1280, height: 840, group: 'entry', state: 'entry artifact workspace' },
  { file: 'vela-entry-permission.png', width: 1280, height: 840, group: 'entry', state: 'entry permission gate' },
  { file: 'vela-entry-review-blocker.png', width: 1280, height: 840, group: 'entry', state: 'entry review blocker' },
  { file: 'vela-entry-policy-blocked.png', width: 1280, height: 840, group: 'entry', state: 'entry policy blocked' },
]

for (const { file, width, height } of expectedScreenshots) {
  assertScreenshot(file, width, height)
}

assert(fs.existsSync(handoffPath), 'Vela Phase 5 handoff exists')
const handoffText = fs.existsSync(handoffPath) ? fs.readFileSync(handoffPath, 'utf-8') : ''
const requiredHandoffText = [
  'Vela Phase 5 Handoff',
  'The right Intelligence Spine is collapsed by default.',
  'The center Mission Workspace shows one primary surface at a time.',
  'The first screen must not become a dashboard.',
  'npm run check:vela',
  'All passed.',
]
for (const text of requiredHandoffText) {
  assert(handoffText.includes(text), `handoff records ${text}`)
}
for (const name of requiredCheckScripts) {
  assert(handoffText.includes(name), `handoff lists ${name}`)
}
for (const { file } of expectedScreenshots) {
  assert(handoffText.includes(file), `handoff lists ${file}`)
}

assert(fs.existsSync(reviewSlicesPath), 'Vela review slices document exists')
const reviewSlicesText = fs.existsSync(reviewSlicesPath) ? fs.readFileSync(reviewSlicesPath, 'utf-8') : ''
const requiredSliceText = [
  'Slice 1: Mission Runtime And API',
  'Slice 2: Vela Shell And Chinese UI',
  'Slice 3: Screenshot And Entry Regression',
  'Slice 4: Phase 5 Evals And Packaging Readiness',
  'Slice 5: Handoff Documentation',
  'eval:vela-review-slices',
  'npm run check:vela',
  'npm run smoke:brain-ui',
]
for (const text of requiredSliceText) {
  assert(reviewSlicesText.includes(text), `review slices record ${text}`)
}

assert(fs.existsSync(prDraftPath), 'Vela PR draft exists')
const prDraftText = fs.existsSync(prDraftPath) ? fs.readFileSync(prDraftPath, 'utf-8') : ''
const requiredPrDraftText = [
  'Vela PR Draft',
  'npm run check:vela',
  'npm run smoke:brain-ui',
  'git diff --check',
  'Intelligence Spine initializes collapsed.',
  'Current Vela dirty files are assigned to review slices.',
]
for (const text of requiredPrDraftText) {
  assert(prDraftText.includes(text), `PR draft records ${text}`)
}

assert(fs.existsSync(validationLogPath), 'Vela validation log exists')
const validationLogText = fs.existsSync(validationLogPath) ? fs.readFileSync(validationLogPath, 'utf-8') : ''
const requiredValidationText = [
  'Vela Validation Log',
  'Latest verified locally on 2026-06-20',
  'npm run check:vela',
  'npm run smoke:brain-ui',
  'git diff --check',
  'All passed.',
  'The right Intelligence Spine initializes collapsed.',
  'The center Mission Workspace keeps one active workspace mode.',
  'Visual smoke blocks common untranslated English fixture text in Vela screenshots.',
  '11 PNG screenshots covering shell and real entry states',
]
for (const text of requiredValidationText) {
  assert(validationLogText.includes(text), `validation log records ${text}`)
}
for (const name of requiredCheckScripts) {
  assert(validationLogText.includes(name), `validation log lists ${name}`)
}

assert(fs.existsSync(visualSignoffPath), 'Vela visual sign-off exists')
const visualSignoffText = fs.existsSync(visualSignoffPath) ? fs.readFileSync(visualSignoffPath, 'utf-8') : ''
const requiredVisualSignoffText = [
  'Vela Visual Sign-Off',
  'the right Intelligence Spine is collapsed by default',
  'the Mission Workspace presents one primary surface at a time',
  'the first screen does not read as a dashboard',
  'Vela Voice remains available at the bottom',
  'permission, review, and policy blockers appear in the main workflow',
  'Vela Phase 5 visual sign-off passes',
]
for (const text of requiredVisualSignoffText) {
  assert(visualSignoffText.includes(text), `visual sign-off records ${text}`)
}
for (const { file } of expectedScreenshots) {
  assert(visualSignoffText.includes(file), `visual sign-off lists ${file}`)
}

assert(fs.existsSync(liveBrowserCheckPath), 'Vela live browser check exists')
const liveBrowserCheckText = fs.existsSync(liveBrowserCheckPath) ? fs.readFileSync(liveBrowserCheckPath, 'utf-8') : ''
const requiredLiveBrowserText = [
  'Vela Live Browser Check',
  'http://127.0.0.1:4173/vela.html',
  'Vela · AI 操作台',
  'Document language: `zh-CN`',
  'Current mission heading: `构建 Vela Shell`',
  'Intelligence Spine visual rail width: `72px`',
  'live DOM inspection is available',
  'the right Intelligence Spine remains visually collapsed',
]
for (const text of requiredLiveBrowserText) {
  assert(liveBrowserCheckText.includes(text), `live browser check records ${text}`)
}

if (failed > 0) {
  console.error('\nRun npm run smoke:vela-shell && npm run smoke:vela-entry before this eval if screenshots are missing.')
  process.exit(1)
}

const manifest = {
  generatedAt: new Date().toISOString(),
  source: 'npm run eval:vela-polish-readiness',
  root: path.relative(root, screenshotRoot),
  screenshots: expectedScreenshots.map(item => ({
    ...item,
    path: path.join(path.relative(root, screenshotRoot), item.file),
  })),
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')
const galleryItems = expectedScreenshots.map(item => `
      <article class="shot">
        <a href="./${item.file}"><img src="./${item.file}" alt="${item.file}"></a>
        <h2>${item.state}</h2>
        <p>${item.group} / ${item.width}x${item.height}</p>
        <code>${item.file}</code>
      </article>`).join('\n')
fs.writeFileSync(galleryPath, `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vela Screenshot Review</title>
  <style>
    body { margin: 0; font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #e8edf2; background: #111418; }
    header { padding: 24px 28px 10px; border-bottom: 1px solid #2b323b; }
    h1 { margin: 0 0 6px; font-size: 24px; font-weight: 650; }
    header p { margin: 0 0 14px; color: #a7b0bb; }
    main { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 18px; padding: 24px 28px 32px; }
    .shot { min-width: 0; border: 1px solid #2b323b; background: #171b20; border-radius: 8px; overflow: hidden; }
    .shot img { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: contain; background: #07090c; border-bottom: 1px solid #2b323b; }
    .shot h2 { margin: 14px 14px 4px; font-size: 15px; font-weight: 650; }
    .shot p { margin: 0 14px 8px; color: #9ea8b4; }
    .shot code { display: block; margin: 0 14px 14px; color: #9bd8ff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  </style>
</head>
<body>
  <header>
    <h1>Vela Screenshot Review</h1>
    <p>Generated by <code>npm run eval:vela-polish-readiness</code>. Click any image to open the full PNG.</p>
  </header>
  <main>
${galleryItems}
  </main>
</body>
</html>
`, 'utf-8')
assert(fs.existsSync(manifestPath), 'screenshot manifest was written')
assert(fs.existsSync(galleryPath), 'screenshot gallery was written')

console.log('\n[PASS] vela polish readiness eval')
console.log(JSON.stringify({
  checkScripts: requiredCheckScripts,
  handoff: path.relative(root, handoffPath),
  reviewSlices: path.relative(root, reviewSlicesPath),
  prDraft: path.relative(root, prDraftPath),
  validationLog: path.relative(root, validationLogPath),
  visualSignoff: path.relative(root, visualSignoffPath),
  liveBrowserCheck: path.relative(root, liveBrowserCheckPath),
  screenshotManifest: path.relative(root, manifestPath),
  screenshotGallery: path.relative(root, galleryPath),
  screenshots: expectedScreenshots.map(({ file, width, height, group, state }) => ({ file, width, height, group, state })),
}, null, 2))
