import fs from 'fs'
import path from 'path'
import { paths } from '../paths.js'
import { executeCapabilityAdapterRun, planCapabilityAdapterRun, prepareCapabilityAdapterResult } from './capability-adapters.js'
import { findOpenCapabilitiesForText } from './capability-registry.js'
import { describeDesktopAdapter, desktopAdapterEvidence } from './desktop-adapter-bridge.js'
import {
  pollWechatIlinkQrLoginStatus,
  prepareWechatIlinkLoginRequest,
  readWechatIlinkRecentMessages,
  saveWechatIlinkCredentials,
  sendWechatIlinkTextMessage,
  startWechatIlinkQrLoginSession,
  wechatIlinkQrSessionEvidence,
  wechatIlinkQrStatusEvidence,
  wechatIlinkReadEvidence,
  wechatIlinkSendEvidence,
} from './wechat-ilink-adapter.js'

export const MISSION_STATES = [
  'Draft',
  'Planned',
  'Running',
  'Waiting for user',
  'Waiting for permission',
  'Blocked',
  'Reviewing',
  'Complete',
  'Failed',
]

export const PERMISSION_MODES = ['Plan', 'Assist', 'Act', 'Auto']
export const AGENT_ROLES = ['Planner', 'Builder', 'Researcher', 'Reviewer', 'Operator']
export const PLAN_STEP_STATUSES = ['Done', 'Active', 'Next', 'Blocked', 'Reviewing']

const STORE_VERSION = 1
const STORE_FILE = path.join(paths.dataDir, 'vela-missions.json')
const TRACE_LIMIT = 120
const REVIEW_PASSING_OUTCOMES = new Set(['pass', 'passed', 'approved', 'ok', 'ready'])
const REVIEW_CHECK_OUTCOMES = ['pending', 'passed', 'failed', 'warning', 'blocked']
const REVIEW_BLOCKING_OUTCOMES = new Set(['failed', 'blocked'])
const VOICE_LATENCY_TARGETS_MS = {
  bargeInStop: 150,
  speechEndToIntent: 400,
  finalAsrToFirstToken: 1500,
  responseSegmentToFirstAudio: 800,
}
const SEED_MISSION_TITLE = 'Vela'
const SEED_MISSION_GOAL = '直接告诉 Vela 你想办什么。它会在后台整理任务、调用工具、保留证据，并在发送消息、改文件或高风险动作前自然确认。'
const SEED_MISSION_NEXT_STEP = '直接说一件想办的事，例如：帮我打开微信，给我老婆回个信息。'
const STARTED_MISSION_NEXT_STEP = '检查任务计划，确认后输入“继续”。'
const RUNNING_MISSION_NEXT_STEP = '任务已进入执行阶段；完成产出后输入“继续”进入审查。'
const REVIEWING_MISSION_NEXT_STEP = '记录审查结果后输入“审查通过”，再输入“完成”。'
const MISSION_BRIEF_TITLE = '任务简报'
const SEED_PLAN = [
  { id: 'describe-mission', label: '说出你想办的事', status: 'Active' },
  { id: 'work-backstage', label: 'Vela 在后台处理', status: 'Next' },
  { id: 'confirm-action', label: '关键动作前确认', status: 'Next' },
]
const STARTED_PLAN = [
  { id: 'clarify-goal', label: '确认任务目标', status: 'Done' },
  { id: 'draft-plan', label: '整理执行计划', status: 'Active' },
  { id: 'execute-review', label: '产出结果并复核', status: 'Next' },
]
const PERSONAL_ASSISTANT_MESSAGE_PLAN = [
  { id: 'understand-request', label: '理解你要办的事', status: 'Done' },
  { id: 'inspect-context', label: '查看相关应用和上下文', status: 'Active' },
  { id: 'draft-reply', label: '草拟可发送内容', status: 'Next' },
  { id: 'confirm-send', label: '确认后再发送', status: 'Next' },
]
const WECHAT_ILINK_LOGIN_PLAN = [
  { id: 'understand-request', label: '理解微信连接目标', status: 'Done' },
  { id: 'prepare-login', label: '准备扫码登录请求', status: 'Active' },
  { id: 'confirm-login', label: '确认后再开始登录', status: 'Next' },
  { id: 'save-credentials', label: '登录成功后确认保存凭据', status: 'Next' },
]
const LEGACY_DEFAULT_PLAN_LABELS = new Map([
  ['clarify-goal|Clarify mission goal', '确认任务目标'],
  ['draft-plan|Draft mission plan', '整理执行计划'],
  ['execute-review|Execute, verify, and review', '产出结果并复核'],
])
const LEGACY_DEFAULT_NEXT_STEPS = new Map([
  ['Review the generated plan and continue.', STARTED_MISSION_NEXT_STEP],
  ['Verify the shell opens with the Intelligence Spine collapsed by default.', SEED_MISSION_NEXT_STEP],
  ['Smoke spine data is loaded from the runtime.', SEED_MISSION_NEXT_STEP],
])

const COMMAND_CONTINUE_RE = /^(?:(?:continue|resume|run|start running)\b|(?:继续|恢复|运行)(?:\s|$))/i
const COMMAND_COMPLETE_RE = /^(?:(?:complete|finish|done|mark complete)\b|(?:完成|结束)(?:\s|$))/i
const COMMAND_REVIEW_PASS_RE = /^(?:(?:review\s+)?(?:pass|passed|approve|approved|ok|ready)\b|(?:审核通过|审查通过|通过审核|通过审查|通过)(?:\s|$))/i
const COMMAND_PERMISSION_RE = /(?:\b(?:permission|approval|approve|approved|allow)\b|权限|批准|许可)/i
const COMMAND_RECOVERY_RE = /(?:\b(?:blocked|recover|recovery|repair|fix blocker)\b|阻塞|恢复|修复)/i
const COMMAND_START_RE = /^(start|new|create|mission|开始|新建|创建)\s*[:：-]?\s+(.+)$/i
const COMMAND_STOP_RE = /^(?:(?:stop|pause|cancel|interrupt)\b|(?:停止|暂停|打断|取消)(?:\s|$))/i
const COMMAND_REPAIR_RE = /^(?:(?:not that|change it to|change that to|repair that)\b|(?:不是这个|不是这样|不对|改一下|修改|改成|改为|修正为|修正)(?:\s|$))/i
const VOICE_CREDENTIAL_RE = /(?:\b(?:password|passcode|api key|secret|token|credential|private key)\b|密码|密钥|令牌|凭证|凭据)/i
const VOICE_EXTERNAL_MESSAGE_RE = /(?:\b(?:send|email|message|post|tweet|dm|reply)\b|发给|发送|邮件|消息|回复|发布)/i
const VOICE_SCREEN_CONTEXT_RE = /(?:\b(?:screen|screenshot|window|app|desktop)\b|屏幕|截图|窗口|桌面)/i
const ASSISTANT_EXTERNAL_MESSAGE_RE = /(?:\b(?:message|reply|dm|text|send)\b|回复|回个|发消息|发信息|发微信|转发|发送)/i
const WECHAT_ILINK_LOGIN_RE = /(?:(?:wechat|weixin|微信).*(?:login|sign in|connect|auth|authorize|授权|登录|连接|接入|绑定|扫码)|(?:login|sign in|connect|auth|authorize|授权|登录|连接|接入|绑定|扫码).*(?:wechat|weixin|微信)|ilink)/i
const WECHAT_QR_SCAN_STATUS_RE = /(?:扫码|二维码|我扫了|已扫|扫好了|扫完了|好了|scan|scanned|qr|login done)/i
const COMMAND_PERMISSION_APPROVE_RE = /(?:\b(?:approve|approved|allow|allowed|grant|granted|authorize|authorized)\b|批准|许可|同意|授权|允许|可以|通过)/i
const COMMAND_PERMISSION_DENY_RE = /(?:\b(?:deny|denied|decline|declined|reject|rejected|disallow)\b|拒绝|否决|驳回|不允许|不可以|不行|不能|不要|别发|别发送)/i
const PENDING_PERMISSION_RE = /^(requested|pending|needs approval|waiting)$/i
const WECHAT_ILINK_PENDING_CREDENTIALS = new Map()

const STATE_TRANSITIONS = {
  Draft: ['Planned', 'Running', 'Waiting for user', 'Blocked', 'Failed'],
  Planned: ['Running', 'Waiting for user', 'Waiting for permission', 'Blocked', 'Failed'],
  Running: ['Waiting for user', 'Waiting for permission', 'Blocked', 'Reviewing', 'Complete', 'Failed'],
  'Waiting for user': ['Running', 'Blocked', 'Failed'],
  'Waiting for permission': ['Running', 'Blocked', 'Failed'],
  Blocked: ['Running', 'Waiting for user', 'Failed'],
  Reviewing: ['Running', 'Complete', 'Failed'],
  Complete: ['Running'],
  Failed: ['Running'],
}

class MissionRuntimeError extends Error {
  constructor(message, code, details = {}) {
    super(message)
    this.name = 'MissionRuntimeError'
    this.code = code
    this.details = details
    if (details.mission) this.mission = details.mission
  }
}

export function createSeedMission(now = new Date().toISOString()) {
  return {
    id: 'mission-vela-shell',
    title: SEED_MISSION_TITLE,
    goal: SEED_MISSION_GOAL,
    state: 'Planned',
    permissionMode: 'Assist',
    modelStatus: 'Local runtime',
    activeSurface: 'Mission Plan',
    nextStep: SEED_MISSION_NEXT_STEP,
    plan: SEED_PLAN.map(step => ({ ...step })),
    inputs: [],
    artifacts: [],
    agentActions: [],
    toolCalls: [],
    permissions: [],
    memoryReferences: [],
    capabilityReferences: [],
    voiceMetrics: [],
    reviewChecks: [],
    reviewResult: null,
    recoveryActions: [],
    trace: [
      {
        id: 'trace-seed-mission',
        missionId: 'mission-vela-shell',
        type: 'mission.seed',
        title: 'Vela ready',
        detail: SEED_MISSION_GOAL,
        result: 'ready',
        createdAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  }
}

function createEmptyStore() {
  const mission = createSeedMission()
  return {
    version: STORE_VERSION,
    currentMissionId: mission.id,
    missions: [mission],
  }
}

function readStore() {
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.missions)) return createEmptyStore()
    const missions = parsed.missions.map(normalizeMission)
    const currentMissionId = missions.some(m => m.id === parsed.currentMissionId)
      ? parsed.currentMissionId
      : missions[0]?.id
    return {
      version: STORE_VERSION,
      currentMissionId,
      missions,
    }
  } catch {
    return createEmptyStore()
  }
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true })
  const tmp = `${STORE_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8')
  fs.renameSync(tmp, STORE_FILE)
}

function asText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function normalizeState(value, fallback = 'Draft') {
  const state = asText(value, fallback)
  if (!MISSION_STATES.includes(state)) throw new Error(`Invalid mission state: ${state}`)
  return state
}

function normalizePermissionMode(value, fallback = 'Assist') {
  const mode = asText(value, fallback)
  if (!PERMISSION_MODES.includes(mode)) throw new Error(`Invalid permission mode: ${mode}`)
  return mode
}

export function isPendingPermissionDecision(value) {
  return PENDING_PERMISSION_RE.test(asText(value))
}

function normalizePermissionDecision(value, fallback = 'approved') {
  const decision = asText(value).toLowerCase()
  if (!decision) return fallback
  if (COMMAND_PERMISSION_DENY_RE.test(decision)) return 'denied'
  if (COMMAND_PERMISSION_APPROVE_RE.test(decision)) return 'approved'
  return fallback
}

function isReadOnlyRisk(risk) {
  return /^(read|analysis|inspect|context|memory)$/i.test(asText(risk))
}

function isScopedActionRisk(risk) {
  return /^(write|edit|execute|command)$/i.test(asText(risk))
}

function isTrustedRecurring(input = {}) {
  return input.trusted === true
    || input.trustedRecurring === true
    || input.recurring === true
    || /^(true|yes|trusted)$/i.test(asText(input.trust || input.trusted))
}

function permissionModePolicy({ mode, risk, decision, input = {} } = {}) {
  const requestedDecision = asText(decision, 'requested')
  if (!isPendingPermissionDecision(requestedDecision)) {
    return {
      decision: requestedDecision,
      policy: `${mode} explicit decision`,
      result: requestedDecision,
      reason: '',
    }
  }

  if (mode === 'Plan') {
    if (isReadOnlyRisk(risk)) {
      return {
        decision: 'approved',
        policy: 'Plan read-only allow',
        result: 'allowed',
        reason: 'Plan mode only allows read-only analysis.',
      }
    }
    return {
      decision: 'denied',
      policy: 'Plan read-only block',
      result: 'blocked',
      reason: 'Plan mode blocks non-read actions.',
      blockMission: true,
    }
  }

  if (mode === 'Assist') {
    if (isReadOnlyRisk(risk)) {
      return {
        decision: 'approved',
        policy: 'Assist read allow',
        result: 'allowed',
        reason: 'Assist mode allows read-only actions.',
      }
    }
    return {
      decision: 'requested',
      policy: 'Assist approval gate',
      result: 'approval_required',
      reason: 'Assist mode requires approval for edits, commands, and external effects.',
    }
  }

  if (mode === 'Act') {
    if (isReadOnlyRisk(risk) || isScopedActionRisk(risk)) {
      return {
        decision: 'approved',
        policy: 'Act scoped-action allow',
        result: 'allowed',
        reason: 'Act mode allows scoped local actions under mission guard policy.',
      }
    }
    return {
      decision: 'requested',
      policy: 'Act high-risk gate',
      result: 'approval_required',
      reason: 'Act mode still requires approval for high-risk or external context.',
    }
  }

  if (mode === 'Auto' && isTrustedRecurring(input) && (isReadOnlyRisk(risk) || isScopedActionRisk(risk))) {
    return {
      decision: 'approved',
      policy: 'Auto trusted-recurring allow',
      result: 'allowed',
      reason: 'Auto mode only allows explicitly trusted recurring low-risk tasks.',
    }
  }

  return {
    decision: 'requested',
    policy: 'Auto trusted-task gate',
    result: 'approval_required',
    reason: 'Auto mode requires explicit trust before Vela can act.',
  }
}

function normalizeAgentRole(value, fallback = 'Operator') {
  const role = asText(value, fallback)
  return AGENT_ROLES.includes(role) ? role : fallback
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizePlan(plan = []) {
  return normalizeArray(plan).map((step, index) => ({
    id: asText(step?.id, `step-${index + 1}`),
    label: normalizePlanLabel(step, index),
    status: normalizePlanStepStatus(step?.status, index === 0 ? 'Active' : 'Next'),
  }))
}

function normalizePlanLabel(step = {}, index = 0) {
  const id = asText(step?.id, `step-${index + 1}`)
  const label = asText(step?.label || step?.title, `Step ${index + 1}`)
  return LEGACY_DEFAULT_PLAN_LABELS.get(`${id}|${label}`) || label
}

function normalizeNextStep(value, fallback = '规划下一步。') {
  const nextStep = asText(value, fallback)
  return LEGACY_DEFAULT_NEXT_STEPS.get(nextStep) || nextStep
}

function normalizePlanStepStatus(value, fallback = 'Next') {
  const status = asText(value, fallback)
  return PLAN_STEP_STATUSES.includes(status) ? status : fallback
}

function normalizeReviewCheckOutcome(value, fallback = 'pending') {
  const outcome = asText(value, fallback).toLowerCase()
  return REVIEW_CHECK_OUTCOMES.includes(outcome) ? outcome : fallback
}

function normalizeTextList(value) {
  if (Array.isArray(value)) {
    return value.map(item => asText(item?.summary || item?.title || item?.detail || item)).filter(Boolean)
  }
  const single = asText(value)
  return single ? [single] : []
}

function normalizeCapabilityReferences(value = []) {
  return normalizeArray(value).map((item, index) => ({
    id: asText(item?.id || item?.capabilityId, `capability-${index + 1}`),
    title: asText(item?.title || item?.label || item?.name, `Capability ${index + 1}`),
    category: asText(item?.category || item?.type, 'tool'),
    summary: asText(item?.summary || item?.detail, ''),
    agentRole: normalizeAgentRole(item?.agentRole || item?.role, 'Operator'),
    riskClasses: normalizeTextList(item?.riskClasses || item?.risks || item?.risk),
    permissionBoundary: asText(item?.permissionBoundary || item?.guard || item?.policy, ''),
    integrationStatus: asText(item?.integrationStatus || item?.status, 'planned'),
    source: asText(item?.source || item?.sourceName, 'Vela capability registry'),
    provenance: asText(item?.provenance || item?.uri || item?.url, ''),
    licensePolicy: asText(item?.licensePolicy || item?.license, 'internal'),
    reason: asText(item?.reason, ''),
    confidence: asText(item?.confidence, ''),
    evaluation: asText(item?.evaluation, ''),
  }))
}

function capabilityMatchText(input = {}) {
  return [
    input.title,
    input.goal,
    ...normalizeArray(input.inputs).map(item => item?.text || item?.title || item?.summary),
  ].map(value => asText(value)).filter(Boolean).join(' ')
}

function capabilityTraceEntry(missionId, capabilityReferences = [], createdAt = new Date().toISOString()) {
  const ids = capabilityReferences.map(item => item.id).filter(Boolean)
  if (!ids.length) return null
  const primary = capabilityReferences[0]
  const risks = [...new Set(capabilityReferences.flatMap(item => normalizeTextList(item.riskClasses)))]
  return {
    missionId,
    type: 'capability.matched',
    title: 'Capability matched',
    detail: capabilityReferences.map(item => `${item.id}: ${item.reason || item.summary}`).join('; '),
    result: primary.id,
    capabilityIds: ids,
    riskClasses: risks,
    agentRole: primary.agentRole,
    createdAt,
  }
}

function toTimestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Date.parse(asText(value))
  return Number.isFinite(parsed) ? parsed : null
}

function diffMs(start, end) {
  const startMs = toTimestampMs(start)
  const endMs = toTimestampMs(end)
  if (startMs === null || endMs === null) return null
  return Math.max(0, Math.round(endMs - startMs))
}

function numberMs(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null
}

function putLatency(target, key, value) {
  const parsed = numberMs(value)
  if (parsed !== null) target[key] = parsed
}

function normalizeVoiceLatency(input = {}) {
  const direct = input.latencyMs || input.latency || {}
  const latencyMs = {}

  putLatency(latencyMs, 'bargeInStop', direct.bargeInStopMs ?? direct.bargeInStop)
  putLatency(latencyMs, 'speechEndToIntent', direct.speechEndToIntentMs ?? direct.speechEndToIntent)
  putLatency(latencyMs, 'finalAsrToFirstToken', direct.firstTokenMs ?? direct.finalAsrToFirstTokenMs ?? direct.finalAsrToFirstToken)
  putLatency(latencyMs, 'responseSegmentToFirstAudio', direct.firstAudioMs ?? direct.responseSegmentToFirstAudioMs ?? direct.responseSegmentToFirstAudio)

  const speechEndToIntent = diffMs(input.speechEndedAt ?? input.finalAsrAt, input.intentSubmittedAt)
  const finalAsrToFirstToken = diffMs(input.finalAsrAt ?? input.speechEndedAt, input.firstTokenAt)
  const responseSegmentToFirstAudio = diffMs(input.responseSegmentAt ?? input.firstResponseSegmentAt, input.firstAudioAt)
  const bargeInStop = diffMs(input.bargeInAt ?? input.interruptAt, input.speechStoppedAt ?? input.stopCompletedAt)

  if (speechEndToIntent !== null) latencyMs.speechEndToIntent = speechEndToIntent
  if (finalAsrToFirstToken !== null) latencyMs.finalAsrToFirstToken = finalAsrToFirstToken
  if (responseSegmentToFirstAudio !== null) latencyMs.responseSegmentToFirstAudio = responseSegmentToFirstAudio
  if (bargeInStop !== null) latencyMs.bargeInStop = bargeInStop

  return latencyMs
}

function evaluateVoiceLatency(latencyMs = {}) {
  return Object.entries(VOICE_LATENCY_TARGETS_MS)
    .filter(([key, target]) => typeof latencyMs[key] === 'number' && latencyMs[key] > target)
    .map(([key, target]) => ({
      metric: key,
      actualMs: latencyMs[key],
      targetMs: target,
    }))
}

function makeVoiceMetric(input = {}, transcript = '', intentType = 'command', state = '') {
  const latencyMs = normalizeVoiceLatency(input)
  const violations = evaluateVoiceLatency(latencyMs)
  const screenContext = normalizeScreenContext(input.screenContext || input.context || input.workspaceContext)
  const metric = {
    id: asText(input.metricId || input.id, makeId('voice-metric')),
    transcript: asText(transcript, 'Voice intent'),
    intentType,
    state: asText(state, ''),
    latencyMs,
    targetsMs: VOICE_LATENCY_TARGETS_MS,
    violations,
    createdAt: new Date().toISOString(),
  }
  if (Object.keys(screenContext).length) metric.screenContext = screenContext
  return metric
}

function hasPassingReview(reviewResult) {
  const outcome = asText(reviewResult?.outcome || reviewResult?.status).toLowerCase()
  return REVIEW_PASSING_OUTCOMES.has(outcome)
}

function reviewCheckKey(check = {}, index = 0) {
  const explicitKey = asText(check.key || check.checkKey)
  if (explicitKey) return explicitKey
  const derived = [
    check.title || check.check || check.summary,
    check.planStepId,
    check.toolCallId,
    check.artifactId,
  ].map(value => asText(value)).filter(Boolean).join('|')
  return derived || asText(check.id, `review-check-${index + 1}`)
}

function getBlockingReviewChecks(mission = {}) {
  const latestByKey = new Map()
  normalizeArray(mission.reviewChecks).forEach((check, index) => {
    const key = reviewCheckKey(check, index)
    latestByKey.set(key, { ...check, key })
  })
  return [...latestByKey.values()].filter(check => (
    REVIEW_BLOCKING_OUTCOMES.has(asText(check.outcome || check.status).toLowerCase())
  ))
}

function isOpenRecoveryAction(action = {}) {
  return !/^(done|closed|resolved)$/i.test(asText(action.status, 'open'))
}

function makeReviewRecoveryAction(check = {}, now = new Date().toISOString()) {
  const key = asText(check.key || reviewCheckKey(check))
  const title = asText(check.title || check.summary, key || 'Review check')
  const failures = normalizeTextList(check.failures || check.failure)
  return {
    id: makeId('recovery'),
    title: `Repair review check: ${title}`,
    status: 'open',
    source: 'review_blocked',
    reviewCheckKey: key,
    reviewCheckId: asText(check.id, ''),
    planStepId: asText(check.planStepId, ''),
    toolCallId: asText(check.toolCallId, ''),
    artifactId: asText(check.artifactId, ''),
    summary: asText(check.summary, failures[0] || 'Resolve the blocking reviewer check before completion.'),
    failures,
    createdAt: now,
  }
}

function syncReviewBlockedRecovery(mission = {}) {
  const now = new Date().toISOString()
  const blockingChecks = getBlockingReviewChecks(mission)
  const blockingByKey = new Map(blockingChecks.map(check => [asText(check.key || reviewCheckKey(check)), check]))
  const openRecoveryKeys = new Set()
  let changed = false

  const recoveryActions = normalizeArray(mission.recoveryActions).map(action => {
    if (action?.source !== 'review_blocked') return action
    const key = asText(action.reviewCheckKey || action.key)
    if (key && blockingByKey.has(key) && isOpenRecoveryAction(action)) {
      openRecoveryKeys.add(key)
      return action
    }
    if (key && !blockingByKey.has(key) && isOpenRecoveryAction(action)) {
      changed = true
      return {
        ...action,
        status: 'resolved',
        resolvedAt: now,
      }
    }
    return action
  })

  for (const check of blockingChecks) {
    const key = asText(check.key || reviewCheckKey(check))
    if (openRecoveryKeys.has(key)) continue
    recoveryActions.push(makeReviewRecoveryAction(check, now))
    changed = true
  }

  if (!changed) return mission
  return withTrace({
    ...mission,
    recoveryActions,
    nextStep: blockingChecks.length
      ? 'Resolve blocking review checks before completion.'
      : mission.nextStep,
  }, {
    type: 'recovery.synced',
    title: blockingChecks.length ? 'Review recovery action opened' : 'Review recovery action resolved',
    detail: blockingChecks.map(check => asText(check.title || check.summary, check.key)).join('; '),
    result: blockingChecks.length ? 'review_blocked' : 'resolved',
    createdAt: now,
  })
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function makeInputRecord(input = {}) {
  const screenContext = normalizeScreenContext(input.screenContext || input.context || input.workspaceContext)
  const record = {
    id: asText(input.id, makeId('input')),
    text: asText(input.text || input.content || input.title, 'Mission input'),
    source: asText(input.source, 'user'),
    createdAt: new Date().toISOString(),
  }
  if (Object.keys(screenContext).length) record.screenContext = screenContext
  return record
}

function briefPlanStepId(plan = []) {
  return normalizeArray(plan).find(step => step?.status === 'Active')?.id
    || normalizeArray(plan).find(step => step?.id)?.id
    || 'draft-plan'
}

function activePlanStepId(plan = [], fallback = '') {
  return normalizeArray(plan).find(step => step?.status === 'Active')?.id
    || normalizeArray(plan).find(step => step?.status === 'Reviewing')?.id
    || normalizeArray(plan).find(step => step?.id)?.id
    || fallback
}

function makeMissionBriefArtifact({ missionId, title, planStepId, createdAt } = {}) {
  const safeMissionId = encodeURIComponent(asText(missionId, makeId('mission')))
  const missionTitle = asText(title, 'Untitled mission')
  return {
    id: `${asText(missionId, safeMissionId)}-brief`,
    title: MISSION_BRIEF_TITLE,
    kind: 'brief',
    uri: `vela://missions/${safeMissionId}/brief`,
    summary: `目标：${missionTitle}。Vela 已建立任务计划、可复核产物和下一步入口；确认计划后输入“继续”。`,
    planStepId: asText(planStepId, 'draft-plan'),
    createdAt: asText(createdAt, new Date().toISOString()),
  }
}

function advancePlanForCommand(plan = [], previousState = '', nextState = '') {
  const normalized = normalizePlan(plan)
  if (previousState === 'Planned' && nextState === 'Running') {
    let promotedNext = false
    return normalized.map(step => {
      if (step.status === 'Active') return { ...step, status: 'Done' }
      if (!promotedNext && step.status === 'Next') {
        promotedNext = true
        return { ...step, status: 'Active' }
      }
      return step
    })
  }
  if (previousState === 'Running' && nextState === 'Reviewing') {
    return normalized.map(step => (
      step.status === 'Active' ? { ...step, status: 'Reviewing' } : step
    ))
  }
  return normalized
}

function commandNextStep(previousState = '', nextState = '', fallback = '') {
  if (previousState === 'Planned' && nextState === 'Running') return RUNNING_MISSION_NEXT_STEP
  if (previousState === 'Running' && nextState === 'Reviewing') return REVIEWING_MISSION_NEXT_STEP
  if (nextState === 'Reviewing') return REVIEWING_MISSION_NEXT_STEP
  return fallback
}

function makeAgentActionRecord(input = {}, options = {}) {
  const role = normalizeAgentRole(input.role || input.agentRole, 'Operator')
  const title = asText(input.title || input.action || input.summary, `${role} action`)
  const status = asText(input.status, 'planned')
  return {
    id: asText(input.id, makeId('agent-action')),
    role,
    title,
    status,
    planStepId: asText(input.planStepId, ''),
    summary: asText(input.summary || input.detail, ''),
    result: asText(input.result, ''),
    requiresReview: Boolean(input.requiresReview),
    createdAt: asText(options.createdAt || input.createdAt, new Date().toISOString()),
  }
}

function makeCommandAdvanceAgentAction(mission = {}, previousState = '', nextState = '', createdAt = '') {
  if (previousState === 'Planned' && nextState === 'Running') {
    const planStepId = activePlanStepId(mission.plan, 'draft-plan')
    return makeAgentActionRecord({
      role: 'Planner',
      title: '确认任务计划',
      status: 'done',
      planStepId,
      summary: `规划者已确认「${asText(mission.title, '当前任务')}」的任务计划，准备进入执行。`,
      result: '准备执行',
      requiresReview: false,
    }, { createdAt })
  }
  if (previousState === 'Running' && nextState === 'Reviewing') {
    const planStepId = activePlanStepId(mission.plan, 'execute-review')
    return makeAgentActionRecord({
      role: 'Builder',
      title: '提交执行结果待审查',
      status: '待审查',
      planStepId,
      summary: `构建者已将「${asText(mission.title, '当前任务')}」推进到审查前状态，等待审查者检查证据。`,
      result: '需要审查',
      requiresReview: true,
    }, { createdAt })
  }
  return null
}

function advanceCurrentMissionByCommand(current = {}, nextState = '', input = {}, text = '') {
  const previousState = asText(current.state, '')
  const createdAt = new Date().toISOString()
  const action = makeCommandAdvanceAgentAction(current, previousState, nextState, createdAt)
  let next = updateCurrentMission({
    state: nextState,
    nextStep: commandNextStep(previousState, nextState, current.nextStep),
    plan: advancePlanForCommand(current.plan, previousState, nextState),
    agentActions: action ? [...normalizeArray(current.agentActions), action] : current.agentActions,
  })
  if (action) {
    next = appendCurrentMissionTrace({
      type: 'agent.action',
      title: `${action.role}: ${action.title}`,
      detail: action.summary || text,
      planStepId: action.planStepId,
      agentRole: action.role,
      result: action.result || action.status,
      reviewOutcome: action.requiresReview ? 'required' : '',
      screenContext: input.screenContext,
      createdAt: action.createdAt,
    })
  }
  if (previousState === 'Planned' && nextState === 'Running') {
    return applyCapabilityAdapterRun(next, input)
  }
  if (previousState === 'Running' && nextState === 'Reviewing') {
    return applyCapabilityAdapterExecution(next, input)
  }
  return next
}

function applyCapabilityAdapterRun(current = {}, input = {}) {
  const run = planCapabilityAdapterRun(current, input)
  if (!run) return current
  appendCurrentMissionToolCall(run.toolCall)
  if (run.artifact) appendCurrentMissionArtifact(run.artifact)
  for (const reference of normalizeArray(run.memoryReferences)) {
    appendCurrentMissionMemoryReference(reference)
  }
  for (const action of normalizeArray(run.agentActions)) {
    appendCurrentMissionAgentAction(action)
  }
  if (run.nextStep) updateCurrentMission({ nextStep: run.nextStep })
  if (run.permission) return appendCurrentMissionPermission(run.permission)
  return getCurrentMission()
}

function applyCapabilityAdapterExecution(current = {}, input = {}) {
  const run = executeCapabilityAdapterRun(current, input)
  if (!run) return current
  appendCurrentMissionToolCall(run.toolCall)
  for (const stage of normalizeArray(run.toolStages)) {
    appendCurrentMissionToolStage({
      ...stage,
      toolCallId: asText(stage.toolCallId, run.toolCall?.id),
      planStepId: asText(stage.planStepId, run.toolCall?.planStepId),
      role: stage.role || run.toolCall?.role,
    })
  }
  if (run.artifact) appendCurrentMissionArtifact(run.artifact)
  for (const reference of normalizeArray(run.memoryReferences)) {
    appendCurrentMissionMemoryReference(reference)
  }
  for (const action of normalizeArray(run.agentActions)) {
    appendCurrentMissionAgentAction(action)
  }
  if (run.reviewCheck) appendCurrentMissionReviewCheck(run.reviewCheck)
  if (run.nextStep) updateCurrentMission({ nextStep: run.nextStep })
  return getCurrentMission()
}

function normalizeScreenContext(value = {}) {
  if (!value || typeof value !== 'object') return {}
  const context = {
    missionId: asText(value.missionId, ''),
    missionTitle: asText(value.missionTitle || value.title, ''),
    activeView: asText(value.activeView || value.view, ''),
    activeSurface: asText(value.activeSurface || value.surface, ''),
    workspaceMode: asText(value.workspaceMode || value.mode, ''),
    selectedArtifactId: asText(value.selectedArtifactId || value.artifactId, ''),
    selectedArtifactTitle: asText(value.selectedArtifactTitle || value.artifactTitle, ''),
    selectedArtifactKind: asText(value.selectedArtifactKind || value.artifactKind, ''),
    selectedPlanStepId: asText(value.selectedPlanStepId || value.planStepId, ''),
  }
  return Object.fromEntries(Object.entries(context).filter(([, contextValue]) => contextValue))
}

function normalizeArtifactMetadata(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value)
    .map(([key, metadataValue]) => [asText(key), metadataValue])
    .filter(([key, metadataValue]) => {
      if (!key) return false
      return ['string', 'number', 'boolean'].includes(typeof metadataValue)
    }))
}

function normalizeArtifactRecord(value = {}, index = 0, options = {}) {
  const title = asText(value.title || value.name, 'Mission artifact')
  const createdAt = asText(value.createdAt, options.now || new Date().toISOString())
  const metadata = normalizeArtifactMetadata(value.metadata || value.meta)
  const record = {
    id: asText(value.id || value.uri || value.path, options.idFallback || `artifact-${index + 1}`),
    title,
    kind: asText(value.kind || value.type, 'note'),
    uri: asText(value.uri || value.path, ''),
    summary: asText(value.summary || value.detail, ''),
    planStepId: asText(value.planStepId, ''),
    createdAt,
  }
  if (Object.keys(metadata).length) record.metadata = metadata
  return record
}

function normalizeArtifacts(value = []) {
  const now = new Date().toISOString()
  return normalizeArray(value).map((artifact, index) => normalizeArtifactRecord(artifact, index, { now }))
}

function normalizeTraceEntry(value = {}) {
  const now = new Date().toISOString()
  const latencyMs = normalizeVoiceLatency(value)
  const screenContext = normalizeScreenContext(value.screenContext || value.context || value.workspaceContext)
  const entry = {
    id: asText(value.id, makeId('trace')),
    missionId: asText(value.missionId, ''),
    type: asText(value.type, 'mission.note'),
    title: asText(value.title, asText(value.summary, 'Mission event')),
    detail: asText(value.detail, ''),
    planStepId: asText(value.planStepId, ''),
    artifactId: asText(value.artifactId, ''),
    toolName: asText(value.toolName, ''),
    toolCallId: asText(value.toolCallId || value.toolId, ''),
    stage: asText(value.stage || value.stageName, ''),
    url: asText(value.url || value.href, ''),
    agentRole: normalizeAgentRole(value.agentRole || value.role, 'Operator'),
    permissionDecision: asText(value.permissionDecision, ''),
    memoryReferenceId: asText(value.memoryReferenceId, ''),
    result: asText(value.result, ''),
    reviewOutcome: asText(value.reviewOutcome, ''),
    createdAt: asText(value.createdAt, now),
  }
  if (Object.keys(latencyMs).length) entry.latencyMs = latencyMs
  if (Object.keys(screenContext).length) entry.screenContext = screenContext
  return entry
}

function normalizeTrace(trace = []) {
  return normalizeArray(trace).map(normalizeTraceEntry).slice(-TRACE_LIMIT)
}

function withTrace(mission, entry) {
  const traceEntry = normalizeTraceEntry({
    ...entry,
    missionId: asText(entry?.missionId, mission.id),
  })
  return {
    ...mission,
    trace: normalizeTrace([...(mission.trace || []), traceEntry]),
    updatedAt: traceEntry.createdAt,
  }
}

function getNextCommandState(state) {
  switch (state) {
    case 'Draft':
      return 'Planned'
    case 'Planned':
    case 'Waiting for user':
    case 'Waiting for permission':
    case 'Blocked':
    case 'Failed':
    case 'Complete':
      return 'Running'
    case 'Running':
      return 'Reviewing'
    case 'Reviewing':
      return 'Complete'
    default:
      return 'Running'
  }
}

function classifyVoicePrivacyRisk(transcript) {
  if (VOICE_CREDENTIAL_RE.test(transcript)) {
    return {
      risk: 'Credential',
      action: 'Review voice intent before using sensitive credentials.',
    }
  }
  if (VOICE_EXTERNAL_MESSAGE_RE.test(transcript)) {
    return {
      risk: 'External message',
      action: 'Review voice intent before sending an external message.',
    }
  }
  if (VOICE_SCREEN_CONTEXT_RE.test(transcript)) {
    return {
      risk: 'Screen',
      action: 'Review voice intent before using screen context.',
    }
  }
  return null
}

function isExternalMessageIntent(text) {
  const value = asText(text)
  return Boolean(value) && (VOICE_EXTERNAL_MESSAGE_RE.test(value) || ASSISTANT_EXTERNAL_MESSAGE_RE.test(value))
}

function isWechatIlinkLoginIntent(text) {
  const value = asText(text)
  return Boolean(value) && WECHAT_ILINK_LOGIN_RE.test(value)
}

function assistantPlanForText(text) {
  return (
    isWechatIlinkLoginIntent(text)
      ? WECHAT_ILINK_LOGIN_PLAN
      : isExternalMessageIntent(text)
        ? PERSONAL_ASSISTANT_MESSAGE_PLAN
        : STARTED_PLAN
  )
    .map(step => ({ ...step }))
}

function assistantNextStepForText(text) {
  if (isWechatIlinkLoginIntent(text)) {
    return '好的，我先准备微信连接。扫码登录、保存凭据和发送消息都会分开确认。'
  }
  if (isExternalMessageIntent(text)) {
    return '好的，我先去看一下。拿到上下文后，我会把准备发送的内容给你确认。'
  }
  return STARTED_MISSION_NEXT_STEP
}

function makeAssistantAgentAction(text, createdAt = new Date().toISOString()) {
  if (isWechatIlinkLoginIntent(text)) {
    return makeAgentActionRecord({
      role: 'Operator',
      title: '准备连接微信',
      status: 'waiting_for_login_confirmation',
      planStepId: 'prepare-login',
      summary: 'Vela 会先准备微信 iLink 扫码登录请求；生成二维码、保存凭据或发送消息前都会单独确认。',
      result: '等待登录准备',
      requiresReview: false,
    }, { createdAt })
  }
  if (!isExternalMessageIntent(text)) return null
  return makeAgentActionRecord({
    role: 'Operator',
    title: '准备处理外部消息',
    status: 'waiting_for_context',
    planStepId: 'inspect-context',
    summary: 'Vela 会先查看相关应用和对话上下文，草拟回复；真正发送前必须获得用户确认。',
    result: '等待上下文',
    requiresReview: false,
  }, { createdAt })
}

function isWechatIlinkLoginMission(mission = {}) {
  return isWechatIlinkLoginIntent(mission.title)
    || isWechatIlinkLoginIntent(mission.goal)
    || normalizeArray(mission.inputs).some(input => isWechatIlinkLoginIntent(input?.text))
    || normalizeArray(mission.plan).some(step => ['prepare-login', 'confirm-login', 'save-credentials'].includes(asText(step?.id)))
}

function hasWechatIlinkLoginPreparation(mission = {}) {
  return normalizeArray(mission.toolCalls).some(tool => tool?.toolName === 'wechat-ilink.qr-login.prepare')
}

function hasWechatIlinkLoginAuthorization(mission = {}) {
  return normalizeArray(mission.toolCalls).some(tool => tool?.toolName === 'wechat-ilink.qr-login.authorize')
    || normalizeArray(mission.artifacts).some(artifact => artifact?.kind === 'credential-login-ready')
}

function wechatIlinkLoginSummary(request = {}) {
  return `微信 iLink 登录准备：库可用=${request.packageAvailable ? 'yes' : 'no'}；凭据保存位置：${asText(request.credentialStorePath)}；Guard：${asText(request.guardrail)}`
}

function appendWechatIlinkLoginPreparation(mission = {}) {
  if (hasWechatIlinkLoginPreparation(mission)) return getCurrentMission()
  const planStepId = 'prepare-login'
  const toolCallId = makeId('tool-wechat-ilink-login-prepare')
  const artifactId = makeId('artifact-wechat-ilink-login')
  const request = prepareWechatIlinkLoginRequest()
  const summary = wechatIlinkLoginSummary(request)

  appendCurrentMissionToolCall({
    id: toolCallId,
    toolName: 'wechat-ilink.qr-login.prepare',
    role: 'Operator',
    status: request.packageAvailable ? 'prepared' : 'blocked',
    planStepId,
    risk: 'Credential',
    result: summary,
  })
  appendCurrentMissionToolStage({
    toolName: 'wechat-ilink.package',
    toolCallId,
    role: 'Operator',
    status: request.packageAvailable ? 'ok' : 'failed',
    stage: 'wechat-ilink-package-check',
    url: request.packagePath,
    planStepId,
    summary: request.packageAvailable ? 'wechat-ilink-client 已安装。' : '未找到 wechat-ilink-client。',
  })
  appendCurrentMissionToolStage({
    toolName: 'wechat-ilink.credential-store',
    toolCallId,
    role: 'Operator',
    status: 'ok',
    stage: 'wechat-ilink-credential-store-prepared',
    url: 'credential://wechat-ilink/store',
    planStepId,
    summary: `凭据将保存到 Vela 用户数据目录；记录路径：${request.credentialStorePath}。`,
  })
  appendCurrentMissionToolStage({
    toolName: 'wechat-ilink.qr-login',
    toolCallId,
    role: 'Operator',
    status: 'skipped',
    stage: 'wechat-ilink-no-qr-login-before-confirmation',
    url: 'credential://wechat-ilink/qr-login',
    planStepId,
    summary: '未生成二维码，等待用户确认。',
  })
  appendCurrentMissionToolStage({
    toolName: 'wechat-ilink.credential-save',
    toolCallId,
    role: 'Operator',
    status: 'skipped',
    stage: 'wechat-ilink-no-credential-save',
    url: 'credential://wechat-ilink/save-skipped',
    planStepId,
    summary: '未保存 token/accountId。',
  })
  appendCurrentMissionArtifact({
    id: artifactId,
    title: '微信登录准备',
    kind: 'credential-login-preflight',
    uri: `vela://capabilities/wechat.ilink-session/login/${toolCallId}`,
    summary,
    planStepId,
  })
  return appendCurrentMissionReviewCheck({
    key: `wechat-ilink-login-preparation-${asText(mission.id, 'mission')}`,
    title: '微信登录准备复核',
    outcome: request.packageAvailable ? 'passed' : 'blocked',
    reviewer: 'Vela Credential Reviewer',
    planStepId,
    artifactId,
    toolCallId,
    summary: '微信 iLink 登录准备只创建可复核的登录计划，没有生成二维码、保存凭据或发送消息。',
    evidence: [
      `库可用：${request.packageAvailable ? 'yes' : 'no'}`,
      `凭据保存位置：${request.credentialStorePath}`,
      '未生成二维码。',
      '未保存 token/accountId。',
      '未读取微信消息。',
      '未发送微信消息。',
      `Guard：${request.guardrail}`,
    ],
  })
}

function advanceWechatIlinkLoginPlanToConfirm(plan = []) {
  return normalizePlan(plan).map(step => {
    if (step.id === 'understand-request' || step.id === 'prepare-login') return { ...step, status: 'Done' }
    if (step.id === 'confirm-login') return { ...step, status: 'Active' }
    return step.status === 'Active' ? { ...step, status: 'Done' } : step
  })
}

function advanceWechatIlinkLoginPlanAfterApproval(plan = []) {
  return normalizePlan(plan).map(step => {
    if (['understand-request', 'prepare-login', 'confirm-login'].includes(step.id)) return { ...step, status: 'Done' }
    if (step.id === 'save-credentials') return { ...step, status: 'Active' }
    return step.status === 'Active' ? { ...step, status: 'Done' } : step
  })
}

function isWechatIlinkLoginPermission(permission = {}) {
  return asText(permission.risk).toLowerCase() === 'credential'
    && asText(permission.toolCallId) === 'wechat-ilink.qr-login'
    && asText(permission.planStepId) === 'confirm-login'
}

function advanceWechatIlinkLoginMissionByCommand(current = {}, input = {}) {
  const createdAt = new Date().toISOString()
  const request = prepareWechatIlinkLoginRequest()
  const summary = '我已准备好微信 iLink 扫码登录。生成二维码前需要你确认。'
  const action = makeAgentActionRecord({
    role: 'Operator',
    title: '准备微信扫码登录',
    status: 'needs_confirmation',
    planStepId: 'prepare-login',
    summary,
    result: '待确认',
    requiresReview: false,
  }, { createdAt })

  updateCurrentMission({
    state: 'Running',
    nextStep: '我已准备好微信扫码登录。要生成登录二维码吗？',
    plan: advanceWechatIlinkLoginPlanToConfirm(current.plan),
    agentActions: [...normalizeArray(current.agentActions), action],
  })
  appendWechatIlinkLoginPreparation(current)
  return appendCurrentMissionPermission({
    action: '生成微信 iLink 扫码登录请求',
    risk: 'Credential',
    decision: 'requested',
    summary: `${summary} ${wechatIlinkLoginSummary(request)}`,
    reason: request.guardrail,
    requestedBy: 'Vela Operator',
    planStepId: 'confirm-login',
    toolCallId: 'wechat-ilink.qr-login',
    scope: 'credential://wechat-ilink/login',
    screenContext: input.screenContext,
  })
}

function wechatIlinkQrStageStatus(session = {}) {
  const status = asText(session?.status)
  if (status === 'qr-ready') return 'ok'
  if (status === 'failed') return 'failed'
  if (status === 'blocked') return 'blocked'
  return 'skipped'
}

function completeWechatIlinkLoginAfterApproval(mission = {}, permission = {}, options = {}) {
  if (!isWechatIlinkLoginPermission(permission) || !isWechatIlinkLoginMission(mission)) return mission
  if (hasWechatIlinkLoginAuthorization(mission)) return mission

  const request = prepareWechatIlinkLoginRequest()
  const qrSession = options.qrSession || null
  const hasQrSession = Boolean(qrSession)
  const qrReady = asText(qrSession?.status) === 'qr-ready'
  const qrBlocked = ['blocked', 'failed'].includes(asText(qrSession?.status))
  const toolCallId = makeId('tool-wechat-ilink-login-authorize')
  const artifactId = makeId(qrReady ? 'artifact-wechat-ilink-login-qr' : 'artifact-wechat-ilink-login-ready')
  const summary = qrReady
    ? '已生成微信扫码登录二维码；当前未轮询扫码状态、未保存凭据、未发送消息。'
    : '已获得微信扫码登录准备授权；当前仍未生成二维码、未保存凭据、未发送消息。'

  appendCurrentMissionAgentAction({
    role: 'Operator',
    title: qrReady ? '微信扫码登录二维码已生成' : '微信扫码登录已授权',
    status: qrReady ? 'qr_ready' : (qrBlocked ? 'blocked' : 'authorized'),
    planStepId: 'confirm-login',
    summary,
    result: qrReady ? '等待扫码' : (qrBlocked ? '二维码请求受阻' : '等待真实二维码登录'),
    requiresReview: false,
  })
  appendCurrentMissionToolCall({
    id: toolCallId,
    toolName: 'wechat-ilink.qr-login.authorize',
    role: 'Operator',
    status: qrReady ? 'qr-ready' : (qrBlocked ? 'blocked' : 'prepared'),
    planStepId: 'confirm-login',
    risk: 'Credential',
    result: summary,
  })
  appendCurrentMissionToolStage({
    toolName: 'wechat-ilink.qr-login',
    toolCallId,
    role: 'Operator',
    status: wechatIlinkQrStageStatus(qrSession),
    stage: qrReady ? 'wechat-ilink-qr-url-ready' : 'wechat-ilink-real-qr-login-pending',
    url: qrReady ? qrSession.qrCodeUrl : 'credential://wechat-ilink/qr-login',
    planStepId: 'confirm-login',
    summary: qrReady
      ? '已生成二维码 URL；等待用户扫码，尚未轮询确认结果。'
      : (hasQrSession ? asText(qrSession.reason, '真实二维码生成尚未执行。') : '真实二维码生成尚未执行；后续接入时会把二维码展示给用户扫码。'),
  })
  appendCurrentMissionToolStage({
    toolName: 'wechat-ilink.credential-save',
    toolCallId,
    role: 'Operator',
    status: 'skipped',
    stage: 'wechat-ilink-save-after-login-pending',
    url: 'credential://wechat-ilink/save-after-confirmation',
    planStepId: 'save-credentials',
    summary: '登录成功后仍需单独确认保存 token/accountId。',
  })
  appendCurrentMissionArtifact({
    id: artifactId,
    title: qrReady ? '微信扫码登录二维码' : '微信扫码登录授权',
    kind: qrReady ? 'credential-login-qr' : 'credential-login-ready',
    uri: qrReady ? qrSession.qrCodeUrl : `vela://capabilities/wechat.ilink-session/login-ready/${toolCallId}`,
    summary,
    planStepId: 'confirm-login',
    metadata: qrReady ? {
      qrCodeId: asText(qrSession.qrCodeId),
      qrStatus: asText(qrSession.status),
    } : {},
  })
  appendCurrentMissionReviewCheck({
    key: `wechat-ilink-login-authorized-${asText(mission.id, 'mission')}`,
    title: '微信登录授权复核',
    outcome: qrBlocked ? 'blocked' : 'passed',
    reviewer: 'Vela Credential Reviewer',
    planStepId: 'confirm-login',
    artifactId,
    toolCallId,
    summary: qrReady
      ? '微信扫码登录二维码已生成，但没有轮询扫码确认、保存凭据或发送消息。'
      : '微信扫码登录授权已记录，但没有执行真实登录、保存凭据或发送消息。',
    evidence: [
      `批准记录：${permission.id}`,
      `凭据保存位置：${request.credentialStorePath}`,
      qrReady ? '授权后已生成二维码 URL。' : '授权后仍未生成二维码。',
      '授权后仍未保存 token/accountId。',
      '授权后仍未读取或发送微信消息。',
      '保存凭据和发送消息需要后续单独确认。',
      ...(hasQrSession ? wechatIlinkQrSessionEvidence(qrSession) : []),
    ],
  })
  const reviewedMission = getCurrentMission()
  return updateCurrentMission({
    state: 'Running',
    plan: advanceWechatIlinkLoginPlanAfterApproval(reviewedMission.plan),
    nextStep: qrReady
      ? '已生成微信登录二维码。请扫码；扫码确认后，我会再单独确认是否保存凭据。'
      : '已获得微信扫码登录授权。下一步接入真实二维码生成后，我会展示二维码让你扫码；登录成功后再单独确认保存凭据。',
  })
}

function latestWechatIlinkQrArtifact(mission = {}) {
  const artifacts = normalizeArray(mission.artifacts)
  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    if (artifacts[index]?.kind === 'credential-login-qr') return artifacts[index]
  }
  return null
}

function latestWechatIlinkQrCodeId(mission = {}) {
  const artifact = latestWechatIlinkQrArtifact(mission)
  return asText(artifact?.metadata?.qrCodeId || artifact?.qrCodeId)
}

function hasWechatIlinkQrArtifact(mission = {}) {
  return Boolean(latestWechatIlinkQrArtifact(mission))
}

function wechatIlinkQrPollStageStatus(status = {}) {
  const state = asText(status.status)
  if (status.credentialsReady || state === 'confirmed') return 'ok'
  if (['blocked', 'failed', 'expired'].includes(state)) return state === 'expired' ? 'blocked' : state
  return 'waiting'
}

function wechatIlinkQrPollSummary(status = {}) {
  const state = asText(status.status, 'unknown')
  if (status.credentialsReady) {
    return '微信扫码已确认；登录凭据只在本次运行内存里等待保存确认，尚未写入本地文件。'
  }
  if (state === 'scaned') return '微信二维码已被扫描，正在等待微信侧确认；当前未保存凭据、未发送消息。'
  if (state === 'wait') return '微信二维码还在等待扫码；当前未保存凭据、未发送消息。'
  if (state === 'waiting-for-network-enable') return '真实扫码状态轮询未启用；当前未联网轮询、未保存凭据、未发送消息。'
  if (['blocked', 'failed', 'expired'].includes(state)) return asText(status.reason, `微信扫码状态为 ${state}；当前未保存凭据、未发送消息。`)
  return `微信扫码状态：${state}；当前未保存凭据、未发送消息。`
}

function wechatIlinkQrPollNextStep(status = {}) {
  const state = asText(status.status)
  if (status.credentialsReady) return '微信扫码已确认。要保存这次登录凭据，让 Vela 后续能继续处理微信任务吗？'
  if (state === 'scaned') return '我看到了扫码动作，正在等微信确认。确认后输入“继续”，我再检查一次。'
  if (state === 'wait') return '二维码还没完成扫码。请扫码后输入“继续”，我再去看状态。'
  if (state === 'waiting-for-network-enable') return '扫码状态轮询还在安全模拟模式；启用真实登录后，我会检查扫码状态。'
  if (state === 'expired') return '这个二维码可能已过期，需要重新生成二维码。'
  if (['blocked', 'failed'].includes(state)) return `扫码状态检查受阻：${asText(status.reason, state)}`
  return '扫码状态还没确认。完成扫码后输入“继续”，我会再查一次。'
}

function makeWechatIlinkPollOptions(input = {}, qrCodeId = '') {
  const adapterDeps = input.wechatIlinkLoginDeps || input.wechatIlink || {}
  const env = adapterDeps.env || input.env || (typeof process === 'undefined' ? {} : process.env)
  const options = {
    ...adapterDeps,
    env,
    qrCodeId,
  }
  if (Object.prototype.hasOwnProperty.call(adapterDeps, 'allowNetwork')) {
    options.allowNetwork = adapterDeps.allowNetwork
  } else if (Object.prototype.hasOwnProperty.call(input, 'allowNetwork')) {
    options.allowNetwork = input.allowNetwork
  }
  return options
}

async function continueWechatIlinkLoginAfterQrStatus(current = {}, input = {}) {
  const qrArtifact = latestWechatIlinkQrArtifact(current)
  if (!qrArtifact) return null

  const qrCodeId = latestWechatIlinkQrCodeId(current)
  appendCurrentMissionInput({ text: input.text || input.command || input.content, source: input.source || 'typed', screenContext: input.screenContext })
  const pollOptions = makeWechatIlinkPollOptions(input, qrCodeId)
  const qrStatus = await pollWechatIlinkQrLoginStatus(pollOptions)
  const toolCallId = makeId('tool-wechat-ilink-qr-status')
  const artifactId = makeId('artifact-wechat-ilink-qr-status')
  const summary = wechatIlinkQrPollSummary(qrStatus)
  const stageStatus = wechatIlinkQrPollStageStatus(qrStatus)

  appendCurrentMissionAgentAction({
    role: 'Operator',
    title: '检查微信扫码状态',
    status: qrStatus.credentialsReady ? 'credentials_ready' : stageStatus,
    planStepId: 'save-credentials',
    summary,
    result: qrStatus.credentialsReady ? '等待保存确认' : asText(qrStatus.status, 'waiting'),
    requiresReview: false,
  })
  appendCurrentMissionToolCall({
    id: toolCallId,
    toolName: 'wechat-ilink.qr-login.poll',
    role: 'Operator',
    status: stageStatus,
    planStepId: 'save-credentials',
    risk: 'Credential',
    result: summary,
  })
  appendCurrentMissionToolStage({
    toolName: 'wechat-ilink.qr-login',
    toolCallId,
    role: 'Operator',
    status: stageStatus,
    stage: 'wechat-ilink-qr-login-status',
    url: qrCodeId ? 'credential://wechat-ilink/qr-login/status' : 'credential://wechat-ilink/qr-login/missing-id',
    planStepId: 'save-credentials',
    summary,
  })
  appendCurrentMissionToolStage({
    toolName: 'wechat-ilink.credential-save',
    toolCallId,
    role: 'Operator',
    status: qrStatus.credentialsReady ? 'pending' : 'skipped',
    stage: qrStatus.credentialsReady ? 'wechat-ilink-save-needs-confirmation' : 'wechat-ilink-save-not-ready',
    url: 'credential://wechat-ilink/save-after-confirmation',
    planStepId: 'save-credentials',
    summary: qrStatus.credentialsReady
      ? '扫码确认后仍未保存 token/accountId；正在等待用户单独确认保存。'
      : '扫码尚未确认；未保存 token/accountId。',
  })
  appendCurrentMissionArtifact({
    id: artifactId,
    title: qrStatus.credentialsReady ? '微信扫码已确认' : '微信扫码状态',
    kind: qrStatus.credentialsReady ? 'credential-login-status' : 'credential-login-poll',
    uri: `vela://capabilities/wechat.ilink-session/qr-status/${toolCallId}`,
    summary,
    planStepId: 'save-credentials',
    metadata: {
      qrCodeId: qrCodeId || 'missing',
      qrStatus: asText(qrStatus.status, 'unknown'),
      credentialsReady: Boolean(qrStatus.credentialsReady),
    },
  })
  appendCurrentMissionReviewCheck({
    key: `wechat-ilink-qr-status-${asText(current.id, 'mission')}-${asText(qrStatus.status, 'unknown')}`,
    title: '微信扫码状态复核',
    outcome: ['blocked', 'failed', 'expired'].includes(asText(qrStatus.status)) ? 'blocked' : 'passed',
    reviewer: 'Vela Credential Reviewer',
    planStepId: 'save-credentials',
    artifactId,
    toolCallId,
    summary: '扫码状态检查只读取登录状态；没有保存凭据、没有读取微信消息、没有发送微信消息。',
    evidence: [
      `二维码产物：${qrArtifact.id}`,
      ...wechatIlinkQrStatusEvidence(qrStatus),
      '未读取微信消息。',
      '未发送微信消息。',
    ],
  })

  if (!qrStatus.credentialsReady) {
    return updateCurrentMission({
      state: 'Running',
      nextStep: wechatIlinkQrPollNextStep(qrStatus),
    })
  }

  const permissionId = makeId('permission-wechat-ilink-save')
  const redacted = qrStatus.redactedCredentials || {}
  WECHAT_ILINK_PENDING_CREDENTIALS.set(permissionId, {
    credentials: qrStatus.credentials,
    filePath: asText(pollOptions.filePath || qrStatus.credentialStorePath),
  })
  return appendCurrentMissionPermission({
    id: permissionId,
    action: '保存微信 iLink 登录凭据',
    risk: 'Credential',
    decision: 'requested',
    summary: `微信扫码已确认。是否保存登录凭据？token=${asText(redacted.token, 'present')}；account=${asText(redacted.accountId, 'present')}。`,
    reason: '保存凭据后，Vela 才能在后续微信任务中复用 iLink 会话；这一步需要单独确认。',
    requestedBy: 'Vela Operator',
    planStepId: 'save-credentials',
    toolCallId: 'wechat-ilink.credential-save',
    scope: 'credential://wechat-ilink/save',
    screenContext: input.screenContext,
  })
}

function isWechatIlinkCredentialSavePermission(permission = {}) {
  return asText(permission.risk).toLowerCase() === 'credential'
    && asText(permission.toolCallId) === 'wechat-ilink.credential-save'
    && asText(permission.planStepId) === 'save-credentials'
}

function hasWechatIlinkCredentialSaveResult(mission = {}) {
  return normalizeArray(mission.toolCalls).some(tool => tool?.toolName === 'wechat-ilink.credential-save' && tool?.status === 'ok')
    || normalizeArray(mission.artifacts).some(artifact => artifact?.kind === 'credential-save-receipt')
}

function advanceWechatIlinkLoginPlanAfterCredentialSave(plan = []) {
  return normalizePlan(plan).map(step => {
    if (['understand-request', 'prepare-login', 'confirm-login', 'save-credentials'].includes(step.id)) {
      return { ...step, status: 'Done' }
    }
    return step.status === 'Active' ? { ...step, status: 'Done' } : step
  })
}

function completeWechatIlinkCredentialSaveAfterApproval(mission = {}, permission = {}) {
  if (!isWechatIlinkCredentialSavePermission(permission) || !isWechatIlinkLoginMission(mission)) return mission
  if (hasWechatIlinkCredentialSaveResult(mission)) return mission

  const pending = WECHAT_ILINK_PENDING_CREDENTIALS.get(permission.id)
  const toolCallId = makeId('tool-wechat-ilink-credential-save')
  if (!pending?.credentials?.token || !pending?.credentials?.accountId) {
    appendCurrentMissionToolCall({
      id: toolCallId,
      toolName: 'wechat-ilink.credential-save',
      role: 'Operator',
      status: 'blocked',
      planStepId: 'save-credentials',
      risk: 'Credential',
      result: '登录凭据只保存在运行内存里；当前找不到待保存凭据，需要重新扫码确认。',
    })
    appendCurrentMissionReviewCheck({
      key: `wechat-ilink-credential-save-missing-${asText(mission.id, 'mission')}`,
      title: '微信凭据保存复核',
      outcome: 'blocked',
      reviewer: 'Vela Credential Reviewer',
      planStepId: 'save-credentials',
      toolCallId,
      summary: '用户批准了保存，但运行内存里没有待保存凭据；没有写入空凭据。',
      evidence: [
        `批准记录：${permission.id}`,
        '未保存 token/accountId。',
        '未读取微信消息。',
        '未发送微信消息。',
      ],
    })
    return updateCurrentMission({
      state: canTransitionMission(mission.state, 'Blocked') ? 'Blocked' : mission.state,
      nextStep: '保存凭据受阻：需要重新生成二维码并完成扫码确认。',
    })
  }

  const saved = saveWechatIlinkCredentials(pending.credentials, {
    filePath: pending.filePath,
    source: 'qr-login',
  })
  WECHAT_ILINK_PENDING_CREDENTIALS.delete(permission.id)
  const summary = `微信 iLink 登录凭据已保存到 Vela 用户数据目录；token=${asText(saved.credentials.token, 'saved')}；account=${asText(saved.credentials.accountId, 'saved')}。`
  appendCurrentMissionAgentAction({
    role: 'Operator',
    title: '保存微信登录凭据',
    status: 'saved',
    planStepId: 'save-credentials',
    summary,
    result: '已保存',
    requiresReview: false,
  })
  appendCurrentMissionToolCall({
    id: toolCallId,
    toolName: 'wechat-ilink.credential-save',
    role: 'Operator',
    status: 'ok',
    planStepId: 'save-credentials',
    risk: 'Credential',
    result: summary,
  })
  appendCurrentMissionToolStage({
    toolName: 'wechat-ilink.credential-store',
    toolCallId,
    role: 'Operator',
    status: 'ok',
    stage: 'wechat-ilink-credential-saved',
    url: 'credential://wechat-ilink/store',
    planStepId: 'save-credentials',
    summary,
  })
  appendCurrentMissionToolStage({
    toolName: 'wechat-ilink.messages',
    toolCallId,
    role: 'Operator',
    status: 'skipped',
    stage: 'wechat-ilink-no-message-read-or-send',
    url: 'external://wechat/messages/not-called',
    planStepId: 'save-credentials',
    summary: '本次只保存登录凭据，没有读取或发送微信消息。',
  })
  appendCurrentMissionArtifact({
    title: '微信登录凭据已保存',
    kind: 'credential-save-receipt',
    uri: `credential://wechat-ilink/store/${toolCallId}`,
    summary,
    planStepId: 'save-credentials',
    metadata: {
      saved: true,
      source: 'qr-login',
    },
  })
  appendCurrentMissionReviewCheck({
    key: `wechat-ilink-credential-save-${asText(mission.id, 'mission')}`,
    title: '微信凭据保存复核',
    outcome: 'passed',
    reviewer: 'Vela Credential Reviewer',
    planStepId: 'save-credentials',
    artifactId: getCurrentMission().artifacts.at(-1)?.id,
    toolCallId,
    summary: '微信登录凭据只在用户批准保存后写入本地凭据文件；没有读取或发送微信消息。',
    evidence: [
      `批准记录：${permission.id}`,
      `凭据文件：${saved.filePath}`,
      '保存发生在 Credential 权限批准之后。',
      '未读取微信消息。',
      '未发送微信消息。',
    ],
  })
  setCurrentMissionReview({
    outcome: 'passed',
    reviewer: 'Vela Credential Reviewer',
    summary: '微信连接链路已通过：先生成二维码，扫码确认后再单独确认保存凭据。',
    evidence: [
      `Permission ${permission.id} approved.`,
      `Tool ${toolCallId} recorded after approval.`,
    ],
  })
  const reviewedMission = getCurrentMission()
  return updateCurrentMission({
    state: 'Complete',
    plan: advanceWechatIlinkLoginPlanAfterCredentialSave(reviewedMission.plan),
    nextStep: '微信已经连接好。接下来你可以直接让 Vela 帮你处理微信任务；真正发送消息前仍会先问你。',
  })
}

function isExternalMessageMission(mission = {}) {
  return isExternalMessageIntent(mission.title)
    || isExternalMessageIntent(mission.goal)
    || normalizeArray(mission.inputs).some(input => isExternalMessageIntent(input?.text))
    || normalizeArray(mission.plan).some(step => ['inspect-context', 'draft-reply', 'confirm-send'].includes(asText(step?.id)))
}

function externalMessageSourceText(mission = {}) {
  return [
    mission.title,
    mission.goal,
    ...normalizeArray(mission.inputs).map(input => input?.text),
  ].map(value => asText(value)).join(' ')
}

function externalMessageRecipient(mission = {}) {
  const sourceText = externalMessageSourceText(mission)
  if (/(老婆|妻子|太太|媳妇)/.test(sourceText)) return '老婆'
  if (/(老公|先生)/.test(sourceText)) return '老公'
  if (/(同事|团队|team|colleague)/i.test(sourceText)) return '同事'
  return '对方'
}

function draftExternalMessageText(mission = {}) {
  const sourceText = externalMessageSourceText(mission)
  if (/(老婆|妻子|太太|媳妇)/.test(sourceText)) return '收到，我晚点跟你说。'
  if (/(老公|先生)/.test(sourceText)) return '收到，我晚点跟你说。'
  return '收到，我看到了，稍后回复你。'
}

function externalMessageDraftSummary(mission = {}) {
  return `我准备这样回：「${draftExternalMessageText(mission)}」`
}

function externalMessageDesktopTarget(mission = {}) {
  const sourceText = externalMessageSourceText(mission)
  if (/(?:微信|wechat)/i.test(sourceText)) {
    return { appName: '微信', appUrl: 'app://wechat' }
  }
  if (/(?:email|邮件|邮箱)/i.test(sourceText)) {
    return { appName: '邮件', appUrl: 'app://mail' }
  }
  return { appName: '消息应用', appUrl: 'app://messages' }
}

function externalMessageExecutionProfile(target = {}) {
  return describeDesktopAdapter(target, 'messages.confirmed-send')
}

function externalMessageDraftPayload(mission = {}) {
  const target = externalMessageDesktopTarget(mission)
  const recipient = externalMessageRecipient(mission)
  const draftText = draftExternalMessageText(mission)
  const executionProfile = externalMessageExecutionProfile(target)
  return {
    channel: target.appName,
    channelUrl: target.appUrl,
    recipient,
    draftText,
    sendPreview: `发给${recipient}（${target.appName}）：${draftText}`,
    guardrail: '用户明确确认前不发送；确认后只记录模拟发送，真实适配器接入后仍走同一确认闸门。',
    ...executionProfile,
  }
}

function externalMessagePayloadSummary(payload = {}) {
  return `渠道：${asText(payload.channel, '消息应用')}；对象：${asText(payload.recipient, '对方')}；内容：「${asText(payload.draftText)}」；模式：模拟链路；Adapter：${asText(payload.adapterStatus, 'real-adapter-pending')}；真实适配器入口：${asText(payload.realAdapterEntry)}；Guard：${asText(payload.guardrail)}`
}

function hasExternalMessageDesktopContext(mission = {}) {
  return normalizeArray(mission.toolCalls).some(tool => tool?.toolName === 'desktop.app-control.inspect')
}

function wechatContextMessageSummary(contextResult = {}) {
  const texts = normalizeArray(contextResult.messages)
    .map(message => asText(message?.text))
    .filter(Boolean)
    .slice(0, 3)
  if (!texts.length) return ''
  return `最近消息：${texts.map(text => `「${text}」`).join('；')}`
}

function latestWechatContextToken(contextResult = {}) {
  return normalizeArray(contextResult.messages)
    .map(message => asText(message?.contextToken))
    .find(Boolean) || ''
}

function latestStoredWechatContextToken(mission = {}) {
  for (const artifact of [...normalizeArray(mission.artifacts)].reverse()) {
    const token = asText(artifact?.metadata?.contextToken)
    if (token) return token
  }
  return ''
}

function makeWechatIlinkReadOptions(input = {}) {
  const adapterDeps = input.wechatIlinkReadDeps || input.wechatIlink || {}
  const readOptions = {
    ...adapterDeps,
    env: adapterDeps.env || input.env || (typeof process === 'undefined' ? {} : process.env),
  }
  for (const key of ['recipientUserId', 'allowRead', 'allowNetwork', 'timeoutMs', 'limit', 'syncBuf', 'mockMessages']) {
    if (!Object.prototype.hasOwnProperty.call(readOptions, key) && Object.prototype.hasOwnProperty.call(input, key)) {
      readOptions[key] = input[key]
    }
  }
  return readOptions
}

async function readWechatContextForExternalMessage(mission = {}, input = {}) {
  const target = externalMessageDesktopTarget(mission)
  if (target.appUrl !== 'app://wechat' && !/微信|wechat/i.test(target.appName)) return null
  return readWechatIlinkRecentMessages(makeWechatIlinkReadOptions(input))
}

function externalMessagePlanAfterContextBlocked(plan = []) {
  return normalizePlan(plan).map(step => {
    if (step.id === 'understand-request') return { ...step, status: 'Done' }
    if (step.id === 'inspect-context') return { ...step, status: 'Blocked' }
    return step
  })
}

function appendExternalMessageDesktopContext(mission = {}, options = {}) {
  if (hasExternalMessageDesktopContext(mission)) return getCurrentMission()
  const planStepId = 'inspect-context'
  const toolCallId = makeId('tool-desktop-app-control-inspect')
  const artifactId = makeId('artifact-desktop-context')
  const target = externalMessageDesktopTarget(mission)
  const payload = externalMessageDraftPayload(mission)
  const contextResult = options.contextResult || null
  const contextAttempted = contextResult?.adapterId === 'wechat-ilink'
  const contextBlocked = contextAttempted && ['blocked', 'failed'].includes(asText(contextResult.status))
  const contextSummary = contextAttempted ? wechatContextMessageSummary(contextResult) : ''
  const contextReason = asText(contextResult?.reason)
  const summary = contextAttempted
    ? (contextSummary
        ? `已读取「${target.appName}」最近消息上下文；目标对象：${payload.recipient}；${contextSummary}；没有发送消息。`
        : `已检查「${target.appName}」最近消息上下文；目标对象：${payload.recipient}；${contextReason || '未发现可用于回复的新文本。'}；没有发送消息。`)
    : `已准备「${target.appName}」上下文原型：模拟打开应用并模拟查看当前对话；目标对象：${payload.recipient}；执行模式为模拟链路；没有真实打开应用、截图、读取真实屏幕或发送消息。`

  appendCurrentMissionToolCall({
    id: toolCallId,
    toolName: 'desktop.app-control.inspect',
    role: 'Operator',
    status: contextBlocked ? 'blocked' : 'ok',
    planStepId,
    risk: 'Screen',
    result: summary,
  })
  appendCurrentMissionToolStage({
    toolName: 'desktop.open-app',
    toolCallId,
    role: 'Operator',
    status: 'ok',
    stage: 'external-message-open-app',
    url: target.appUrl,
    planStepId,
    summary: `模拟打开${target.appName}，未启动真实应用。`,
  })
  appendCurrentMissionToolStage({
    toolName: 'desktop.screen-context',
    toolCallId,
    role: 'Operator',
    status: contextBlocked ? 'blocked' : 'ok',
    stage: contextAttempted ? 'external-message-wechat-ilink-context' : 'external-message-screen-context',
    url: contextAttempted ? 'credential://wechat-ilink/messages/recent' : 'screen://mock/current-chat',
    planStepId,
    summary: contextAttempted
      ? (contextSummary || contextReason || '已通过微信 iLink 检查最近消息。')
      : '模拟读取当前对话上下文，未截图或读取真实屏幕。',
  })
  appendCurrentMissionToolStage({
    toolName: 'desktop.real-adapter',
    toolCallId,
    role: 'Operator',
    status: contextAttempted ? (contextBlocked ? 'blocked' : 'ok') : 'skipped',
    stage: contextAttempted
      ? (contextBlocked ? 'external-message-real-adapter-context-blocked' : 'external-message-real-adapter-context')
      : 'external-message-real-adapter-pending',
    url: contextAttempted ? 'desktop://adapters/wechat/messages.read-recent' : payload.realAdapterEntry,
    planStepId,
    summary: contextAttempted
      ? (contextBlocked
          ? `真实${target.appName}最近消息读取受阻：${contextReason}。`
          : `真实${target.appName}最近消息读取适配器已完成上下文检查。`)
      : `真实${target.appName}桌面适配器尚未接入，本次只记录模拟上下文。`,
  })
  appendCurrentMissionToolStage({
    toolName: 'desktop.external-effect',
    toolCallId,
    role: 'Operator',
    status: 'skipped',
    stage: 'external-message-no-hidden-send',
    url: 'external://none',
    planStepId,
    summary: '未发送消息，等待用户确认草稿。',
  })
  appendCurrentMissionArtifact({
    id: artifactId,
    title: `${target.appName}上下文摘要`,
    kind: 'desktop-context',
    uri: `vela://capabilities/desktop.app-control/results/${toolCallId}`,
    summary,
    planStepId,
    metadata: contextAttempted ? {
      adapterId: 'wechat-ilink',
      contextStatus: asText(contextResult.status),
      messageCount: Number(contextResult.messageCount || 0),
      contextToken: latestWechatContextToken(contextResult),
      syncBuf: asText(contextResult.syncBuf),
    } : {},
  })
  return appendCurrentMissionReviewCheck({
    key: `external-message-desktop-context-${asText(mission.id, 'mission')}`,
    title: '桌面上下文复核',
    outcome: contextBlocked ? 'blocked' : 'passed',
    reviewer: 'Vela Desktop Reviewer',
    planStepId,
    artifactId,
    toolCallId,
    summary: contextBlocked
      ? '外部消息任务尝试读取微信上下文但受阻；没有隐藏发送动作。'
      : '外部消息任务已先完成桌面上下文检查；没有隐藏发送动作。',
    evidence: [
      `目标应用：${target.appName}`,
      `消息对象：${payload.recipient}`,
      `发送草稿预览：${payload.sendPreview}`,
      ...desktopAdapterEvidence(payload),
      ...(contextAttempted
        ? [
            ...wechatIlinkReadEvidence(contextResult),
            contextSummary ? `最近消息摘要：${contextSummary}` : '最近消息摘要：none',
            '未截图、未发送消息。',
          ]
        : [
            `模拟打开：${target.appUrl}`,
            '模拟屏幕上下文：screen://mock/current-chat',
            '未真实打开应用、未截图、未读取真实屏幕、未发送消息。',
          ]),
      `Guard：${payload.guardrail}`,
    ],
  })
}

function advanceExternalMessagePlanToConfirm(plan = []) {
  return normalizePlan(plan).map(step => {
    if (step.id === 'understand-request' || step.id === 'inspect-context' || step.id === 'draft-reply') {
      return { ...step, status: 'Done' }
    }
    if (step.id === 'confirm-send') return { ...step, status: 'Active' }
    return step.status === 'Active' ? { ...step, status: 'Done' } : step
  })
}

function advanceExternalMessagePlanToSent(plan = []) {
  return normalizePlan(plan).map(step => {
    if (['understand-request', 'inspect-context', 'draft-reply', 'confirm-send'].includes(step.id)) {
      return { ...step, status: 'Done' }
    }
    return step.status === 'Active' ? { ...step, status: 'Done' } : step
  })
}

function isExternalMessageSendPermission(permission = {}) {
  return asText(permission.risk).toLowerCase() === 'external message'
    && asText(permission.toolCallId) === 'external.message.send'
    && asText(permission.planStepId) === 'confirm-send'
}

function hasExternalMessageSendResult(mission = {}) {
  return normalizeArray(mission.toolCalls).some(tool => tool?.toolName === 'messages.outbound.send')
    || normalizeArray(mission.artifacts).some(artifact => artifact?.kind === 'send-receipt')
}

function externalMessageSendReceiptSummary(mission = {}) {
  const payload = externalMessageDraftPayload(mission)
  return `已按确认记录${payload.channel}模拟发送给${payload.recipient}：「${payload.draftText}」。`
}

function completeExternalMessageAfterApproval(mission = {}, permission = {}, options = {}) {
  if (!isExternalMessageSendPermission(permission) || !isExternalMessageMission(mission)) return mission
  if (hasExternalMessageSendResult(mission)) return mission

  const target = externalMessageDesktopTarget(mission)
  const payload = externalMessageDraftPayload(mission)
  const draftText = payload.draftText
  const sendResult = options.sendResult || null
  const adapterAttempted = sendResult?.adapterId === 'wechat-ilink'
  const sendBlocked = adapterAttempted && ['blocked', 'failed'].includes(asText(sendResult.status))
  const liveSent = adapterAttempted && sendResult.messageSent === true
  const toolCallId = makeId('tool-messages-outbound-send')
  const artifactId = makeId('artifact-send-receipt')
  const summary = sendBlocked
    ? `已获得发送确认，但真实${target.appName}发送受阻：${asText(sendResult.reason, '未知错误')}。`
    : (liveSent
        ? `已按确认记录通过微信 iLink 发送给${payload.recipient}：「${draftText}」。`
        : `${externalMessageSendReceiptSummary(mission)} 当前适配器记录模拟发送回执；真实${target.appName}发送入口 ${payload.realAdapterEntry} 尚未接入或未启用，接入后仍必须由 External message 确认触发。`)

  appendCurrentMissionAgentAction({
    role: 'Operator',
    title: '发送已确认回复',
    status: sendBlocked ? 'blocked' : 'sent',
    planStepId: 'confirm-send',
    summary,
    result: sendBlocked ? '发送受阻' : '已发送',
    requiresReview: false,
  })
  appendCurrentMissionToolCall({
    id: toolCallId,
    toolName: 'messages.outbound.send',
    role: 'Operator',
    status: sendBlocked ? 'blocked' : 'ok',
    planStepId: 'confirm-send',
    risk: 'External message',
    result: summary,
  })
  appendCurrentMissionToolStage({
    toolName: 'messages.external-send',
    toolCallId,
    role: 'Operator',
    status: sendBlocked ? 'blocked' : 'ok',
    stage: liveSent ? 'confirmed-send-live' : (sendBlocked ? 'confirmed-send-blocked' : 'confirmed-send'),
    url: liveSent
      ? `external://messages/${encodeURIComponent(target.appName)}/wechat-ilink`
      : `external://messages/${encodeURIComponent(target.appName)}/mock-send`,
    planStepId: 'confirm-send',
    summary: sendBlocked
      ? `根据用户确认记录尝试发送给${payload.recipient}，但发送受阻：${asText(sendResult.reason)}。`
      : (liveSent
          ? `根据用户确认记录通过微信 iLink 发送给${payload.recipient}：「${draftText}」。`
          : `根据用户确认记录模拟发送给${payload.recipient}：「${draftText}」。`),
  })
  appendCurrentMissionToolStage({
    toolName: 'messages.real-adapter',
    toolCallId,
    role: 'Operator',
    status: liveSent ? 'ok' : (sendBlocked ? 'blocked' : 'skipped'),
    stage: liveSent ? 'confirmed-send-real-adapter' : (sendBlocked ? 'confirmed-send-real-adapter-blocked' : 'confirmed-send-real-adapter-pending'),
    url: payload.realAdapterEntry,
    planStepId: 'confirm-send',
    summary: liveSent
      ? `真实${target.appName}发送适配器已在 External message 权限批准后调用。`
      : (sendBlocked
          ? `真实${target.appName}发送适配器调用受阻：${asText(sendResult.reason)}。`
          : `真实${target.appName}发送适配器尚未启用；没有调用真实外部应用发送接口。`),
  })
  appendCurrentMissionArtifact({
    id: artifactId,
    title: '发送回执',
    kind: 'send-receipt',
    uri: `vela://capabilities/messages.outbound/results/${toolCallId}`,
    summary,
    planStepId: 'confirm-send',
  })
  appendCurrentMissionReviewCheck({
    key: `external-message-send-${asText(mission.id, 'mission')}`,
    title: '外部发送复核',
    outcome: sendBlocked ? 'blocked' : 'passed',
    reviewer: 'Vela Message Reviewer',
    planStepId: 'confirm-send',
    artifactId,
    toolCallId,
    summary: '外部消息只在用户批准后生成发送结果，批准前没有隐藏发送动作。',
    evidence: [
      `批准记录：${permission.id}`,
      `目标应用：${target.appName}`,
      `发送对象：${payload.recipient}`,
      `发送内容：${draftText}`,
      ...desktopAdapterEvidence(payload),
      ...(adapterAttempted ? wechatIlinkSendEvidence(sendResult) : []),
      '发送阶段发生在 External message 权限批准之后。',
      liveSent ? '当前已调用微信 iLink sendText。' : '当前未调用真实外部应用发送接口。',
    ],
  })
  if (sendBlocked) {
    return updateCurrentMission({
      state: canTransitionMission(mission.state, 'Blocked') ? 'Blocked' : mission.state,
      nextStep: `发送受阻：${asText(sendResult.reason, '请检查微信 iLink 配置后重试。')}`,
    })
  }
  setCurrentMissionReview({
    outcome: 'passed',
    reviewer: 'Vela Message Reviewer',
    summary: liveSent
      ? '外部消息发送链路已通过：先草拟，用户确认后通过微信 iLink 发送，并记录发送回执。'
      : '外部消息发送链路已通过：先草拟，用户确认后发送，并记录发送回执。',
    evidence: [
      `Permission ${permission.id} approved.`,
      `Tool ${toolCallId} recorded after approval.`,
    ],
  })
  const reviewedMission = getCurrentMission()
  return updateCurrentMission({
    state: 'Complete',
    plan: advanceExternalMessagePlanToSent(reviewedMission.plan),
    nextStep: summary,
  })
}

function advanceExternalMessageMissionByCommand(current = {}, input = {}, text = '', options = {}) {
  const createdAt = new Date().toISOString()
  const summary = externalMessageDraftSummary(current)
  const payload = externalMessageDraftPayload(current)
  const payloadSummary = externalMessagePayloadSummary(payload)
  const contextResult = options.contextResult || null
  const contextBlocked = contextResult?.adapterId === 'wechat-ilink'
    && ['blocked', 'failed'].includes(asText(contextResult.status))
  if (contextBlocked) {
    updateCurrentMission({
      state: 'Running',
      nextStep: `读取${payload.channel}上下文受阻：${asText(contextResult.reason, '请检查连接配置后重试。')}`,
      plan: externalMessagePlanAfterContextBlocked(current.plan),
      agentActions: [
        ...normalizeArray(current.agentActions),
        makeAgentActionRecord({
          role: 'Operator',
          title: '查看外部消息上下文',
          status: 'blocked',
          planStepId: 'inspect-context',
          summary: asText(contextResult.reason, '外部消息上下文读取受阻。'),
          result: '上下文受阻',
          requiresReview: true,
        }, { createdAt }),
      ],
    })
    appendExternalMessageDesktopContext(current, { contextResult })
    return updateCurrentMission({
      state: 'Blocked',
      nextStep: `读取${payload.channel}上下文受阻：${asText(contextResult.reason, '请先连接微信或检查 iLink 配置。')}`,
    })
  }
  const nextStep = `${summary} 这样发可以吗？`
  const action = makeAgentActionRecord({
    role: 'Operator',
    title: '草拟待确认回复',
    status: 'needs_confirmation',
    planStepId: 'draft-reply',
    summary,
    result: '待确认',
    requiresReview: false,
  }, { createdAt })

  updateCurrentMission({
    state: 'Running',
    nextStep,
    plan: advanceExternalMessagePlanToConfirm(current.plan),
    agentActions: [...normalizeArray(current.agentActions), action],
  })
  appendExternalMessageDesktopContext(current, { contextResult })
  appendCurrentMissionArtifact({
    title: '拟发送内容',
    kind: 'draft',
    uri: `vela://missions/${encodeURIComponent(asText(current.id, 'mission'))}/external-message-draft`,
    summary: `${summary} ${payloadSummary}`,
    planStepId: 'draft-reply',
  })
  return appendCurrentMissionPermission({
    action: nextStep,
    risk: 'External message',
    decision: 'requested',
    summary: `${summary} ${payloadSummary}`,
    reason: `发送前需要你确认。${payloadSummary}`,
    requestedBy: 'Vela Operator',
    planStepId: 'confirm-send',
    toolCallId: 'external.message.send',
    scope: `external://messages/${encodeURIComponent(payload.channel)}/${encodeURIComponent(payload.recipient)}`,
    screenContext: input.screenContext,
  })
}

export function normalizeMission(value = {}) {
  const now = new Date().toISOString()
  const title = asText(value.title, asText(value.goal, 'Untitled mission'))
  return {
    id: asText(value.id, `mission-${Date.now()}`),
    title,
    goal: asText(value.goal, title),
    state: normalizeState(value.state, 'Draft'),
    permissionMode: normalizePermissionMode(value.permissionMode, 'Assist'),
    modelStatus: asText(value.modelStatus, 'Local runtime'),
    activeSurface: asText(value.activeSurface, 'Mission Plan'),
    nextStep: normalizeNextStep(value.nextStep, '规划下一步。'),
    plan: normalizePlan(value.plan),
    inputs: normalizeArray(value.inputs),
    artifacts: normalizeArtifacts(value.artifacts),
    agentActions: normalizeArray(value.agentActions),
    toolCalls: normalizeArray(value.toolCalls),
    permissions: normalizeArray(value.permissions),
    memoryReferences: normalizeArray(value.memoryReferences),
    capabilityReferences: normalizeCapabilityReferences(value.capabilityReferences),
    voiceMetrics: normalizeArray(value.voiceMetrics),
    reviewChecks: normalizeArray(value.reviewChecks),
    reviewResult: value.reviewResult ?? null,
    recoveryActions: normalizeArray(value.recoveryActions),
    trace: normalizeTrace(value.trace),
    createdAt: asText(value.createdAt, now),
    updatedAt: asText(value.updatedAt, now),
  }
}

export function canTransitionMission(fromState, toState) {
  if (fromState === toState) return true
  if (!MISSION_STATES.includes(fromState) || !MISSION_STATES.includes(toState)) return false
  return STATE_TRANSITIONS[fromState]?.includes(toState) || false
}

function applyMissionPatch(mission, patch = {}) {
  const previousState = mission.state
  const previousPermissionMode = mission.permissionMode
  const next = normalizeMission({
    ...mission,
    ...patch,
    id: mission.id,
    createdAt: mission.createdAt,
    plan: patch.plan ?? mission.plan,
    updatedAt: new Date().toISOString(),
  })
  if (!canTransitionMission(mission.state, next.state)) {
    throw new MissionRuntimeError(`Invalid mission transition: ${mission.state} -> ${next.state}`, 'invalid_transition')
  }
  if (mission.state !== 'Complete' && next.state === 'Complete' && !hasPassingReview(next.reviewResult)) {
    throw new MissionRuntimeError('Reviewer outcome required before mission can be completed.', 'review_required')
  }
  const blockingReviewChecks = getBlockingReviewChecks(next)
  if (mission.state !== 'Complete' && next.state === 'Complete' && blockingReviewChecks.length) {
    throw new MissionRuntimeError('Blocking review checks must be resolved before mission can be completed.', 'review_blocked', {
      blockingReviewChecks,
    })
  }
  if (previousState !== next.state) {
    return withTrace(next, {
      type: 'state.changed',
      title: `State changed to ${next.state}`,
      detail: `${previousState} -> ${next.state}`,
      result: next.nextStep,
    })
  }
  if (previousPermissionMode !== next.permissionMode) {
    return withTrace(next, {
      type: 'permission.mode.changed',
      title: `Permission mode changed to ${next.permissionMode}`,
      detail: `${previousPermissionMode} -> ${next.permissionMode}`,
      result: next.permissionMode,
    })
  }
  return next
}

function writeCurrentMission(store, mission) {
  const exists = store.missions.some(item => item.id === mission.id)
  const missions = exists
    ? store.missions.map(item => item.id === mission.id ? mission : item)
    : [mission, ...store.missions]
  writeStore({
    version: STORE_VERSION,
    currentMissionId: mission.id,
    missions,
  })
  return mission
}

export function getCurrentMission() {
  const store = readStore()
  return store.missions.find(mission => mission.id === store.currentMissionId) || store.missions[0] || createSeedMission()
}

export function listMissions() {
  return readStore().missions
}

export function selectMission(id) {
  const missionId = asText(id)
  if (!missionId) throw new Error('mission id required')
  const store = readStore()
  const mission = store.missions.find(item => item.id === missionId)
  if (!mission) throw new Error(`Mission not found: ${missionId}`)
  writeStore({ ...store, currentMissionId: mission.id })
  return mission
}

export function startMission(input = {}) {
  const now = new Date().toISOString()
  const title = asText(input.title, asText(input.goal, 'Untitled mission'))
  const missionId = input.id || `mission-${Date.now()}`
  const plan = input.plan?.length ? input.plan : STARTED_PLAN.map(step => ({ ...step }))
  const capabilityReferences = normalizeCapabilityReferences(
    input.capabilityReferences?.length
      ? input.capabilityReferences
      : findOpenCapabilitiesForText(capabilityMatchText({ ...input, title }))
  )
  const initialArtifacts = normalizeArray(input.artifacts)
  const shouldCreateBrief = initialArtifacts.length === 0
  const missionBrief = shouldCreateBrief
    ? makeMissionBriefArtifact({
        missionId,
        title,
        planStepId: briefPlanStepId(plan),
        createdAt: now,
      })
    : null
  const trace = [
    {
      missionId,
      type: 'mission.started',
      title: 'Mission started',
      detail: title,
      result: input.nextStep || STARTED_MISSION_NEXT_STEP,
      createdAt: now,
    },
  ]
  if (missionBrief) {
    trace.push({
      missionId,
      type: 'mission.brief.created',
      title: '任务简报已创建',
      detail: missionBrief.summary,
      planStepId: missionBrief.planStepId,
      artifactId: missionBrief.id,
      result: missionBrief.uri,
      createdAt: now,
    })
  }
  const capabilityTrace = capabilityTraceEntry(missionId, capabilityReferences, now)
  if (capabilityTrace) trace.push(capabilityTrace)
  const mission = normalizeMission({
    id: missionId,
    title,
    goal: input.goal || title,
    state: input.state || 'Planned',
    permissionMode: input.permissionMode || 'Assist',
    modelStatus: input.modelStatus || 'Local runtime',
    activeSurface: input.activeSurface || 'Mission Plan',
    nextStep: input.nextStep || STARTED_MISSION_NEXT_STEP,
    plan,
    inputs: input.inputs || [],
    artifacts: missionBrief ? [missionBrief] : initialArtifacts,
    agentActions: input.agentActions || [],
    toolCalls: input.toolCalls || [],
    permissions: input.permissions || [],
    memoryReferences: input.memoryReferences || [],
    capabilityReferences,
    voiceMetrics: input.voiceMetrics || [],
    reviewChecks: input.reviewChecks || [],
    reviewResult: input.reviewResult ?? null,
    recoveryActions: input.recoveryActions || [],
    trace,
    createdAt: now,
    updatedAt: now,
  })

  const store = readStore()
  const missions = [mission, ...store.missions.filter(item => item.id !== mission.id)]
  writeStore({ version: STORE_VERSION, currentMissionId: mission.id, missions })
  return mission
}

export function updateCurrentMission(patch = {}) {
  const store = readStore()
  const current = store.missions.find(mission => mission.id === store.currentMissionId) || store.missions[0] || createSeedMission()
  try {
    const next = applyMissionPatch(current, patch)
    return writeCurrentMission(store, next)
  } catch (err) {
    if (err?.code === 'review_blocked') {
      const recovered = syncReviewBlockedRecovery(current)
      const mission = recovered === current ? current : writeCurrentMission(store, recovered)
      err.mission = mission
    }
    throw err
  }
}

export function appendCurrentMissionTrace(entry = {}) {
  const store = readStore()
  const current = store.missions.find(mission => mission.id === store.currentMissionId) || store.missions[0] || createSeedMission()
  return writeCurrentMission(store, withTrace(current, entry))
}

export function appendCurrentMissionInput(input = {}) {
  const record = makeInputRecord(input)
  const store = readStore()
  const current = store.missions.find(mission => mission.id === store.currentMissionId) || store.missions[0] || createSeedMission()
  const next = withTrace({
    ...current,
    inputs: [...current.inputs, record],
  }, {
    type: 'input.added',
    title: 'Input added',
    detail: record.text,
    result: record.source,
    createdAt: record.createdAt,
  })
  return writeCurrentMission(store, next)
}

export function appendCurrentMissionArtifact(input = {}) {
  const record = normalizeArtifactRecord(input, 0, {
    idFallback: makeId('artifact'),
    now: new Date().toISOString(),
  })
  const store = readStore()
  const current = store.missions.find(mission => mission.id === store.currentMissionId) || store.missions[0] || createSeedMission()
  const next = withTrace({
    ...current,
    artifacts: [...current.artifacts, record],
  }, {
    type: 'artifact.added',
    title: `Artifact added: ${record.title}`,
    detail: record.summary,
    planStepId: record.planStepId,
    artifactId: record.id,
    result: record.uri || record.kind,
    createdAt: record.createdAt,
  })
  return writeCurrentMission(store, next)
}

export function appendCurrentMissionMemoryReference(input = {}) {
  const title = asText(input.title || input.name || input.id, 'Mission memory')
  const record = {
    id: asText(input.id, makeId('memory')),
    title,
    type: asText(input.type || input.kind, 'project'),
    source: asText(input.source, 'manual'),
    provenance: asText(input.provenance || input.path || input.uri, ''),
    uri: asText(input.uri || input.path, ''),
    query: asText(input.query, ''),
    relevance: asText(input.relevance || input.score, ''),
    confidence: asText(input.confidence, ''),
    usedByPlanStepId: asText(input.usedByPlanStepId || input.planStepId, ''),
    reason: asText(input.reason || input.summary || input.detail, ''),
    summary: asText(input.summary || input.detail, ''),
    createdAt: new Date().toISOString(),
  }
  const store = readStore()
  const current = store.missions.find(mission => mission.id === store.currentMissionId) || store.missions[0] || createSeedMission()
  const next = withTrace({
    ...current,
    memoryReferences: [...current.memoryReferences, record],
  }, {
    type: 'memory.reference',
    title: `Memory attached: ${title}`,
    detail: record.reason || record.summary,
    planStepId: record.usedByPlanStepId,
    memoryReferenceId: record.id,
    result: record.relevance || record.provenance || record.source,
    createdAt: record.createdAt,
  })
  return writeCurrentMission(store, next)
}

export function appendCurrentMissionToolCall(input = {}) {
  const toolName = asText(input.toolName || input.tool || input.name, 'tool')
  const status = asText(input.status, 'ok')
  const role = normalizeAgentRole(input.role || input.agentRole, 'Operator')
  const record = {
    id: asText(input.id, makeId('tool')),
    toolName,
    role,
    status,
    planStepId: asText(input.planStepId, ''),
    risk: asText(input.risk, ''),
    result: asText(input.result || input.summary, ''),
    createdAt: new Date().toISOString(),
  }
  const store = readStore()
  const current = store.missions.find(mission => mission.id === store.currentMissionId) || store.missions[0] || createSeedMission()
  const next = withTrace({
    ...current,
    toolCalls: [...current.toolCalls, record],
  }, {
    type: 'tool.called',
    title: `Tool called: ${toolName}`,
    detail: record.result,
    planStepId: record.planStepId,
    toolName,
    toolCallId: record.id,
    agentRole: role,
    result: status,
    createdAt: record.createdAt,
  })
  return writeCurrentMission(store, next)
}

export function appendCurrentMissionToolStage(input = {}) {
  const toolName = asText(input.toolName || input.tool || input.name, 'tool')
  const status = asText(input.status || input.result, 'ok')
  const role = normalizeAgentRole(input.role || input.agentRole, 'Operator')
  const createdAt = new Date().toISOString()
  return appendCurrentMissionTrace({
    type: 'tool.stage',
    title: asText(input.title, `Tool stage ${status}: ${toolName}`),
    detail: asText(input.summary || input.detail || input.reason, ''),
    planStepId: asText(input.planStepId, ''),
    toolName,
    toolCallId: asText(input.toolCallId || input.toolId, ''),
    stage: asText(input.stage || input.stageName, ''),
    url: asText(input.url || input.final_url || input.href, ''),
    agentRole: role,
    result: status,
    createdAt,
  })
}

export function appendCurrentMissionAgentAction(input = {}) {
  const record = makeAgentActionRecord(input)
  const store = readStore()
  const current = store.missions.find(mission => mission.id === store.currentMissionId) || store.missions[0] || createSeedMission()
  const next = withTrace({
    ...current,
    agentActions: [...(current.agentActions || []), record],
  }, {
    type: 'agent.action',
    title: `${record.role}: ${record.title}`,
    detail: record.summary,
    planStepId: record.planStepId,
    agentRole: record.role,
    result: record.result || record.status,
    reviewOutcome: record.requiresReview ? 'required' : '',
    createdAt: record.createdAt,
  })
  return writeCurrentMission(store, next)
}

function appendCurrentMissionVoiceTrace(entry = {}, metricInput = {}) {
  const store = readStore()
  const current = store.missions.find(mission => mission.id === store.currentMissionId) || store.missions[0] || createSeedMission()
  const metric = makeVoiceMetric(
    metricInput,
    entry.detail || metricInput.transcript,
    entry.type === 'voice.privacy_gate' ? 'privacy_gate' : 'command',
    current.state,
  )
  const next = withTrace({
    ...current,
    voiceMetrics: [...(current.voiceMetrics || []), metric],
  }, {
    ...entry,
    latencyMs: metric.latencyMs,
    screenContext: metric.screenContext,
    result: entry.result || metric.state,
  })
  return writeCurrentMission(store, next)
}

export function appendCurrentMissionReviewCheck(input = {}) {
  const outcome = normalizeReviewCheckOutcome(input.outcome || input.status, 'pending')
  const title = asText(input.title || input.check || input.summary, 'Review check')
  const role = normalizeAgentRole(input.role || input.agentRole, 'Reviewer')
  const planStepId = asText(input.planStepId, '')
  const artifactId = asText(input.artifactId, '')
  const toolCallId = asText(input.toolCallId, '')
  const record = {
    id: asText(input.id, makeId('review-check')),
    key: reviewCheckKey({ ...input, title, planStepId, artifactId, toolCallId }),
    title,
    outcome,
    reviewer: asText(input.reviewer, 'Reviewer'),
    role,
    planStepId,
    artifactId,
    toolCallId,
    summary: asText(input.summary || input.detail, ''),
    evidence: normalizeTextList(input.evidence),
    failures: normalizeTextList(input.failures || input.failure),
    createdAt: new Date().toISOString(),
  }
  const store = readStore()
  const current = store.missions.find(mission => mission.id === store.currentMissionId) || store.missions[0] || createSeedMission()
  const nextWithCheck = withTrace({
    ...current,
    reviewChecks: [...(current.reviewChecks || []), record],
  }, {
    type: 'review.check',
    title: `Review check ${outcome}: ${title}`,
    detail: record.summary || record.evidence[0] || record.failures[0],
    planStepId: record.planStepId,
    artifactId: record.artifactId,
    toolName: record.toolCallId,
    toolCallId: record.toolCallId,
    agentRole: role,
    result: outcome,
    reviewOutcome: outcome,
    createdAt: record.createdAt,
  })
  const next = syncReviewBlockedRecovery(nextWithCheck)
  return writeCurrentMission(store, next)
}

export function updateCurrentMissionPlanStep(id, patch = {}) {
  const stepId = asText(id)
  if (!stepId) throw new MissionRuntimeError('Plan step id required.', 'plan_step_required')
  const store = readStore()
  const current = store.missions.find(mission => mission.id === store.currentMissionId) || store.missions[0] || createSeedMission()
  const existing = current.plan.find(step => step.id === stepId)
  if (!existing) throw new MissionRuntimeError(`Plan step not found: ${stepId}`, 'plan_step_not_found')

  const nextStatus = patch.status === undefined
    ? existing.status
    : normalizePlanStepStatus(patch.status, existing.status)
  const nextLabel = patch.label === undefined && patch.title === undefined
    ? existing.label
    : asText(patch.label || patch.title, existing.label)
  const nextPlan = current.plan.map(step => {
    if (step.id === stepId) {
      return {
        ...step,
        label: nextLabel,
        status: nextStatus,
      }
    }
    if (nextStatus === 'Active' && step.status === 'Active') {
      return {
        ...step,
        status: 'Next',
      }
    }
    return step
  })
  const next = withTrace({
    ...current,
    plan: nextPlan,
    nextStep: asText(patch.nextStep, current.nextStep),
  }, {
    type: 'plan.step.updated',
    title: `Plan step updated: ${nextLabel}`,
    detail: `${existing.status} -> ${nextStatus}`,
    planStepId: stepId,
    result: nextStatus,
  })
  return writeCurrentMission(store, next)
}

export function appendCurrentMissionPermission(input = {}) {
  const action = asText(input.action || input.title || input.summary, 'Permission decision')
  const store = readStore()
  const current = store.missions.find(mission => mission.id === store.currentMissionId) || store.missions[0] || createSeedMission()
  const mode = normalizePermissionMode(input.mode || input.permissionMode, current.permissionMode)
  const rawDecision = asText(input.decision || input.status, 'requested')
  const risk = asText(input.risk || input.riskClass, 'Write')
  const policy = permissionModePolicy({
    mode,
    risk,
    decision: rawDecision,
    input,
  })
  const record = {
    id: asText(input.id, makeId('permission')),
    action,
    mode,
    policy: asText(input.policy || input.policyName, policy.policy),
    scope: asText(input.scope || input.resource || input.path, ''),
    risk,
    decision: policy.decision,
    reason: asText(input.reason || input.summary || input.detail, policy.reason),
    summary: asText(input.summary || input.detail || input.reason, policy.reason),
    planStepId: asText(input.planStepId, ''),
    toolCallId: asText(input.toolCallId, ''),
    approvedBy: asText(input.approvedBy || input.approver, ''),
    requestedBy: asText(input.requestedBy || input.actor, 'Vela'),
    expiresAt: asText(input.expiresAt, ''),
    createdAt: new Date().toISOString(),
  }
  const shouldWaitForPermission = isPendingPermissionDecision(record.decision)
    && canTransitionMission(current.state, 'Waiting for permission')
  const shouldBlockForPolicy = policy.blockMission
    && canTransitionMission(current.state, 'Blocked')
  const next = withTrace({
    ...current,
    state: shouldBlockForPolicy ? 'Blocked' : (shouldWaitForPermission ? 'Waiting for permission' : current.state),
    nextStep: shouldBlockForPolicy ? `Blocked by ${mode} policy: ${action}` : (shouldWaitForPermission ? action : current.nextStep),
    permissions: [...current.permissions, record],
  }, {
    type: 'permission.recorded',
    title: `Permission ${record.decision}: ${action}`,
    detail: record.reason || record.summary,
    planStepId: record.planStepId,
    toolName: record.toolCallId,
    toolCallId: record.toolCallId,
    permissionDecision: record.decision,
    result: record.policy || policy.result || record.risk,
    createdAt: record.createdAt,
  })
  return writeCurrentMission(store, next)
}

// Guard approval: resolve a pending permission request in place (not a second record)
// and close the loop by resuming the mission. This is the shared runtime primitive behind
// the Guard Spine button, typed "approve" commands, and the voice privacy gate.
function normalizePermissionResolveOptions(id, patch = {}) {
  return (id && typeof id === 'object')
    ? id
    : { ...patch, id: asText(typeof id === 'string' ? id : '') || asText(patch.id || patch.permissionId) }
}

function findPermissionResolveTarget(permissions = [], requestedId = '', current = {}) {
  if (requestedId) {
    const target = permissions.find(item => item.id === requestedId) || null
    if (!target) throw new MissionRuntimeError(`Permission not found: ${requestedId}`, 'permission_not_found')
    return target
  }
  for (let index = permissions.length - 1; index >= 0; index -= 1) {
    if (isPendingPermissionDecision(permissions[index].decision)) {
      return permissions[index]
    }
  }
  throw new MissionRuntimeError('No pending permission to resolve.', 'permission_not_pending', { mission: current })
}

function resolveCurrentMissionPermissionWithOptions(options = {}, runtimeOptions = {}) {
  const store = readStore()
  const current = store.missions.find(mission => mission.id === store.currentMissionId) || store.missions[0] || createSeedMission()
  const permissions = normalizeArray(current.permissions)

  const requestedId = asText(options.id || options.permissionId)
  const target = findPermissionResolveTarget(permissions, requestedId, current)
  if (!isPendingPermissionDecision(target.decision)) {
    throw new MissionRuntimeError(`Permission already resolved: ${target.decision}`, 'permission_not_pending', { mission: current })
  }

  const decision = normalizePermissionDecision(options.decision || options.status, 'approved')
  const approved = decision === 'approved'
  const resolvedAt = new Date().toISOString()
  const approvedBy = asText(options.approvedBy || options.approver || options.reviewer, 'User')
  const reason = asText(options.reason || options.summary || options.detail, target.reason)
  const resolvedPermission = {
    ...target,
    decision,
    approvedBy,
    reason,
    summary: asText(options.summary, target.summary),
    expiresAt: asText(options.expiresAt, target.expiresAt),
    resolvedAt,
  }
  const permissionsNext = permissions.map(item => (item.id === target.id ? resolvedPermission : item))
  const stillPending = permissionsNext.some(item => isPendingPermissionDecision(item.decision))

  let nextState = current.state
  let nextStep = current.nextStep
  if (current.state === 'Waiting for permission') {
    if (approved && !stillPending && canTransitionMission(current.state, 'Running')) {
      nextState = 'Running'
      nextStep = asText(options.nextStep, `Approved: ${target.action}. Resuming mission.`)
    } else if (!approved && canTransitionMission(current.state, 'Blocked')) {
      nextState = 'Blocked'
      nextStep = asText(options.nextStep, `Denied: ${target.action}. Mission needs an alternative.`)
    }
  }

  const next = withTrace({
    ...current,
    state: nextState,
    nextStep,
    permissions: permissionsNext,
  }, {
    type: 'guard.approval',
    title: `Permission ${decision}: ${target.action}`,
    detail: reason,
    planStepId: target.planStepId,
    toolName: target.toolCallId,
    toolCallId: target.toolCallId,
    permissionDecision: decision,
    result: nextState !== current.state
      ? (approved ? 'resumed' : 'blocked')
      : (target.policy || target.risk),
    createdAt: resolvedAt,
  })
  const written = writeCurrentMission(store, next)
  if (approved && !stillPending && isExternalMessageSendPermission(resolvedPermission)) {
    return completeExternalMessageAfterApproval(written, resolvedPermission, {
      sendResult: runtimeOptions.externalMessageSendResult || null,
    })
  }
  if (approved && !stillPending && isWechatIlinkLoginPermission(resolvedPermission)) {
    return completeWechatIlinkLoginAfterApproval(written, resolvedPermission, {
      qrSession: runtimeOptions.wechatIlinkQrSession || null,
    })
  }
  if (approved && !stillPending && isWechatIlinkCredentialSavePermission(resolvedPermission)) {
    return completeWechatIlinkCredentialSaveAfterApproval(written, resolvedPermission)
  }
  return written
}

export function resolveCurrentMissionPermission(id, patch = {}) {
  return resolveCurrentMissionPermissionWithOptions(normalizePermissionResolveOptions(id, patch))
}

export async function resolveCurrentMissionPermissionWithAdapters(id, patch = {}) {
  const options = normalizePermissionResolveOptions(id, patch)
  const store = readStore()
  const current = store.missions.find(mission => mission.id === store.currentMissionId) || store.missions[0] || createSeedMission()
  const permissions = normalizeArray(current.permissions)
  const requestedId = asText(options.id || options.permissionId)
  const target = findPermissionResolveTarget(permissions, requestedId, current)
  const decision = normalizePermissionDecision(options.decision || options.status || options.result, target.decision)
  let wechatIlinkQrSession = null
  let externalMessageSendResult = null

  if (decision === 'approved' && isWechatIlinkLoginPermission(target)) {
    const adapterDeps = options.wechatIlinkLoginDeps || options.wechatIlink || {}
    const qrSessionOptions = {
      ...adapterDeps,
      env: adapterDeps.env || options.env || (typeof process === 'undefined' ? {} : process.env),
    }
    if (Object.prototype.hasOwnProperty.call(adapterDeps, 'allowNetwork')) {
      qrSessionOptions.allowNetwork = adapterDeps.allowNetwork
    } else if (Object.prototype.hasOwnProperty.call(options, 'allowNetwork')) {
      qrSessionOptions.allowNetwork = options.allowNetwork
    }
    wechatIlinkQrSession = await startWechatIlinkQrLoginSession(qrSessionOptions)
  }

  if (decision === 'approved' && isExternalMessageSendPermission(target) && isExternalMessageMission(current)) {
    const externalTarget = externalMessageDesktopTarget(current)
    if (externalTarget.appUrl === 'app://wechat' || /微信|wechat/i.test(externalTarget.appName)) {
      const payload = externalMessageDraftPayload(current)
      const adapterDeps = options.wechatIlinkSendDeps || options.wechatIlink || {}
      const sendOptions = {
        ...adapterDeps,
        text: payload.draftText,
        contextToken: asText(adapterDeps.contextToken || options.contextToken, latestStoredWechatContextToken(current)),
        env: adapterDeps.env || options.env || (typeof process === 'undefined' ? {} : process.env),
      }
      if (Object.prototype.hasOwnProperty.call(adapterDeps, 'recipientUserId')) {
        sendOptions.recipientUserId = adapterDeps.recipientUserId
      } else if (Object.prototype.hasOwnProperty.call(options, 'recipientUserId')) {
        sendOptions.recipientUserId = options.recipientUserId
      }
      if (Object.prototype.hasOwnProperty.call(adapterDeps, 'allowSend')) {
        sendOptions.allowSend = adapterDeps.allowSend
      } else if (Object.prototype.hasOwnProperty.call(options, 'allowSend')) {
        sendOptions.allowSend = options.allowSend
      }
      if (Object.prototype.hasOwnProperty.call(adapterDeps, 'allowNetwork')) {
        sendOptions.allowNetwork = adapterDeps.allowNetwork
      } else if (Object.prototype.hasOwnProperty.call(options, 'allowNetwork')) {
        sendOptions.allowNetwork = options.allowNetwork
      }
      externalMessageSendResult = await sendWechatIlinkTextMessage(sendOptions)
    }
  }

  return resolveCurrentMissionPermissionWithOptions(options, { wechatIlinkQrSession, externalMessageSendResult })
}

export function appendCurrentMissionRecoveryAction(input = {}) {
  const title = asText(input.title || input.label || input.action, 'Recovery action')
  const record = {
    id: asText(input.id, makeId('recovery')),
    title,
    status: asText(input.status, 'open'),
    summary: asText(input.summary || input.detail, ''),
    createdAt: new Date().toISOString(),
  }
  const store = readStore()
  const current = store.missions.find(mission => mission.id === store.currentMissionId) || store.missions[0] || createSeedMission()
  const shouldBlock = !/^(done|closed|resolved)$/i.test(record.status)
    && canTransitionMission(current.state, 'Blocked')
  const next = withTrace({
    ...current,
    state: shouldBlock ? 'Blocked' : current.state,
    nextStep: shouldBlock ? title : current.nextStep,
    recoveryActions: [...current.recoveryActions, record],
  }, {
    type: 'recovery.added',
    title: `Recovery action: ${title}`,
    detail: record.summary,
    result: record.status,
    createdAt: record.createdAt,
  })
  return writeCurrentMission(store, next)
}

export function updateCurrentMissionRecoveryAction(id, patch = {}) {
  const recoveryId = asText(id)
  if (!recoveryId) throw new MissionRuntimeError('Recovery action id required.', 'recovery_required')
  const store = readStore()
  const current = store.missions.find(mission => mission.id === store.currentMissionId) || store.missions[0] || createSeedMission()
  const existing = current.recoveryActions.find(action => action.id === recoveryId)
  if (!existing) throw new MissionRuntimeError(`Recovery action not found: ${recoveryId}`, 'recovery_not_found')

  const status = asText(patch.status, existing.status || 'open')
  const title = patch.title === undefined && patch.label === undefined && patch.action === undefined
    ? existing.title
    : asText(patch.title || patch.label || patch.action, existing.title)
  const summary = patch.summary === undefined && patch.detail === undefined
    ? existing.summary
    : asText(patch.summary || patch.detail, existing.summary)
  const resolved = /^(done|closed|resolved)$/i.test(status)
  const updatedAt = new Date().toISOString()
  const nextRecoveryActions = current.recoveryActions.map(action => {
    if (action.id !== recoveryId) return action
    return {
      ...action,
      title,
      status,
      summary,
      resolvedAt: resolved ? asText(patch.resolvedAt, action.resolvedAt || updatedAt) : asText(patch.resolvedAt, action.resolvedAt || ''),
      updatedAt,
    }
  })
  const next = withTrace({
    ...current,
    state: resolved && current.state === 'Blocked' && canTransitionMission(current.state, 'Running')
      ? 'Running'
      : current.state,
    nextStep: resolved ? asText(patch.nextStep, current.nextStep) : title,
    recoveryActions: nextRecoveryActions,
  }, {
    type: 'recovery.updated',
    title: `Recovery ${status}: ${title}`,
    detail: summary,
    result: status,
    createdAt: updatedAt,
  })
  return writeCurrentMission(store, next)
}

export function applyCurrentMissionCommand(input = {}) {
  const text = asText(input.text || input.command || input.content)
  if (!text) throw new MissionRuntimeError('Mission command required.', 'command_required')

  const isContinue = COMMAND_CONTINUE_RE.test(text)
  const explicitStart = isContinue ? null : text.match(COMMAND_START_RE)
  const isComplete = COMMAND_COMPLETE_RE.test(text)
  const isReviewPass = COMMAND_REVIEW_PASS_RE.test(text)
  const isPermission = COMMAND_PERMISSION_RE.test(text)
  const isRecovery = COMMAND_RECOVERY_RE.test(text)
  const isStop = COMMAND_STOP_RE.test(text)
  const isRepair = COMMAND_REPAIR_RE.test(text)
  const isApprovePermission = COMMAND_PERMISSION_APPROVE_RE.test(text)
  const isDenyPermission = COMMAND_PERMISSION_DENY_RE.test(text)

  // Spoken or typed approval/denial resolves a pending guard request through the same
  // pipeline as the Guard Spine button: close the privacy gate and resume the mission.
  if (isApprovePermission || isDenyPermission) {
    const pendingMission = getCurrentMission()
    const hasPending = normalizeArray(pendingMission.permissions).some(item => isPendingPermissionDecision(item.decision))
    if (hasPending) {
      appendCurrentMissionInput({ text, source: input.source || 'typed', screenContext: input.screenContext })
      return resolveCurrentMissionPermission(null, {
        decision: isDenyPermission ? 'denied' : 'approved',
        approvedBy: asText(input.approvedBy || input.reviewer || input.requestedBy, input.source === 'voice' ? 'Vela voice' : 'Vela command'),
        reason: text,
        nextStep: input.nextStep,
      })
    }
  }

  if (isContinue) {
    const pendingMission = getCurrentMission()
    const permissions = normalizeArray(pendingMission.permissions)
    let pendingPermission = null
    for (let index = permissions.length - 1; index >= 0; index -= 1) {
      if (isPendingPermissionDecision(permissions[index].decision)) {
        pendingPermission = permissions[index]
        break
      }
    }
    if (pendingMission.state === 'Waiting for permission' && pendingPermission) {
      appendCurrentMissionInput({ text, source: input.source || 'typed', screenContext: input.screenContext })
      return updateCurrentMission({
        state: 'Waiting for permission',
        nextStep: `需要先确认：${pendingPermission.action}`,
      })
    }
  }

  if (explicitStart || (!isContinue && !isComplete && !isReviewPass && !isPermission && !isRecovery && !isStop && !isRepair)) {
    const now = new Date().toISOString()
    const missionText = asText(explicitStart?.[2], text)
    const record = makeInputRecord({ text, source: input.source || 'typed', screenContext: input.screenContext })
    const mission = startMission({
      title: missionText,
      goal: missionText,
      nextStep: assistantNextStepForText(missionText),
      plan: assistantPlanForText(missionText),
      inputs: [record],
      createdAt: now,
      updatedAt: now,
    })
    const assistantAction = makeAssistantAgentAction(missionText, now)
    if (assistantAction) appendCurrentMissionAgentAction(assistantAction)
    return appendCurrentMissionTrace({
      type: 'command.started_mission',
      title: 'Command started mission',
      detail: text,
      result: mission.title,
      screenContext: input.screenContext,
      createdAt: record.createdAt,
    })
  }

  appendCurrentMissionInput({ text, source: input.source || 'typed', screenContext: input.screenContext })

  if (isStop) {
    const current = getCurrentMission()
    const next = updateCurrentMission({
      state: canTransitionMission(current.state, 'Waiting for user') ? 'Waiting for user' : current.state,
      nextStep: 'Stopped. Awaiting user direction.',
    })
    return appendCurrentMissionTrace({
      type: 'command.stopped',
      title: 'Command stopped',
      detail: text,
      result: next.state,
      screenContext: input.screenContext,
    })
  }

  if (isRepair) {
    const current = getCurrentMission()
    const next = updateCurrentMission({
      state: canTransitionMission(current.state, 'Waiting for user') ? 'Waiting for user' : current.state,
      nextStep: `Repair requested: ${text}`,
    })
    return appendCurrentMissionTrace({
      type: 'command.repair',
      title: 'Command repair requested',
      detail: text,
      result: next.state,
      screenContext: input.screenContext,
    })
  }

  if (isReviewPass) {
    const reviewed = setCurrentMissionReview({
      outcome: 'passed',
      reviewer: asText(input.reviewer, 'Vela command'),
      summary: text,
    })
    return updateCurrentMission({
      nextStep: reviewed.state === 'Reviewing'
        ? 'Reviewer outcome recorded. Mission can move to Complete.'
        : reviewed.nextStep,
    })
  }

  if (isPermission) {
    const decision = COMMAND_PERMISSION_APPROVE_RE.test(text) ? 'approved' : 'requested'
    return appendCurrentMissionPermission({
      action: text,
      risk: asText(input.risk, 'Write'),
      decision,
      summary: text,
      requestedBy: asText(input.requestedBy, 'Vela command'),
    })
  }

  if (isRecovery) {
    return appendCurrentMissionRecoveryAction({
      title: text,
      summary: text,
    })
  }

  const current = getCurrentMission()
  const nextState = isComplete ? 'Complete' : getNextCommandState(current.state)
  if (isContinue) {
    if (current.state === 'Planned' && nextState === 'Running' && isWechatIlinkLoginMission(current)) {
      return advanceWechatIlinkLoginMissionByCommand(current, input)
    }
    if (current.state === 'Planned' && nextState === 'Running' && isExternalMessageMission(current)) {
      return advanceExternalMessageMissionByCommand(current, input, text)
    }
    return advanceCurrentMissionByCommand(current, nextState, input, text)
  }
  return updateCurrentMission({
    state: nextState,
    nextStep: nextState === 'Reviewing'
      ? REVIEWING_MISSION_NEXT_STEP
      : current.nextStep,
  })
}

export async function applyCurrentMissionCommandWithAdapters(input = {}) {
  const text = asText(input.text || input.command || input.content)
  const isApprovePermission = COMMAND_PERMISSION_APPROVE_RE.test(text)
  const isDenyPermission = COMMAND_PERMISSION_DENY_RE.test(text)
  if (isApprovePermission || isDenyPermission) {
    const pendingMission = getCurrentMission()
    const hasPending = normalizeArray(pendingMission.permissions).some(item => isPendingPermissionDecision(item.decision))
    if (hasPending) {
      appendCurrentMissionInput({ text, source: input.source || 'typed', screenContext: input.screenContext })
      return resolveCurrentMissionPermissionWithAdapters(null, {
        ...input,
        decision: isDenyPermission ? 'denied' : 'approved',
        approvedBy: asText(input.approvedBy || input.reviewer || input.requestedBy, input.source === 'voice' ? 'Vela voice' : 'Vela command'),
        reason: text,
        nextStep: input.nextStep,
      })
    }
  }

  let capabilityAdapterResult = input.capabilityAdapterResult || null
  const isContinue = COMMAND_CONTINUE_RE.test(text)
  if (!capabilityAdapterResult && (isContinue || WECHAT_QR_SCAN_STATUS_RE.test(text))) {
    const current = getCurrentMission()
    if (isContinue && current.state === 'Planned' && isExternalMessageMission(current)) {
      const contextResult = await readWechatContextForExternalMessage(current, input)
      appendCurrentMissionInput({ text, source: input.source || 'typed', screenContext: input.screenContext })
      return advanceExternalMessageMissionByCommand(current, input, text, { contextResult })
    }
    if (current.state === 'Running' && isWechatIlinkLoginMission(current) && hasWechatIlinkQrArtifact(current)) {
      const loginStatusResult = await continueWechatIlinkLoginAfterQrStatus(current, input)
      if (loginStatusResult) return loginStatusResult
    }
  }
  if (!capabilityAdapterResult && isContinue) {
    const current = getCurrentMission()
    if (current.state === 'Running') {
      capabilityAdapterResult = await prepareCapabilityAdapterResult(current, input, input.capabilityAdapterDeps || {})
    }
  }
  return applyCurrentMissionCommand(capabilityAdapterResult
    ? { ...input, capabilityAdapterResult }
    : input)
}

export function applyCurrentMissionVoiceIntent(input = {}) {
  const transcript = asText(input.transcript || input.text || input.command || input.content)
  if (!transcript) throw new MissionRuntimeError('Voice transcript required.', 'voice_transcript_required')
  const privacyRisk = classifyVoicePrivacyRisk(transcript)
  if (privacyRisk) {
    appendCurrentMissionInput({ text: transcript, source: 'voice', screenContext: input.screenContext })
    appendCurrentMissionPermission({
      action: privacyRisk.action,
      risk: privacyRisk.risk,
      decision: 'requested',
      summary: transcript,
      requestedBy: 'Vela voice privacy gate',
    })
    return appendCurrentMissionVoiceTrace({
      type: 'voice.privacy_gate',
      title: 'Voice privacy gate requested permission',
      detail: transcript,
      permissionDecision: 'requested',
      result: privacyRisk.risk,
    }, { ...input, transcript })
  }
  const mission = applyCurrentMissionCommand({
    ...input,
    text: transcript,
    source: 'voice',
    reviewer: input.reviewer || 'Vela voice',
    requestedBy: input.requestedBy || 'Vela voice',
  })
  return appendCurrentMissionVoiceTrace({
    type: 'voice.intent.routed',
    title: 'Voice intent routed',
    detail: transcript,
    result: mission.state,
  }, { ...input, transcript })
}

export function setCurrentMissionReview(input = {}) {
  const outcome = asText(input.outcome || input.status, 'pending')
  const reviewResult = {
    outcome,
    summary: asText(input.summary || input.detail, ''),
    reviewer: asText(input.reviewer, 'Reviewer'),
    evidence: normalizeTextList(input.evidence),
    failures: normalizeTextList(input.failures || input.failure),
    createdAt: new Date().toISOString(),
  }
  const store = readStore()
  const current = store.missions.find(mission => mission.id === store.currentMissionId) || store.missions[0] || createSeedMission()
  const next = withTrace({
    ...current,
    reviewResult,
  }, {
    type: 'review.recorded',
    title: `Review ${outcome}`,
    detail: reviewResult.summary,
    reviewOutcome: outcome,
    result: reviewResult.reviewer,
    createdAt: reviewResult.createdAt,
  })
  return writeCurrentMission(store, next)
}
