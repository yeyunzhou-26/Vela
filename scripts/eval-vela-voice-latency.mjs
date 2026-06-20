import fs from 'fs'
import os from 'os'
import path from 'path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blm-vela-voice-latency-'))
process.env.BAILONGMA_USER_DIR = tmp

let failed = 0
function assert(condition, label) {
  if (!condition) {
    console.error(`FAIL: ${label}`)
    failed += 1
    process.exitCode = 1
  } else {
    console.log(`PASS: ${label}`)
  }
}

try {
  const runtime = await import('../src/vela/mission-runtime.js')

  runtime.startMission({
    id: 'mission-voice-latency-eval',
    title: 'Voice Latency Eval Mission',
    goal: 'Verify Vela records voice latency against Siri-class interaction targets.',
    plan: [
      { id: 'listen', label: 'Capture spoken intent', status: 'Done' },
      { id: 'route', label: 'Route voice intent', status: 'Active' },
      { id: 'repair', label: 'Handle spoken repair', status: 'Next' },
    ],
  })

  const routed = runtime.applyCurrentMissionVoiceIntent({
    transcript: 'continue',
    speechEndedAt: 1000,
    intentSubmittedAt: 1320,
    finalAsrAt: 1320,
    firstTokenAt: 2500,
    responseSegmentAt: 2500,
    firstAudioAt: 3220,
    bargeInAt: 4000,
    speechStoppedAt: 4120,
  })
  const routedMetric = routed.voiceMetrics.at(-1)
  assert(routed.state === 'Running', 'voice latency eval routes continue through command pipeline')
  assert(routedMetric.latencyMs.speechEndToIntent === 320, 'voice metric computes speech-end to intent latency')
  assert(routedMetric.latencyMs.finalAsrToFirstToken === 1180, 'voice metric computes first-token latency')
  assert(routedMetric.latencyMs.responseSegmentToFirstAudio === 720, 'voice metric computes first-audio latency')
  assert(routedMetric.latencyMs.bargeInStop === 120, 'voice metric computes barge-in stop latency')
  assert(routedMetric.violations.length === 0, 'voice metric passes latency targets')
  assert(routed.trace.at(-1).latencyMs.speechEndToIntent === 320, 'voice trace carries latency metrics')

  const repaired = runtime.applyCurrentMissionVoiceIntent({
    transcript: '不是这个',
    latencyMs: {
      speechEndToIntentMs: 410,
      bargeInStopMs: 175,
    },
  })
  const repairMetric = repaired.voiceMetrics.at(-1)
  assert(repaired.state === 'Waiting for user', 'spoken repair remains first-class behavior')
  assert(repairMetric.transcript === '不是这个', 'voice latency eval records Chinese repair transcript')
  assert(repairMetric.violations.some(item => item.metric === 'speechEndToIntent' && item.targetMs === 400), 'voice metric records speech-to-intent violation')
  assert(repairMetric.violations.some(item => item.metric === 'bargeInStop' && item.targetMs === 150), 'voice metric records barge-in violation')
  assert(repaired.trace.at(-1).type === 'voice.intent.routed', 'spoken repair still records voice routing trace')

  console.log('\n[PASS] vela voice latency eval')
  console.log(JSON.stringify({
    missionId: repaired.id,
    latestMetric: repairMetric,
  }, null, 2))
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
}

if (failed > 0) process.exit(1)
