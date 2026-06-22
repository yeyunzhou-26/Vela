function asText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function normalizedId(value = '', fallback = 'desktop-app') {
  return asText(value, fallback).toLowerCase().replace(/[^a-z0-9-]+/g, '-') || fallback
}

function normalizedCapabilityId(value = '', fallback = 'screen-context') {
  return asText(value, fallback).toLowerCase().replace(/[^a-z0-9.-]+/g, '-') || fallback
}

const DESKTOP_ADAPTER_CATALOG = {
  wechat: {
    appId: 'wechat',
    appName: '微信',
    missingConnector: '未连接 macOS/微信自动化适配器。',
    supportedCapabilities: ['screen-context', 'messages.confirmed-send'],
  },
  'system-settings': {
    appId: 'system-settings',
    appName: '系统设置',
    missingConnector: '未连接 macOS 系统设置自动化适配器。',
    supportedCapabilities: ['screen-context'],
  },
  'desktop-app': {
    appId: 'desktop-app',
    appName: '目标应用',
    missingConnector: '未连接通用桌面自动化适配器。',
    supportedCapabilities: ['screen-context'],
  },
}

function enabledRealAdapterIds() {
  const raw = typeof process === 'undefined' ? '' : process.env?.VELA_REAL_DESKTOP_ADAPTERS
  return new Set(asText(raw).split(',').map(item => normalizedId(item)).filter(Boolean))
}

export function normalizeDesktopAdapterTarget(target = {}) {
  const fromUrl = asText(target.appUrl).replace(/^app:\/\//, '')
  const appId = normalizedId(target.appId || fromUrl, 'desktop-app')
  const catalogEntry = DESKTOP_ADAPTER_CATALOG[appId] || DESKTOP_ADAPTER_CATALOG['desktop-app']
  return {
    appId,
    appName: asText(target.appName, catalogEntry.appName),
    appUrl: asText(target.appUrl, `app://${appId}`),
    catalogEntry,
  }
}

export function describeDesktopAdapter(target = {}, capability = 'screen-context') {
  const normalized = normalizeDesktopAdapterTarget(target)
  const capabilityId = normalizedCapabilityId(capability, 'screen-context')
  const enabled = enabledRealAdapterIds()
  const realAdapterReady = enabled.has(normalized.appId) || enabled.has('*')
  const supported = normalized.catalogEntry.supportedCapabilities.includes(capabilityId)
  const available = realAdapterReady && supported
  const adapterStatus = available ? 'real-adapter-ready' : 'real-adapter-pending'
  const executionMode = available ? 'live' : 'simulated'
  const realAdapterEntry = `desktop://adapters/${normalized.appId}/${capabilityId}`
  return {
    appId: normalized.appId,
    appName: normalized.appName,
    appUrl: normalized.appUrl,
    capability: capabilityId,
    realAdapterEntry,
    executionMode,
    adapterStatus,
    available,
    supported,
    requiredGuards: capabilityId === 'messages.confirmed-send'
      ? ['Screen', 'External message']
      : ['Screen'],
    missingConnector: supported
      ? normalized.catalogEntry.missingConnector
      : `当前目录没有声明 ${normalized.appName} 的 ${capabilityId} 能力。`,
    modeSummary: available
      ? `真实${normalized.appName}适配器已可用；执行前仍必须通过对应 Guard。`
      : `当前为模拟链路；${supported ? normalized.catalogEntry.missingConnector : `未声明 ${capabilityId} 能力。`}`,
  }
}

export function desktopAdapterEvidence(adapter = {}) {
  return [
    `执行模式：${asText(adapter.executionMode, 'simulated')}`,
    `适配器状态：${asText(adapter.adapterStatus, 'real-adapter-pending')}`,
    `真实适配器入口：${asText(adapter.realAdapterEntry)}`,
    `真实适配器可用：${adapter.available ? 'yes' : 'no'}`,
    `适配器缺口：${asText(adapter.missingConnector, '未连接真实桌面自动化适配器。')}`,
  ]
}
