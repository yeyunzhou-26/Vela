import fs from 'fs'
import os from 'os'
import path from 'path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blm-vela-mission-'))
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
  const runtime = await import('./vela/mission-runtime.js')
  const capabilityAdapters = await import('./vela/capability-adapters.js')
  const capabilityRegistry = await import('./vela/capability-registry.js')

  const browserCapability = capabilityRegistry.findOpenCapabilitiesForText('帮我打开网页填写表单')[0]
  assert(browserCapability.id === 'browser.web-agent', 'capability registry routes browser tasks to browser agent')
  assert(browserCapability.riskClasses.includes('Network'), 'browser capability declares network risk')
  const urlCapability = capabilityRegistry.findOpenCapabilitiesForText('总结 https://example.com/vela')[0]
  assert(urlCapability.id === 'browser.web-agent', 'capability registry routes bare URLs to browser agent')
  const browserAdapterPlan = capabilityAdapters.planCapabilityAdapterRun({
    title: '帮我打开网页搜索资料并总结',
    plan: [{ id: 'execute-review', label: '执行并复核', status: 'Active' }],
    capabilityReferences: [browserCapability],
  })
  assert(browserAdapterPlan.toolCall.toolName === 'browser.web-agent.prepare', 'browser adapter prepares a browser tool call')
  assert(!browserAdapterPlan.permission, 'browser read adapter does not request permission for read-only browsing')
  const browserAdapterLiveRun = capabilityAdapters.executeCapabilityAdapterRun({
    id: 'mission-live-browser',
    title: '帮我搜索 Vela 浏览器能力',
    goal: '帮我搜索 Vela 浏览器能力',
    plan: [{ id: 'execute-review', label: '执行并复核', status: 'Active' }],
    capabilityReferences: [browserCapability],
    toolCalls: [browserAdapterPlan.toolCall],
    artifacts: [browserAdapterPlan.artifact],
  }, {
    capabilityAdapterResult: {
      kind: 'browser-read-result',
      ok: true,
      sourceTools: ['web_search', 'fetch_url'],
      summary: '已围绕「Vela 浏览器能力」完成网页搜索和读取。',
      evidence: ['搜索查询：Vela 浏览器能力', 'Capability Map：https://example.com/capability（direct）'],
    },
  })
  assert(browserAdapterLiveRun.toolCall.result.includes('web_search + fetch_url'), 'browser adapter result records live web tools')
  assert(browserAdapterLiveRun.artifact.summary.includes('网页搜索和读取'), 'browser adapter artifact uses live web summary')
  assert(browserAdapterLiveRun.reviewCheck.evidence.at(-1).includes('example.com'), 'browser adapter review uses live evidence')
  const fallbackCapability = capabilityRegistry.findOpenCapabilitiesForText('帮我处理一个很复杂的新任务')[0]
  assert(fallbackCapability.id === 'agent.orchestration', 'capability registry falls back to agent orchestration')
  const desktopCapability = capabilityRegistry.findOpenCapabilitiesForText('帮我打开微信')[0]
  assert(desktopCapability.id === 'desktop.app-control', 'capability registry routes desktop app tasks to desktop control')
  assert(desktopCapability.riskClasses.includes('Screen'), 'desktop capability declares screen risk')
  assert(desktopCapability.integrationStatus === 'adapter-ready', 'desktop capability is marked adapter-ready')
  const desktopAdapterPlan = capabilityAdapters.planCapabilityAdapterRun({
    title: '帮我打开微信',
    plan: [{ id: 'inspect-context', label: '查看应用上下文', status: 'Active' }],
    capabilityReferences: [desktopCapability],
  })
  assert(desktopAdapterPlan.toolCall.toolName === 'desktop.app-control.prepare', 'desktop adapter prepares a desktop tool call')
  assert(!desktopAdapterPlan.permission, 'desktop adapter prototype does not request permission before mocked inspection')
  assert(desktopAdapterPlan.artifact.summary.includes('不会真的打开应用'), 'desktop adapter plan states no real app action')
  const desktopAdapterRun = capabilityAdapters.executeCapabilityAdapterRun({
    id: 'mission-desktop-adapter',
    title: '帮我打开微信',
    goal: '帮我打开微信',
    plan: [{ id: 'inspect-context', label: '查看应用上下文', status: 'Active' }],
    capabilityReferences: [desktopCapability],
    toolCalls: [desktopAdapterPlan.toolCall],
    artifacts: [desktopAdapterPlan.artifact],
  })
  assert(desktopAdapterRun.toolCall.toolName === 'desktop.app-control.inspect', 'desktop adapter records mocked desktop inspection')
  assert(desktopAdapterRun.artifact.title === '桌面上下文摘要', 'desktop adapter creates desktop context artifact')
  assert(desktopAdapterRun.reviewCheck.outcome === 'passed', 'desktop adapter review passes for mocked inspection')
  assert(desktopAdapterRun.toolStages.some(item => item.toolName === 'desktop.open-app' && item.url === 'app://wechat'), 'desktop adapter records mocked app-open stage')
  assert(desktopAdapterRun.toolStages.some(item => item.toolName === 'desktop.external-effect' && item.status === 'skipped'), 'desktop adapter records no hidden external effect')

  const seed = runtime.getCurrentMission()
  assert(seed.id === 'mission-vela-shell', 'seed mission is available before persistence')
  assert(seed.state === 'Planned', 'seed mission state is Planned')
  assert(Array.isArray(seed.capabilityReferences), 'seed mission normalizes capability references')

  const mission = runtime.startMission({
    title: 'Smoke Mission Runtime',
    goal: 'Verify Vela missions persist and resume.',
    plan: [
      { id: 'one', label: 'Create mission', status: 'Done' },
      { id: 'two', label: 'Resume mission', status: 'Active' },
    ],
    artifacts: [
      {
        name: 'Initial Runtime Brief',
        type: 'report',
        path: 'vela://runtime-brief',
        detail: 'Initial artifact should normalize through mission creation.',
        planStepId: 'one',
      },
    ],
  })
  assert(mission.state === 'Planned', 'started mission defaults to Planned')
  assert(mission.plan.length === 2, 'started mission keeps provided plan')
  assert(mission.artifacts.at(-1).title === 'Initial Runtime Brief', 'started mission normalizes initial artifact title')
  assert(mission.artifacts.at(-1).kind === 'report', 'started mission normalizes initial artifact kind')
  assert(mission.artifacts.at(-1).uri === 'vela://runtime-brief', 'started mission normalizes initial artifact uri')
  assert(mission.artifacts.at(-1).summary.includes('mission creation'), 'started mission normalizes initial artifact summary')
  assert(mission.artifacts.at(-1).planStepId === 'one', 'started mission links initial artifact to plan step')
  assert(mission.trace.some(event => event.type === 'mission.started'), 'started mission records trace event')
  assert(mission.trace.at(-1).missionId === mission.id, 'started mission trace is linked to mission id')
  assert(mission.capabilityReferences.some(item => item.id === 'agent.orchestration'), 'started mission records matched capability references')
  assert(mission.trace.some(event => event.type === 'capability.matched'), 'started mission records capability match trace')

  const running = runtime.updateCurrentMission({ state: 'Running', nextStep: 'Continue runtime verification.' })
  assert(running.state === 'Running', 'mission transitions Planned -> Running')
  assert(running.nextStep === 'Continue runtime verification.', 'mission patch updates next step')
  assert(running.trace.some(event => event.type === 'state.changed' && event.detail === 'Planned -> Running'), 'state transition records trace event')
  assert(running.trace.at(-1).missionId === mission.id, 'state trace is linked to mission id')

  const waitingForPermission = runtime.appendCurrentMissionPermission({
    action: 'Approve runtime smoke write',
    policy: 'Assist write gate',
    scope: 'vela://runtime-smoke',
    risk: 'Write',
    decision: 'requested',
    reason: 'Mission needs approval before continuing.',
    planStepId: 'two',
    toolCallId: 'runtime.write',
  })
  assert(waitingForPermission.state === 'Waiting for permission', 'pending permission moves mission to Waiting for permission')
  assert(waitingForPermission.permissions.at(-1).risk === 'Write', 'mission permission is appended')
  assert(waitingForPermission.permissions.at(-1).policy === 'Assist write gate', 'mission permission records guard policy')
  assert(waitingForPermission.permissions.at(-1).scope === 'vela://runtime-smoke', 'mission permission records scope')
  assert(waitingForPermission.permissions.at(-1).reason.includes('approval'), 'mission permission records reason')
  assert(waitingForPermission.trace.at(-1).permissionDecision === 'requested', 'mission permission records trace decision')
  assert(waitingForPermission.trace.at(-1).planStepId === 'two', 'mission permission trace links plan step')
  assert(waitingForPermission.trace.at(-1).toolName === 'runtime.write', 'mission permission trace links tool call')

  const resumedAfterPermission = runtime.updateCurrentMission({ state: 'Running', nextStep: 'Continue runtime verification.' })
  assert(resumedAfterPermission.state === 'Running', 'mission resumes from Waiting for permission')

  const actMode = runtime.updateCurrentMission({ permissionMode: 'Act' })
  assert(actMode.permissionMode === 'Act', 'mission permission mode can switch to Act')
  assert(actMode.trace.at(-1).type === 'permission.mode.changed', 'permission mode switch records trace event')
  assert(actMode.trace.at(-1).detail === 'Assist -> Act', 'permission mode trace records mode transition')

  const actWrite = runtime.appendCurrentMissionPermission({
    action: 'Write local runtime note',
    risk: 'Write',
    decision: 'requested',
    requestedBy: 'Runtime test',
  })
  assert(actWrite.state === 'Running', 'Act mode allows scoped write without pausing')
  assert(actWrite.permissions.at(-1).decision === 'approved', 'Act mode auto-approves scoped write permission')
  assert(actWrite.permissions.at(-1).policy === 'Act scoped-action allow', 'Act mode records scoped-action policy')

  runtime.updateCurrentMission({ permissionMode: 'Auto' })
  const autoUntrusted = runtime.appendCurrentMissionPermission({
    action: 'Run untrusted recurring write',
    risk: 'Write',
    decision: 'requested',
    requestedBy: 'Runtime test',
  })
  assert(autoUntrusted.state === 'Waiting for permission', 'Auto mode gates untrusted recurring actions')
  assert(autoUntrusted.permissions.at(-1).decision === 'requested', 'Auto mode keeps untrusted action pending')
  assert(autoUntrusted.permissions.at(-1).policy === 'Auto trusted-task gate', 'Auto mode records trusted-task gate policy')

  runtime.updateCurrentMission({ state: 'Running', nextStep: 'Continue runtime verification.' })
  const autoTrusted = runtime.appendCurrentMissionPermission({
    action: 'Run trusted recurring write',
    risk: 'Write',
    decision: 'requested',
    requestedBy: 'Runtime test',
    trustedRecurring: true,
  })
  assert(autoTrusted.state === 'Running', 'Auto mode allows trusted recurring low-risk actions')
  assert(autoTrusted.permissions.at(-1).decision === 'approved', 'Auto mode auto-approves trusted recurring action')
  assert(autoTrusted.permissions.at(-1).policy === 'Auto trusted-recurring allow', 'Auto mode records trusted-recurring policy')

  let invalidPermissionModeRejected = false
  try {
    runtime.updateCurrentMission({ permissionMode: 'Root' })
  } catch {
    invalidPermissionModeRejected = true
  }
  assert(invalidPermissionModeRejected, 'invalid permission mode is rejected')

  runtime.updateCurrentMission({ permissionMode: 'Plan' })
  const planBlocked = runtime.appendCurrentMissionPermission({
    action: 'Execute runtime mutation',
    risk: 'Execute',
    decision: 'requested',
    requestedBy: 'Runtime test',
  })
  assert(planBlocked.state === 'Blocked', 'Plan mode blocks non-read actions')
  assert(planBlocked.permissions.at(-1).decision === 'denied', 'Plan mode denies non-read permission')
  assert(planBlocked.trace.at(-1).permissionDecision === 'denied', 'Plan mode denial is auditable in trace')

  const blocked = runtime.appendCurrentMissionRecoveryAction({
    title: 'Repair runtime verification gap',
    summary: 'A recovery action should keep the mission visible.',
  })
  assert(blocked.state === 'Blocked', 'open recovery action moves mission to Blocked')
  assert(blocked.recoveryActions.at(-1).title === 'Repair runtime verification gap', 'mission recovery action is appended')
  assert(blocked.trace.at(-1).type === 'recovery.added', 'mission recovery action records trace event')

  const resolvedRecovery = runtime.updateCurrentMissionRecoveryAction(blocked.recoveryActions.at(-1).id, {
    status: 'resolved',
    summary: 'Runtime verification gap repaired.',
    nextStep: 'Continue runtime verification.',
  })
  assert(resolvedRecovery.state === 'Running', 'resolved recovery action resumes mission from Blocked')
  assert(resolvedRecovery.recoveryActions.at(-1).status === 'resolved', 'mission recovery action status updates')
  assert(resolvedRecovery.trace.at(-1).type === 'recovery.updated', 'mission recovery update records trace event')

  const resumedAfterRecovery = runtime.updateCurrentMission({ state: 'Running', nextStep: 'Continue runtime verification.' })
  assert(resumedAfterRecovery.state === 'Running', 'mission remains Running after recovery resolution')

  const stepDone = runtime.updateCurrentMissionPlanStep('two', {
    status: 'Done',
    nextStep: 'Runtime plan step updated.',
  })
  assert(stepDone.plan.find(step => step.id === 'two')?.status === 'Done', 'plan step status updates')
  assert(stepDone.nextStep === 'Runtime plan step updated.', 'plan step update can refresh next step')
  assert(stepDone.trace.at(-1).type === 'plan.step.updated', 'plan step update records trace event')
  assert(stepDone.trace.at(-1).planStepId === 'two', 'plan step update trace links step id')

  const stepActive = runtime.updateCurrentMissionPlanStep('one', { status: 'Active' })
  assert(stepActive.plan.find(step => step.id === 'one')?.status === 'Active', 'plan step can become active')
  assert(stepActive.plan.filter(step => step.status === 'Active').length === 1, 'plan keeps a single active step')

  const withInput = runtime.appendCurrentMissionInput({ text: 'Continue with runtime trace checks.', source: 'test' })
  assert(withInput.inputs.at(-1).source === 'test', 'mission input is appended')
  assert(withInput.trace.at(-1).type === 'input.added', 'mission input records trace event')

  const withArtifact = runtime.appendCurrentMissionArtifact({
    title: 'Runtime Notes',
    kind: 'note',
    uri: 'memory://runtime-notes',
    summary: 'Traceable runtime artifact.',
    planStepId: 'two',
  })
  assert(withArtifact.artifacts.at(-1).title === 'Runtime Notes', 'mission artifact is appended')
  assert(withArtifact.artifacts.at(-1).planStepId === 'two', 'mission artifact links to plan step')
  assert(withArtifact.trace.at(-1).type === 'artifact.added', 'mission artifact records trace event')
  assert(withArtifact.trace.at(-1).planStepId === 'two', 'mission artifact trace links plan step')
  assert(withArtifact.trace.at(-1).artifactId === withArtifact.artifacts.at(-1).id, 'mission artifact trace links artifact id')

  const withMemory = runtime.appendCurrentMissionMemoryReference({
    title: 'Runtime Memory',
    type: 'project',
    source: 'test',
    provenance: 'src/test-vela-mission.js',
    query: 'runtime mission trace memory',
    relevance: '0.91',
    confidence: 'high',
    usedByPlanStepId: 'two',
    reason: 'This memory explains the runtime mission test contract.',
    summary: 'Mission runtime test memory reference.',
  })
  assert(withMemory.memoryReferences.at(-1).title === 'Runtime Memory', 'mission memory reference is appended')
  assert(withMemory.memoryReferences.at(-1).provenance === 'src/test-vela-mission.js', 'mission memory reference records provenance')
  assert(withMemory.memoryReferences.at(-1).query === 'runtime mission trace memory', 'mission memory reference records recall query')
  assert(withMemory.memoryReferences.at(-1).usedByPlanStepId === 'two', 'mission memory reference records consuming plan step')
  assert(withMemory.trace.at(-1).type === 'memory.reference', 'mission memory reference records trace event')
  assert(withMemory.trace.at(-1).memoryReferenceId === withMemory.memoryReferences.at(-1).id, 'mission memory reference trace links memory id')
  assert(withMemory.trace.at(-1).planStepId === 'two', 'mission memory reference trace links consuming plan step')

  const withAgentAction = runtime.appendCurrentMissionAgentAction({
    role: 'Builder',
    title: 'Run runtime trace checks',
    status: 'done',
    planStepId: 'two',
    summary: 'Builder completed runtime trace checks.',
    result: 'passed',
    requiresReview: true,
  })
  assert(withAgentAction.agentActions.at(-1).role === 'Builder', 'mission agent action records role')
  assert(withAgentAction.agentActions.at(-1).status === 'done', 'mission agent action records status')
  assert(withAgentAction.trace.at(-1).type === 'agent.action', 'mission agent action records trace event')
  assert(withAgentAction.trace.at(-1).agentRole === 'Builder', 'mission agent action trace records agent role')
  assert(withAgentAction.trace.at(-1).reviewOutcome === 'required', 'mission agent action trace records review requirement')

  const withToolCall = runtime.appendCurrentMissionToolCall({
    toolName: 'test.runner',
    role: 'Builder',
    status: 'ok',
    planStepId: 'two',
    result: 'Runtime trace checks passed.',
  })
  assert(withToolCall.toolCalls.at(-1).toolName === 'test.runner', 'mission tool call is appended')
  assert(withToolCall.toolCalls.at(-1).role === 'Builder', 'mission tool call records agent role')
  assert(withToolCall.trace.at(-1).type === 'tool.called', 'mission tool call records trace event')
  assert(withToolCall.trace.at(-1).agentRole === 'Builder', 'mission tool call trace records agent role')
  assert(withToolCall.trace.at(-1).toolCallId === withToolCall.toolCalls.at(-1).id, 'mission tool call trace links tool call id')

  const withToolStage = runtime.appendCurrentMissionToolStage({
    toolName: 'test.runner',
    toolCallId: withToolCall.toolCalls.at(-1).id,
    role: 'Builder',
    status: 'ok',
    stage: 'stdout-read',
    url: 'vela://runtime-tool-stage',
    planStepId: 'two',
    summary: 'Runtime stage evidence was captured.',
  })
  assert(withToolStage.trace.at(-1).type === 'tool.stage', 'mission tool stage records trace event')
  assert(withToolStage.trace.at(-1).toolName === 'test.runner', 'mission tool stage records tool name')
  assert(withToolStage.trace.at(-1).toolCallId === withToolCall.toolCalls.at(-1).id, 'mission tool stage links tool call id')
  assert(withToolStage.trace.at(-1).stage === 'stdout-read', 'mission tool stage records stage name')
  assert(withToolStage.trace.at(-1).url === 'vela://runtime-tool-stage', 'mission tool stage records stage URL')
  assert(withToolStage.trace.at(-1).result === 'ok', 'mission tool stage records stage result')

  const withReviewCheck = runtime.appendCurrentMissionReviewCheck({
    title: 'Runtime claim accuracy',
    outcome: 'passed',
    reviewer: 'Mission Runtime Test',
    planStepId: 'two',
    artifactId: withArtifact.artifacts.at(-1).id,
    toolCallId: withToolCall.toolCalls.at(-1).id,
    summary: 'Reviewer checked runtime trace evidence.',
    evidence: ['runtime trace includes tool call and plan step linkage'],
  })
  assert(withReviewCheck.reviewChecks.at(-1).title === 'Runtime claim accuracy', 'mission review check is appended')
  assert(withReviewCheck.reviewChecks.at(-1).outcome === 'passed', 'mission review check records outcome')
  assert(withReviewCheck.reviewChecks.at(-1).evidence.at(-1).includes('plan step linkage'), 'mission review check records evidence')
  assert(withReviewCheck.trace.at(-1).type === 'review.check', 'mission review check records trace event')
  assert(withReviewCheck.trace.at(-1).reviewOutcome === 'passed', 'mission review check trace records review outcome')
  assert(withReviewCheck.trace.at(-1).artifactId === withArtifact.artifacts.at(-1).id, 'mission review check trace links artifact id')

  const reviewing = runtime.updateCurrentMission({ state: 'Reviewing', nextStep: 'Reviewer outcome required before completion.' })
  assert(reviewing.state === 'Reviewing', 'mission transitions Running -> Reviewing')

  let reviewGateRejected = false
  try {
    runtime.updateCurrentMission({ state: 'Complete' })
  } catch (err) {
    reviewGateRejected = err?.code === 'review_required'
  }
  assert(reviewGateRejected, 'mission cannot complete without reviewer outcome')

  const reviewed = runtime.setCurrentMissionReview({
    outcome: 'passed',
    reviewer: 'Mission Runtime Test',
    summary: 'Runtime trace surface is coherent.',
    evidence: ['Review check passed with linked tool evidence.'],
    failures: [],
  })
  assert(reviewed.reviewResult.outcome === 'passed', 'mission review result is recorded')
  assert(reviewed.reviewResult.evidence.at(-1).includes('linked tool evidence'), 'mission review records evidence')
  assert(reviewed.trace.at(-1).reviewOutcome === 'passed', 'mission review records trace outcome')

  const failedReviewCheck = runtime.appendCurrentMissionReviewCheck({
    title: 'Runtime claim accuracy',
    outcome: 'failed',
    reviewer: 'Mission Runtime Test',
    planStepId: 'two',
    artifactId: withArtifact.artifacts.at(-1).id,
    toolCallId: withToolCall.toolCalls.at(-1).id,
    summary: 'Reviewer found missing claim evidence.',
    failures: ['claim evidence missing before completion'],
  })
  assert(failedReviewCheck.reviewChecks.at(-1).key === withReviewCheck.reviewChecks.at(-1).key, 'matching review checks share a blocking key')
  assert(failedReviewCheck.recoveryActions.at(-1).source === 'review_blocked', 'blocking review check opens a recovery action')
  assert(failedReviewCheck.recoveryActions.at(-1).reviewCheckKey === failedReviewCheck.reviewChecks.at(-1).key, 'review recovery action links blocking check key')
  assert(failedReviewCheck.recoveryActions.at(-1).failures.at(-1).includes('claim evidence'), 'review recovery action carries failure evidence')

  let reviewBlockedRejected = false
  let reviewBlockedMission = null
  try {
    runtime.updateCurrentMission({ state: 'Complete' })
  } catch (err) {
    reviewBlockedRejected = err?.code === 'review_blocked'
    reviewBlockedMission = err?.mission
  }
  assert(reviewBlockedRejected, 'mission cannot complete with unresolved blocking review checks')
  assert(reviewBlockedMission?.recoveryActions?.some(item => item.source === 'review_blocked' && item.status === 'open'), 'review blocked error carries mission with open recovery action')

  const resolvedReviewCheck = runtime.appendCurrentMissionReviewCheck({
    title: 'Runtime claim accuracy',
    outcome: 'passed',
    reviewer: 'Mission Runtime Test',
    planStepId: 'two',
    artifactId: withArtifact.artifacts.at(-1).id,
    toolCallId: withToolCall.toolCalls.at(-1).id,
    summary: 'Reviewer accepted the repaired claim evidence.',
    evidence: ['claim evidence repaired before completion'],
  })
  assert(resolvedReviewCheck.reviewChecks.at(-1).key === failedReviewCheck.reviewChecks.at(-1).key, 'passing check resolves the same blocking key')
  assert(resolvedReviewCheck.recoveryActions.some(item => item.source === 'review_blocked' && item.reviewCheckKey === failedReviewCheck.reviewChecks.at(-1).key && item.status === 'resolved'), 'passing review check resolves linked recovery action')

  const completed = runtime.updateCurrentMission({ state: 'Complete', nextStep: 'Mission complete.' })
  assert(completed.state === 'Complete', 'mission completes after reviewer outcome')

  const reloaded = runtime.getCurrentMission()
  assert(reloaded.id === mission.id, 'current mission reloads from disk')
  assert(reloaded.state === 'Complete', 'mission state persists to disk')
  assert(reloaded.permissions.some(item => item.risk === 'Write'), 'mission permissions persist to disk')
  assert(reloaded.recoveryActions.some(item => item.title === 'Repair runtime verification gap'), 'mission recovery actions persist to disk')
  assert(reloaded.artifacts.some(item => item.title === 'Runtime Notes'), 'mission artifacts persist to disk')
  assert(reloaded.memoryReferences.some(item => item.title === 'Runtime Memory'), 'mission memory references persist to disk')
  assert(reloaded.agentActions.some(item => item.title === 'Run runtime trace checks' && item.role === 'Builder'), 'mission agent actions persist to disk')
  assert(reloaded.toolCalls.some(item => item.toolName === 'test.runner' && item.role === 'Builder'), 'mission tool calls persist to disk')
  assert(reloaded.reviewChecks.some(item => item.title === 'Runtime claim accuracy' && item.outcome === 'passed'), 'mission review checks persist to disk')
  assert(reloaded.reviewResult?.reviewer === 'Mission Runtime Test', 'mission review persists to disk')

  let invalidTransitionRejected = false
  try {
    runtime.updateCurrentMission({ state: 'Draft' })
  } catch {
    invalidTransitionRejected = true
  }
  assert(invalidTransitionRejected, 'invalid mission transition is rejected')

  const missions = runtime.listMissions()
  assert(missions.some(item => item.id === mission.id), 'mission list includes current mission')

  const second = runtime.startMission({
    title: 'Second Mission',
    goal: 'Verify mission switching.',
  })
  assert(runtime.getCurrentMission().id === second.id, 'new mission becomes current')
  const selected = runtime.selectMission(mission.id)
  assert(selected.id === mission.id, 'selectMission returns selected mission')
  assert(runtime.getCurrentMission().id === mission.id, 'selectMission changes current mission')

  const commandMission = runtime.applyCurrentMissionCommand({
    text: 'Command Pipeline Mission',
    source: 'test-command',
  })
  assert(commandMission.title === 'Command Pipeline Mission', 'plain command starts a mission')
  assert(commandMission.inputs.at(-1).source === 'test-command', 'command mission captures typed input')
  assert(commandMission.artifacts.some(item => item.title === '任务简报'), 'plain command mission creates a task brief artifact')
  assert(commandMission.artifacts.at(-1).summary.includes('Command Pipeline Mission'), 'task brief summarizes the command mission goal')
  assert(commandMission.artifacts.at(-1).planStepId === 'draft-plan', 'task brief links to the active planning step')
  assert(commandMission.trace.some(item => item.type === 'mission.brief.created'), 'task brief creation is auditable in trace')
  assert(commandMission.trace.at(-1).type === 'command.started_mission', 'command mission records command trace')
  assert(commandMission.capabilityReferences.some(item => item.id === 'agent.orchestration'), 'plain command mission keeps capability routing evidence')

  const commandRunning = runtime.applyCurrentMissionCommand({ text: 'continue', source: 'test-command' })
  assert(commandRunning.state === 'Running', 'continue command moves Planned -> Running')
  assert(commandRunning.plan.find(item => item.id === 'draft-plan')?.status === 'Done', 'continue command marks planning step done')
  assert(commandRunning.plan.find(item => item.id === 'execute-review')?.status === 'Active', 'continue command activates execution step')
  assert(commandRunning.agentActions.at(-1).role === 'Planner', 'continue command records Planner action')
  assert(commandRunning.agentActions.at(-1).planStepId === 'draft-plan', 'Planner action links to planning step')
  assert(commandRunning.trace.at(-1).type === 'agent.action', 'Planner action is auditable in trace')

  const commandReviewing = runtime.applyCurrentMissionCommand({ text: 'continue', source: 'test-command' })
  assert(commandReviewing.state === 'Reviewing', 'continue command moves Running -> Reviewing')
  assert(commandReviewing.plan.find(item => item.id === 'execute-review')?.status === 'Reviewing', 'continue command marks execution step reviewing')
  assert(commandReviewing.agentActions.at(-1).role === 'Builder', 'review continue records Builder action')
  assert(commandReviewing.agentActions.at(-1).requiresReview === true, 'Builder action requires reviewer outcome')
  assert(commandReviewing.trace.at(-1).reviewOutcome === 'required', 'Builder action trace records review requirement')

  let commandReviewGateRejected = false
  try {
    runtime.applyCurrentMissionCommand({ text: 'complete', source: 'test-command' })
  } catch (err) {
    commandReviewGateRejected = err?.code === 'review_required'
  }
  assert(commandReviewGateRejected, 'complete command is blocked without reviewer outcome')

  const commandReviewed = runtime.applyCurrentMissionCommand({ text: 'review passed', source: 'test-command' })
  assert(commandReviewed.reviewResult?.outcome === 'passed', 'review command records reviewer outcome')

  const commandCompleted = runtime.applyCurrentMissionCommand({ text: 'complete', source: 'test-command' })
  assert(commandCompleted.state === 'Complete', 'complete command succeeds after reviewer outcome')

  const browserCommandMission = runtime.applyCurrentMissionCommand({
    text: '帮我打开网页搜索资料并总结',
    source: 'test-command',
  })
  assert(browserCommandMission.capabilityReferences.some(item => item.id === 'browser.web-agent'), 'browser command mission matches browser capability')
  assert(!browserCommandMission.capabilityReferences.some(item => item.id === 'voice.system-entry'), 'browser command mission does not match voice from default next-step copy')
  const browserCommandRunning = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(browserCommandRunning.state === 'Running', 'browser command continues without permission for read-only browsing')
  assert(browserCommandRunning.toolCalls.at(-1).toolName === 'browser.web-agent.prepare', 'browser command records browser adapter tool call')
  assert(browserCommandRunning.toolCalls.at(-1).status === 'prepared', 'browser command tool call is prepared')
  assert(browserCommandRunning.artifacts.at(-1).title === '浏览器执行方案', 'browser command creates browser execution plan artifact')
  const browserCommandReviewing = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(browserCommandReviewing.state === 'Reviewing', 'browser command moves to reviewing after adapter execution')
  assert(browserCommandReviewing.toolCalls.at(-1).toolName === 'browser.web-agent.read', 'browser command records browser read execution')
  assert(browserCommandReviewing.toolCalls.at(-1).status === 'ok', 'browser read execution succeeds')
  assert(browserCommandReviewing.artifacts.at(-1).title === '浏览器结果摘要', 'browser command creates browser result artifact')
  assert(browserCommandReviewing.reviewChecks.at(-1).title === '浏览器结果复核', 'browser command creates browser review check')
  assert(browserCommandReviewing.reviewChecks.at(-1).outcome === 'passed', 'browser command review check passes')
  assert(browserCommandReviewing.reviewChecks.at(-1).toolCallId === browserCommandReviewing.toolCalls.at(-1).id, 'browser review check links executed tool call')
  assert(browserCommandReviewing.reviewChecks.at(-1).artifactId === browserCommandReviewing.artifacts.at(-1).id, 'browser review check links result artifact')

  const liveBrowserCommandMission = runtime.applyCurrentMissionCommand({
    text: '帮我打开网页总结 https://example.com/vela',
    source: 'test-command',
  })
  assert(liveBrowserCommandMission.capabilityReferences.some(item => item.id === 'browser.web-agent'), 'live browser command matches browser capability')
  const liveBrowserRunning = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(liveBrowserRunning.state === 'Running', 'live browser command enters running state')
  const liveBrowserReviewing = await runtime.applyCurrentMissionCommandWithAdapters({
    text: '继续',
    source: 'test-command',
    capabilityAdapterDeps: {
      fetchUrl: async (args) => JSON.stringify({
        ok: true,
        tool: 'fetch_url',
        url: args.url,
        fetch_source: 'direct',
        title: 'Vela Live Browser Source',
        content: 'Live browser adapter results flow through the async command wrapper into mission artifacts.',
        content_length: 91,
      }),
    },
  })
  assert(liveBrowserReviewing.state === 'Reviewing', 'async browser command moves to reviewing')
  assert(liveBrowserReviewing.toolCalls.at(-1).result.includes('fetch_url'), 'async browser command records live fetch tool')
  assert(liveBrowserReviewing.artifacts.at(-1).summary.includes('Vela Live Browser Source'), 'async browser command writes live source summary')
  assert(liveBrowserReviewing.reviewChecks.at(-1).evidence.some(item => item.includes('example.com/vela')), 'async browser command review keeps source evidence')
  const liveBrowserReadToolId = liveBrowserReviewing.toolCalls.at(-1).id
  const liveBrowserFetchStage = liveBrowserReviewing.trace.find(item => (
    item.type === 'tool.stage'
      && item.toolCallId === liveBrowserReadToolId
      && item.toolName === 'fetch_url'
      && item.url.includes('example.com/vela')
  ))
  assert(liveBrowserFetchStage?.result === 'ok', 'async browser command records fetch_url stage success')

  runtime.applyCurrentMissionCommand({
    text: '帮我打开网页总结 https://example.com/js-fail',
    source: 'test-command',
  })
  runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  const failedBrowserReviewing = await runtime.applyCurrentMissionCommandWithAdapters({
    text: '继续',
    source: 'test-command',
    capabilityAdapterDeps: {
      fetchUrl: async (args) => JSON.stringify({
        ok: false,
        tool: 'fetch_url',
        url: args.url,
        error: 'no readable content',
        hint: 'The page requires JavaScript or blocks crawlers. Use browser_read instead.',
      }),
      browserRead: async (args) => JSON.stringify({
        ok: false,
        tool: 'browser_read',
        url: args.url,
        error: 'captcha required',
      }),
    },
  })
  assert(failedBrowserReviewing.state === 'Reviewing', 'failed browser command still reaches reviewing with evidence')
  assert(failedBrowserReviewing.toolCalls.at(-1).status === 'failed', 'failed browser command records failed tool call')
  assert(failedBrowserReviewing.reviewChecks.at(-1).outcome === 'failed', 'failed browser command records failed review check')
  assert(failedBrowserReviewing.reviewChecks.at(-1).failures.some(item => item.includes('captcha required')), 'failed browser command records browser failure reason')
  assert(failedBrowserReviewing.recoveryActions.some(item => item.source === 'review_blocked' && item.status === 'open'), 'failed browser command opens review recovery action')
  const failedBrowserReadToolId = failedBrowserReviewing.toolCalls.at(-1).id
  const failedBrowserStages = failedBrowserReviewing.trace.filter(item => (
    item.type === 'tool.stage' && item.toolCallId === failedBrowserReadToolId
  ))
  assert(failedBrowserStages.some(item => item.toolName === 'fetch_url' && item.result === 'failed'), 'failed browser command records failed fetch_url stage')
  assert(failedBrowserStages.some(item => item.toolName === 'browser_read' && item.result === 'failed'), 'failed browser command records failed browser_read stage')
  assert(failedBrowserStages.some(item => item.url.includes('example.com/js-fail')), 'failed browser command stage trace keeps target URL')

  const browserSubmitMission = runtime.applyCurrentMissionCommand({
    text: '帮我打开网页填写表单并提交',
    source: 'test-command',
  })
  assert(browserSubmitMission.capabilityReferences.some(item => item.id === 'browser.web-agent'), 'browser submit mission matches browser capability')
  const browserSubmitGate = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(browserSubmitGate.state === 'Waiting for permission', 'browser submit command waits for permission')
  assert(browserSubmitGate.toolCalls.at(-1).status === 'needs-permission', 'browser submit tool call records permission need')
  assert(browserSubmitGate.permissions.at(-1).requestedBy === 'Vela Browser Adapter', 'browser submit permission records adapter requester')
  assert(browserSubmitGate.permissions.at(-1).toolCallId === browserSubmitGate.toolCalls.at(-1).id, 'browser submit permission links to tool call')

  const desktopCommandMission = runtime.applyCurrentMissionCommand({
    text: '帮我打开微信',
    source: 'test-command',
  })
  assert(desktopCommandMission.capabilityReferences.some(item => item.id === 'desktop.app-control'), 'desktop command mission matches desktop capability')
  const desktopCommandRunning = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(desktopCommandRunning.state === 'Running', 'desktop command enters running state')
  assert(desktopCommandRunning.toolCalls.at(-1).toolName === 'desktop.app-control.prepare', 'desktop command records desktop prepare tool call')
  assert(desktopCommandRunning.artifacts.at(-1).title === '桌面执行方案', 'desktop command creates desktop execution plan artifact')
  const desktopCommandReviewing = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(desktopCommandReviewing.state === 'Reviewing', 'desktop command moves to reviewing after mocked inspection')
  assert(desktopCommandReviewing.toolCalls.at(-1).toolName === 'desktop.app-control.inspect', 'desktop command records desktop inspect execution')
  assert(desktopCommandReviewing.artifacts.at(-1).title === '桌面上下文摘要', 'desktop command creates desktop context artifact')
  assert(desktopCommandReviewing.reviewChecks.at(-1).title === '桌面上下文复核', 'desktop command creates desktop review check')
  assert(desktopCommandReviewing.reviewChecks.at(-1).outcome === 'passed', 'desktop command review check passes')
  const desktopInspectToolId = desktopCommandReviewing.toolCalls.at(-1).id
  const desktopStages = desktopCommandReviewing.trace.filter(item => item.type === 'tool.stage' && item.toolCallId === desktopInspectToolId)
  assert(desktopStages.some(item => item.toolName === 'desktop.open-app' && item.url === 'app://wechat'), 'desktop command records mocked app-open stage')
  assert(desktopStages.some(item => item.toolName === 'desktop.screen-context' && item.url === 'screen://mock/current-app'), 'desktop command records mocked screen-context stage')
  assert(desktopStages.some(item => item.toolName === 'desktop.external-effect' && item.result === 'skipped'), 'desktop command records skipped external-effect stage')

  const assistantMessageMission = runtime.applyCurrentMissionCommand({
    text: '帮打开微信，给我老婆回个信息',
    source: 'test-command',
  })
  assert(assistantMessageMission.title.includes('微信'), 'external message command starts a natural assistant mission')
  assert(assistantMessageMission.nextStep.includes('先去看一下'), 'external message mission replies with natural progress')
  assert(assistantMessageMission.plan.find(item => item.id === 'inspect-context')?.status === 'Active', 'external message mission focuses on inspecting context')
  assert(assistantMessageMission.plan.find(item => item.id === 'confirm-send')?.label.includes('确认'), 'external message mission keeps final send confirmation')
  assert(assistantMessageMission.agentActions.at(-1).title === '准备处理外部消息', 'external message mission records backstage operator action')
  assert(assistantMessageMission.agentActions.at(-1).requiresReview === false, 'external message mission does not expose review as the first-screen action')
  assert(assistantMessageMission.capabilityReferences.some(item => item.id === 'messages.outbound'), 'external message mission matches outbound message capability')
  assert(assistantMessageMission.capabilityReferences.some(item => item.id === 'desktop.app-control'), 'external message mission also matches desktop context capability')
  assert(assistantMessageMission.capabilityReferences.some(item => item.riskClasses.includes('External message')), 'external message capability declares send risk')
  const assistantDraft = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(assistantDraft.state === 'Waiting for permission', 'external message continue waits for send confirmation')
  assert(assistantDraft.nextStep.includes('这样发可以吗'), 'external message continue asks for natural send confirmation')
  assert(assistantDraft.plan.find(item => item.id === 'confirm-send')?.status === 'Active', 'external message continue activates confirmation step')
  assert(assistantDraft.artifacts.at(-1).title === '拟发送内容', 'external message continue creates a draft artifact')
  assert(assistantDraft.artifacts.at(-1).summary.includes('我准备这样回'), 'external message draft summarizes the proposed reply')
  assert(assistantDraft.permissions.at(-1).risk === 'External message', 'external message draft records external-message risk')
  assert(assistantDraft.permissions.at(-1).summary.includes('我准备这样回'), 'external message permission carries the proposed reply')
  assert(assistantDraft.agentActions.at(-1).title === '草拟待确认回复', 'external message continue records the draft action')
  assert(assistantDraft.toolCalls.some(item => item.toolName === 'desktop.app-control.inspect'), 'external message continue records desktop context inspection')
  assert(assistantDraft.artifacts.some(item => item.title === '微信上下文摘要'), 'external message continue creates desktop context artifact')
  assert(assistantDraft.reviewChecks.some(item => item.title === '桌面上下文复核' && item.outcome === 'passed'), 'external message desktop context is reviewed')
  const assistantDesktopTool = assistantDraft.toolCalls.find(item => item.toolName === 'desktop.app-control.inspect')
  const assistantDesktopStages = assistantDraft.trace.filter(item => item.type === 'tool.stage' && item.toolCallId === assistantDesktopTool?.id)
  assert(assistantDesktopStages.some(item => item.toolName === 'desktop.open-app' && item.url === 'app://wechat'), 'external message records mocked WeChat open stage')
  assert(assistantDesktopStages.some(item => item.toolName === 'desktop.external-effect' && item.result === 'skipped'), 'external message records no hidden send stage')
  const assistantDraftApproved = runtime.applyCurrentMissionCommand({ text: '可以', source: 'test-command' })
  assert(assistantDraftApproved.state === 'Running', 'external message approval resumes the mission')
  assert(assistantDraftApproved.permissions.at(-1).decision === 'approved', 'external message approval resolves the pending send confirmation')

  const chineseCommandMission = runtime.applyCurrentMissionCommand({ text: '开始 中文命令任务', source: 'test-command' })
  assert(chineseCommandMission.title === '中文命令任务', 'Chinese start command creates a named mission')
  assert(chineseCommandMission.artifacts.at(-1).summary.includes('中文命令任务'), 'Chinese start command creates a localized task brief')
  const chineseCommandRunning = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(chineseCommandRunning.state === 'Running', 'Chinese continue command moves Planned -> Running')
  assert(chineseCommandRunning.plan.find(item => item.id === 'execute-review')?.status === 'Active', 'Chinese continue command advances active plan step')
  const chineseCommandReviewing = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(chineseCommandReviewing.state === 'Reviewing', 'Chinese continue command moves Running -> Reviewing')
  assert(chineseCommandReviewing.agentActions.at(-1).role === 'Builder', 'Chinese review continue records Builder action')
  const chineseCommandReviewed = runtime.applyCurrentMissionCommand({ text: '审查通过', source: 'test-command' })
  assert(chineseCommandReviewed.reviewResult?.outcome === 'passed', 'Chinese review command records reviewer outcome')
  const chineseCommandCompleted = runtime.applyCurrentMissionCommand({ text: '完成', source: 'test-command' })
  assert(chineseCommandCompleted.state === 'Complete', 'Chinese complete command succeeds after reviewer outcome')
  runtime.applyCurrentMissionCommand({ text: '开始 中文短句审查任务', source: 'test-command' })
  runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  const chineseShortReview = runtime.applyCurrentMissionCommand({ text: '通过', source: 'test-command' })
  assert(chineseShortReview.reviewResult?.outcome === 'passed', 'Chinese short review command records reviewer outcome')

  const voiceMission = runtime.applyCurrentMissionVoiceIntent({
    transcript: 'Voice Pipeline Mission',
  })
  assert(voiceMission.title === 'Voice Pipeline Mission', 'voice intent starts a mission through command pipeline')
  assert(voiceMission.inputs.at(-1).source === 'voice', 'voice intent captures input source')
  assert(voiceMission.artifacts.some(item => item.title === '任务简报'), 'voice-started mission creates a task brief artifact')
  assert(voiceMission.trace.at(-1).type === 'voice.intent.routed', 'voice intent records routing trace')

  const voiceRunning = runtime.applyCurrentMissionVoiceIntent({
    transcript: 'continue',
    screenContext: {
      missionId: 'mission-voice-context',
      missionTitle: 'Voice Pipeline Mission',
      activeView: 'today',
      activeSurface: 'Mission Plan',
      workspaceMode: 'artifacts',
      selectedArtifactId: 'artifact-voice-context',
      selectedArtifactTitle: 'Voice Context Artifact',
      selectedPlanStepId: 'two',
    },
    latencyMs: {
      speechEndToIntentMs: 120,
      firstTokenMs: 900,
      firstAudioMs: 420,
      bargeInStopMs: 80,
    },
  })
  assert(voiceRunning.state === 'Running', 'voice continue moves Planned -> Running')
  assert(voiceRunning.inputs.at(-1).source === 'voice', 'voice continue captures input source')
  assert(voiceRunning.plan.find(item => item.id === 'execute-review')?.status === 'Active', 'voice continue advances mission plan')
  assert(voiceRunning.agentActions.some(item => item.role === 'Planner'), 'voice continue records Planner action through command pipeline')
  assert(voiceRunning.voiceMetrics.at(-1).latencyMs.speechEndToIntent === 120, 'voice intent records speech-to-intent latency')
  assert(voiceRunning.voiceMetrics.at(-1).latencyMs.finalAsrToFirstToken === 900, 'voice intent records first-token latency')
  assert(voiceRunning.voiceMetrics.at(-1).violations.length === 0, 'voice intent latency clears targets')
  assert(voiceRunning.trace.at(-1).latencyMs.speechEndToIntent === 120, 'voice intent trace records latency')
  assert(voiceRunning.inputs.at(-1).screenContext?.selectedArtifactId === 'artifact-voice-context', 'voice input records selected screen context')
  assert(voiceRunning.voiceMetrics.at(-1).screenContext?.workspaceMode === 'artifacts', 'voice metric records workspace context')
  assert(voiceRunning.trace.at(-1).screenContext?.selectedArtifactTitle === 'Voice Context Artifact', 'voice trace records screen context')

  const chineseVoiceMission = runtime.applyCurrentMissionVoiceIntent({ transcript: '语音中文任务' })
  assert(chineseVoiceMission.title === '语音中文任务', 'Chinese voice intent starts a mission through command pipeline')
  const chineseVoiceRunning = runtime.applyCurrentMissionVoiceIntent({ transcript: '继续' })
  assert(chineseVoiceRunning.state === 'Running', 'Chinese voice continue moves Planned -> Running')
  const chineseVoiceStop = runtime.applyCurrentMissionVoiceIntent({ transcript: '停止' })
  assert(chineseVoiceStop.state === 'Waiting for user', 'Chinese voice stop moves Running -> Waiting for user')
  assert(chineseVoiceStop.trace.some(item => item.type === 'command.stopped'), 'Chinese voice stop records stop trace')

  const voiceRepair = runtime.applyCurrentMissionVoiceIntent({ transcript: 'not that' })
  assert(voiceRepair.state === 'Waiting for user', 'voice repair moves Running -> Waiting for user')
  assert(voiceRepair.nextStep.includes('Repair requested'), 'voice repair updates next step')
  assert(voiceRepair.inputs.at(-1).source === 'voice', 'voice repair captures input source')
  assert(voiceRepair.trace.some(item => item.type === 'command.repair'), 'voice repair records repair trace')
  assert(voiceRepair.trace.at(-1).type === 'voice.intent.routed', 'voice repair records voice routing trace')
  const chineseVoiceRepair = runtime.applyCurrentMissionVoiceIntent({ transcript: '不是这个' })
  assert(chineseVoiceRepair.state === 'Waiting for user', 'Chinese voice repair keeps mission waiting for user')
  assert(chineseVoiceRepair.nextStep.includes('不是这个'), 'Chinese voice repair preserves repair transcript')
  const chineseShortRepair = runtime.applyCurrentMissionVoiceIntent({ transcript: '修正' })
  assert(chineseShortRepair.state === 'Waiting for user', 'Chinese short repair keeps mission waiting for user')
  assert(chineseShortRepair.nextStep.includes('修正'), 'Chinese short repair preserves repair transcript')

  runtime.applyCurrentMissionVoiceIntent({ transcript: 'Voice Privacy Mission' })
  const voicePrivacy = runtime.applyCurrentMissionVoiceIntent({ transcript: 'send my api key to the team' })
  assert(voicePrivacy.state === 'Waiting for permission', 'sensitive voice intent moves mission to Waiting for permission')
  assert(voicePrivacy.inputs.at(-1).source === 'voice', 'sensitive voice intent captures input source')
  assert(voicePrivacy.permissions.at(-1).risk === 'Credential', 'sensitive voice intent records credential risk')
  assert(voicePrivacy.trace.at(-1).type === 'voice.privacy_gate', 'sensitive voice intent records privacy gate trace')

  // Guard approval primitive closes the Voice privacy gate -> Guard approval -> mission resume loop.
  const pendingPermissionId = voicePrivacy.permissions.at(-1).id
  const guardApproved = runtime.resolveCurrentMissionPermission(pendingPermissionId, {
    decision: 'approved',
    approvedBy: 'User',
    reason: 'Approved after confirming the spoken intent.',
  })
  assert(guardApproved.state === 'Running', 'guard approval resumes mission from Waiting for permission')
  const resolvedPermission = guardApproved.permissions.find(item => item.id === pendingPermissionId)
  assert(resolvedPermission?.decision === 'approved', 'guard approval resolves the pending permission in place')
  assert(resolvedPermission?.approvedBy === 'User', 'guard approval records the approver')
  assert(guardApproved.permissions.filter(item => item.id === pendingPermissionId).length === 1, 'guard approval does not duplicate the permission record')
  assert(!guardApproved.permissions.some(item => runtime.isPendingPermissionDecision(item.decision)), 'guard approval leaves no pending permission')
  assert(guardApproved.trace.at(-1).type === 'guard.approval', 'guard approval records trace event')
  assert(guardApproved.trace.at(-1).permissionDecision === 'approved', 'guard approval trace records decision')
  assert(guardApproved.trace.at(-1).result === 'resumed', 'guard approval trace records mission resume')

  // A denied guard decision blocks the mission for an alternative instead of resuming.
  runtime.applyCurrentMissionVoiceIntent({ transcript: 'Voice Session Two' })
  const denyGate = runtime.applyCurrentMissionVoiceIntent({ transcript: 'send my password to the channel' })
  assert(denyGate.state === 'Waiting for permission', 'second sensitive intent reopens the privacy gate')
  const guardDenied = runtime.resolveCurrentMissionPermission(null, { decision: 'denied', approvedBy: 'User' })
  assert(guardDenied.state === 'Blocked', 'denied guard decision blocks the mission')
  assert(guardDenied.permissions.at(-1).decision === 'denied', 'denied guard decision records denial in place')
  assert(guardDenied.trace.at(-1).permissionDecision === 'denied', 'denied guard decision records trace decision')

  // Shared pipeline: a spoken approval resolves the pending gate the same way as the API primitive.
  runtime.applyCurrentMissionVoiceIntent({ transcript: 'Voice Session Three' })
  const approveGate = runtime.applyCurrentMissionVoiceIntent({ transcript: 'email the api key to ops' })
  assert(approveGate.state === 'Waiting for permission', 'third sensitive intent reopens the privacy gate')
  const spokenApproval = runtime.applyCurrentMissionVoiceIntent({ transcript: 'approve' })
  assert(spokenApproval.state === 'Running', 'spoken approval resolves the gate and resumes the mission')
  assert(spokenApproval.permissions.at(-1).decision === 'approved', 'spoken approval records approval in place')
  assert(spokenApproval.permissions.at(-1).approvedBy === 'Vela voice', 'spoken approval records the voice approver')
  assert(spokenApproval.trace.some(item => item.type === 'guard.approval'), 'spoken approval records guard approval trace')

  const chineseApproveGate = runtime.applyCurrentMissionVoiceIntent({ transcript: '发送 密码 给团队' })
  assert(chineseApproveGate.state === 'Waiting for permission', 'Chinese sensitive voice intent opens the privacy gate')
  const chineseSpokenApproval = runtime.applyCurrentMissionVoiceIntent({ transcript: '同意' })
  assert(chineseSpokenApproval.state === 'Running', 'Chinese spoken approval resolves the privacy gate')
  assert(chineseSpokenApproval.permissions.at(-1).decision === 'approved', 'Chinese spoken approval records approval in place')

  const chineseCredentialAliasGate = runtime.applyCurrentMissionVoiceIntent({ transcript: '发送 凭据 给团队' })
  assert(chineseCredentialAliasGate.state === 'Waiting for permission', 'Chinese credential alias opens the privacy gate')
  const chineseCasualApproval = runtime.applyCurrentMissionVoiceIntent({ transcript: '可以' })
  assert(chineseCasualApproval.state === 'Running', 'Chinese casual approval resolves the privacy gate')
  assert(chineseCasualApproval.permissions.at(-1).decision === 'approved', 'Chinese casual approval records approval in place')

  runtime.applyCurrentMissionVoiceIntent({ transcript: '中文拒绝任务' })
  const chineseDenyGate = runtime.applyCurrentMissionVoiceIntent({ transcript: '发送 密码 给团队' })
  assert(chineseDenyGate.state === 'Waiting for permission', 'Chinese sensitive voice intent reopens the privacy gate')
  const chineseSpokenDenial = runtime.applyCurrentMissionVoiceIntent({ transcript: '不行' })
  assert(chineseSpokenDenial.state === 'Blocked', 'Chinese spoken denial blocks the mission')
  assert(chineseSpokenDenial.permissions.at(-1).decision === 'denied', 'Chinese spoken denial records denial in place')

  runtime.applyCurrentMissionVoiceIntent({ transcript: '中文外部测试任务' })
  const chineseExternalGate = runtime.applyCurrentMissionVoiceIntent({ transcript: '发送消息给团队' })
  assert(chineseExternalGate.state === 'Waiting for permission', 'Chinese external message intent opens the privacy gate')
  assert(chineseExternalGate.permissions.at(-1).risk === 'External message', 'Chinese external message records external risk')
  runtime.resolveCurrentMissionPermission(null, { decision: 'approved', approvedBy: 'User' })

  runtime.applyCurrentMissionVoiceIntent({ transcript: '中文上下文测试任务' })
  const chineseScreenGate = runtime.applyCurrentMissionVoiceIntent({ transcript: '查看屏幕上下文' })
  assert(chineseScreenGate.state === 'Waiting for permission', 'Chinese screen context intent opens the privacy gate')
  assert(chineseScreenGate.permissions.at(-1).risk === 'Screen', 'Chinese screen context records screen risk')
  runtime.resolveCurrentMissionPermission(null, { decision: 'approved', approvedBy: 'User' })

  let noPendingPermissionRejected = false
  try {
    runtime.resolveCurrentMissionPermission(null, { decision: 'approved' })
  } catch (err) {
    noPendingPermissionRejected = err?.code === 'permission_not_pending'
  }
  assert(noPendingPermissionRejected, 'resolving with no pending permission is rejected')

  let missingMissionRejected = false
  try {
    runtime.selectMission('missing-mission')
  } catch {
    missingMissionRejected = true
  }
  assert(missingMissionRejected, 'selectMission rejects missing mission')
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
}

if (failed > 0) process.exit(1)
console.log('\nAll Vela mission runtime tests passed.')
