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

const { startAPI } = await import('../src/api.js')
const server = startAPI(port)

function shutdown() {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500).unref?.()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
