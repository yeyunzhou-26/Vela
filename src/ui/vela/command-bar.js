import { escapeHtml } from './dom-utils.js'
import { zh, zhOnly } from './locale.js'

const PERMISSION_MODES = ['Plan', 'Assist', 'Act', 'Auto']

export function renderCommandBar(mission, { onSubmitCommand, onSelectPermissionMode, isMissionActionBusy = false } = {}) {
  const bar = document.createElement('header')
  bar.className = 'top-command-bar'
  const disabledAttr = isMissionActionBusy ? ' disabled' : ''
  const commandPlaceholder = isMissionActionBusy ? 'Vela is working' : 'Command or search the current mission'
  bar.innerHTML = `
    <div class="brand-lockup" aria-label="Vela">
      <span class="brand-mark" aria-hidden="true">V</span>
      <span class="brand-name">Vela</span>
    </div>
    <div class="mission-title">
      <span class="caption">${escapeHtml(zh('Active mission'))}</span>
      <strong>${escapeHtml(zh(mission.title))}</strong>
    </div>
    <form class="command-search" aria-label="${escapeHtml(zh('Global mission command'))}" aria-busy="${isMissionActionBusy ? 'true' : 'false'}">
      <span class="search-glyph" aria-hidden="true">/</span>
      <input type="search" aria-label="${escapeHtml(zh('Command or search the current mission'))}" placeholder="${escapeHtml(zh(commandPlaceholder))}"${disabledAttr}>
    </form>
    <div class="status-strip" aria-label="${escapeHtml(zh('Runtime status'))}">
      <span class="status-pill">${escapeHtml(zh(mission.modelStatus))}</span>
      <div class="mode-segment" role="radiogroup" aria-label="${escapeHtml(zh('Permission mode'))}">
        ${PERMISSION_MODES.map(mode => {
          const selected = mode === mission.permissionMode
          return `
            <button
              class="mode-segment-button"
              type="button"
              aria-pressed="${selected ? 'true' : 'false'}"
              data-permission-mode="${escapeHtml(mode)}"
              title="${escapeHtml(zh(mode))}"
              ${disabledAttr}
            >${escapeHtml(zhOnly(mode))}</button>
          `
        }).join('')}
      </div>
      <button class="icon-button" type="button" aria-label="${escapeHtml(zh('Open settings'))}">S</button>
    </div>
  `
  bar.querySelector('.command-search')?.addEventListener('submit', (event) => {
    event.preventDefault()
    if (isMissionActionBusy) return
    const input = bar.querySelector('.command-search input')
    const value = input?.value || ''
    Promise.resolve(onSubmitCommand?.(value)).catch(() => {})
    if (input) input.value = ''
  })
  for (const button of bar.querySelectorAll('.mode-segment-button')) {
    button.addEventListener('click', () => {
      Promise.resolve(onSelectPermissionMode?.(button.dataset.permissionMode)).catch(() => {})
    })
  }
  return bar
}
