import fs from 'fs'
import os from 'os'
import path from 'path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blm-vela-memory-recall-'))
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

function score(value) {
  const parsed = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}

try {
  const runtime = await import('../src/vela/mission-runtime.js')

  runtime.startMission({
    id: 'mission-memory-recall-eval',
    title: 'Memory Recall Eval Mission',
    goal: 'Verify Vela memory injections stay inspectable and traceable.',
    plan: [
      { id: 'collect-context', label: 'Collect mission context', status: 'Done' },
      { id: 'inject-memory', label: 'Inject relevant memory', status: 'Active' },
      { id: 'review-memory', label: 'Review memory quality', status: 'Next' },
    ],
  })
  runtime.updateCurrentMission({ state: 'Running', nextStep: 'Attach relevant memory with provenance.' })

  runtime.appendCurrentMissionMemoryReference({
    id: 'memory-recall-spec',
    title: 'Vela spec memory rule',
    type: 'project',
    source: 'memory-eval',
    provenance: 'docs/superpowers/specs/2026-06-13-vela-ai-operating-desk-design.md',
    query: 'memory injection must be traceable in mission review',
    relevance: '0.96',
    confidence: 'high',
    usedByPlanStepId: 'inject-memory',
    reason: 'The mission is validating the memory provenance requirement.',
    summary: 'Memory injection must be traceable in mission review.',
  })
  runtime.appendCurrentMissionMemoryReference({
    id: 'memory-recall-guard',
    title: 'Guard and review memory',
    type: 'project',
    source: 'memory-eval',
    provenance: 'docs/superpowers/specs/2026-06-13-vela-ai-operating-desk-design.md#phase-4',
    query: 'guard context review visible high risk actions',
    relevance: '0.88',
    confidence: 'medium',
    usedByPlanStepId: 'review-memory',
    reason: 'The reviewer needs the guard/review requirement while checking trace quality.',
    summary: 'High-risk actions and memory use must be visible.',
  })

  const mission = runtime.getCurrentMission()
  const references = mission.memoryReferences
  assert(references.length === 2, 'memory eval mission has two memory references')
  assert(references.every(item => item.query), 'every memory reference keeps the recall query')
  assert(references.every(item => item.provenance), 'every memory reference keeps provenance')
  assert(references.every(item => item.usedByPlanStepId), 'every memory reference links to a consuming plan step')
  assert(references.every(item => score(item.relevance) >= 0.75), 'every memory reference clears relevance threshold')
  assert(references.every(item => /^(high|medium)$/i.test(item.confidence)), 'every memory reference records acceptable confidence')

  const memoryTraces = mission.trace.filter(entry => entry.type === 'memory.reference')
  assert(memoryTraces.length === 2, 'memory references each record a trace event')
  assert(memoryTraces.every(entry => entry.missionId === mission.id), 'memory trace links mission id')
  assert(memoryTraces.some(entry => entry.memoryReferenceId === 'memory-recall-spec'), 'memory trace links first memory id')
  assert(memoryTraces.some(entry => entry.planStepId === 'review-memory'), 'memory trace links review plan step')
  assert(memoryTraces.every(entry => score(entry.result) >= 0.75), 'memory trace result carries relevance score')

  console.log('\n[PASS] vela memory recall eval')
  console.log(JSON.stringify({
    missionId: mission.id,
    references: references.map(item => ({
      id: item.id,
      relevance: item.relevance,
      confidence: item.confidence,
      usedByPlanStepId: item.usedByPlanStepId,
    })),
  }, null, 2))
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
}

if (failed > 0) process.exit(1)
