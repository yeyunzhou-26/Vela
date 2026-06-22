import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const WECHAT_ILINK_ENV = {
  token: 'VELA_WECHAT_ILINK_TOKEN',
  accountId: 'VELA_WECHAT_ILINK_ACCOUNT_ID',
  baseUrl: 'VELA_WECHAT_ILINK_BASE_URL',
  defaultRecipientUserId: 'VELA_WECHAT_ILINK_DEFAULT_TO_USER_ID',
}

function asText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function envValue(env = {}, key = '', fallback = '') {
  return asText(env?.[key], fallback)
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

export function readWechatIlinkCredentials(env = typeof process === 'undefined' ? {} : process.env) {
  return {
    token: envValue(env, WECHAT_ILINK_ENV.token),
    accountId: envValue(env, WECHAT_ILINK_ENV.accountId),
    baseUrl: envValue(env, WECHAT_ILINK_ENV.baseUrl, 'https://ilinkai.weixin.qq.com'),
    defaultRecipientUserId: envValue(env, WECHAT_ILINK_ENV.defaultRecipientUserId),
  }
}

export function preflightWechatIlinkAdapter(options = {}) {
  const env = options.env || (typeof process === 'undefined' ? {} : process.env)
  const capability = asText(options.capability, 'messages.confirmed-send')
  const credentials = readWechatIlinkCredentials(env)
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
    `微信缺少凭据：${missingCredentials.length ? missingCredentials.join(', ') : 'none'}`,
    `微信收件人 ID 状态：${asText(preflight.recipientStatus, 'missing')}`,
  ]
}
