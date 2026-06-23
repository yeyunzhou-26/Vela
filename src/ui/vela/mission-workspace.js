import { escapeHtml } from './dom-utils.js'
import { zh } from './locale.js'

const WORKSPACE_MODES = [
  { id: 'plan', label: 'Plan' },
  { id: 'artifacts', label: 'Artifacts' },
]

const QUICK_COMMANDS = [
  { label: '打开微信', command: '打开微信' },
  { label: '看最近消息', command: '看看最近消息' },
  { label: '回她：我马上到', command: '给她回：我马上到' },
]

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

function latestWechatContextArtifact(mission = {}) {
  return [...asArray(mission.artifacts)].reverse().find(artifact => (
    artifact?.metadata?.adapterId === 'wechat-ilink'
    || /微信上下文摘要|微信最近消息|wechat context|recent messages/i.test(text(artifact?.title))
  )) || null
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

function isCredentialLoginQrArtifact(artifact = {}) {
  return text(artifact.kind || artifact.type) === 'credential-login-qr'
}

function qrArtifactUrl(artifact = {}) {
  const uri = text(artifact.uri || artifact.path)
  return /^(?:https?:\/\/|data:image\/)/i.test(uri) ? uri : ''
}

function renderArtifactVisual(artifact = {}) {
  if (!isCredentialLoginQrArtifact(artifact)) return ''
  const qrUrl = qrArtifactUrl(artifact)
  return `
    <div class="artifact-qr-panel">
      <div class="artifact-qr-frame">
        ${qrUrl ? `
          <img src="${escapeHtml(qrUrl)}" alt="${escapeHtml(zh('WeChat login QR code'))}">
        ` : `
          <span>${escapeHtml(zh('QR code pending'))}</span>
        `}
      </div>
      <div class="artifact-qr-copy">
        <span class="caption">${escapeHtml(zh('WeChat login'))}</span>
        <strong>${escapeHtml(zh('Scan with WeChat'))}</strong>
        <p>${escapeHtml(zh('After scanning, Vela will ask before saving credentials.'))}</p>
      </div>
    </div>
  `
}

function artifactUriLabel(artifact = {}) {
  if (isCredentialLoginQrArtifact(artifact) && qrArtifactUrl(artifact)) return 'QR URL ready'
  return text(artifact.uri || artifact.path, 'No URI recorded')
}

function artifactListMeta(artifact = {}) {
  if (isCredentialLoginQrArtifact(artifact)) return localizedKind(artifact.kind || artifact.type, '')
  return [localizedKind(artifact.kind || artifact.type, ''), text(artifact.uri || artifact.path)].filter(Boolean).join(' / ') || zh('Artifacts')
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

function extractQuotedText(value = '') {
  const source = text(value)
  return source.match(/内容[:：]?[「"]([^」"]+)[」"]/)?.[1]
    || source.match(/我准备这样回[:：]?[「"]([^」"]+)[」"]/)?.[1]
    || ''
}

function extractWechatContextLine(artifact = {}) {
  const summary = text(artifact?.summary || artifact?.detail)
  return summary.match(/最近消息[:：]\s*([「"][^；]+?[」"])/)?.[1]
    || summary.match(/最近消息[:：]([^；。]+)/)?.[1]
    || summary.match(/最近消息[:：](.+?)(?:；没有发送消息|；没有发送|。|$)/)?.[1]
    || ''
}

function isContinueLike(value) {
  return /^(?:继续|下一步|运行|恢复|continue|resume|run)$/i.test(text(value))
}

function isApprovalLike(value) {
  return /^(?:可以|好|好的|确认|发送|发吧|同意|approve|approved|send|ok)$/i.test(text(value))
}

function isContextReadRequest(value) {
  return /(?:看看|看一下|查看|读一下|读取|检查|最近消息|聊天记录|对话上下文|recent messages|check messages)/i.test(text(value))
}

function isGenericDraftRequest(value) {
  const source = text(value)
  if (externalMessageDirectReplyLike(source)) return false
  return /(?:草拟|拟|写|生成|准备).*(?:回复|回信|消息)|(?:帮我回复|替我回复|怎么回|如何回复|回什么|回复一下|回一下)/i.test(source)
}

function externalMessageDirectReplyLike(value) {
  return /(?:给(?:她|他|对方|老婆|老公)?回|回(?:她|他|对方|老婆|老公)|回复(?:她|他|对方|老婆|老公)|发(?:给)?(?:她|他|对方|老婆|老公))\s*[:：]\s*.+/.test(text(value))
}

function latestExternalMessageDraftArtifact(mission = {}) {
  return [...asArray(mission.artifacts)].reverse().find(artifact => (
    text(artifact?.title) === '拟发送内容'
    || (text(artifact?.kind || artifact?.type) === 'draft' && text(artifact?.planStepId) === 'draft-reply')
    || /我准备这样回|拟发送内容|消息草稿/.test(text(artifact?.summary || artifact?.detail || artifact?.title))
  )) || null
}

function latestSendReceiptArtifact(mission = {}) {
  return [...asArray(mission.artifacts)].reverse().find(artifact => (
    text(artifact?.kind || artifact?.type) === 'send-receipt'
    || text(artifact?.title) === '发送回执'
  )) || null
}

function draftTextForMission(mission = {}, attention = null) {
  return extractQuotedText(attention?.permission?.summary || attention?.title)
    || extractQuotedText(latestExternalMessageDraftArtifact(mission)?.summary)
}

function sendReceiptText(artifact = {}) {
  const summary = text(artifact?.summary || artifact?.detail)
  if (!summary) return ''
  return summary.replace(/^已按确认记录/, '已按你的确认')
}

function meaningfulInputs(mission = {}) {
  return asArray(mission.inputs)
    .map(input => text(input?.text))
    .filter(Boolean)
}

function pushTurn(turns, turn) {
  const body = text(turn?.body)
  if (!body) return
  const last = turns[turns.length - 1]
  if (last?.role === turn.role && last?.body === body) return
  turns.push({
    role: turn.role === 'user' ? 'user' : 'assistant',
    label: turn.label || (turn.role === 'user' ? 'You' : 'Vela'),
    body,
    current: Boolean(turn.current),
  })
}

function assistantThreadTurns(mission = {}, attention = null) {
  const inputs = meaningfulInputs(mission)
  const firstUserInput = inputs.find(value => !isContinueLike(value)) || inputs[0] || ''
  if (!isExternalMessageMission(mission)) {
    const turns = []
    if (text(firstUserInput)) pushTurn(turns, { role: 'user', label: 'You', body: firstUserInput })
    pushTurn(turns, { role: 'assistant', label: 'Vela', body: assistantReplyForMission(mission, attention), current: true })
    return turns
  }

  const turns = []
  if (firstUserInput) pushTurn(turns, { role: 'user', label: 'You', body: firstUserInput })

  const contextArtifact = latestWechatContextArtifact(mission)
  const contextLine = extractWechatContextLine(contextArtifact)
  const draftText = draftTextForMission(mission, attention)
  const receiptArtifact = latestSendReceiptArtifact(mission)

  if (!contextArtifact && !draftText && !receiptArtifact) {
    pushTurn(turns, { role: 'assistant', label: 'Vela', body: '好的，我去看一下。拿到上下文后，我会先告诉你准备怎么回。', current: true })
    return turns
  }

  if (contextArtifact) {
    pushTurn(turns, {
      role: 'assistant',
      label: 'Vela',
      body: contextLine ? `我看到了最近消息：${contextLine}` : text(contextArtifact.summary, '我已经整理好最近消息上下文。'),
    })
  }

  for (const value of inputs.slice(firstUserInput ? inputs.indexOf(firstUserInput) + 1 : 0)) {
    if (!value || isContinueLike(value)) continue
    if (isContextReadRequest(value)) continue
    if (isGenericDraftRequest(value)) continue
    if (isApprovalLike(value) && !receiptArtifact) continue
    pushTurn(turns, { role: 'user', label: 'You', body: value })
  }

  if (draftText && !receiptArtifact) {
    pushTurn(turns, {
      role: 'assistant',
      label: 'Vela',
      body: contextLine
        ? `我准备这样回：「${draftText}」。这样发可以吗？`
        : assistantReplyForMission(mission, attention),
      current: true,
    })
    return turns
  }

  if (receiptArtifact) {
    pushTurn(turns, {
      role: 'assistant',
      label: 'Vela',
      body: sendReceiptText(receiptArtifact) || assistantReplyForMission(mission, attention),
      current: true,
    })
    return turns
  }

  pushTurn(turns, { role: 'assistant', label: 'Vela', body: assistantReplyForMission(mission, attention), current: true })
  return turns
}

function missionAttention(mission = {}) {
  const permission = latestPendingPermission(mission.permissions)
  if (permission) {
    const externalMessage = isExternalMessagePermission(permission)
    const draftText = externalMessage ? extractQuotedText(permission.summary || permission.action || permission.title) : ''
    return {
      kind: 'guard',
      panelId: 'guard',
      primaryAction: 'approve-permission',
      secondaryAction: 'open-spine-panel',
      primaryLabel: externalMessage ? 'Send this reply' : 'Approve permission',
      secondaryLabel: externalMessage ? 'Review details' : 'Open Guard',
      caption: externalMessage ? 'Send confirmation' : 'Permission gate',
      title: externalMessage
        ? (draftText ? `我准备这样回：「${draftText}」` : text(permission.summary || permission.action || permission.title, 'Message draft'))
        : text(permission.action || permission.title, 'Permission request'),
      detail: externalMessage
        ? '只有你确认后，Vela 才会发送。'
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
      primaryAction: 'submit-command',
      primaryCommand: '继续',
      primaryLabel: 'Retry now',
      secondaryAction: 'open-spine-panel',
      secondaryLabel: recoveryAction.source === 'review_blocked' ? 'Open Review' : 'Open Guard',
      caption: 'Recovery needed',
      title: text(recoveryAction.title || recoveryAction.label, 'Recovery action pending'),
      detail: text(recoveryAction.summary || recoveryAction.detail, 'Open the spine to inspect recovery evidence.'),
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
      const draftText = extractQuotedText(attention.permission?.summary || attention.title)
      const contextLine = extractWechatContextLine(latestWechatContextArtifact(mission))
      const contextPrefix = contextLine ? `我看到了最近一条：${contextLine}；` : '我已经整理好上下文；'
      const draft = draftText ? `准备回复：「${draftText}」` : '我准备好了回复草稿'
      return `${contextPrefix}${draft}，这样发可以吗？`
    }
    return '我已经准备好下一步了。这个动作会影响外部世界，所以先把要做的事给你确认。'
  }
  if (attention?.kind === 'review') {
    return '我先把结果卡住，等后台复核通过再算完成。你不用看细节，必要时我会直接告诉你缺什么。'
  }
  if (attention?.kind === 'recovery') {
    return `${text(attention.title, '这一步卡住了')}。${text(attention.detail, '我会告诉你下一步怎么恢复。')}`
  }
  if (mission.state === 'Waiting for user') {
    return '我停在这里，等你一句话继续、修改，或者换个方向。'
  }
  if (mission.state === 'Blocked') {
    return '这一步卡住了。我已经把恢复办法放在当前任务里，你按下一步处理就行。'
  }
  if (looksLikeExternalMessageIntent(value)) {
    return '好的，我先去看一下。拿到上下文后，我会把准备发送的内容给你确认。'
  }
  if (mission.state === 'Complete') {
    return '这件事已经处理完了。'
  }
  if (mission.state === 'Reviewing') {
    return '结果已经准备好，我在等你确认。你可以查看产物，说“通过”或让我继续调整。'
  }
  if (mission.state === 'Running') {
    return '我正在处理这件事。需要你决定的时候，我会只问关键问题。'
  }
  return '你直接说想办的事就行。我会先去看需要的上下文；如果要发送消息、改文件或做高风险动作，我会把最终动作给你确认。'
}

function assistantStateLabel(mission = {}, attention = null) {
  if (attention?.kind === 'guard') return '等待你确认'
  if (attention?.kind === 'review') return '后台复核中'
  if (mission.state === 'Waiting for permission') return '等待你确认'
  if (mission.state === 'Running') return '正在处理'
  if (mission.state === 'Reviewing') return '等待确认'
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

function renderQuickCommands(userText, isMissionActionBusy) {
  if (userText || isMissionActionBusy) return ''
  return `
    <div class="quick-command-row" aria-label="快捷任务">
      ${QUICK_COMMANDS.map(item => `
        <button class="quick-command" type="button" data-quick-command="${escapeHtml(item.command)}">
          ${escapeHtml(item.label)}
        </button>
      `).join('')}
    </div>
  `
}

function renderPlanCanvas(mission, plan, { isMissionActionBusy = false } = {}) {
  const attention = missionAttention(mission)
  const turns = assistantThreadTurns(mission, attention)
  const hasUserText = meaningfulInputs(mission).some(value => !isContinueLike(value))
  const showProcess = turns.length <= 2
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
        ${turns.map(turn => `
          <article class="chat-bubble ${escapeHtml(turn.role)}${turn.current ? ' current' : ''}">
            <span>${escapeHtml(zh(turn.label))}</span>
            <p>${escapeHtml(zh(turn.body))}</p>
          </article>
        `).join('')}
      </div>
      <div class="assistant-focus-line">
        <span>${escapeHtml(zh('Current focus'))}</span>
        <p class="mission-goal">${escapeHtml(zh(mission.goal))}</p>
      </div>
      ${renderQuickCommands(hasUserText ? 'started' : '', isMissionActionBusy)}
      ${showProcess ? renderAssistantProcess(plan, mission) : ''}
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
  const hasVisual = Boolean(renderArtifactVisual(selected))
  return `
    <div class="canvas-kicker">${escapeHtml(zh('Artifacts'))}</div>
    <section class="artifact-focus${hasVisual ? ' has-visual' : ''}" aria-label="${escapeHtml(zh('Current artifact'))}">
      ${renderArtifactVisual(selected)}
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
          <dd>${escapeHtml(zh(artifactUriLabel(selected)))}</dd>
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
              <small>${escapeHtml(artifactListMeta(artifact))}</small>
            </span>
            <em>${escapeHtml(zh(text(artifact.summary || artifact.detail, 'No summary')))}</em>
            <small class="artifact-step-link">${escapeHtml(planStepLabel(plan, artifact.planStepId))}</small>
          </button>
        </li>
      `}).join('')}
    </ol>
  `
}

function renderAttentionStrip(attention, { isMissionActionBusy = false } = {}) {
  if (!attention) return ''
  const hasPrimary = attention.primaryAction && attention.primaryLabel
  const hasSecondary = attention.secondaryAction && attention.secondaryLabel
  const primaryDisabledAttr = isMissionActionBusy ? ' disabled' : ''
  const primaryLabel = isMissionActionBusy ? 'Working' : attention.primaryLabel
  return `
    <div class="mission-attention-strip" data-attention-kind="${escapeHtml(attention.kind)}" role="status">
      <div class="attention-copy">
        <span class="caption">${escapeHtml(zh(attention.caption))}</span>
        <strong>${escapeHtml(zh(attention.title))}</strong>
        <p>${escapeHtml(zh(attention.detail))}</p>
      </div>
      <div class="attention-actions">
        ${hasPrimary ? `
          <button class="attention-action primary" type="button" data-attention-action="primary"${primaryDisabledAttr}>
            ${escapeHtml(zh(primaryLabel))}
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

export function renderMissionWorkspace(mission, { notice = '', workspaceMode = 'plan', selectedArtifactId = '', onSelectWorkspaceMode, onSelectArtifact, onRequestArtifactReview, onApprovePermission, onResolveReviewCheck, onOpenSpinePanel, onSubmitCommand, isMissionActionBusy = false } = {}) {
  const plan = Array.isArray(mission.plan) ? mission.plan : []
  const artifacts = asArray(mission.artifacts)
  const activeMode = workspaceMode === 'artifacts' ? 'artifacts' : 'plan'
  const guardNotice = String(notice || '').trim()
  const attention = missionAttention(mission)
  const disabledAttr = isMissionActionBusy ? ' disabled' : ''
  const actionLabel = isMissionActionBusy ? 'Working' : 'Continue'
  const sendLabel = isMissionActionBusy ? 'Working' : 'Send'
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
        : renderPlanCanvas(mission, plan, { isMissionActionBusy })}
    </section>

    ${renderAttentionStrip(attention, { isMissionActionBusy })}

    <div class="next-step-strip">
      <div class="next-step-copy">
        <span class="caption">${escapeHtml(zh('Next step'))}</span>
        <strong>${escapeHtml(zh(mission.nextStep))}</strong>
      </div>
      <button class="step-action" type="button" title="${escapeHtml(zh(actionLabel))}"${disabledAttr}>${escapeHtml(zh(actionLabel))}</button>
    </div>

    ${guardNotice ? `
      <div class="mission-alert" role="alert">
        <span class="caption">${escapeHtml(zh('Mission guard'))}</span>
        <strong>${escapeHtml(zh(guardNotice))}</strong>
      </div>
    ` : ''}

    <form class="mission-input" aria-label="${escapeHtml(zh('Mission command input'))}" aria-busy="${isMissionActionBusy ? 'true' : 'false'}">
      <input type="text" placeholder="${escapeHtml(zh('Tell Vela what to do'))}"${disabledAttr}>
      <button type="submit"${disabledAttr}>${escapeHtml(zh(sendLabel))}</button>
    </form>
  `
  workspace.querySelector('.mission-input')?.addEventListener('submit', (event) => {
    event.preventDefault()
    if (isMissionActionBusy) return
    const input = workspace.querySelector('.mission-input input')
    const value = input?.value || ''
    Promise.resolve(onSubmitCommand?.(value)).catch(() => {})
    if (input) input.value = ''
  })
  workspace.querySelector('.step-action')?.addEventListener('click', () => {
    if (isMissionActionBusy) return
    Promise.resolve(onSubmitCommand?.('继续')).catch(() => {})
  })
  for (const button of workspace.querySelectorAll('.workspace-mode-tab')) {
    button.addEventListener('click', () => {
      Promise.resolve(onSelectWorkspaceMode?.(button.dataset.workspaceMode)).catch(() => {})
    })
  }
  for (const button of workspace.querySelectorAll('.quick-command')) {
    button.addEventListener('click', () => {
      if (isMissionActionBusy) return
      Promise.resolve(onSubmitCommand?.(button.dataset.quickCommand)).catch(() => {})
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
    if (isMissionActionBusy) return
    if (attention?.primaryAction === 'approve-permission') {
      Promise.resolve(onApprovePermission?.(attention.permission)).catch(() => {})
    } else if (attention?.primaryAction === 'resolve-review-check') {
      Promise.resolve(onResolveReviewCheck?.(attention.check)).catch(() => {})
    } else if (attention?.primaryAction === 'submit-command') {
      Promise.resolve(onSubmitCommand?.(attention.primaryCommand || '继续')).catch(() => {})
    }
  })
  workspace.querySelector('[data-attention-action="secondary"]')?.addEventListener('click', () => {
    Promise.resolve(onOpenSpinePanel?.(attention?.panelId)).catch(() => {})
  })
  return workspace
}
