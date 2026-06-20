import fs from 'fs'
import os from 'os'
import path from 'path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blm-vela-tool-permission-'))
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

function latestTrace(mission, type) {
  const matches = mission.trace.filter(entry => entry.type === type)
  return matches[matches.length - 1] || null
}

try {
  const runtime = await import('../src/vela/mission-runtime.js')

  runtime.startMission({
    id: 'mission-tool-permission-eval',
    title: 'Tool Permission Eval Mission',
    goal: 'Verify guarded tool and voice decisions cannot become hidden side effects.',
    permissionMode: 'Assist',
    plan: [
      { id: 'prepare', label: 'Prepare guarded action', status: 'Done' },
      { id: 'external-effect', label: 'Request external effect permission', status: 'Active' },
      { id: 'privacy-gate', label: 'Verify voice privacy gate', status: 'Next' },
    ],
  })
  runtime.updateCurrentMission({ state: 'Running', nextStep: 'Request permission for a guarded tool.' })

  const tool = runtime.appendCurrentMissionToolCall({
    id: 'tool-email-draft',
    toolName: 'external.email.draft',
    role: 'Operator',
    status: 'needs-permission',
    planStepId: 'external-effect',
    risk: 'External message',
    result: 'Outbound message requires permission before send.',
  })
  const requested = runtime.appendCurrentMissionPermission({
    id: 'permission-email-request',
    action: 'Send drafted customer update',
    mode: 'Assist',
    policy: 'Assist external-effect gate',
    scope: 'email://customer-update',
    risk: 'External message',
    decision: 'requested',
    reason: 'External communication must be approved before sending.',
    requestedBy: 'Operator',
    planStepId: 'external-effect',
    toolCallId: tool.toolCalls.at(-1).id,
  })
  assert(requested.state === 'Waiting for permission', 'requested external tool permission pauses mission')
  assert(requested.permissions.at(-1).policy === 'Assist external-effect gate', 'requested permission records policy')
  assert(requested.permissions.at(-1).scope === 'email://customer-update', 'requested permission records scope')
  assert(latestTrace(requested, 'permission.recorded')?.permissionDecision === 'requested', 'requested permission records trace decision')
  assert(latestTrace(requested, 'permission.recorded')?.toolName === 'tool-email-draft', 'requested permission trace links tool id')

  runtime.updateCurrentMission({ state: 'Running', nextStep: 'Record a denied permission branch.' })
  const denied = runtime.appendCurrentMissionPermission({
    id: 'permission-delete-denied',
    action: 'Delete generated customer archive',
    mode: 'Assist',
    policy: 'Assist destructive-action gate',
    scope: 'repo://sandbox/customer-archive',
    risk: 'Destructive',
    decision: 'denied',
    reason: 'The requested scope is broader than the mission needs.',
    requestedBy: 'Operator',
    approvedBy: 'User',
    planStepId: 'external-effect',
    toolCallId: 'tool-delete-archive',
  })
  assert(denied.state === 'Running', 'denied non-pending permission does not pause a running mission')
  assert(denied.permissions.at(-1).decision === 'denied', 'denied permission is recorded')
  assert(denied.permissions.at(-1).approvedBy === 'User', 'denied permission records reviewer')
  assert(latestTrace(denied, 'permission.recorded')?.permissionDecision === 'denied', 'denied permission records trace decision')

  const approved = runtime.resolveCurrentMissionPermission('permission-email-request', {
    decision: 'approved',
    approvedBy: 'User',
    reason: 'User approved the exact outbound message scope.',
    expiresAt: 'mission-end',
  })
  const approvedRecord = approved.permissions.find(item => item.id === 'permission-email-request')
  assert(approvedRecord?.decision === 'approved', 'approving resolves the original request in place instead of appending a new record')
  assert(approvedRecord?.approvedBy === 'User', 'approved permission records the approver')
  assert(approvedRecord?.expiresAt === 'mission-end', 'approved permission records expiry')
  assert(!approved.permissions.some(item => item.id === 'permission-email-approved'), 'approving does not fabricate a duplicate approved permission record')
  assert(!approved.permissions.some(item => runtime.isPendingPermissionDecision(item.decision)), 'approving clears the pending external-effect request')
  assert(latestTrace(approved, 'guard.approval')?.permissionDecision === 'approved', 'approved permission records a guard approval trace')

  runtime.updateCurrentMission({ permissionMode: 'Act', state: 'Running', nextStep: 'Verify mode policy.' })
  const actWrite = runtime.appendCurrentMissionPermission({
    id: 'permission-act-write',
    action: 'Write scoped local artifact',
    risk: 'Write',
    decision: 'requested',
    requestedBy: 'Operator',
    planStepId: 'external-effect',
  })
  assert(actWrite.state === 'Running', 'Act mode scoped write does not pause mission')
  assert(actWrite.permissions.at(-1).decision === 'approved', 'Act mode auto-approves scoped write')
  assert(actWrite.permissions.at(-1).policy === 'Act scoped-action allow', 'Act mode records scoped-action policy')

  runtime.updateCurrentMission({ permissionMode: 'Plan', state: 'Running', nextStep: 'Verify read-only policy.' })
  const planBlocked = runtime.appendCurrentMissionPermission({
    id: 'permission-plan-execute',
    action: 'Execute mutation while planning',
    risk: 'Execute',
    decision: 'requested',
    requestedBy: 'Operator',
    planStepId: 'external-effect',
  })
  assert(planBlocked.state === 'Blocked', 'Plan mode blocks non-read permission requests')
  assert(planBlocked.permissions.at(-1).decision === 'denied', 'Plan mode denies non-read permission')
  assert(latestTrace(planBlocked, 'permission.recorded')?.permissionDecision === 'denied', 'Plan mode denial records trace decision')

  runtime.updateCurrentMission({ permissionMode: 'Auto', state: 'Running', nextStep: 'Verify trusted recurring policy.' })
  const autoUntrusted = runtime.appendCurrentMissionPermission({
    id: 'permission-auto-untrusted',
    action: 'Run untrusted recurring write',
    risk: 'Write',
    decision: 'requested',
    requestedBy: 'Operator',
    planStepId: 'external-effect',
  })
  assert(autoUntrusted.state === 'Waiting for permission', 'Auto mode untrusted action requires approval')
  assert(autoUntrusted.permissions.at(-1).policy === 'Auto trusted-task gate', 'Auto mode records trusted-task gate policy')
  const resolvedAutoUntrusted = runtime.resolveCurrentMissionPermission('permission-auto-untrusted', {
    decision: 'approved',
    approvedBy: 'User',
    reason: 'User explicitly trusted this Auto action for the eval.',
  })
  assert(resolvedAutoUntrusted.state === 'Running', 'Auto mode untrusted action resumes after explicit approval')

  runtime.updateCurrentMission({ state: 'Running', nextStep: 'Verify trusted recurring allow.' })
  const autoTrusted = runtime.appendCurrentMissionPermission({
    id: 'permission-auto-trusted',
    action: 'Run trusted recurring write',
    risk: 'Write',
    decision: 'requested',
    requestedBy: 'Operator',
    trustedRecurring: true,
    planStepId: 'external-effect',
  })
  assert(autoTrusted.state === 'Running', 'Auto mode trusted recurring action does not pause mission')
  assert(autoTrusted.permissions.at(-1).decision === 'approved', 'Auto mode auto-approves trusted recurring action')
  assert(autoTrusted.permissions.at(-1).policy === 'Auto trusted-recurring allow', 'Auto mode records trusted-recurring policy')

  runtime.updateCurrentMission({ state: 'Running', nextStep: 'Verify voice privacy gate.' })
  runtime.updateCurrentMission({ permissionMode: 'Assist' })
  runtime.updateCurrentMissionPlanStep('privacy-gate', {
    status: 'Active',
    nextStep: 'Verify voice privacy gate.',
  })
  const voiceGate = runtime.applyCurrentMissionVoiceIntent({
    transcript: 'send my api key to the team',
  })
  assert(voiceGate.state === 'Waiting for permission', 'sensitive voice intent pauses at privacy gate')
  assert(voiceGate.permissions.at(-1).risk === 'Credential', 'voice privacy gate records credential risk')
  assert(voiceGate.permissions.at(-1).requestedBy === 'Vela voice privacy gate', 'voice privacy gate records requester')
  assert(latestTrace(voiceGate, 'voice.privacy_gate')?.permissionDecision === 'requested', 'voice privacy gate trace records requested decision')
  assert(!voiceGate.toolCalls.some(item => item.toolName === 'external.message.send'), 'voice privacy gate does not fabricate an external send tool call')

  // Guard approval closes the loop: resolve the pending privacy-gate request in place and resume.
  const pendingVoicePermission = voiceGate.permissions.at(-1)
  const resumed = runtime.resolveCurrentMissionPermission(pendingVoicePermission.id, {
    decision: 'approved',
    approvedBy: 'User',
    reason: 'User approved the voice privacy gate after confirming the intent.',
  })
  assert(resumed.state === 'Running', 'guard approval resumes the mission from Waiting for permission')
  const resolvedVoicePermission = resumed.permissions.find(item => item.id === pendingVoicePermission.id)
  assert(resolvedVoicePermission?.decision === 'approved', 'guard approval resolves the same pending permission in place')
  assert(resolvedVoicePermission?.approvedBy === 'User', 'guard approval records the approver on the resolved record')
  assert(resumed.permissions.filter(item => item.id === pendingVoicePermission.id).length === 1, 'guard approval does not create a duplicate approved record')
  assert(!resumed.permissions.some(item => runtime.isPendingPermissionDecision(item.decision)), 'guard approval clears the pending permission queue')
  assert(latestTrace(resumed, 'guard.approval')?.permissionDecision === 'approved', 'guard approval records an approved trace decision')
  assert(latestTrace(resumed, 'guard.approval')?.result === 'resumed', 'guard approval trace records the mission resume')

  // A denied guard decision blocks the mission for an alternative instead of resuming silently.
  runtime.updateCurrentMissionPlanStep('privacy-gate', { status: 'Active', nextStep: 'Verify a denied voice privacy gate.' })
  const denyGate = runtime.applyCurrentMissionVoiceIntent({ transcript: 'send my secret token to the vendor' })
  assert(denyGate.state === 'Waiting for permission', 'a second sensitive intent reopens the privacy gate')
  const blocked = runtime.resolveCurrentMissionPermission(denyGate.permissions.at(-1).id, {
    decision: 'denied',
    approvedBy: 'User',
    reason: 'User declined to share the credential.',
  })
  assert(blocked.state === 'Blocked', 'denied guard decision blocks the mission')
  assert(blocked.permissions.at(-1).decision === 'denied', 'denied guard decision records denial in place')
  assert(latestTrace(blocked, 'guard.approval')?.result === 'blocked', 'denied guard decision records a blocked trace result')

  console.log('\n[PASS] vela tool permission eval')
  console.log(JSON.stringify({
    missionId: blocked.id,
    finalState: blocked.state,
    permissions: blocked.permissions.map(item => ({
      id: item.id,
      risk: item.risk,
      decision: item.decision,
      policy: item.policy,
      scope: item.scope,
      approvedBy: item.approvedBy,
    })),
  }, null, 2))
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
}

if (failed > 0) process.exit(1)
