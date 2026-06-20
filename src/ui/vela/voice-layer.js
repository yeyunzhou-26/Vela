import { voiceStates } from './state/mission-store.js'
import { escapeHtml } from './dom-utils.js'
import { zh, zhOnly } from './locale.js'

export function renderVoiceLayer({ activeState = 'Idle', notice = '', onStartListening, onSubmitVoiceIntent } = {}) {
  const state = voiceStates.includes(activeState) ? activeState : 'Idle'
  const statusLine = notice ? `${zh(state)} · ${zh(notice)}` : zh(state)
  const layer = document.createElement('section')
  layer.className = 'voice-layer'
  layer.dataset.state = state.toLowerCase().replace(/\s+/g, '-')
  layer.setAttribute('aria-label', zh('Vela Voice Layer'))
  layer.innerHTML = `
    <div class="voice-core">
      <span class="voice-wave" aria-hidden="true"></span>
      <div>
        <strong>Vela Voice</strong>
        <span>${escapeHtml(statusLine)}</span>
      </div>
    </div>
    <div class="voice-controls" aria-label="${escapeHtml(zh('Voice controls'))}">
      <button class="voice-control" type="button" data-voice-action="listen" aria-pressed="${state === 'Listening' ? 'true' : 'false'}">${escapeHtml(zh('Listen'))}</button>
      <button class="voice-control" type="button" data-voice-action="stop">${escapeHtml(zh('Stop'))}</button>
      <button class="voice-control" type="button" data-voice-action="repair">${escapeHtml(zh('Repair'))}</button>
    </div>
    <div class="voice-states" aria-label="${escapeHtml(zh('Voice states'))}">
      ${voiceStates.map(item => `
        <span
          class="${item === state ? 'active' : ''}"
          data-state-id="${escapeHtml(item)}"
          aria-label="${escapeHtml(zh(item))}"
        >${escapeHtml(zhOnly(item))}</span>
      `).join('')}
    </div>
    <form class="voice-intent-form" aria-label="${escapeHtml(zh('Voice intent input'))}">
      <input class="voice-intent-input" type="text" placeholder="${escapeHtml(zh('Voice intent'))}">
      <button class="voice-intent-submit" type="submit">${escapeHtml(zh('Send'))}</button>
    </form>
  `
  layer.querySelector('.voice-intent-form')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const input = layer.querySelector('.voice-intent-input')
    const value = input?.value || ''
    Promise.resolve(onSubmitVoiceIntent?.(value)).catch(() => {})
    if (input) input.value = ''
  })
  layer.querySelector('[data-voice-action="listen"]')?.addEventListener('click', () => {
    Promise.resolve(onStartListening?.()).catch(() => {})
  })
  layer.querySelector('[data-voice-action="stop"]')?.addEventListener('click', () => {
    const now = Date.now()
    Promise.resolve(onSubmitVoiceIntent?.('停止', {
      bargeInAt: now - 90,
      speechStoppedAt: now,
      intentSubmittedAt: now,
    })).catch(() => {})
  })
  layer.querySelector('[data-voice-action="repair"]')?.addEventListener('click', () => {
    const now = Date.now()
    Promise.resolve(onSubmitVoiceIntent?.('不是这个', {
      speechEndedAt: now - 80,
      intentSubmittedAt: now,
    })).catch(() => {})
  })
  return layer
}
