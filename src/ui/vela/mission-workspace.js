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
    return {
      kind: 'guard',
      panelId: 'guard',
      primaryAction: 'approve-permission',
      secondaryAction: 'open-spine-panel',
      primaryLabel: 'Approve permission',
      secondaryLabel: 'Open Guard',
      caption: 'Permission gate',
      title: text(permission.action || permission.title, 'Permission request'),
      detail: buildPermissionDetail(permission),
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
  `
}

function renderPlanCanvas(mission, plan) {
  return `
    <div class="canvas-kicker">${escapeHtml(zh(mission.activeSurface))}</div>
    <p class="mission-goal">${escapeHtml(zh(mission.goal))}</p>
    <ol class="mission-plan" aria-label="${escapeHtml(zh('Mission plan'))}">
      ${plan.map(step => `
        <li data-status="${escapeHtml(String(step.status || '').toLowerCase())}">
          <span>${escapeHtml(zh(step.label))}</span>
          <strong>${escapeHtml(zh(step.status))}</strong>
        </li>
      `).join('')}
    </ol>
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
    <div class="mission-header">
      <div>
        <span class="caption">${escapeHtml(zh('Mission Workspace'))}</span>
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
      <button class="step-action" type="button">${escapeHtml(zhPrefix('Move to', zh(nextState)))}</button>
    </div>

    ${guardNotice ? `
      <div class="mission-alert" role="alert">
        <span class="caption">${escapeHtml(zh('Mission guard'))}</span>
        <strong>${escapeHtml(zh(guardNotice))}</strong>
      </div>
    ` : ''}

    <form class="mission-input" aria-label="${escapeHtml(zh('Mission command input'))}">
      <input type="text" placeholder="${escapeHtml(zh('Start a mission or ask Vela to continue'))}">
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
