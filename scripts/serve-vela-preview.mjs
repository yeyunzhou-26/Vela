import fs from 'fs'
import os from 'os'
import path from 'path'

const port = Number(process.env.VELA_PREVIEW_PORT || process.env.PORT || 4173)
const previewUserDir = process.env.VELA_PREVIEW_USER_DIR || path.join(os.tmpdir(), 'blm-vela-preview')
process.env.BAILONGMA_USER_DIR ||= previewUserDir

fs.mkdirSync(previewUserDir, { recursive: true })
const previewConfigFile = path.join(previewUserDir, 'config.json')
if (!fs.existsSync(previewConfigFile)) {
  fs.writeFileSync(previewConfigFile, JSON.stringify({
    schemaVersion: 1,
    provider: 'custom',
    apiKey: 'none',
    model: 'vela-preview',
    baseURL: 'http://127.0.0.1:9/v1',
  }, null, 2), 'utf-8')
}

const previewMissionStore = path.join(previewUserDir, 'data', 'vela-missions.json')
const keepPreviewData = process.env.VELA_PREVIEW_KEEP_DATA === '1'
const forceResetPreviewData = process.env.VELA_PREVIEW_RESET === '1'

function includesDemoText(value) {
  return /(?:Build Vela Shell|Smoke Runtime Mission|Entry Smoke Mission|Smoke UI Mission|Blocked Review Mission|Policy Blocked Mission|Live Preview|Seed Shell|Shell Handoff|smoke\.runtime)/i
    .test(String(value || ''))
}

function looksLikeDemoMission(mission = {}) {
  return [
    mission.title,
    mission.goal,
    mission.nextStep,
    ...(Array.isArray(mission.inputs) ? mission.inputs.map(item => `${item.source || ''} ${item.text || ''}`) : []),
    ...(Array.isArray(mission.artifacts) ? mission.artifacts.map(item => `${item.title || item.name || ''} ${item.summary || item.detail || ''}`) : []),
    ...(Array.isArray(mission.toolCalls) ? mission.toolCalls.map(item => `${item.toolName || item.name || ''} ${item.result || item.summary || ''}`) : []),
    ...(Array.isArray(mission.reviewChecks) ? mission.reviewChecks.map(item => `${item.title || ''} ${item.summary || ''}`) : []),
  ].some(includesDemoText)
}

function resetDemoPreviewStoreIfNeeded() {
  if (keepPreviewData || !fs.existsSync(previewMissionStore)) return
  let parsed = null
  try {
    parsed = JSON.parse(fs.readFileSync(previewMissionStore, 'utf-8'))
  } catch {
    parsed = null
  }
  const shouldReset = forceResetPreviewData
    || !parsed
    || (Array.isArray(parsed.missions) && parsed.missions.some(looksLikeDemoMission))
  if (!shouldReset) return
  const backupFile = `${previewMissionStore}.bak-${Date.now()}`
  fs.mkdirSync(path.dirname(previewMissionStore), { recursive: true })
  try {
    fs.renameSync(previewMissionStore, backupFile)
    console.log(`[Vela Preview] Backed up demo mission store to ${backupFile}`)
  } catch (err) {
    console.warn(`[Vela Preview] Could not reset demo mission store: ${err.message}`)
  }
}

resetDemoPreviewStoreIfNeeded()

const { startAPI } = await import('../src/api.js')
const server = startAPI(port)

function shutdown() {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500).unref?.()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
