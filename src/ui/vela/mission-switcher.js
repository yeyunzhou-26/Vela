import { escapeHtml } from './dom-utils.js'
import { zh } from './locale.js'

function formatMissionTime(value) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return ''
  }
}

export function renderMissionSwitcher({ missions = [], currentMissionId = '', onSelectMission } = {}) {
  const switcher = document.createElement('section')
  switcher.className = 'mission-workspace mission-switcher'
  switcher.setAttribute('aria-label', zh('Mission Switcher'))
  switcher.innerHTML = `
    <div class="mission-header">
      <div>
        <span class="caption">${escapeHtml(zh('Mission Switcher'))}</span>
        <h1>${escapeHtml(zh('Missions'))}</h1>
      </div>
      <span class="state-chip">${missions.length} ${escapeHtml(zh('saved'))}</span>
    </div>

    <section class="mission-canvas switcher-canvas" aria-label="${escapeHtml(zh('Saved missions'))}">
      <div class="canvas-kicker">${escapeHtml(zh('Mission List'))}</div>
      <p class="mission-goal">${escapeHtml(zh('Choose one mission to make it the active work surface.'))}</p>
      <div class="mission-list">
        ${missions.map(mission => `
          <button class="mission-list-item${mission.id === currentMissionId ? ' active' : ''}" type="button" data-id="${escapeHtml(mission.id)}">
            <span>
              <strong>${escapeHtml(zh(mission.title))}</strong>
              <small>${escapeHtml(zh(mission.goal))}</small>
            </span>
            <em>${escapeHtml(zh(mission.state))} · ${escapeHtml(formatMissionTime(mission.updatedAt || mission.createdAt))}</em>
          </button>
        `).join('')}
      </div>
    </section>
  `

  for (const button of switcher.querySelectorAll('.mission-list-item')) {
    button.addEventListener('click', () => {
      Promise.resolve(onSelectMission?.(button.dataset.id)).catch(() => {})
    })
  }

  return switcher
}
