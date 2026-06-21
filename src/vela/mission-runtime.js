import fs from 'fs'
import path from 'path'
import { paths } from '../paths.js'
import { executeCapabilityAdapterRun, planCapabilityAdapterRun, prepareCapabilityAdapterResult } from './capability-adapters.js'
import { findOpenCapabilitiesForText } from './capability-registry.js'

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
const COMMAND_PERMISSION_APPROVE_RE = /(?:\b(?:approve|approved|allow|allowed|grant|granted|authorize|authorized)\b|批准|许可|同意|授权|允许|可以|通过)/i
const COMMAND_PERMISSION_DENY_RE = /(?:\b(?:deny|denied|decline|declined|reject|rejected|disallow)\b|拒绝|否决|驳回|不允许|不可以|不行|不能|不要|别发|别发送)/i
const PENDING_PERMISSION_RE = /^(requested|pending|needs approval|waiting)$/i

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

function normalizeArtifactRecord(value = {}, index = 0, options = {}) {
  const title = asText(value.title || value.name, 'Mission artifact')
  const createdAt = asText(value.createdAt, options.now || new Date().toISOString())
  return {
    id: asText(value.id || value.uri || value.path, options.idFallback || `artifact-${index + 1}`),
    title,
    kind: asText(value.kind || value.type, 'note'),
    uri: asText(value.uri || value.path, ''),
    summary: asText(value.summary || value.detail, ''),
    planStepId: asText(value.planStepId, ''),
    createdAt,
  }
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

function assistantPlanForText(text) {
  return (isExternalMessageIntent(text) ? PERSONAL_ASSISTANT_MESSAGE_PLAN : STARTED_PLAN)
    .map(step => ({ ...step }))
}

function assistantNextStepForText(text) {
  if (isExternalMessageIntent(text)) {
    return '好的，我先去看一下。拿到上下文后，我会把准备发送的内容给你确认。'
  }
  return STARTED_MISSION_NEXT_STEP
}

function makeAssistantAgentAction(text, createdAt = new Date().toISOString()) {
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

function isExternalMessageMission(mission = {}) {
  return isExternalMessageIntent(mission.title)
    || isExternalMessageIntent(mission.goal)
    || normalizeArray(mission.inputs).some(input => isExternalMessageIntent(input?.text))
    || normalizeArray(mission.plan).some(step => ['inspect-context', 'draft-reply', 'confirm-send'].includes(asText(step?.id)))
}

function draftExternalMessageText(mission = {}) {
  const sourceText = [
    mission.title,
    mission.goal,
    ...normalizeArray(mission.inputs).map(input => input?.text),
  ].map(value => asText(value)).join(' ')
  if (/(老婆|妻子|太太|媳妇)/.test(sourceText)) return '收到，我晚点跟你说。'
  if (/(老公|先生)/.test(sourceText)) return '收到，我晚点跟你说。'
  return '收到，我看到了，稍后回复你。'
}

function externalMessageDraftSummary(mission = {}) {
  return `我准备这样回：「${draftExternalMessageText(mission)}」`
}

function externalMessageDesktopTarget(mission = {}) {
  const sourceText = [
    mission.title,
    mission.goal,
    ...normalizeArray(mission.inputs).map(input => input?.text),
  ].map(value => asText(value)).join(' ')
  if (/(?:微信|wechat)/i.test(sourceText)) {
    return { appName: '微信', appUrl: 'app://wechat' }
  }
  if (/(?:email|邮件|邮箱)/i.test(sourceText)) {
    return { appName: '邮件', appUrl: 'app://mail' }
  }
  return { appName: '消息应用', appUrl: 'app://messages' }
}

function hasExternalMessageDesktopContext(mission = {}) {
  return normalizeArray(mission.toolCalls).some(tool => tool?.toolName === 'desktop.app-control.inspect')
}

function appendExternalMessageDesktopContext(mission = {}) {
  if (hasExternalMessageDesktopContext(mission)) return getCurrentMission()
  const planStepId = 'inspect-context'
  const toolCallId = makeId('tool-desktop-app-control-inspect')
  const artifactId = makeId('artifact-desktop-context')
  const target = externalMessageDesktopTarget(mission)
  const summary = `已准备「${target.appName}」上下文原型：模拟打开应用并模拟查看当前对话；没有真实打开应用、截图、读取真实屏幕或发送消息。`

  appendCurrentMissionToolCall({
    id: toolCallId,
    toolName: 'desktop.app-control.inspect',
    role: 'Operator',
    status: 'ok',
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
    status: 'ok',
    stage: 'external-message-screen-context',
    url: 'screen://mock/current-chat',
    planStepId,
    summary: '模拟读取当前对话上下文，未截图或读取真实屏幕。',
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
  })
  return appendCurrentMissionReviewCheck({
    key: `external-message-desktop-context-${asText(mission.id, 'mission')}`,
    title: '桌面上下文复核',
    outcome: 'passed',
    reviewer: 'Vela Desktop Reviewer',
    planStepId,
    artifactId,
    toolCallId,
    summary: '外部消息任务已先完成桌面上下文原型检查；没有隐藏发送动作。',
    evidence: [
      `目标应用：${target.appName}`,
      `模拟打开：${target.appUrl}`,
      '模拟屏幕上下文：screen://mock/current-chat',
      '未真实打开应用、未截图、未读取真实屏幕、未发送消息。',
      '真正发送前仍需要 External message 确认。',
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
  const target = externalMessageDesktopTarget(mission)
  return `已按确认发送到${target.appName}：「${draftExternalMessageText(mission)}」。`
}

function completeExternalMessageAfterApproval(mission = {}, permission = {}) {
  if (!isExternalMessageSendPermission(permission) || !isExternalMessageMission(mission)) return mission
  if (hasExternalMessageSendResult(mission)) return mission

  const target = externalMessageDesktopTarget(mission)
  const draftText = draftExternalMessageText(mission)
  const toolCallId = makeId('tool-messages-outbound-send')
  const artifactId = makeId('artifact-send-receipt')
  const summary = `${externalMessageSendReceiptSummary(mission)} 当前适配器记录模拟发送回执；接入真实应用发送前仍必须由 External message 确认触发。`

  appendCurrentMissionAgentAction({
    role: 'Operator',
    title: '发送已确认回复',
    status: 'sent',
    planStepId: 'confirm-send',
    summary,
    result: '已发送',
    requiresReview: false,
  })
  appendCurrentMissionToolCall({
    id: toolCallId,
    toolName: 'messages.outbound.send',
    role: 'Operator',
    status: 'ok',
    planStepId: 'confirm-send',
    risk: 'External message',
    result: summary,
  })
  appendCurrentMissionToolStage({
    toolName: 'messages.external-send',
    toolCallId,
    role: 'Operator',
    status: 'ok',
    stage: 'confirmed-send',
    url: `external://messages/${encodeURIComponent(target.appName)}/mock-send`,
    planStepId: 'confirm-send',
    summary: `根据用户确认记录模拟发送：「${draftText}」。`,
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
    outcome: 'passed',
    reviewer: 'Vela Message Reviewer',
    planStepId: 'confirm-send',
    artifactId,
    toolCallId,
    summary: '外部消息只在用户批准后生成发送结果，批准前没有隐藏发送动作。',
    evidence: [
      `批准记录：${permission.id}`,
      `目标应用：${target.appName}`,
      `发送内容：${draftText}`,
      '发送阶段发生在 External message 权限批准之后。',
      '当前为模拟发送回执，未调用真实外部应用发送接口。',
    ],
  })
  setCurrentMissionReview({
    outcome: 'passed',
    reviewer: 'Vela Message Reviewer',
    summary: '外部消息发送链路已通过：先草拟，用户确认后发送，并记录发送回执。',
    evidence: [
      `Permission ${permission.id} approved.`,
      `Tool ${toolCallId} recorded after approval.`,
    ],
  })
  const reviewedMission = getCurrentMission()
  return updateCurrentMission({
    state: 'Complete',
    plan: advanceExternalMessagePlanToSent(reviewedMission.plan),
    nextStep: externalMessageSendReceiptSummary(reviewedMission),
  })
}

function advanceExternalMessageMissionByCommand(current = {}, input = {}, text = '') {
  const createdAt = new Date().toISOString()
  const summary = externalMessageDraftSummary(current)
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
  appendExternalMessageDesktopContext(current)
  appendCurrentMissionArtifact({
    title: '拟发送内容',
    kind: 'draft',
    uri: `vela://missions/${encodeURIComponent(asText(current.id, 'mission'))}/external-message-draft`,
    summary,
    planStepId: 'draft-reply',
  })
  return appendCurrentMissionPermission({
    action: nextStep,
    risk: 'External message',
    decision: 'requested',
    summary,
    reason: '发送前需要你确认。',
    requestedBy: 'Vela Operator',
    planStepId: 'confirm-send',
    toolCallId: 'external.message.send',
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
export function resolveCurrentMissionPermission(id, patch = {}) {
  const options = (id && typeof id === 'object')
    ? id
    : { ...patch, id: asText(typeof id === 'string' ? id : '') || asText(patch.id || patch.permissionId) }
  const store = readStore()
  const current = store.missions.find(mission => mission.id === store.currentMissionId) || store.missions[0] || createSeedMission()
  const permissions = normalizeArray(current.permissions)

  const requestedId = asText(options.id || options.permissionId)
  let target = null
  if (requestedId) {
    target = permissions.find(item => item.id === requestedId) || null
    if (!target) throw new MissionRuntimeError(`Permission not found: ${requestedId}`, 'permission_not_found')
  } else {
    for (let index = permissions.length - 1; index >= 0; index -= 1) {
      if (isPendingPermissionDecision(permissions[index].decision)) {
        target = permissions[index]
        break
      }
    }
    if (!target) throw new MissionRuntimeError('No pending permission to resolve.', 'permission_not_pending', { mission: current })
  }
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
    return completeExternalMessageAfterApproval(written, resolvedPermission)
  }
  return written
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
  let capabilityAdapterResult = input.capabilityAdapterResult || null
  if (!capabilityAdapterResult && COMMAND_CONTINUE_RE.test(text)) {
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
