import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const velaUiRoot = path.join(root, 'src', 'ui', 'vela')

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

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf-8')
}

function walkFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return walkFiles(fullPath)
    return entry.isFile() ? [fullPath] : []
  })
}

const velaHtml = read('vela.html')
const appShell = read('src/ui/vela/app-shell.js')
const spine = read('src/ui/vela/intelligence-spine.js')
const workspace = read('src/ui/vela/mission-workspace.js')
const locale = read('src/ui/vela/locale.js')
const visualAssertions = read('scripts/vela-visual-assertions.mjs')
const uiFiles = walkFiles(velaUiRoot)
  .filter(file => /\.(css|js)$/.test(file))
  .map(file => ({
    file: path.relative(root, file),
    text: fs.readFileSync(file, 'utf-8'),
  }))

assert(velaHtml.includes('<html lang="zh-CN">'), 'Vela HTML declares zh-CN')
assert(velaHtml.includes('id="vela-root"'), 'Vela HTML exposes the Vela root')
assert(velaHtml.includes('aria-label="Vela AI 操作台"'), 'Vela HTML labels the Chinese operating desk')
assert(velaHtml.includes('src="/src/ui/vela/app-shell.js"'), 'Vela HTML loads the Vela shell entry')
assert(!velaHtml.includes('/src/ui/brain-ui/'), 'Vela HTML does not load Brain UI assets')

assert(appShell.includes("openSpinePanel: ''"), 'Vela shell starts with no open spine panel')
assert(appShell.includes("workspaceMode: 'plan'"), 'Vela shell starts on the plan workspace')
assert(appShell.includes("voiceState: 'Idle'"), 'Vela shell starts with idle voice state')
assert(appShell.includes('renderMissionWorkspace'), 'Vela shell renders Mission Workspace as the center surface')
assert(appShell.includes('renderIntelligenceSpine'), 'Vela shell renders Intelligence Spine separately')

assert(spine.includes("spine.dataset.collapsed = 'true'"), 'Intelligence Spine initializes collapsed')
assert(spine.includes("panel.setAttribute('aria-hidden', 'true')"), 'Intelligence Spine panel starts hidden')
assert(spine.includes("spine.dataset.collapsed = willExpand ? 'false' : 'true'"), 'Intelligence Spine only expands through explicit toggle')

assert(workspace.includes("workspace.setAttribute('aria-label', zh('Mission Workspace'))"), 'Mission Workspace has a localized aria contract')
assert(workspace.includes('renderWorkspaceTabs(activeMode, artifacts.length)'), 'Mission Workspace uses one active workspace mode')
assert(workspace.includes('missionAttention(mission)'), 'Mission Workspace surfaces guard and review attention without opening the spine')
assert(workspace.includes('assistant-canvas'), 'Mission Workspace defaults to a chat-first assistant canvas')
assert(workspace.includes('assistant-process-switcher'), 'Mission Workspace keeps process details secondary')
assert(workspace.includes("zh('Tell Vela what to do')"), 'Mission input is phrased as a natural assistant composer')
assert(workspace.includes('quick-command'), 'Mission Workspace offers natural one-click chat commands on the empty screen')
assert(workspace.includes('assistantThreadTurns'), 'Mission Workspace synthesizes multi-step mission state into chat turns')
assert(workspace.includes('latestSendReceiptArtifact'), 'Mission Workspace can show confirmed external-send receipts in the chat flow')

assert(locale.includes("'Mission Workspace': '任务工作区'"), 'locale localizes Mission Workspace')
assert(locale.includes("'Vela Assistant': 'Vela 助手'"), 'locale localizes the chat-first assistant shell')
assert(locale.includes("'Permission blocked': '许可已阻断'"), 'locale localizes permission blocked state')
assert(locale.includes("'Vela Voice Layer': 'Vela 语音层'"), 'locale localizes voice layer')
assert(visualAssertions.includes('assertNoOverlappingChatBubbles'), 'visual assertions catch overlapping chat bubbles')

const brainAssetReferences = uiFiles
  .filter(item => /\/src\/ui\/brain-ui\/|src\/ui\/brain-ui|from ['"][^'"]*brain-ui|import\([^)]*brain-ui/.test(item.text))
  .map(item => item.file)
assert(brainAssetReferences.length === 0, `Vela UI does not import Brain UI assets: ${brainAssetReferences.join(', ')}`)

const dashboardChrome = uiFiles
  .filter(item => /\b[Dd]ashboard\b/.test(item.text))
  .map(item => item.file)
assert(dashboardChrome.length === 0, `Vela UI source does not introduce dashboard chrome: ${dashboardChrome.join(', ')}`)

if (failed > 0) process.exit(1)

console.log('\n[PASS] vela product contract eval')
console.log(JSON.stringify({
  checkedFiles: uiFiles.map(item => item.file),
  hardRules: [
    'zh-CN Vela entry',
    'no Brain UI assets in Vela shell',
    'collapsed Intelligence Spine by default',
    'chat-first Mission Workspace with secondary process details',
    'no dashboard chrome in Vela UI source',
  ],
}, null, 2))
