import { spineEntries } from './state/mission-store.js'
import { escapeHtml } from './dom-utils.js'
import { zh } from './locale.js'

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function lastOf(value) {
  const list = asArray(value)
  return list[list.length - 1] || null
}

function text(value, fallback = '') {
  const result = String(value ?? '').trim()
  return result || fallback
}

function textList(value, fallback = '') {
  const items = Array.isArray(value) ? value : (value ? [value] : [])
  const result = items
    .map(item => text(item?.summary || item?.title || item?.detail || item))
    .filter(Boolean)
    .join('; ')
  return result || fallback
}

function latencyText(value, fallback = 'No latency recorded') {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? `${Math.round(parsed)} ms` : fallback
}

function reviewCheckKey(check = {}, index = 0) {
  const explicitKey = text(check.key || check.checkKey)
  if (explicitKey) return explicitKey
  const derived = [
    check.title || check.check || check.summary,
    check.planStepId,
    check.toolCallId,
    check.artifactId,
  ].map(value => text(value)).filter(Boolean).join('|')
  return derived || text(check.id, `review-check-${index + 1}`)
}

function blockingReviewChecks(reviewChecks = []) {
  const latestByKey = new Map()
  asArray(reviewChecks).forEach((check, index) => {
    const key = reviewCheckKey(check, index)
    latestByKey.set(key, { ...check, key })
  })
  return [...latestByKey.values()].filter(item => /^(failed|blocked)$/i.test(item?.outcome || item?.status || ''))
}

function isPermissionRequested(permission = {}) {
  return /^(requested|pending|needs approval|waiting)$/i.test(text(permission.decision || permission.status, ''))
}

function baseEntry(id) {
  return spineEntries.find(entry => entry.id === id) || {
    id,
    label: id,
    mark: id.slice(0, 3),
    status: 'idle',
    detail: '',
  }
}

function summarizeTrace(trace) {
  const latest = lastOf(trace)
  if (!latest) return 'Trace begins when Vela acts on this mission.'
  return text(latest.title || latest.type, 'Mission event')
}

function traceEventText(entry = {}) {
  const title = text(entry.title || entry.type, 'Mission event')
  const parts = [
    zh(title),
    text(entry.planStepId),
    text(entry.artifactId),
    text(entry.toolName || entry.toolCallId),
    text(entry.reviewOutcome || entry.decision || entry.result) ? zh(text(entry.reviewOutcome || entry.decision || entry.result)) : '',
  ].filter(Boolean)
  return parts.join(' / ')
}

function recentTraceText(trace) {
  const events = asArray(trace).slice(-4).map(traceEventText).filter(Boolean)
  return events.join('; ') || 'No trace events recorded yet'
}

function latestScreenContext(inputs = [], voiceMetrics = [], trace = []) {
  return [
    ...asArray(inputs).map(item => item?.screenContext),
    ...asArray(voiceMetrics).map(item => item?.screenContext),
    ...asArray(trace).map(item => item?.screenContext),
  ].reverse().find(context => context && typeof context === 'object' && Object.keys(context).length) || null
}

function screenContextText(context = {}) {
  const source = context || {}
  const parts = [
    text(source.workspaceMode) ? `${zh('Workspace')}: ${zh(text(source.workspaceMode))}` : '',
    text(source.activeView) ? `${zh('View')}: ${zh(text(source.activeView))}` : '',
    text(source.activeSurface) ? `${zh('Surface')}: ${zh(text(source.activeSurface))}` : '',
    text(source.selectedArtifactTitle || source.selectedArtifactId)
      ? `${zh('Artifact')}: ${text(source.selectedArtifactTitle || source.selectedArtifactId)}` : '',
    text(source.selectedPlanStepId) ? `${zh('Step')}: ${text(source.selectedPlanStepId)}` : '',
  ].filter(Boolean)
  return parts.join(' / ') || 'No screen context recorded'
}

const AUDIT_MARKS = {
  'mission.seed': 'MSN',
  'mission.started': 'MSN',
  'state.changed': 'STA',
  'input.added': 'IN',
  'command.started_mission': 'CMD',
  'command.routed': 'CMD',
  'command.stopped': 'CMD',
  'command.repair': 'CMD',
  'voice.intent.routed': 'VOX',
  'voice.privacy_gate': 'VOX',
  'plan.step.updated': 'STEP',
  'memory.reference': 'MEM',
  'agent.action': 'AGT',
  'tool.called': 'TOOL',
  'artifact.added': 'ART',
  'permission.recorded': 'GRD',
  'permission.mode.changed': 'GRD',
  'guard.approval': 'GRD',
  'recovery.added': 'REC',
  'recovery.updated': 'REC',
  'recovery.synced': 'REC',
  'review.check': 'REV',
  'review.recorded': 'REV',
}

function auditMark(entry = {}) {
  return AUDIT_MARKS[text(entry.type)] || text(entry.type).slice(0, 4).toUpperCase() || 'EVT'
}

function auditStatus(entry = {}) {
  const decision = text(entry.permissionDecision).toLowerCase()
  const review = text(entry.reviewOutcome).toLowerCase()
  const result = text(entry.result).toLowerCase()
  if (['requested', 'pending', 'denied'].includes(decision)) return 'watch'
  if (['failed', 'blocked', 'required'].includes(review)) return 'watch'
  if (/(blocked|failed|required|review_required|review_blocked)/i.test(result)) return 'watch'
  if (['approved', 'passed', 'pass', 'ok', 'ready', 'resumed', 'complete', 'done'].includes(decision || review || result)) return 'ready'
  return 'idle'
}

function auditMetaParts(entry = {}) {
  return [
    text(entry.planStepId) ? `${zh('Step')}: ${text(entry.planStepId)}` : '',
    text(entry.toolName) ? `${zh('Tool')}: ${text(entry.toolName)}` : '',
    text(entry.artifactId) ? `${zh('Artifact')}: ${text(entry.artifactId)}` : '',
    text(entry.memoryReferenceId) ? `${zh('Memory')}: ${text(entry.memoryReferenceId)}` : '',
    text(entry.permissionDecision) ? `${zh('Permission')}: ${zh(text(entry.permissionDecision))}` : '',
    text(entry.reviewOutcome) ? `${zh('Review result')}: ${zh(text(entry.reviewOutcome))}` : '',
    text(entry.screenContext?.workspaceMode || entry.screenContext?.selectedArtifactTitle || entry.screenContext?.selectedPlanStepId)
      ? `${zh('Screen')}: ${screenContextText(entry.screenContext)}` : '',
    text(entry.result) ? `${zh('Result')}: ${zh(text(entry.result))}` : '',
  ].filter(Boolean)
}

function buildAuditChain(trace = []) {
  return asArray(trace).slice(-7).map((entry, index) => ({
    id: text(entry.id, `audit-${index + 1}`),
    mark: auditMark(entry),
    status: auditStatus(entry),
    title: text(entry.title || entry.type, 'Mission event'),
    meta: auditMetaParts(entry).join(' · '),
  }))
}

function buildSpineEntries(mission = {}) {
  const inputs = asArray(mission.inputs)
  const artifacts = asArray(mission.artifacts)
  const agentActions = asArray(mission.agentActions)
  const toolCalls = asArray(mission.toolCalls)
  const permissions = asArray(mission.permissions)
  const memoryReferences = asArray(mission.memoryReferences)
  const voiceMetrics = asArray(mission.voiceMetrics)
  const reviewChecks = asArray(mission.reviewChecks)
  const recoveryActions = asArray(mission.recoveryActions)
  const trace = asArray(mission.trace)
  const latestInput = lastOf(inputs)
  const latestArtifact = lastOf(artifacts)
  const latestAction = lastOf(agentActions)
  const latestTool = lastOf(toolCalls)
  const latestPermission = lastOf(permissions)
  const latestMemory = lastOf(memoryReferences)
  const latestVoiceMetric = lastOf(voiceMetrics)
  const latestRecovery = lastOf(recoveryActions)
  const latestReviewCheck = lastOf(reviewChecks)
  const screenContext = latestScreenContext(inputs, voiceMetrics, trace)
  const review = mission.reviewResult || null
  const reviewOutcome = text(review?.outcome || review?.status, 'Not reviewed yet')
  const reviewPassed = /^(pass|passed|approved|ok|ready)$/i.test(reviewOutcome)
  const reviewCheckOutcome = text(latestReviewCheck?.outcome || latestReviewCheck?.status, 'No check outcome')
  const unresolvedBlockingChecks = blockingReviewChecks(reviewChecks)
  const latestBlockingCheck = lastOf(unresolvedBlockingChecks)
  const needsGuard = mission.state === 'Waiting for permission'
    || mission.state === 'Blocked'
    || permissions.length > 0
    || recoveryActions.length > 0

  return [
    {
      ...baseEntry('context'),
      status: inputs.length || artifacts.length || trace.length ? 'ready' : 'idle',
      summary: `Active context for ${text(mission.title, 'the current mission')}.`,
      auditChain: buildAuditChain(trace),
      details: [
        ['Surface', text(mission.activeSurface, 'Mission Plan')],
        ['Inputs', String(inputs.length)],
        ['Artifacts', String(artifacts.length)],
        ['Latest input', text(latestInput?.text || latestInput?.title, 'No mission input captured yet')],
        ['Latest artifact', text(latestArtifact?.title || latestArtifact?.name, 'No artifacts yet')],
        ['Latest trace', summarizeTrace(trace)],
        ['Trace events', String(trace.length)],
        ['Recent trace', recentTraceText(trace)],
        ['Latest screen context', screenContextText(screenContext)],
        ['Voice metrics', String(voiceMetrics.length)],
        ['Speech to intent', latencyText(latestVoiceMetric?.latencyMs?.speechEndToIntent)],
        ['First token', latencyText(latestVoiceMetric?.latencyMs?.finalAsrToFirstToken)],
        ['First audio', latencyText(latestVoiceMetric?.latencyMs?.responseSegmentToFirstAudio)],
        ['Barge-in stop', latencyText(latestVoiceMetric?.latencyMs?.bargeInStop)],
      ],
    },
    {
      ...baseEntry('memory'),
      status: memoryReferences.length ? 'ready' : 'idle',
      summary: memoryReferences.length
        ? 'Mission memory is attached with inspectable provenance.'
        : 'No mission memory is attached yet.',
      details: [
        ['References', String(memoryReferences.length)],
        ['Latest memory', text(latestMemory?.title || latestMemory?.name || latestMemory?.id, 'No memory reference')],
        ['Type', text(latestMemory?.type || latestMemory?.kind, 'No memory type')],
        ['Source', text(latestMemory?.source, 'No memory source')],
        ['Provenance', text(latestMemory?.provenance || latestMemory?.source, 'Awaiting memory provenance')],
        ['Query', text(latestMemory?.query, 'No memory query recorded')],
        ['Relevance', text(latestMemory?.relevance || latestMemory?.score, 'No relevance score recorded')],
        ['Confidence', text(latestMemory?.confidence, 'No confidence recorded')],
        ['Used by step', text(latestMemory?.usedByPlanStepId || latestMemory?.planStepId, 'Not linked yet')],
        ['Reason', text(latestMemory?.reason || latestMemory?.summary || latestMemory?.detail, 'No memory reason recorded')],
        ['Summary', text(latestMemory?.summary || latestMemory?.detail, 'No memory summary yet')],
      ],
    },
    {
      ...baseEntry('tools'),
      status: latestAction?.requiresReview || (latestTool?.status && !/^(ok|done|success|passed)$/i.test(latestTool.status)) ? 'watch' : (toolCalls.length || agentActions.length ? 'ready' : 'idle'),
      summary: toolCalls.length || agentActions.length
        ? 'Agent actions and tool calls are mapped back to mission execution.'
        : 'Agent actions and tool calls will appear here when Vela acts.',
      details: [
        ['Actions', String(agentActions.length)],
        ['Latest action', text(latestAction?.title, 'No agent action yet')],
        ['Action role', text(latestAction?.role, 'Operator')],
        ['Action status', text(latestAction?.status, 'No action status yet')],
        ['Calls', String(toolCalls.length)],
        ['Latest tool', text(latestTool?.toolName || latestTool?.name, 'No tool call yet')],
        ['Role', text(latestTool?.role || latestTool?.agentRole, 'Operator')],
        ['Plan step', text(latestTool?.planStepId, 'Not linked yet')],
        ['Result', text(latestTool?.result || latestTool?.status, 'No tool result yet')],
      ],
    },
    {
      ...baseEntry('guard'),
      status: needsGuard ? 'watch' : 'ready',
      permissionRecord: latestPermission,
      summary: needsGuard
        ? 'Guard state needs attention before autonomy continues.'
        : 'Guard policy is clear for the current mission mode.',
      details: [
        ['Mode', text(mission.permissionMode, 'Assist')],
        ['Mission state', text(mission.state, 'Draft')],
        ['Permission records', String(permissions.length)],
        ['Latest action', text(latestPermission?.action || latestPermission?.title, 'No permission action yet')],
        ['Policy', text(latestPermission?.policy || latestPermission?.mode, 'No guard policy recorded')],
        ['Scope', text(latestPermission?.scope, 'No permission scope recorded')],
        ['Risk', text(latestPermission?.risk || latestPermission?.riskClass, 'No risk class yet')],
        ['Latest decision', text(latestPermission?.decision || latestPermission?.status, 'No permission decision yet')],
        ['Reason', text(latestPermission?.reason || latestPermission?.summary || latestPermission?.detail, 'No permission reason recorded')],
        ['Plan step', text(latestPermission?.planStepId, 'Not linked yet')],
        ['Tool call', text(latestPermission?.toolCallId, 'Not linked yet')],
        ['Requested by', text(latestPermission?.requestedBy || latestPermission?.actor, 'Requester not recorded')],
        ['Approved by', text(latestPermission?.approvedBy, 'Approver not recorded')],
        ['Recovery', text(latestRecovery?.title || latestRecovery?.label, 'No recovery action pending')],
        ['Recovery status', text(latestRecovery?.status, 'No recovery status recorded')],
        ['Recovery source', text(latestRecovery?.source, 'No recovery source recorded')],
        ['Review check key', text(latestRecovery?.reviewCheckKey || latestRecovery?.key, 'No review check key recorded')],
        ['Recovery failures', textList(latestRecovery?.failures, 'No recovery failures recorded')],
      ],
    },
    {
      ...baseEntry('review'),
      status: unresolvedBlockingChecks.length ? 'watch' : (review ? (reviewPassed ? 'ready' : 'watch') : 'idle'),
      blockingCheck: latestBlockingCheck,
      summary: unresolvedBlockingChecks.length
        ? 'Reviewer has unresolved blocking checks before completion.'
        : review
        ? 'Reviewer outcome is recorded with inspectable evidence.'
        : 'Reviewer outcome is required before nontrivial completion.',
      details: [
        ['Outcome', reviewOutcome],
        ['Reviewer', text(review?.reviewer, 'Reviewer not assigned')],
        ['Summary', text(review?.summary || review?.detail, 'No review summary yet')],
        ['Review evidence', textList(review?.evidence, 'No review evidence recorded')],
        ['Review failures', textList(review?.failures, 'No review failures recorded')],
        ['Checks', String(reviewChecks.length)],
        ['Blocking checks', String(unresolvedBlockingChecks.length)],
        ['Latest blocking check', text(latestBlockingCheck?.title, 'No blocking check pending')],
        ['Latest blocking failures', textList(latestBlockingCheck?.failures, 'No blocking failure pending')],
        ['Latest check', text(latestReviewCheck?.title, 'No review check recorded')],
        ['Check outcome', reviewCheckOutcome],
        ['Check reviewer', text(latestReviewCheck?.reviewer, 'Reviewer not assigned')],
        ['Check plan step', text(latestReviewCheck?.planStepId, 'Not linked yet')],
        ['Check artifact', text(latestReviewCheck?.artifactId, 'Not linked yet')],
        ['Checked tool call', text(latestReviewCheck?.toolCallId, 'Not linked yet')],
        ['Check evidence', textList(latestReviewCheck?.evidence, 'No check evidence recorded')],
        ['Check failures', textList(latestReviewCheck?.failures, 'No check failures recorded')],
      ],
    },
  ]
}

function renderAuditChain(auditChain = []) {
  const items = asArray(auditChain)
  if (!items.length) return ''
  return `
    <section class="spine-audit" aria-label="${escapeHtml(zh('Audit chain'))}">
      <span class="caption">${escapeHtml(zh('Audit chain'))}</span>
      <ol>
        ${items.map(item => `
          <li data-audit-status="${escapeHtml(item.status)}">
            <span class="spine-audit-mark">${escapeHtml(item.mark)}</span>
            <span class="spine-audit-copy">
              <strong>${escapeHtml(zh(item.title))}</strong>
              <small>${escapeHtml(item.meta || zh('No audit links recorded'))}</small>
            </span>
          </li>
        `).join('')}
      </ol>
    </section>
  `
}

function renderPanelContent(entry, actions = {}) {
  const canResolveReviewCheck = entry.id === 'review' && entry.blockingCheck && actions.onResolveReviewCheck
  const canApprovePermission = entry.id === 'guard'
    && entry.permissionRecord
    && isPermissionRequested(entry.permissionRecord)
    && actions.onApprovePermission
  return `
    <p class="spine-summary">${escapeHtml(zh(entry.summary || entry.detail))}</p>
    ${renderAuditChain(entry.auditChain)}
    <dl class="spine-detail-list">
      ${(entry.details || []).map(([label, value]) => `
        <div class="spine-detail-row">
          <dt>${escapeHtml(zh(label))}</dt>
          <dd>${escapeHtml(zh(value))}</dd>
        </div>
      `).join('')}
    </dl>
    ${canResolveReviewCheck ? `
      <div class="spine-action-strip">
        <button class="spine-action-button" type="button" data-action="resolve-review-check">
          ${escapeHtml(zh('Record passed check'))}
        </button>
      </div>
    ` : ''}
    ${canApprovePermission ? `
      <div class="spine-action-strip">
        <button class="spine-action-button" type="button" data-action="approve-permission">
          ${escapeHtml(zh('Approve permission'))}
        </button>
      </div>
    ` : ''}
  `
}

export function renderIntelligenceSpine(mission = {}, actions = {}) {
  const entries = buildSpineEntries(mission)
  const spine = document.createElement('aside')
  spine.className = 'intelligence-spine'
  spine.dataset.collapsed = 'true'
  spine.setAttribute('aria-label', zh('Intelligence Spine'))
  let activeEntryId = entries[0]?.id || 'context'

  const rail = document.createElement('div')
  rail.className = 'spine-rail'

  const panel = document.createElement('section')
  panel.className = 'spine-panel'
  panel.id = 'spine-panel'
  panel.setAttribute('aria-hidden', 'true')

  const title = document.createElement('h2')
  title.textContent = zh('Context')
  const body = document.createElement('div')
  body.className = 'spine-panel-body'
  body.innerHTML = renderPanelContent(entries[0], actions)
  panel.append(title, body)

  function bindPanelActions(entry) {
    body.querySelector('[data-action="resolve-review-check"]')?.addEventListener('click', () => {
      Promise.resolve(actions.onResolveReviewCheck?.(entry.blockingCheck)).catch(() => {})
    })
    body.querySelector('[data-action="approve-permission"]')?.addEventListener('click', () => {
      Promise.resolve(actions.onApprovePermission?.(entry.permissionRecord)).catch(() => {})
    })
  }

  function setExpanded(entry) {
    const willExpand = spine.dataset.collapsed === 'true' || activeEntryId !== entry.id
    activeEntryId = entry.id
    spine.dataset.collapsed = willExpand ? 'false' : 'true'
    panel.setAttribute('aria-hidden', willExpand ? 'false' : 'true')
    title.textContent = zh(entry.label)
    body.innerHTML = renderPanelContent(entry, actions)
    bindPanelActions(entry)
    for (const button of rail.querySelectorAll('.spine-tab')) {
      const selected = willExpand && button.dataset.id === entry.id
      button.setAttribute('aria-expanded', selected ? 'true' : 'false')
      button.classList.toggle('selected', selected)
    }
  }

  for (const entry of entries) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'spine-tab'
    button.dataset.id = entry.id
    button.setAttribute('aria-expanded', 'false')
    button.setAttribute('aria-controls', 'spine-panel')
    button.innerHTML = `
      <span class="status-dot ${escapeHtml(entry.status)}" aria-hidden="true"></span>
      <span class="spine-mark">${escapeHtml(entry.mark)}</span>
      <span class="spine-label">${escapeHtml(zh(entry.label))}</span>
    `
    button.addEventListener('click', () => setExpanded(entry))
    rail.appendChild(button)
  }

  const requestedEntry = entries.find(entry => entry.id === actions.openPanelId)
  if (requestedEntry) setExpanded(requestedEntry)

  spine.append(panel, rail)
  return spine
}
