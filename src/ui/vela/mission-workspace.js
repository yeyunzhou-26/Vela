import { escapeHtml } from './dom-utils.js'
import { zh, zhPrefix } from './locale.js'

const WORKSPACE_MODES = [
  { id: 'plan', label: 'Plan' },
  { id: 'artifacts', label: 'Artifacts' },
]

const NEXT_STATE = {
  Draft: 'Planned',
  Planned: 'Running',
  Running: 'Reviewing',
  'Waiting for user': 'Running',
  'Waiting for permission': 'Running',
  Blocked: 'Running',
  Reviewing: 'Complete',
  Failed: 'Running',
  Complete: 'Running',
}

export function getNextMissionState(state) {
  return NEXT_STATE[state] || 'Running'
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function text(value, fallback = '') {
  const result = String(value ?? '').trim()
  return result || fallback
}

function lastOf(value) {
  const list = asArray(value)
  return list[list.length - 1] || null
}

function latestInput(mission = {}) {
  return lastOf(mission.inputs)
}

function latestAgentAction(mission = {}) {
  return lastOf(mission.agentActions)
}

function latestArtifact(mission = {}) {
  return lastOf(mission.artifacts)
}

function looksLikeExternalMessageIntent(value) {
  return /(?:wechat|微信|老婆|妻子|太太|媳妇|老公|先生|reply|message|回复|回个|发消息|发信息|发微信|发送)/i.test(text(value))
}

function isExternalMessageMission(mission = {}) {
  return looksLikeExternalMessageIntent(mission.title)
    || looksLikeExternalMessageIntent(mission.goal)
    || asArray(mission.inputs).some(input => looksLikeExternalMessageIntent(input?.text))
    || asArray(mission.plan).some(step => ['inspect-context', 'draft-reply', 'confirm-send'].includes(text(step?.id)))
}

function isExternalMessagePermission(permission = {}) {
  return /^(external message|外部消息)$/i.test(text(permission.risk || permission.riskClass))
    || looksLikeExternalMessageIntent(permission.action || permission.title || permission.summary)
}

function artifactId(artifact = {}, index = 0) {
  return text(artifact.id || artifact.uri || artifact.path || artifact.title || artifact.name, `artifact-${index + 1}`)
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

function isPermissionDenied(permission = {}) {
  return /^(denied|rejected|declined|blocked|disallowed)$/i.test(text(permission.decision || permission.status, ''))
}

function isPolicyBlockedPermission(permission = {}) {
  const summary = [
    permission.policy,
    permission.reason,
    permission.summary,
    permission.result,
    permission.status,
    permission.decision,
  ].map(value => text(value)).join(' ')
  return isPermissionDenied(permission) && /\b(block|blocked|read-only|guard|policy|denied)\b/i.test(summary)
}

function latestPendingPermission(permissions = []) {
  return [...asArray(permissions)].reverse().find(isPermissionRequested) || null
}

function latestPolicyBlockedPermission(permissions = []) {
  return [...asArray(permissions)].reverse().find(isPolicyBlockedPermission) || null
}

function latestOpenRecoveryAction(recoveryActions = []) {
  return [...asArray(recoveryActions)].reverse().find(action => (
    !/^(done|closed|resolved)$/i.test(text(action?.status, 'open'))
  )) || null
}

function labelValue(label, value) {
  const result = text(value)
  return result ? `${zh(label)}: ${zh(result)}` : ''
}

function localizedKind(value, fallback = 'note') {
  return zh(text(value, fallback))
}

function buildPermissionDetail(permission = {}) {
  return [
    labelValue('Risk', permission.risk || permission.riskClass),
    labelValue('Scope', permission.scope),
    labelValue('Policy', permission.policy || permission.mode),
    labelValue('Latest decision', permission.decision || permission.status),
    labelValue('Requested by', permission.requestedBy || permission.actor),
  ].filter(Boolean).join(' · ') || zh('Review this request before Vela continues.')
}

function missionAttention(mission = {}) {
  const permission = latestPendingPermission(mission.permissions)
  if (permission) {
    const externalMessage = isExternalMessagePermission(permission)
    return {
      kind: 'guard',
      panelId: 'guard',
      primaryAction: 'approve-permission',
      secondaryAction: 'open-spine-panel',
      primaryLabel: externalMessage ? 'Send this reply' : 'Approve permission',
      secondaryLabel: externalMessage ? 'Review details' : 'Open Guard',
      caption: externalMessage ? 'Send confirmation' : 'Permission gate',
      title: externalMessage
        ? text(permission.summary || permission.action || permission.title, 'Message draft')
        : text(permission.action || permission.title, 'Permission request'),
      detail: externalMessage
        ? text(permission.reason, 'Vela will only send after you confirm.')
        : buildPermissionDetail(permission),
      permission,
    }
  }

  const blockingCheck = lastOf(blockingReviewChecks(mission.reviewChecks))
  if (blockingCheck) {
    return {
      kind: 'review',
      panelId: 'review',
      primaryAction: 'resolve-review-check',
      secondaryAction: 'open-spine-panel',
      primaryLabel: 'Record passed check',
      secondaryLabel: 'Open Review',
      caption: 'Review blocker',
      title: text(blockingCheck.title || blockingCheck.summary, 'Blocking review check'),
      detail: text(blockingCheck.summary, zh('Resolve this reviewer check before completion.')),
      check: blockingCheck,
    }
  }

  const recoveryAction = latestOpenRecoveryAction(mission.recoveryActions)
  if (mission.state === 'Blocked' && recoveryAction) {
    return {
      kind: 'recovery',
      panelId: recoveryAction.source === 'review_blocked' ? 'review' : 'guard',
      secondaryAction: 'open-spine-panel',
      secondaryLabel: recoveryAction.source === 'review_blocked' ? 'Open Review' : 'Open Guard',
      caption: 'Recovery needed',
      title: text(recoveryAction.title || recoveryAction.label, 'Recovery action pending'),
      detail: zh('Open the spine to inspect recovery evidence.'),
      recoveryAction,
    }
  }

  const policyBlockedPermission = mission.state === 'Blocked'
    ? latestPolicyBlockedPermission(mission.permissions)
    : null
  if (policyBlockedPermission) {
    return {
      kind: 'guard',
      panelId: 'guard',
      secondaryAction: 'open-spine-panel',
      secondaryLabel: 'Open Guard',
      caption: 'Permission blocked',
      title: text(policyBlockedPermission.action || policyBlockedPermission.title, 'Permission request blocked'),
      detail: buildPermissionDetail(policyBlockedPermission) || zh('Open Guard to inspect the policy decision.'),
      permission: policyBlockedPermission,
    }
  }

  return null
}

function planStepLabel(plan, planStepId) {
  const id = text(planStepId)
  if (!id) return zh('Not linked yet')
  const step = asArray(plan).find(item => text(item.id) === id)
  return step ? `${zh(text(step.label || step.title, id))} (${id})` : id
}

function artifactReviewPayload(artifact = {}, artifactIdValue = '') {
  const title = text(artifact.title || artifact.name, 'Mission artifact')
  const summary = text(artifact.summary || artifact.detail || artifact.uri || artifact.path, 'Artifact is ready for review.')
  return {
    title: `Review ${title}`,
    outcome: 'pending',
    reviewer: 'Vela Review Spine',
    planStepId: text(artifact.planStepId),
    artifactId: artifactIdValue,
    summary: `Review requested from Artifacts workspace for ${title}.`,
    evidence: [summary],
  }
}

function renderWorkspaceTabs(activeMode, artifactCount) {
  return `
    <div class="assistant-process-switcher">
      <span class="caption">${escapeHtml(zh('Process'))}</span>
      <div class="workspace-mode-tabs" role="tablist" aria-label="${escapeHtml(zh('Mission workspace mode'))}">
        ${WORKSPACE_MODES.map(mode => {
          const selected = mode.id === activeMode
          const label = mode.id === 'artifacts' ? `${zh(mode.label)} ${artifactCount}` : zh(mode.label)
          return `
            <button
              class="workspace-mode-tab"
              type="button"
              role="tab"
              aria-selected="${selected ? 'true' : 'false'}"
              data-workspace-mode="${escapeHtml(mode.id)}"
            >${escapeHtml(label)}</button>
          `
        }).join('')}
      </div>
    </div>
  `
}

function assistantReplyForMission(mission = {}, attention = null) {
  const input = latestInput(mission)
  const value = text(input?.text || mission.title)
  if (attention?.kind === 'guard') {
    if (isExternalMessagePermission(attention.permission)) {
      const draft = text(attention.permission?.summary || attention.title, '我准备好了回复草稿。')
      return `${draft} 这样发可以吗？`
    }
    return '我已经准备好下一步了。这个动作会影响外部世界，所以先把要做的事给你确认。'
  }
  if (attention?.kind === 'review') {
    return '我先把结果卡住，等后台复核通过再算完成。你不用看细节，必要时我会直接告诉你缺什么。'
  }
  if (mission.state === 'Waiting for user') {
    return '我停在这里，等你一句话继续、修改，或者换个方向。'
  }
  if (looksLikeExternalMessageIntent(value)) {
    return '好的，我先去看一下。拿到上下文后，我会把准备发送的内容给你确认。'
  }
  if (mission.state === 'Complete') {
    return '这件事已经处理完了。'
  }
  if (mission.state === 'Running') {
    return '我正在处理这件事。需要你决定的时候，我会只问关键问题。'
  }
  return '想让我办什么，直接说就行。'
}

function assistantStateLabel(mission = {}, attention = null) {
  if (attention?.kind === 'guard') return '等待你确认'
  if (attention?.kind === 'review') return '后台复核中'
  if (mission.state === 'Waiting for permission') return '等待你确认'
  if (mission.state === 'Running') return '正在处理'
  if (mission.state === 'Complete') return '已完成'
  return '待命'
}

function renderAssistantProcess(plan, mission = {}) {
  const action = latestAgentAction(mission)
  const artifact = latestArtifact(mission)
  const activeStep = asArray(plan).find(step => text(step.status).toLowerCase() === 'active')
    || asArray(plan).find(step => text(step.status).toLowerCase() === 'reviewing')
    || asArray(plan)[0]
  return `
    <div class="assistant-process">
      <div>
        <span class="caption">${escapeHtml(zh('Now'))}</span>
        <strong>${escapeHtml(zh(text(activeStep?.label, 'Ready')))}</strong>
      </div>
      <div>
        <span class="caption">${escapeHtml(zh('Backstage'))}</span>
        <strong>${escapeHtml(zh(text(action?.title || artifact?.title, 'No backstage action yet')))}</strong>
      </div>
      <div>
        <span class="caption">${escapeHtml(zh('Next'))}</span>
        <strong>${escapeHtml(zh(mission.nextStep))}</strong>
      </div>
    </div>
  `
}

function shouldContinueThroughCommand(mission = {}) {
  return mission.state === 'Planned' && isExternalMessageMission(mission)
}

function renderPlanCanvas(mission, plan) {
  const input = latestInput(mission)
  const attention = missionAttention(mission)
  const userText = text(input?.text)
  return `
    <div class="assistant-canvas" aria-label="${escapeHtml(zh('Assistant chat'))}">
      <div class="assistant-status">
        <span class="assistant-mark" aria-hidden="true">V</span>
        <div>
          <span class="caption">${escapeHtml(zh('Vela Assistant'))}</span>
          <strong>${escapeHtml(assistantStateLabel(mission, attention))}</strong>
        </div>
      </div>
      <div class="assistant-thread">
        <article class="chat-bubble assistant">
          <span>${escapeHtml(zh('Vela'))}</span>
          <p>${escapeHtml(assistantReplyForMission(mission, attention))}</p>
        </article>
        ${userText ? `
          <article class="chat-bubble user">
            <span>${escapeHtml(zh('You'))}</span>
            <p>${escapeHtml(zh(userText))}</p>
          </article>
        ` : ''}
        <article class="chat-bubble assistant current">
          <span>${escapeHtml(zh('Current focus'))}</span>
          <p class="mission-goal">${escapeHtml(zh(mission.goal))}</p>
        </article>
      </div>
      ${renderAssistantProcess(plan, mission)}
    </div>
  `
}

function renderArtifactCanvas(artifacts, selectedArtifactId, plan) {
  const selected = artifacts.find((artifact, index) => artifactId(artifact, index) === selectedArtifactId)
    || artifacts[artifacts.length - 1]
    || null
  const selectedId = selected ? artifactId(selected, artifacts.indexOf(selected)) : ''
  if (!selected) {
    return `
      <div class="canvas-kicker">${escapeHtml(zh('Artifacts'))}</div>
      <div class="artifact-empty">
        <strong>${escapeHtml(zh('No artifacts yet'))}</strong>
        <span>${escapeHtml(zh('Mission outputs will appear here after Vela creates files, reports, previews, or handoff notes.'))}</span>
      </div>
    `
  }
  return `
    <div class="canvas-kicker">${escapeHtml(zh('Artifacts'))}</div>
    <section class="artifact-focus" aria-label="${escapeHtml(zh('Current artifact'))}">
      <div class="artifact-copy">
        <span class="caption">${escapeHtml(zh('Current artifact'))}</span>
        <h2>${escapeHtml(zh(text(selected.title || selected.name, 'Mission artifact')))}</h2>
        <p>${escapeHtml(zh(text(selected.summary || selected.detail, 'No artifact summary recorded yet.')))}</p>
        <div class="artifact-actions">
          <button class="artifact-review-action" type="button" data-artifact-id="${escapeHtml(selectedId)}" aria-controls="spine-panel">
            ${escapeHtml(zh('Send to Review'))}
          </button>
        </div>
      </div>
      <dl class="artifact-meta">
        <div>
          <dt>${escapeHtml(zh('Kind'))}</dt>
          <dd>${escapeHtml(localizedKind(selected.kind || selected.type))}</dd>
        </div>
        <div>
          <dt>${escapeHtml(zh('URI'))}</dt>
          <dd>${escapeHtml(zh(text(selected.uri || selected.path, 'No URI recorded')))}</dd>
        </div>
        <div>
          <dt>${escapeHtml(zh('Created'))}</dt>
          <dd>${escapeHtml(text(selected.createdAt, zh('No timestamp')))}</dd>
        </div>
        <div>
          <dt>${escapeHtml(zh('Step'))}</dt>
          <dd>${escapeHtml(planStepLabel(plan, selected.planStepId))}</dd>
        </div>
      </dl>
    </section>
    <ol class="artifact-list" aria-label="${escapeHtml(zh('Mission artifacts'))}">
      ${artifacts.map((artifact, index) => {
        const id = artifactId(artifact, index)
        const isSelected = id === selectedId
        return `
        <li>
          <button
            class="artifact-select"
            type="button"
            aria-pressed="${isSelected ? 'true' : 'false'}"
            data-artifact-id="${escapeHtml(id)}"
          >
            <span>
              <strong>${escapeHtml(zh(text(artifact.title || artifact.name, 'Mission artifact')))}</strong>
              <small>${escapeHtml([localizedKind(artifact.kind || artifact.type, ''), text(artifact.uri || artifact.path)].filter(Boolean).join(' / ') || zh('Artifacts'))}</small>
            </span>
            <em>${escapeHtml(zh(text(artifact.summary || artifact.detail, 'No summary')))}</em>
            <small class="artifact-step-link">${escapeHtml(planStepLabel(plan, artifact.planStepId))}</small>
          </button>
        </li>
      `}).join('')}
    </ol>
  `
}

function renderAttentionStrip(attention) {
  if (!attention) return ''
  const hasPrimary = attention.primaryAction && attention.primaryLabel
  const hasSecondary = attention.secondaryAction && attention.secondaryLabel
  return `
    <div class="mission-attention-strip" data-attention-kind="${escapeHtml(attention.kind)}" role="status">
      <div class="attention-copy">
        <span class="caption">${escapeHtml(zh(attention.caption))}</span>
        <strong>${escapeHtml(zh(attention.title))}</strong>
        <p>${escapeHtml(zh(attention.detail))}</p>
      </div>
      <div class="attention-actions">
        ${hasPrimary ? `
          <button class="attention-action primary" type="button" data-attention-action="primary">
            ${escapeHtml(zh(attention.primaryLabel))}
          </button>
        ` : ''}
        ${hasSecondary ? `
          <button class="attention-action secondary" type="button" data-attention-action="secondary">
            ${escapeHtml(zh(attention.secondaryLabel))}
          </button>
        ` : ''}
      </div>
    </div>
  `
}

export function renderMissionWorkspace(mission, { notice = '', workspaceMode = 'plan', selectedArtifactId = '', onSelectWorkspaceMode, onSelectArtifact, onRequestArtifactReview, onApprovePermission, onResolveReviewCheck, onOpenSpinePanel, onSubmitCommand, onAdvanceMission } = {}) {
  const plan = Array.isArray(mission.plan) ? mission.plan : []
  const artifacts = asArray(mission.artifacts)
  const activeMode = workspaceMode === 'artifacts' ? 'artifacts' : 'plan'
  const nextState = getNextMissionState(mission.state)
  const guardNotice = String(notice || '').trim()
  const attention = missionAttention(mission)
  const workspace = document.createElement('section')
  workspace.className = 'mission-workspace'
  workspace.setAttribute('aria-label', zh('Mission Workspace'))
  workspace.innerHTML = `
    <div class="mission-header assistant-header">
      <div>
        <span class="caption">${escapeHtml(zh('Vela Assistant'))}</span>
        <h1>${escapeHtml(zh(mission.title))}</h1>
      </div>
      <span class="state-chip">${escapeHtml(zh(mission.state))}</span>
    </div>

    ${renderWorkspaceTabs(activeMode, artifacts.length)}

    <section class="mission-canvas" aria-label="${escapeHtml(zh('Active work surface'))}">
      ${activeMode === 'artifacts'
        ? renderArtifactCanvas(artifacts, selectedArtifactId, plan)
        : renderPlanCanvas(mission, plan)}
    </section>

    ${renderAttentionStrip(attention)}

    <div class="next-step-strip">
      <div class="next-step-copy">
        <span class="caption">${escapeHtml(zh('Next step'))}</span>
        <strong>${escapeHtml(zh(mission.nextStep))}</strong>
      </div>
      <button class="step-action" type="button" title="${escapeHtml(zhPrefix('Move to', zh(nextState)))}">${escapeHtml(zh('Continue'))}</button>
    </div>

    ${guardNotice ? `
      <div class="mission-alert" role="alert">
        <span class="caption">${escapeHtml(zh('Mission guard'))}</span>
        <strong>${escapeHtml(zh(guardNotice))}</strong>
      </div>
    ` : ''}

    <form class="mission-input" aria-label="${escapeHtml(zh('Mission command input'))}">
      <input type="text" placeholder="${escapeHtml(zh('Tell Vela what to do'))}">
      <button type="submit">${escapeHtml(zh('Send'))}</button>
    </form>
  `
  workspace.querySelector('.mission-input')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const input = workspace.querySelector('.mission-input input')
    const value = input?.value || ''
    Promise.resolve(onSubmitCommand?.(value)).catch(() => {})
    if (input) input.value = ''
  })
  workspace.querySelector('.step-action')?.addEventListener('click', () => {
    if (shouldContinueThroughCommand(mission)) {
      Promise.resolve(onSubmitCommand?.('继续')).catch(() => {})
      return
    }
    Promise.resolve(onAdvanceMission?.(nextState)).catch(() => {})
  })
  for (const button of workspace.querySelectorAll('.workspace-mode-tab')) {
    button.addEventListener('click', () => {
      Promise.resolve(onSelectWorkspaceMode?.(button.dataset.workspaceMode)).catch(() => {})
    })
  }
  for (const button of workspace.querySelectorAll('.artifact-select')) {
    button.addEventListener('click', () => {
      Promise.resolve(onSelectArtifact?.(button.dataset.artifactId)).catch(() => {})
    })
  }
  for (const button of workspace.querySelectorAll('.artifact-review-action')) {
    button.addEventListener('click', () => {
      const targetId = button.dataset.artifactId || ''
      const artifact = artifacts.find((item, index) => artifactId(item, index) === targetId)
      Promise.resolve(onRequestArtifactReview?.(artifactReviewPayload(artifact, targetId))).catch(() => {})
    })
  }
  workspace.querySelector('[data-attention-action="primary"]')?.addEventListener('click', () => {
    if (attention?.primaryAction === 'approve-permission') {
      Promise.resolve(onApprovePermission?.(attention.permission)).catch(() => {})
    } else if (attention?.primaryAction === 'resolve-review-check') {
      Promise.resolve(onResolveReviewCheck?.(attention.check)).catch(() => {})
    }
  })
  workspace.querySelector('[data-attention-action="secondary"]')?.addEventListener('click', () => {
    Promise.resolve(onOpenSpinePanel?.(attention?.panelId)).catch(() => {})
  })
  return workspace
}
