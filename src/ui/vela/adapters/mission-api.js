import { seedMission } from '../state/mission-store.js'

function fallbackSnapshot() {
  return { mission: seedMission, missions: [seedMission] }
}

async function readMissionResponse(response, fallbackMessage) {
  let payload = null
  try {
    payload = await response.json()
  } catch {}
  if (!response.ok) {
    const error = new Error(payload?.error || fallbackMessage)
    error.code = payload?.code || 'request_failed'
    error.mission = payload?.mission || null
    error.details = payload?.details || null
    throw error
  }
  return payload || {}
}

export async function loadCurrentMission() {
  const snapshot = await loadMissionSnapshot()
  return snapshot.mission
}

export async function loadMissionSnapshot() {
  try {
    const [missionResponse, missionsResponse] = await Promise.all([
      fetch('/vela/mission', { cache: 'no-store' }),
      fetch('/vela/missions', { cache: 'no-store' }),
    ])
    if (!missionResponse.ok || !missionsResponse.ok) return fallbackSnapshot()
    const missionPayload = await missionResponse.json()
    const missionsPayload = await missionsResponse.json()
    return {
      mission: missionPayload?.mission || seedMission,
      missions: Array.isArray(missionsPayload?.missions) && missionsPayload.missions.length
        ? missionsPayload.missions
        : [missionPayload?.mission || seedMission],
    }
  } catch {
    return fallbackSnapshot()
  }
}

export async function createMissionFromText(text) {
  const title = String(text || '').trim()
  if (!title) return null
  const response = await fetch('/vela/missions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      goal: title,
      nextStep: 'Review the generated plan and continue.',
    }),
  })
  const payload = await readMissionResponse(response, 'Unable to create mission')
  return payload?.mission || null
}

export async function updateCurrentMission(patch) {
  const response = await fetch('/vela/mission', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch || {}),
  })
  const payload = await readMissionResponse(response, 'Unable to update mission')
  return payload?.mission || null
}

export async function recordCurrentMissionReviewCheck(check) {
  const response = await fetch('/vela/mission/review-checks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(check || {}),
  })
  const payload = await readMissionResponse(response, 'Unable to record review check')
  return payload?.mission || null
}

export async function recordCurrentMissionPermission(permission) {
  const response = await fetch('/vela/mission/permissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(permission || {}),
  })
  const payload = await readMissionResponse(response, 'Unable to record permission')
  return payload?.mission || null
}

export async function resolveCurrentMissionPermission(resolution) {
  const response = await fetch('/vela/mission/permissions/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(resolution || {}),
  })
  const payload = await readMissionResponse(response, 'Unable to resolve permission')
  return payload?.mission || null
}

export async function sendMissionCommand(text) {
  const command = String(text || '').trim()
  if (!command) return null
  const response = await fetch('/vela/mission/commands', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: command,
      source: 'typed',
    }),
  })
  const payload = await readMissionResponse(response, 'Unable to send mission command')
  return payload?.mission || null
}

export async function sendVoiceIntent(transcript, metadata = {}) {
  const text = String(transcript || '').trim()
  if (!text) return null
  const response = await fetch('/vela/voice/intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...metadata,
      transcript: text,
      source: 'voice',
    }),
  })
  const payload = await readMissionResponse(response, 'Unable to send voice intent')
  return payload?.mission || null
}

export async function selectMission(id) {
  const response = await fetch(`/vela/missions/${encodeURIComponent(id)}/current`, {
    method: 'POST',
  })
  const payload = await readMissionResponse(response, 'Unable to select mission')
  return payload?.mission || null
}
