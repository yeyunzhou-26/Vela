import { railEntries } from './state/mission-store.js'
import { escapeHtml } from './dom-utils.js'
import { zh } from './locale.js'

export function renderMissionRail({ activeView = 'today', onSelectView } = {}) {
  const rail = document.createElement('nav')
  rail.className = 'mission-rail'
  rail.setAttribute('aria-label', zh('Mission navigation'))

  for (const entry of railEntries) {
    const item = document.createElement('button')
    item.type = 'button'
    const active = entry.id === activeView || (activeView === 'mission' && entry.id === 'today')
    item.className = `rail-item${active ? ' active' : ''}`
    item.dataset.id = entry.id
    item.setAttribute('aria-current', active ? 'page' : 'false')
    item.innerHTML = `
      <span class="rail-mark" aria-hidden="true">${escapeHtml(entry.mark)}</span>
      <span class="rail-label">${escapeHtml(zh(entry.label))}</span>
    `
    item.addEventListener('click', () => {
      onSelectView?.(entry.id)
    })
    rail.appendChild(item)
  }

  return rail
}
