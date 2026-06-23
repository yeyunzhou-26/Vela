import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { paths } from '../paths.js'

const require = createRequire(import.meta.url)

const WECHAT_ILINK_ENV = {
  token: 'VELA_WECHAT_ILINK_TOKEN',
  accountId: 'VELA_WECHAT_ILINK_ACCOUNT_ID',
  baseUrl: 'VELA_WECHAT_ILINK_BASE_URL',
  defaultRecipientUserId: 'VELA_WECHAT_ILINK_DEFAULT_TO_USER_ID',
}
const DEFAULT_WECHAT_ILINK_CREDENTIALS_FILE = 'vela-wechat-ilink-credentials.json'

function asText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function envValue(env = {}, key = '', fallback = '') {
  return asText(env?.[key], fallback)
}

function maybeReadJsonFile(filePath = '') {
  const target = asText(filePath)
  if (!target || !fs.existsSync(target)) return null
  try {
    return JSON.parse(fs.readFileSync(target, 'utf-8'))
  } catch {
    return null
  }
}

function redactSecret(value = '') {
  const text = asText(value)
  if (!text) return ''
  if (text.length <= 8) return `${text.slice(0, 2)}...`
  return `${text.slice(0, 4)}...${text.slice(-4)}`
}

function resolveWechatIlinkPackage() {
  try {
    return import.meta.resolve('wechat-ilink-client')
  } catch {
    // Keep a CommonJS resolver fallback for older runtimes.
  }
  try {
    return require.resolve('wechat-ilink-client')
  } catch {
    return ''
  }
}

export function wechatIlinkCredentialStorePath(options = {}) {
  return path.join(asText(options.dataDir, paths.dataDir), DEFAULT_WECHAT_ILINK_CREDENTIALS_FILE)
}

export function normalizeWechatIlinkCredentials(value = {}) {
  const now = new Date().toISOString()
  return {
    token: asText(value.token || value.botToken),
    accountId: asText(value.accountId || value.ilinkBotId),
    baseUrl: asText(value.baseUrl || value.baseurl, 'https://ilinkai.weixin.qq.com'),
    defaultRecipientUserId: asText(value.defaultRecipientUserId || value.defaultToUserId || value.toUserId),
    savedAt: asText(value.savedAt, now),
    source: asText(value.source, 'local-store'),
  }
}

export function redactWechatIlinkCredentials(value = {}) {
  const normalized = normalizeWechatIlinkCredentials(value)
  return {
    token: normalized.token ? redactSecret(normalized.token) : '',
    accountId: normalized.accountId ? redactSecret(normalized.accountId) : '',
    baseUrl: normalized.baseUrl,
    defaultRecipientUserId: normalized.defaultRecipientUserId ? redactSecret(normalized.defaultRecipientUserId) : '',
    savedAt: normalized.savedAt,
    source: normalized.source,
  }
}

export function loadWechatIlinkStoredCredentials(options = {}) {
  return normalizeWechatIlinkCredentials(maybeReadJsonFile(asText(options.filePath, wechatIlinkCredentialStorePath(options))) || {})
}

export function saveWechatIlinkCredentials(value = {}, options = {}) {
  const filePath = asText(options.filePath, wechatIlinkCredentialStorePath(options))
  const credentials = normalizeWechatIlinkCredentials({
    ...value,
    savedAt: asText(options.savedAt, new Date().toISOString()),
    source: asText(options.source, 'local-store'),
  })
  if (!credentials.token || !credentials.accountId) {
    throw new Error('WeChat iLink token and accountId are required before saving credentials.')
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 })
  try {
    fs.chmodSync(filePath, 0o600)
  } catch {
    // Some filesystems ignore POSIX modes; the file still stays in userData.
  }
  return {
    filePath,
    credentials: redactWechatIlinkCredentials(credentials),
  }
}

export function removeWechatIlinkCredentials(options = {}) {
  const filePath = asText(options.filePath, wechatIlinkCredentialStorePath(options))
  if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true })
  return { filePath, removed: true }
}

function isStructuredCredentialOptions(value = {}) {
  return Boolean(value && (
    Object.prototype.hasOwnProperty.call(value, 'env')
    || Object.prototype.hasOwnProperty.call(value, 'filePath')
    || Object.prototype.hasOwnProperty.call(value, 'dataDir')
    || Object.prototype.hasOwnProperty.call(value, 'storedCredentials')
  ))
}

export function readWechatIlinkCredentials(options = undefined) {
  const structured = isStructuredCredentialOptions(options)
  const optionBag = structured ? options : {}
  const env = structured
    ? (options.env || (typeof process === 'undefined' ? {} : process.env))
    : (options || (typeof process === 'undefined' ? {} : process.env))
  const storedCredentials = optionBag.storedCredentials || loadWechatIlinkStoredCredentials(optionBag)
  const hasEnvCredentials = Boolean(envValue(env, WECHAT_ILINK_ENV.token) || envValue(env, WECHAT_ILINK_ENV.accountId))
  const hasStoredCredentials = Boolean(storedCredentials.token || storedCredentials.accountId)
  return {
    token: envValue(env, WECHAT_ILINK_ENV.token, storedCredentials.token),
    accountId: envValue(env, WECHAT_ILINK_ENV.accountId, storedCredentials.accountId),
    baseUrl: envValue(env, WECHAT_ILINK_ENV.baseUrl, storedCredentials.baseUrl || 'https://ilinkai.weixin.qq.com'),
    defaultRecipientUserId: envValue(env, WECHAT_ILINK_ENV.defaultRecipientUserId, storedCredentials.defaultRecipientUserId),
    source: hasEnvCredentials ? 'environment' : (hasStoredCredentials ? storedCredentials.source : 'none'),
    storePath: asText(optionBag.filePath, wechatIlinkCredentialStorePath(optionBag)),
  }
}

export function preflightWechatIlinkAdapter(options = {}) {
  const env = options.env || (typeof process === 'undefined' ? {} : process.env)
  const capability = asText(options.capability, 'messages.confirmed-send')
  const credentials = readWechatIlinkCredentials({ ...options, env })
  const packagePath = resolveWechatIlinkPackage()
  const packageAvailable = Boolean(packagePath)
  const missingCredentials = []
  if (!credentials.token) missingCredentials.push(WECHAT_ILINK_ENV.token)
  if (!credentials.accountId) missingCredentials.push(WECHAT_ILINK_ENV.accountId)

  const recipientUserId = asText(options.recipientUserId, credentials.defaultRecipientUserId)
  const sendCapability = capability === 'messages.confirmed-send'
  const supported = sendCapability
  const recipientReady = !sendCapability || Boolean(recipientUserId)
  const available = packageAvailable && supported && missingCredentials.length === 0 && recipientReady
  const missingParts = []
  if (!packageAvailable) missingParts.push('未安装 wechat-ilink-client。')
  if (!supported) missingParts.push(`wechat-ilink-client 不提供 ${capability} 能力。`)
  if (missingCredentials.length) missingParts.push(`缺少环境变量：${missingCredentials.join(', ')}。`)
  if (!recipientReady) missingParts.push(`缺少收件人 iLink 用户 ID，可通过 ${WECHAT_ILINK_ENV.defaultRecipientUserId} 或任务上下文提供。`)

  return {
    adapterId: 'wechat-ilink',
    appId: 'wechat',
    appName: '微信',
    protocol: 'wechat-ilink-client',
    packageAvailable,
    packagePath,
    capability,
    realAdapterEntry: `desktop://adapters/wechat/${capability}`,
    supported,
    available,
    executionMode: available ? 'live' : 'simulated',
    adapterStatus: available ? 'real-adapter-ready' : 'real-adapter-pending',
    credentialStatus: missingCredentials.length ? 'missing' : 'configured',
    credentialSource: credentials.source,
    credentialStorePath: credentials.storePath,
    redactedCredentials: redactWechatIlinkCredentials(credentials),
    missingCredentials,
    recipientStatus: recipientReady ? 'configured' : 'missing',
    recipientUserId,
    requiredGuards: ['External message'],
    missingConnector: missingParts.join(' ') || 'wechat-ilink-client 已完成预检；发送前仍需要 External message 确认。',
  }
}

export function wechatIlinkEvidence(preflight = {}) {
  const missingCredentials = Array.isArray(preflight.missingCredentials) ? preflight.missingCredentials : []
  return [
    `微信协议：${asText(preflight.protocol, 'wechat-ilink-client')}`,
    `微信库可用：${preflight.packageAvailable ? 'yes' : 'no'}`,
    `微信凭据状态：${asText(preflight.credentialStatus, 'missing')}`,
    `微信凭据来源：${asText(preflight.credentialSource, 'none')}`,
    `微信凭据存储：${asText(preflight.credentialStorePath)}`,
    `微信缺少凭据：${missingCredentials.length ? missingCredentials.join(', ') : 'none'}`,
    `微信收件人 ID 状态：${asText(preflight.recipientStatus, 'missing')}`,
  ]
}

export function prepareWechatIlinkLoginRequest(options = {}) {
  const credentialStorePath = asText(options.filePath, wechatIlinkCredentialStorePath(options))
  const packagePath = resolveWechatIlinkPackage()
  return {
    adapterId: 'wechat-ilink',
    action: 'wechat-ilink.qr-login.prepare',
    risk: 'Credential',
    packageAvailable: Boolean(packagePath),
    packagePath,
    credentialStorePath,
    summary: '准备微信 iLink 扫码登录：只生成登录准备和凭据保存位置，不自动发起扫码、不保存凭据、不发送消息。',
    guardrail: '扫码登录、保存 token/accountId、发送消息都必须分别经过用户确认。',
    requiredCredentialFields: ['botToken', 'accountId', 'baseUrl'],
  }
}
