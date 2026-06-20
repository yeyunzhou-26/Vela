import { escapeHtml } from './dom-utils.js'
import { zh } from './locale.js'

const SURFACE_CONFIG = {
  agents: {
    caption: 'Agent Surface',
    title: 'Agents',
    stateLabel: 'roles',
    kicker: 'Mission agents',
  },
  memory: {
    caption: 'Memory Surface',
    title: 'Memory',
    stateLabel: 'refs',
    kicker: 'Mission memory',
  },
  apps: {
    caption: 'Apps Surface',
    title: 'Apps',
    stateLabel: 'links',
    kicker: 'Mission apps',
  },
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function text(value, fallback = '') {
  const result = String(value ?? '').trim()
  return result || fallback
}

function uniqueCount(values) {
  return new Set(values.map(value => text(value)).filter(Boolean)).size
}

function itemRowsFor(view, mission) {
  if (view === 'agents') return agentRows(mission)
  if (view === 'memory') return memoryRows(mission)
  if (view === 'apps') return appRows(mission)
  return []
}

function agentRows(mission) {
  const actions = asArray(mission.agentActions)
  const toolCalls = asArray(mission.toolCalls)
  const actionRows = actions.map(action => ({
    title: text(action.title || action.summary, 'Agent action'),
    meta: [text(action.role || action.agentRole, 'Agent'), text(action.status, 'pending'), text(action.planStepId)].filter(Boolean).map(zh).join(' / '),
    detail: text(action.summary || action.result, 'No action summary recorded'),
    spinePanel: 'tools',
    reviewPayload: {
      title: `Review ${text(action.title || action.summary, 'agent action')}`,
      outcome: 'pending',
      reviewer: 'Vela Review Spine',
      planStepId: text(action.planStepId),
      summary: `Review requested from Agents surface for ${text(action.title || action.summary, 'agent action')}.`,
      evidence: [text(action.summary || action.result, 'Agent action is ready for review.')],
    },
  }))
  const toolRows = toolCalls.map(call => ({
    title: text(call.toolName || call.name, 'Tool call'),
    meta: [text(call.role || call.agentRole, 'Operator'), text(call.status, 'pending'), text(call.planStepId)].filter(Boolean).map(zh).join(' / '),
    detail: text(call.result || call.summary, 'No tool result recorded'),
    spinePanel: 'tools',
    reviewPayload: {
      title: `Review ${text(call.toolName || call.name, 'tool call')}`,
      outcome: 'pending',
      reviewer: 'Vela Review Spine',
      planStepId: text(call.planStepId),
      toolCallId: text(call.id),
      summary: `Review requested from Agents surface for ${text(call.toolName || call.name, 'tool call')}.`,
      evidence: [text(call.result || call.summary, 'Tool call is ready for review.')],
    },
  }))
  return [...actionRows, ...toolRows]
}

function memoryRows(mission) {
  return asArray(mission.memoryReferences).map(reference => ({
    title: text(reference.title || reference.name || reference.id, 'Memory reference'),
    meta: [
      text(reference.type || reference.kind, 'memory'),
      text(reference.relevance || reference.score),
      text(reference.confidence),
      text(reference.usedByPlanStepId || reference.planStepId),
    ].filter(Boolean).map(zh).join(' / '),
    detail: text(reference.summary || reference.reason || reference.provenance || reference.source, 'No memory summary recorded'),
    spinePanel: 'memory',
  }))
}

function appRows(mission) {
  const calls = asArray(mission.toolCalls).map(call => ({
    title: text(call.toolName || call.name, 'Tool call'),
    meta: [text(call.status, 'pending'), text(call.role || call.agentRole, 'Operator'), text(call.planStepId)].filter(Boolean).map(zh).join(' / '),
    detail: text(call.result || call.summary, 'No tool result recorded'),
    spinePanel: 'tools',
  }))
  const permissions = asArray(mission.permissions).map(permission => ({
    title: text(permission.action || permission.title || permission.scope, 'Permission record'),
    meta: [text(permission.decision || permission.status, 'pending'), text(permission.risk || permission.riskClass), text(permission.policy || permission.mode)].filter(Boolean).map(zh).join(' / '),
    detail: text(permission.reason || permission.summary || permission.scope, 'No permission reason recorded'),
    spinePanel: 'guard',
  }))
  return [...calls, ...permissions]
}

function countFor(view, mission) {
  if (view === 'agents') {
    return uniqueCount([
      ...asArray(mission.agentActions).map(action => action.role || action.agentRole),
      ...asArray(mission.toolCalls).map(call => call.role || call.agentRole),
    ])
  }
  if (view === 'memory') return asArray(mission.memoryReferences).length
  if (view === 'apps') return asArray(mission.toolCalls).length + asArray(mission.permissions).length
  return 0
}

function summaryFor(view, mission, rows) {
  if (view === 'agents') {
    return `${rows.length} 条智能体或工具记录已映射到 ${zh(text(mission.title, 'this mission'))}。`
  }
  if (view === 'memory') {
    return `${rows.length} 条记忆引用已关联到 ${zh(text(mission.title, 'this mission'))}。`
  }
  if (view === 'apps') {
    return `${rows.length} 条工具和许可链接已关联到 ${zh(text(mission.title, 'this mission'))}。`
  }
  return zh(text(mission.goal, 'Mission surface'))
}

function emptyTextFor(view) {
  if (view === 'agents') return 'No agent actions recorded yet.'
  if (view === 'memory') return 'No mission memory attached yet.'
  if (view === 'apps') return 'No app or tool links recorded yet.'
  return 'No records yet.'
}

export function renderMissionSurface(view, mission = {}, actions = {}) {
  const config = SURFACE_CONFIG[view] || SURFACE_CONFIG.agents
  const rows = itemRowsFor(view, mission)
  const surface = document.createElement('section')
  surface.className = `mission-workspace mission-surface mission-surface-${escapeHtml(view)}`
  surface.setAttribute('aria-label', zh(config.title))
  surface.innerHTML = `
    <div class="mission-header">
      <div>
        <span class="caption">${escapeHtml(zh(config.caption))}</span>
        <h1>${escapeHtml(zh(config.title))}</h1>
      </div>
      <span class="state-chip">${escapeHtml(countFor(view, mission))} ${escapeHtml(zh(config.stateLabel))}</span>
    </div>

    <section class="mission-canvas surface-canvas" aria-label="${escapeHtml(`${zh(config.title)}${zh('records')}`)}">
      <div class="canvas-kicker">${escapeHtml(zh(config.kicker))}</div>
      <p class="mission-goal">${escapeHtml(summaryFor(view, mission, rows))}</p>
      <div class="surface-list">
        ${rows.length ? rows.map((row, index) => `
          <article class="surface-list-item">
            <div class="surface-row-copy">
              <strong>${escapeHtml(zh(row.title))}</strong>
              <small>${escapeHtml(row.meta)}</small>
            </div>
            <div class="surface-row-actions">
              ${row.reviewPayload ? `
                <button class="surface-review-action" type="button" data-row-index="${escapeHtml(index)}" aria-controls="spine-panel">
                  ${escapeHtml(zh('Send to Review'))}
                </button>
              ` : ''}
              <button class="surface-row-action" type="button" data-spine-panel="${escapeHtml(row.spinePanel)}" aria-controls="spine-panel">
                ${escapeHtml(zh('Inspect Spine'))}
              </button>
            </div>
            <p>${escapeHtml(zh(row.detail))}</p>
          </article>
        `).join('') : `
          <article class="surface-list-item empty">
            <div class="surface-row-copy">
              <strong>${escapeHtml(zh(emptyTextFor(view)))}</strong>
              <small>${escapeHtml(zh(mission.state || 'Mission'))}</small>
            </div>
          </article>
        `}
      </div>
    </section>
  `
  for (const button of surface.querySelectorAll('.surface-row-action')) {
    button.addEventListener('click', () => {
      actions.onOpenSpinePanel?.(button.dataset.spinePanel)
    })
  }
  for (const button of surface.querySelectorAll('.surface-review-action')) {
    button.addEventListener('click', () => {
      const row = rows[Number(button.dataset.rowIndex)]
      actions.onRequestReviewCheck?.(row?.reviewPayload)
    })
  }
  return surface
}
