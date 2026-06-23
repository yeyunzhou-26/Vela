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
  botType: 'VELA_WECHAT_ILINK_BOT_TYPE',
  routeTag: 'VELA_WECHAT_ILINK_ROUTE_TAG',
  enableRealLogin: 'VELA_WECHAT_ILINK_ENABLE_REAL_LOGIN',
  enableRealSend: 'VELA_WECHAT_ILINK_ENABLE_REAL_SEND',
}
const DEFAULT_WECHAT_ILINK_CREDENTIALS_FILE = 'vela-wechat-ilink-credentials.json'
const DEFAULT_WECHAT_ILINK_BOT_TYPE = '3'

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

function enabledFlag(value) {
  return /^(1|true|yes|on|live|enabled)$/i.test(asText(value))
}

function shouldAllowWechatIlinkNetwork(options = {}, env = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'allowNetwork')) {
    return options.allowNetwork === true
  }
  return enabledFlag(envValue(env, WECHAT_ILINK_ENV.enableRealLogin))
}

function shouldAllowWechatIlinkSend(options = {}, env = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'allowSend')) {
    return options.allowSend === true
  }
  if (Object.prototype.hasOwnProperty.call(options, 'allowNetwork')) {
    return options.allowNetwork === true
  }
  return enabledFlag(envValue(env, WECHAT_ILINK_ENV.enableRealSend))
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

function normalizeWechatIlinkSendPayload(options = {}) {
  const env = options.env || (typeof process === 'undefined' ? {} : process.env)
  const credentials = readWechatIlinkCredentials({ ...options, env })
  return {
    text: asText(options.text || options.message || options.body || options.draftText),
    recipientUserId: asText(options.recipientUserId || options.toUserId || options.to, credentials.defaultRecipientUserId),
    contextToken: asText(options.contextToken),
    credentials,
  }
}

export async function sendWechatIlinkTextMessage(options = {}) {
  const env = options.env || (typeof process === 'undefined' ? {} : process.env)
  const payload = normalizeWechatIlinkSendPayload({ ...options, env })
  const preflight = preflightWechatIlinkAdapter({
    ...options,
    env,
    capability: 'messages.confirmed-send',
    recipientUserId: payload.recipientUserId,
  })
  const realSendEnabled = shouldAllowWechatIlinkSend(options, env)
  const base = {
    adapterId: 'wechat-ilink',
    action: 'wechat-ilink.messages.confirmed-send',
    risk: 'External message',
    packageAvailable: Boolean(preflight.packageAvailable),
    packagePath: asText(preflight.packagePath),
    credentialStatus: asText(preflight.credentialStatus, 'missing'),
    credentialSource: asText(preflight.credentialSource, 'none'),
    credentialStorePath: asText(preflight.credentialStorePath),
    recipientStatus: asText(preflight.recipientStatus, 'missing'),
    recipientUserId: payload.recipientUserId,
    textLength: payload.text.length,
    realSendEnabled,
    executionMode: realSendEnabled ? 'live' : 'simulated',
    status: realSendEnabled ? 'prepared' : 'simulated',
    messageSent: false,
    redactedCredentials: preflight.redactedCredentials || redactWechatIlinkCredentials(payload.credentials),
    reason: realSendEnabled
      ? '真实微信 iLink 发送已启用，等待调用 sendText。'
      : `真实微信 iLink 发送未启用；设置 ${WECHAT_ILINK_ENV.enableRealSend}=1 或传入 allowSend=true 后才会调用 sendText。`,
    nextAction: realSendEnabled ? 'send-text' : 'record-simulated-send-receipt',
    createdAt: asText(options.createdAt, new Date().toISOString()),
  }

  if (!payload.text) {
    return {
      ...base,
      status: 'blocked',
      reason: '缺少待发送文本，未调用微信 iLink。',
      nextAction: 'draft-message-before-send',
    }
  }

  if (!preflight.available) {
    return {
      ...base,
      executionMode: realSendEnabled ? 'live' : 'simulated',
      status: 'blocked',
      reason: preflight.missingConnector || '微信 iLink 发送预检未通过。',
      nextAction: 'connect-wechat-ilink-or-configure-recipient',
    }
  }

  if (!realSendEnabled) {
    return {
      ...base,
      status: 'simulated',
      reason: '已完成微信 iLink 发送预检；本次只记录模拟发送回执，没有调用真实微信接口。',
    }
  }

  try {
    const clientModule = options.clientModule || await import('wechat-ilink-client')
    const WeChatClient = options.WeChatClient || clientModule.WeChatClient
    if (typeof WeChatClient !== 'function' && !options.client) {
      return {
        ...base,
        status: 'blocked',
        reason: 'wechat-ilink-client 没有导出 WeChatClient，无法发送微信文本。',
        nextAction: 'verify-wechat-ilink-client-package',
      }
    }
    const client = options.client || new WeChatClient({
      accountId: payload.credentials.accountId,
      token: payload.credentials.token,
      baseUrl: payload.credentials.baseUrl,
      routeTag: envValue(env, WECHAT_ILINK_ENV.routeTag),
    })
    const receipt = await client.sendText(payload.recipientUserId, payload.text, payload.contextToken || undefined)
    return {
      ...base,
      status: 'sent',
      messageSent: true,
      reason: '已通过微信 iLink sendText 发送文本消息。',
      nextAction: 'record-live-send-receipt',
      receipt: receipt && typeof receipt === 'object' ? {
        type: asText(receipt.type || receipt.messageType || receipt.status, 'sendText'),
      } : { type: 'sendText' },
    }
  } catch (err) {
    return {
      ...base,
      status: 'failed',
      reason: `微信 iLink 发送失败：${asText(err?.message, 'unknown error')}`,
      nextAction: 'retry-after-user-review',
    }
  }
}

export function wechatIlinkSendEvidence(result = {}) {
  return [
    `微信发送状态：${asText(result.status, 'unknown')}`,
    `微信发送模式：${asText(result.executionMode, 'simulated')}`,
    `微信真实发送启用：${result.realSendEnabled ? 'yes' : 'no'}`,
    `微信消息已发送：${result.messageSent ? 'yes' : 'no'}`,
    `微信凭据状态：${asText(result.credentialStatus, 'missing')}`,
    `微信凭据来源：${asText(result.credentialSource, 'none')}`,
    `微信收件人 ID：${result.recipientUserId ? 'present' : 'none'}`,
    `微信发送原因：${asText(result.reason)}`,
  ]
}

export function prepareWechatIlinkLoginRequest(options = {}) {
  const env = options.env || (typeof process === 'undefined' ? {} : process.env)
  const credentialStorePath = asText(options.filePath, wechatIlinkCredentialStorePath(options))
  const packagePath = resolveWechatIlinkPackage()
  const realQrLoginEnabled = shouldAllowWechatIlinkNetwork(options, env)
  return {
    adapterId: 'wechat-ilink',
    action: 'wechat-ilink.qr-login.prepare',
    risk: 'Credential',
    packageAvailable: Boolean(packagePath),
    packagePath,
    credentialStorePath,
    botType: asText(options.botType, envValue(env, WECHAT_ILINK_ENV.botType, DEFAULT_WECHAT_ILINK_BOT_TYPE)),
    baseUrl: asText(options.baseUrl, envValue(env, WECHAT_ILINK_ENV.baseUrl, 'https://ilinkai.weixin.qq.com')),
    realQrLoginEnabled,
    summary: '准备微信 iLink 扫码登录：只生成登录准备和凭据保存位置，不自动发起扫码、不保存凭据、不发送消息。',
    guardrail: '扫码登录、保存 token/accountId、发送消息都必须分别经过用户确认。',
    requiredCredentialFields: ['botToken', 'accountId', 'baseUrl'],
  }
}

function normalizeQrCodeResponse(value = {}) {
  return {
    qrCodeId: asText(value.qrcode || value.qrCode || value.qrCodeId || value.id),
    qrCodeUrl: asText(value.qrcode_img_content || value.qrcodeUrl || value.qrCodeUrl || value.url),
  }
}

function normalizeQrStatusResponse(value = {}) {
  const credentials = normalizeWechatIlinkCredentials({
    token: value.bot_token || value.botToken || value.token,
    accountId: value.ilink_bot_id || value.accountId || value.ilinkBotId,
    baseUrl: value.baseurl || value.baseUrl,
    defaultRecipientUserId: value.ilink_user_id || value.defaultRecipientUserId || value.userId,
    source: 'qr-login',
  })
  return {
    status: asText(value.status, 'unknown'),
    credentials,
    redactedCredentials: redactWechatIlinkCredentials(credentials),
  }
}

function qrSessionBase(request = {}, patch = {}) {
  const now = asText(patch.createdAt, new Date().toISOString())
  return {
    adapterId: 'wechat-ilink',
    action: 'wechat-ilink.qr-login.start',
    risk: 'Credential',
    packageAvailable: Boolean(request.packageAvailable),
    packagePath: asText(request.packagePath),
    credentialStorePath: asText(request.credentialStorePath),
    botType: asText(request.botType, DEFAULT_WECHAT_ILINK_BOT_TYPE),
    baseUrl: asText(request.baseUrl, 'https://ilinkai.weixin.qq.com'),
    realQrLoginEnabled: request.realQrLoginEnabled === true,
    executionMode: 'simulated',
    status: 'waiting-for-network-enable',
    qrCodeId: '',
    qrCodeUrl: '',
    tokenSaved: false,
    messageSent: false,
    guardrail: asText(request.guardrail),
    reason: '真实二维码网络请求未启用。',
    nextAction: 'enable-real-login-after-user-confirmation',
    createdAt: now,
    ...patch,
  }
}

export async function startWechatIlinkQrLoginSession(options = {}) {
  const env = options.env || (typeof process === 'undefined' ? {} : process.env)
  const request = prepareWechatIlinkLoginRequest({ ...options, env })
  const base = qrSessionBase(request, {
    createdAt: asText(options.createdAt, new Date().toISOString()),
  })

  if (!request.packageAvailable) {
    return {
      ...base,
      executionMode: 'unavailable',
      status: 'blocked',
      reason: '未安装 wechat-ilink-client，无法请求微信登录二维码。',
      nextAction: 'install-wechat-ilink-client',
    }
  }

  if (!request.realQrLoginEnabled) {
    return {
      ...base,
      reason: `真实二维码网络请求未启用；设置 ${WECHAT_ILINK_ENV.enableRealLogin}=1 或传入 allowNetwork=true 后才会调用 ApiClient.getQRCode。`,
    }
  }

  try {
    const clientModule = options.clientModule || await import('wechat-ilink-client')
    const ApiClient = options.ApiClient || clientModule.ApiClient
    if (typeof ApiClient !== 'function' && !options.apiClient) {
      return {
        ...base,
        executionMode: 'live',
        status: 'blocked',
        reason: 'wechat-ilink-client 没有导出 ApiClient，无法请求二维码。',
        nextAction: 'verify-wechat-ilink-client-package',
      }
    }
    const api = options.apiClient || new ApiClient({
      baseUrl: request.baseUrl,
      routeTag: envValue(env, WECHAT_ILINK_ENV.routeTag),
    })
    const rawQr = await api.getQRCode(request.botType)
    const qr = normalizeQrCodeResponse(rawQr)
    if (!qr.qrCodeId || !qr.qrCodeUrl) {
      return {
        ...base,
        executionMode: 'live',
        status: 'failed',
        reason: '微信 iLink 返回的二维码响应缺少 qrcode 或 qrcode_img_content。',
        nextAction: 'retry-qr-login',
      }
    }
    return {
      ...base,
      executionMode: 'live',
      status: 'qr-ready',
      qrCodeId: qr.qrCodeId,
      qrCodeUrl: qr.qrCodeUrl,
      reason: '二维码 URL 已生成；未轮询扫码状态，未保存 token/accountId，未发送消息。',
      nextAction: 'display-qr-code',
    }
  } catch (err) {
    return {
      ...base,
      executionMode: 'live',
      status: 'failed',
      reason: `请求微信登录二维码失败：${asText(err?.message, 'unknown error')}`,
      nextAction: 'retry-qr-login',
    }
  }
}

export async function pollWechatIlinkQrLoginStatus(options = {}) {
  const env = options.env || (typeof process === 'undefined' ? {} : process.env)
  const qrCodeId = asText(options.qrCodeId || options.qrcode || options.qrCode)
  const request = prepareWechatIlinkLoginRequest({ ...options, env })
  const base = {
    adapterId: 'wechat-ilink',
    action: 'wechat-ilink.qr-login.poll',
    risk: 'Credential',
    packageAvailable: Boolean(request.packageAvailable),
    packagePath: asText(request.packagePath),
    credentialStorePath: asText(request.credentialStorePath),
    botType: asText(request.botType, DEFAULT_WECHAT_ILINK_BOT_TYPE),
    baseUrl: asText(request.baseUrl, 'https://ilinkai.weixin.qq.com'),
    realQrLoginEnabled: request.realQrLoginEnabled === true,
    executionMode: 'simulated',
    status: 'waiting-for-network-enable',
    qrCodeId,
    credentialsReady: false,
    tokenSaved: false,
    messageSent: false,
    redactedCredentials: redactWechatIlinkCredentials({}),
    reason: '真实二维码状态轮询未启用。',
    nextAction: 'enable-real-login-after-user-confirmation',
    createdAt: asText(options.createdAt, new Date().toISOString()),
  }

  if (!qrCodeId) {
    return {
      ...base,
      status: 'blocked',
      reason: '缺少二维码 ID，无法轮询微信登录状态。',
      nextAction: 'request-new-qr-code',
    }
  }

  if (!request.packageAvailable) {
    return {
      ...base,
      executionMode: 'unavailable',
      status: 'blocked',
      reason: '未安装 wechat-ilink-client，无法轮询微信登录状态。',
      nextAction: 'install-wechat-ilink-client',
    }
  }

  if (!request.realQrLoginEnabled) {
    return {
      ...base,
      reason: `真实二维码状态轮询未启用；设置 ${WECHAT_ILINK_ENV.enableRealLogin}=1 或传入 allowNetwork=true 后才会调用 ApiClient.pollQRCodeStatus。`,
    }
  }

  try {
    const clientModule = options.clientModule || await import('wechat-ilink-client')
    const ApiClient = options.ApiClient || clientModule.ApiClient
    if (typeof ApiClient !== 'function' && !options.apiClient) {
      return {
        ...base,
        executionMode: 'live',
        status: 'blocked',
        reason: 'wechat-ilink-client 没有导出 ApiClient，无法轮询二维码状态。',
        nextAction: 'verify-wechat-ilink-client-package',
      }
    }
    const api = options.apiClient || new ApiClient({
      baseUrl: request.baseUrl,
      routeTag: envValue(env, WECHAT_ILINK_ENV.routeTag),
    })
    const rawStatus = await api.pollQRCodeStatus(qrCodeId)
    const normalized = normalizeQrStatusResponse(rawStatus)
    const credentialsReady = normalized.status === 'confirmed'
      && Boolean(normalized.credentials.token)
      && Boolean(normalized.credentials.accountId)
    return {
      ...base,
      executionMode: 'live',
      status: normalized.status,
      credentialsReady,
      credentials: credentialsReady ? normalized.credentials : normalizeWechatIlinkCredentials({}),
      redactedCredentials: credentialsReady ? normalized.redactedCredentials : redactWechatIlinkCredentials({}),
      reason: credentialsReady
        ? '微信扫码已确认；凭据只在内存结果中返回，尚未保存。'
        : `微信扫码状态：${normalized.status}；尚未保存凭据。`,
      nextAction: credentialsReady ? 'request-credential-save-confirmation' : 'poll-again-or-refresh-qr',
    }
  } catch (err) {
    return {
      ...base,
      executionMode: 'live',
      status: 'failed',
      reason: `轮询微信登录状态失败：${asText(err?.message, 'unknown error')}`,
      nextAction: 'retry-qr-status-poll',
    }
  }
}

export function wechatIlinkQrSessionEvidence(session = {}) {
  return [
    `二维码状态：${asText(session.status, 'unknown')}`,
    `二维码执行模式：${asText(session.executionMode, 'simulated')}`,
    `二维码请求已启用：${session.realQrLoginEnabled ? 'yes' : 'no'}`,
    `二维码 ID：${session.qrCodeId ? 'present' : 'none'}`,
    `二维码 URL：${session.qrCodeUrl ? 'present' : 'none'}`,
    `凭据保存：${session.tokenSaved ? 'yes' : 'no'}`,
    `消息发送：${session.messageSent ? 'yes' : 'no'}`,
    `下一步：${asText(session.nextAction)}`,
  ]
}

export function wechatIlinkQrStatusEvidence(status = {}) {
  return [
    `扫码状态：${asText(status.status, 'unknown')}`,
    `扫码执行模式：${asText(status.executionMode, 'simulated')}`,
    `二维码 ID：${status.qrCodeId ? 'present' : 'none'}`,
    `凭据就绪：${status.credentialsReady ? 'yes' : 'no'}`,
    `凭据保存：${status.tokenSaved ? 'yes' : 'no'}`,
    `消息发送：${status.messageSent ? 'yes' : 'no'}`,
    `下一步：${asText(status.nextAction)}`,
  ]
}
