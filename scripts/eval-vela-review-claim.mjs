import fs from 'fs'
import os from 'os'
import path from 'path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blm-vela-review-claim-'))
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

function completeBlockedWith(runtime, code) {
  try {
    runtime.updateCurrentMission({ state: 'Complete' })
    return false
  } catch (err) {
    return err?.code === code
  }
}

try {
  const runtime = await import('../src/vela/mission-runtime.js')

  runtime.startMission({
    id: 'mission-review-claim-eval',
    title: 'Review Claim Eval Mission',
    goal: 'Verify reviewer claim checks can block and later resolve mission completion.',
    plan: [
      { id: 'build', label: 'Build claim evidence', status: 'Done' },
      { id: 'review', label: 'Review claim evidence', status: 'Active' },
    ],
  })
  runtime.updateCurrentMission({ state: 'Running', nextStep: 'Generate claim evidence.' })
  runtime.appendCurrentMissionToolCall({
    id: 'tool-review-claim',
    toolName: 'review.claim.runner',
    role: 'Reviewer',
    status: 'ok',
    planStepId: 'review',
    result: 'Claim evidence collected.',
  })
  runtime.updateCurrentMission({ state: 'Reviewing', nextStep: 'Reviewer outcome required.' })

  assert(completeBlockedWith(runtime, 'review_required'), 'review claim eval requires reviewer outcome first')

  runtime.setCurrentMissionReview({
    outcome: 'passed',
    reviewer: 'Review Claim Evaluator',
    summary: 'Reviewer outcome is present, but claim checks still matter.',
    evidence: ['review outcome recorded'],
  })
  const blocked = runtime.appendCurrentMissionReviewCheck({
    key: 'claim-accuracy',
    title: 'Claim accuracy',
    outcome: 'failed',
    reviewer: 'Review Claim Evaluator',
    planStepId: 'review',
    toolCallId: 'tool-review-claim',
    failures: ['claim evidence does not support completion'],
  })
  assert(blocked.reviewChecks.at(-1).key === 'claim-accuracy', 'blocking review check records stable key')
  assert(blocked.recoveryActions.at(-1).source === 'review_blocked', 'blocking review check opens recovery action')
  assert(blocked.recoveryActions.at(-1).reviewCheckKey === 'claim-accuracy', 'review recovery action links claim check key')
  assert(blocked.recoveryActions.at(-1).status === 'open', 'review recovery action starts open')
  assert(completeBlockedWith(runtime, 'review_blocked'), 'failed claim check blocks completion despite passing reviewer outcome')

  const resolved = runtime.appendCurrentMissionReviewCheck({
    key: 'claim-accuracy',
    title: 'Claim accuracy',
    outcome: 'passed',
    reviewer: 'Review Claim Evaluator',
    planStepId: 'review',
    toolCallId: 'tool-review-claim',
    evidence: ['claim evidence now supports completion'],
  })
  assert(resolved.recoveryActions.some(item => item.reviewCheckKey === 'claim-accuracy' && item.status === 'resolved'), 'passing claim check resolves linked recovery action')
  const completed = runtime.updateCurrentMission({ state: 'Complete', nextStep: 'Review claim eval complete.' })
  assert(completed.state === 'Complete', 'passing check with the same key resolves review block')
  assert(completed.trace.some(entry => entry.type === 'review.check' && entry.reviewOutcome === 'failed'), 'failed review check remains auditable in trace')
  assert(completed.trace.some(entry => entry.type === 'review.check' && entry.reviewOutcome === 'passed'), 'resolved review check remains auditable in trace')

  console.log('\n[PASS] vela review claim eval')
  console.log(JSON.stringify({
    missionId: completed.id,
    reviewChecks: completed.reviewChecks.map(item => ({
      key: item.key,
      title: item.title,
      outcome: item.outcome,
    })),
  }, null, 2))
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
}

if (failed > 0) process.exit(1)
