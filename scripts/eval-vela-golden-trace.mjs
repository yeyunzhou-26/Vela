import fs from 'fs'
import os from 'os'
import path from 'path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blm-vela-golden-trace-'))
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

function findTrace(trace, type) {
  return trace.find(entry => entry.type === type)
}

function assertOrder(types, expected) {
  let cursor = -1
  for (const type of expected) {
    const next = types.findIndex((item, index) => index > cursor && item === type)
    assert(next > cursor, `trace includes ${type} after position ${cursor}`)
    cursor = next
  }
}

try {
  const runtime = await import('../src/vela/mission-runtime.js')

  const mission = runtime.startMission({
    id: 'mission-golden-trace',
    title: 'Golden Trace Mission',
    goal: 'Verify the Vela mission trace contract stays auditable.',
    plan: [
      { id: 'plan', label: 'Plan the mission', status: 'Done' },
      { id: 'execute', label: 'Execute with guarded tools', status: 'Active' },
      { id: 'review', label: 'Review claims and evidence', status: 'Next' },
    ],
  })

  runtime.updateCurrentMission({ state: 'Running', nextStep: 'Execute with guarded tools.' })
  const memory = runtime.appendCurrentMissionMemoryReference({
    id: 'memory-golden-spec',
    title: 'Vela Golden Trace Spec',
    type: 'project',
    source: 'golden-trace',
    provenance: 'docs/superpowers/specs/2026-06-13-vela-ai-operating-desk-design.md',
    summary: 'Mission actions must be traceable to plan, tools, permissions, memory, and review.',
  })
  runtime.appendCurrentMissionAgentAction({
    id: 'action-golden-builder',
    role: 'Builder',
    title: 'Run guarded implementation step',
    status: 'done',
    planStepId: 'execute',
    summary: 'Builder performed a guarded implementation action.',
    result: 'ready-for-review',
    requiresReview: true,
  })
  const tool = runtime.appendCurrentMissionToolCall({
    id: 'tool-golden-runner',
    toolName: 'golden.runner',
    role: 'Builder',
    status: 'ok',
    planStepId: 'execute',
    result: 'Guarded implementation command finished.',
  })
  runtime.appendCurrentMissionToolStage({
    toolName: 'golden.runner',
    toolCallId: 'tool-golden-runner',
    role: 'Builder',
    status: 'ok',
    stage: 'command-exit',
    url: 'vela://golden-runner/stages/command-exit',
    planStepId: 'execute',
    summary: 'Golden runner command exited successfully.',
  })
  const artifact = runtime.appendCurrentMissionArtifact({
    id: 'artifact-golden-report',
    title: 'Golden implementation report',
    kind: 'report',
    uri: 'vela://golden-report',
    summary: 'Reviewable artifact produced by the guarded implementation step.',
    planStepId: 'execute',
  })
  runtime.appendCurrentMissionPermission({
    action: 'Approve golden runner write',
    policy: 'Assist write gate',
    scope: 'repo://src/vela',
    risk: 'Write',
    decision: 'requested',
    reason: 'The builder wants to change runtime-owned mission files.',
    requestedBy: 'Golden Trace Evaluator',
    planStepId: 'execute',
    toolCallId: tool.toolCalls.at(-1).id,
  })
  runtime.updateCurrentMission({ state: 'Running', nextStep: 'Recover and finish the plan.' })
  runtime.appendCurrentMissionRecoveryAction({
    title: 'Recover missing verification evidence',
    status: 'open',
    summary: 'Reviewer needs an explicit evidence check before completion.',
  })
  runtime.updateCurrentMission({ state: 'Running', nextStep: 'Record review evidence.' })
  runtime.updateCurrentMissionPlanStep('execute', {
    status: 'Done',
    nextStep: 'Review claims and evidence.',
  })
  runtime.updateCurrentMissionPlanStep('review', {
    status: 'Active',
    nextStep: 'Record review evidence.',
  })
  runtime.appendCurrentMissionReviewCheck({
    title: 'Golden trace claim accuracy',
    outcome: 'passed',
    reviewer: 'Golden Trace Reviewer',
    planStepId: 'review',
    artifactId: artifact.artifacts.at(-1).id,
    toolCallId: tool.toolCalls.at(-1).id,
    summary: 'Reviewer checked trace coverage for the guarded tool flow.',
    evidence: ['mission id', 'plan step id', 'artifact id', 'tool call id', 'permission decision', 'memory reference', 'review outcome'],
  })
  runtime.updateCurrentMission({ state: 'Reviewing', nextStep: 'Reviewer outcome required before completion.' })
  runtime.setCurrentMissionReview({
    outcome: 'passed',
    reviewer: 'Golden Trace Reviewer',
    summary: 'Golden trace contains the required audit links.',
    evidence: ['review.check event passed', 'permission.recorded event includes policy and scope'],
    failures: [],
  })
  const completed = runtime.updateCurrentMission({ state: 'Complete', nextStep: 'Golden trace complete.' })

  const trace = completed.trace
  const types = trace.map(entry => entry.type)
  assert(completed.id === mission.id, 'golden mission remains current')
  assert(trace.every(entry => entry.missionId === mission.id), 'every trace entry links to the mission id')
  assertOrder(types, [
    'mission.started',
    'state.changed',
    'memory.reference',
    'agent.action',
    'tool.called',
    'tool.stage',
    'artifact.added',
    'permission.recorded',
    'state.changed',
    'recovery.added',
    'state.changed',
    'plan.step.updated',
    'plan.step.updated',
    'review.check',
    'state.changed',
    'review.recorded',
    'state.changed',
  ])

  const memoryTrace = findTrace(trace, 'memory.reference')
  assert(memoryTrace?.memoryReferenceId === memory.memoryReferences.at(-1).id, 'memory trace links memory reference id')

  const toolTrace = findTrace(trace, 'tool.called')
  assert(toolTrace?.planStepId === 'execute', 'tool trace links plan step')
  assert(toolTrace?.toolName === 'golden.runner', 'tool trace links tool name')
  assert(toolTrace?.agentRole === 'Builder', 'tool trace links agent role')

  const toolStageTrace = findTrace(trace, 'tool.stage')
  assert(toolStageTrace?.toolCallId === 'tool-golden-runner', 'tool stage trace links tool call id')
  assert(toolStageTrace?.toolName === 'golden.runner', 'tool stage trace links stage tool name')
  assert(toolStageTrace?.stage === 'command-exit', 'tool stage trace records stage name')
  assert(toolStageTrace?.url === 'vela://golden-runner/stages/command-exit', 'tool stage trace records stage URL')
  assert(toolStageTrace?.result === 'ok', 'tool stage trace records stage result')

  const artifactTrace = findTrace(trace, 'artifact.added')
  assert(artifactTrace?.artifactId === 'artifact-golden-report', 'artifact trace links artifact id')
  assert(artifactTrace?.planStepId === 'execute', 'artifact trace links plan step')

  const permissionTrace = findTrace(trace, 'permission.recorded')
  assert(permissionTrace?.permissionDecision === 'requested', 'permission trace records decision')
  assert(permissionTrace?.planStepId === 'execute', 'permission trace links plan step')
  assert(permissionTrace?.toolName === 'tool-golden-runner', 'permission trace links tool call id')
  assert(permissionTrace?.result === 'Assist write gate', 'permission trace records guard policy')

  const reviewCheckTrace = findTrace(trace, 'review.check')
  assert(reviewCheckTrace?.reviewOutcome === 'passed', 'review check trace records outcome')
  assert(reviewCheckTrace?.planStepId === 'review', 'review check trace links review plan step')
  assert(reviewCheckTrace?.artifactId === 'artifact-golden-report', 'review check trace links checked artifact')
  assert(reviewCheckTrace?.toolName === 'tool-golden-runner', 'review check trace links checked tool call')

  const reviewTrace = findTrace(trace, 'review.recorded')
  assert(reviewTrace?.reviewOutcome === 'passed', 'review result trace records outcome')
  assert(completed.reviewResult?.evidence?.length === 2, 'review result keeps evidence list')
  assert(completed.state === 'Complete', 'mission completes after golden review')

  console.log('\n[PASS] vela golden trace eval')
  console.log(JSON.stringify({ missionId: completed.id, traceTypes: types }, null, 2))
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
}

if (failed > 0) process.exit(1)
