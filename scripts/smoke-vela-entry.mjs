import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { chromium } from 'playwright'
import { zh } from '../src/ui/vela/locale.js'
import { assertFocusedWorkbenchScreenshot } from './vela-visual-assertions.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const screenshotRoot = path.join(root, 'output', 'playwright', 'vela')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blm-vela-entry-'))
process.env.BAILONGMA_USER_DIR = tmp
process.env.BAILONGMA_RESOURCES_DIR = root

fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({
  schemaVersion: 1,
  provider: 'custom',
  apiKey: 'none',
  model: 'smoke-model',
  baseURL: 'http://127.0.0.1:9/v1',
}, null, 2), 'utf-8')

const { startAPI } = await import('../src/api.js')
const server = startAPI(0)
if (!server.listening) {
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
}

const port = server.address().port
const base = `http://127.0.0.1:${port}`
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 840 } })

let failed = false
try {
  fs.mkdirSync(screenshotRoot, { recursive: true })
  const velaHead = await fetch(`${base}/vela.html`, { method: 'HEAD' })
  if (velaHead.status !== 200 || !velaHead.headers.get('content-type')?.includes('text/html')) {
    throw new Error(`vela HEAD probe failed: ${velaHead.status} ${velaHead.headers.get('content-type') || ''}`)
  }
  const velaAssetHead = await fetch(`${base}/src/ui/vela/app-shell.js`, { method: 'HEAD' })
  if (velaAssetHead.status !== 200 || !velaAssetHead.headers.get('content-type')?.includes('text/javascript')) {
    throw new Error(`vela asset HEAD probe failed: ${velaAssetHead.status} ${velaAssetHead.headers.get('content-type') || ''}`)
  }

  const created = await fetch(`${base}/vela/missions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Smoke Runtime Mission',
      goal: 'Verify Vela mission persistence reaches the first screen.',
      nextStep: 'Resume this mission from persisted runtime state.',
      plan: [
        { id: 'start', label: 'Start mission runtime', status: 'Done' },
        { id: 'resume', label: 'Resume mission in shell', status: 'Active' },
      ],
    }),
  }).then(res => res.json())
  if (!created?.ok || created?.mission?.title !== 'Smoke Runtime Mission') {
    throw new Error('mission creation API failed')
  }

  const planStep = await fetch(`${base}/vela/mission/plan-steps/resume`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'Done',
      nextStep: 'Resume this mission from persisted runtime state.',
    }),
  }).then(res => res.json())
  if (!planStep?.ok || planStep?.mission?.plan?.find(item => item.id === 'resume')?.status !== 'Done') {
    throw new Error('mission plan-step API failed')
  }
  if (!planStep?.mission?.trace?.some(item => item.type === 'plan.step.updated' && item.planStepId === 'resume')) {
    throw new Error('mission plan-step API did not record trace')
  }

  const voiceIntent = await fetch(`${base}/vela/voice/intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript: '继续',
      screenContext: {
        missionId: 'entry-smoke-mission',
        missionTitle: 'Entry Smoke Mission',
        activeView: 'today',
        activeSurface: 'Mission Plan',
        workspaceMode: 'artifacts',
        selectedArtifactId: 'entry-smoke-artifact',
        selectedArtifactTitle: 'Entry Smoke Artifact',
        selectedPlanStepId: 'resume',
      },
      latencyMs: {
        speechEndToIntentMs: 120,
        firstTokenMs: 880,
        firstAudioMs: 430,
      },
    }),
  }).then(res => res.json())
  if (!voiceIntent?.ok || voiceIntent?.mission?.state !== 'Running') {
    throw new Error('voice intent API did not reuse mission command pipeline')
  }
  if (!voiceIntent?.mission?.inputs?.some(item => item.source === 'voice' && item.text === '继续')) {
    throw new Error('voice intent did not persist a voice-sourced mission input')
  }
  if (!voiceIntent?.mission?.inputs?.some(item => item.screenContext?.selectedArtifactId === 'entry-smoke-artifact')) {
    throw new Error('voice intent did not persist screen context on input')
  }
  if (!voiceIntent?.mission?.trace?.some(item => item.type === 'voice.intent.routed')) {
    throw new Error('voice intent did not record routing trace')
  }
  if (!voiceIntent?.mission?.trace?.some(item => item.type === 'voice.intent.routed' && item.screenContext?.workspaceMode === 'artifacts')) {
    throw new Error('voice intent trace did not preserve workspace context')
  }
  if (!voiceIntent?.mission?.voiceMetrics?.some(item => item.latencyMs?.speechEndToIntent === 120)) {
    throw new Error('voice intent did not record latency metric')
  }
  if (!voiceIntent?.mission?.voiceMetrics?.some(item => item.screenContext?.selectedArtifactTitle === 'Entry Smoke Artifact')) {
    throw new Error('voice intent metric did not preserve selected artifact context')
  }

  const privateVoiceIntent = await fetch(`${base}/vela/voice/intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript: '发送 密码 给团队',
      screenContext: {
        missionId: 'entry-smoke-mission',
        missionTitle: 'Entry Smoke Mission',
        activeView: 'today',
        activeSurface: 'Mission Plan',
        workspaceMode: 'plan',
        selectedPlanStepId: 'resume',
      },
      latencyMs: {
        speechEndToIntentMs: 160,
        bargeInStopMs: 90,
      },
    }),
  }).then(res => res.json())
  if (!privateVoiceIntent?.ok || privateVoiceIntent?.mission?.state !== 'Waiting for permission') {
    throw new Error('private voice intent did not route through permission gate')
  }
  if (!privateVoiceIntent?.mission?.inputs?.some(item => item.source === 'voice' && item.text === '发送 密码 给团队')) {
    throw new Error('private voice intent did not persist Chinese sensitive transcript')
  }
  if (!privateVoiceIntent?.mission?.permissions?.some(item => item.risk === 'Credential')) {
    throw new Error('private voice intent did not record credential risk')
  }
  if (!privateVoiceIntent?.mission?.trace?.some(item => item.type === 'voice.privacy_gate')) {
    throw new Error('private voice intent did not record privacy gate trace')
  }
  if (!privateVoiceIntent?.mission?.trace?.some(item => item.type === 'voice.privacy_gate' && item.screenContext?.selectedPlanStepId === 'resume')) {
    throw new Error('private voice privacy trace did not preserve screen context')
  }
  if (!privateVoiceIntent?.mission?.voiceMetrics?.some(item => item.intentType === 'privacy_gate' && item.latencyMs?.bargeInStop === 90)) {
    throw new Error('private voice intent did not record privacy latency metric')
  }

  // Close the Voice privacy gate -> Guard approval -> mission resume loop through the runtime,
  // resolving the pending request in place rather than silently flipping mission state.
  const pendingVoicePermissionId = privateVoiceIntent?.mission?.permissions?.at(-1)?.id
  const resumedAfterPrivateVoice = await fetch(`${base}/vela/mission/permissions/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: pendingVoicePermissionId,
      decision: 'approved',
      approvedBy: 'Entry Smoke User',
      reason: 'User approved the voice privacy gate after confirming intent.',
    }),
  }).then(res => res.json())
  if (!resumedAfterPrivateVoice?.ok || resumedAfterPrivateVoice?.mission?.state !== 'Running') {
    throw new Error('guard approval did not resume mission after voice privacy gate')
  }
  const resolvedVoicePermission = resumedAfterPrivateVoice?.mission?.permissions?.find(item => item.id === pendingVoicePermissionId)
  if (resolvedVoicePermission?.decision !== 'approved' || resolvedVoicePermission?.approvedBy !== 'Entry Smoke User') {
    throw new Error('guard approval did not resolve the voice privacy permission in place')
  }
  if (resumedAfterPrivateVoice?.mission?.permissions?.some(item => /^(requested|pending|needs approval|waiting)$/i.test(item.decision || ''))) {
    throw new Error('guard approval left a pending permission after voice privacy gate')
  }
  if (!resumedAfterPrivateVoice?.mission?.trace?.some(item => item.type === 'guard.approval' && item.permissionDecision === 'approved')) {
    throw new Error('guard approval did not record a guard.approval trace')
  }

  const inputRecord = await fetch(`${base}/vela/mission/inputs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: 'Persisted smoke input',
      source: 'entry-smoke',
    }),
  }).then(res => res.json())
  if (!inputRecord?.ok || !inputRecord?.mission?.inputs?.some(item => item.text === 'Persisted smoke input')) {
    throw new Error('mission input API failed')
  }

  const artifact = await fetch(`${base}/vela/mission/artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'entry-smoke-artifact',
      title: 'Entry Smoke Artifact',
      kind: 'preview',
      uri: 'vela://entry-smoke-artifact',
      summary: 'Artifact persisted through the Vela mission API.',
      planStepId: 'resume',
    }),
  }).then(res => res.json())
  if (!artifact?.ok || !artifact?.mission?.artifacts?.some(item => item.title === 'Entry Smoke Artifact')) {
    throw new Error('mission artifact API failed')
  }

  const handoffArtifact = await fetch(`${base}/vela/mission/artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'entry-smoke-handoff',
      title: 'Entry Smoke Handoff',
      kind: 'note',
      uri: 'vela://entry-smoke-handoff',
      summary: '第二个产物用于证明任务工作区可以选择持久化输出。',
      planStepId: 'resume',
    }),
  }).then(res => res.json())
  if (!handoffArtifact?.ok || !handoffArtifact?.mission?.artifacts?.some(item => item.title === 'Entry Smoke Handoff')) {
    throw new Error('mission handoff artifact API failed')
  }

  const memoryReference = await fetch(`${base}/vela/mission/memory-references`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Entry Smoke Memory',
      type: 'project',
      source: 'entry-smoke',
      provenance: 'scripts/smoke-vela-entry.mjs',
      query: 'entry smoke memory provenance',
      relevance: '0.94',
      confidence: 'high',
      usedByPlanStepId: 'resume',
      reason: 'Entry smoke needs to prove memory recall metadata reaches the UI.',
      summary: 'Memory provenance persisted through the Vela mission API.',
    }),
  }).then(res => res.json())
  if (!memoryReference?.ok || !memoryReference?.mission?.memoryReferences?.some(item => item.title === 'Entry Smoke Memory')) {
    throw new Error('mission memory-reference API failed')
  }

  const agentAction = await fetch(`${base}/vela/mission/agent-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: 'Builder',
      title: 'Entry smoke builder action',
      status: 'done',
      planStepId: 'resume',
      summary: 'Builder action persisted through the Vela mission API.',
      result: 'passed',
      requiresReview: true,
    }),
  }).then(res => res.json())
  if (!agentAction?.ok || !agentAction?.mission?.agentActions?.some(item => item.title === 'Entry smoke builder action' && item.role === 'Builder')) {
    throw new Error('mission agent-action API failed')
  }

  const toolCall = await fetch(`${base}/vela/mission/tool-calls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      toolName: 'entry.smoke',
      role: 'Builder',
      status: 'ok',
      planStepId: 'resume',
      result: 'Entry smoke wrote mission trace.',
    }),
  }).then(res => res.json())
  if (!toolCall?.ok || !toolCall?.mission?.toolCalls?.some(item => item.toolName === 'entry.smoke' && item.role === 'Builder')) {
    throw new Error('mission tool-call API failed')
  }

  const reviewCheck = await fetch(`${base}/vela/mission/review-checks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Entry smoke review check',
      outcome: 'passed',
      reviewer: 'Entry Smoke Reviewer',
      planStepId: 'resume',
      toolCallId: toolCall.mission.toolCalls.at(-1)?.id,
      summary: 'Reviewer verified entry smoke evidence before outcome.',
      evidence: ['smoke:vela-entry', 'Review Spine renders check evidence.'],
    }),
  }).then(res => res.json())
  if (!reviewCheck?.ok || !reviewCheck?.mission?.reviewChecks?.some(item => item.title === 'Entry smoke review check' && item.outcome === 'passed')) {
    throw new Error('mission review-check API failed')
  }
  if (!reviewCheck?.mission?.trace?.some(item => item.type === 'review.check' && item.reviewOutcome === 'passed')) {
    throw new Error('mission review-check API did not record trace')
  }

  const permission = await fetch(`${base}/vela/mission/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'Approve entry smoke write',
      policy: 'Assist write gate',
      scope: 'vela://entry-smoke-artifact',
      risk: 'Write',
      decision: 'requested',
      reason: 'Entry smoke permission record should surface in Guard.',
      planStepId: 'resume',
      toolCallId: toolCall.mission.toolCalls.at(-1)?.id,
    }),
  }).then(res => res.json())
  if (!permission?.ok || permission?.mission?.state !== 'Waiting for permission') {
    throw new Error('mission permission API failed')
  }

  // Resolve the write permission through Guard approval (keep the original reason so the Guard
  // Spine still renders the persisted request below).
  const resumedAfterPermission = await fetch(`${base}/vela/mission/permissions/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: permission?.mission?.permissions?.at(-1)?.id,
      decision: 'approved',
      approvedBy: 'Entry Smoke User',
    }),
  }).then(res => res.json())
  if (!resumedAfterPermission?.ok || resumedAfterPermission?.mission?.state !== 'Running') {
    throw new Error('guard approval did not resume mission after write permission')
  }
  if (resumedAfterPermission?.mission?.permissions?.at(-1)?.decision !== 'approved') {
    throw new Error('guard approval did not resolve the write permission in place')
  }

  const recovery = await fetch(`${base}/vela/mission/recovery-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Repair entry smoke trace gap',
      summary: 'Entry smoke recovery action should surface in Guard.',
    }),
  }).then(res => res.json())
  if (!recovery?.ok || recovery?.mission?.state !== 'Blocked') {
    throw new Error('mission recovery API failed')
  }

  const recoveryUpdate = await fetch(`${base}/vela/mission/recovery-actions/${encodeURIComponent(recovery.mission.recoveryActions.at(-1).id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'resolved',
      summary: 'Entry smoke recovery action was resolved.',
      nextStep: 'Resume this mission from persisted runtime state.',
    }),
  }).then(res => res.json())
  if (!recoveryUpdate?.ok || recoveryUpdate?.mission?.recoveryActions?.at(-1)?.status !== 'resolved') {
    throw new Error('mission recovery update API failed')
  }
  if (!recoveryUpdate?.mission?.trace?.some(item => item.type === 'recovery.updated')) {
    throw new Error('mission recovery update API did not record trace')
  }

  const resumedAfterRecovery = await fetch(`${base}/vela/mission`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: 'Running',
      nextStep: 'Resume this mission from persisted runtime state.',
    }),
  }).then(res => res.json())
  if (!resumedAfterRecovery?.ok || resumedAfterRecovery?.mission?.state !== 'Running') {
    throw new Error('mission did not resume after recovery')
  }

  const reviewing = await fetch(`${base}/vela/mission`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: 'Reviewing',
      nextStep: 'Resume this mission from persisted runtime state.',
    }),
  }).then(res => res.json())
  if (!reviewing?.ok || reviewing?.mission?.state !== 'Reviewing') {
    throw new Error('mission did not enter review')
  }

  const blockedCompleteResponse = await fetch(`${base}/vela/mission`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'Complete' }),
  })
  const blockedComplete = await blockedCompleteResponse.json()
  if (blockedCompleteResponse.status !== 409 || blockedComplete?.code !== 'review_required') {
    throw new Error('mission completion was not blocked by review gate')
  }

  const review = await fetch(`${base}/vela/mission/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      outcome: 'passed',
      reviewer: 'Entry Smoke Reviewer',
      summary: 'Persisted mission data renders in the Intelligence Spine.',
      evidence: ['Entry smoke review check passed.'],
      failures: [],
    }),
  }).then(res => res.json())
  if (!review?.ok || review?.mission?.reviewResult?.reviewer !== 'Entry Smoke Reviewer') {
    throw new Error('mission review API failed')
  }

  const failedReviewCheck = await fetch(`${base}/vela/mission/review-checks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Entry smoke review check',
      outcome: 'failed',
      reviewer: 'Entry Smoke Reviewer',
      planStepId: 'resume',
      toolCallId: toolCall.mission.toolCalls.at(-1)?.id,
      summary: 'Reviewer found a missing persisted evidence assertion.',
      failures: ['missing persisted evidence assertion'],
    }),
  }).then(res => res.json())
  if (!failedReviewCheck?.ok || !failedReviewCheck?.mission?.reviewChecks?.some(item => item.outcome === 'failed')) {
    throw new Error('mission failed review-check API failed')
  }
  if (!failedReviewCheck?.mission?.recoveryActions?.some(item => item.source === 'review_blocked' && item.status === 'open')) {
    throw new Error('failed review check did not open recovery action')
  }

  const blockedByReviewCheckResponse = await fetch(`${base}/vela/mission`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'Complete' }),
  })
  const blockedByReviewCheck = await blockedByReviewCheckResponse.json()
  if (blockedByReviewCheckResponse.status !== 409 || blockedByReviewCheck?.code !== 'review_blocked') {
    throw new Error('mission completion was not blocked by unresolved review check')
  }
  if (!blockedByReviewCheck?.mission?.recoveryActions?.some(item => item.source === 'review_blocked' && item.status === 'open')) {
    throw new Error('review_blocked response did not return recovery mission')
  }

  const resolvedReviewCheck = await fetch(`${base}/vela/mission/review-checks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Entry smoke review check',
      outcome: 'passed',
      reviewer: 'Entry Smoke Reviewer',
      planStepId: 'resume',
      toolCallId: toolCall.mission.toolCalls.at(-1)?.id,
      summary: 'Reviewer accepted the repaired persisted evidence assertion.',
      evidence: ['persisted evidence assertion repaired'],
    }),
  }).then(res => res.json())
  if (!resolvedReviewCheck?.ok || resolvedReviewCheck?.mission?.reviewChecks?.at(-1)?.outcome !== 'passed') {
    throw new Error('mission resolved review-check API failed')
  }
  if (!resolvedReviewCheck?.mission?.recoveryActions?.some(item => item.source === 'review_blocked' && item.status === 'resolved')) {
    throw new Error('resolved review check did not resolve recovery action')
  }

  const resumedAfterReview = await fetch(`${base}/vela/mission`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: 'Running',
      nextStep: 'Resume this mission from persisted runtime state.',
    }),
  }).then(res => res.json())
  if (!resumedAfterReview?.ok || resumedAfterReview?.mission?.state !== 'Running') {
    throw new Error('mission did not resume after review')
  }

  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.vela-shell', { timeout: 5000 })
  await page.waitForFunction(expected => document.querySelector('.mission-workspace h1')?.textContent?.includes(expected), zh('Smoke Runtime Mission'))
  const rootSnapshot = await page.evaluate(() => ({
    title: document.title,
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    mission: document.querySelector('.mission-workspace h1')?.textContent || '',
    nextStep: document.querySelector('.next-step-strip strong')?.textContent || '',
  }))
  if (!rootSnapshot.title.includes('Vela')) throw new Error('root entry did not serve Vela title')
  if (rootSnapshot.collapsed !== 'true') throw new Error('root entry did not keep Intelligence Spine collapsed')
  if (!rootSnapshot.mission.includes(zh('Smoke Runtime Mission'))) throw new Error('root entry did not show persisted mission')
  if (!rootSnapshot.nextStep.includes(zh('Resume this mission from persisted runtime state.'))) throw new Error('root entry did not show persisted next step')
  await assertFocusedWorkbenchScreenshot(
    page,
    'entry root Vela shell',
    path.join(screenshotRoot, 'vela-entry-root.png'),
    1280,
    840,
  )

  await page.click('.workspace-mode-tab[data-workspace-mode="artifacts"]')
  await page.waitForFunction(() => document.querySelector('.workspace-mode-tab[data-workspace-mode="artifacts"]')?.getAttribute('aria-selected') === 'true')
  const artifactWorkspace = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    title: document.querySelector('.artifact-focus h2')?.textContent || '',
    selected: document.querySelector('.artifact-select[aria-pressed="true"]')?.getAttribute('data-artifact-id') || '',
    text: document.querySelector('.mission-canvas')?.textContent || '',
  }))
  if (artifactWorkspace.collapsed !== 'true') throw new Error('artifact workspace opened with expanded spine')
  if (!artifactWorkspace.title.includes(zh('Entry Smoke Handoff'))) throw new Error(`artifact workspace did not focus latest persisted artifact: ${artifactWorkspace.title}`)
  if (artifactWorkspace.selected !== 'entry-smoke-handoff') throw new Error(`artifact workspace did not mark latest persisted artifact selected: ${artifactWorkspace.selected}`)
  if (!artifactWorkspace.text.includes('第二个产物用于证明任务工作区可以选择持久化输出。')) {
    throw new Error(`artifact workspace did not render persisted artifact summary: ${artifactWorkspace.text}`)
  }
  if (!artifactWorkspace.text.includes(`${zh('Resume mission in shell')} (resume)`)) {
    throw new Error(`artifact workspace did not render persisted artifact plan step: ${artifactWorkspace.text}`)
  }
  await assertFocusedWorkbenchScreenshot(
    page,
    'entry artifact workspace Vela shell',
    path.join(screenshotRoot, 'vela-entry-artifacts.png'),
    1280,
    840,
  )
  await page.click('.artifact-select[data-artifact-id="entry-smoke-artifact"]')
  await page.waitForFunction(expected => document.querySelector('.artifact-focus h2')?.textContent?.includes(expected), zh('Entry Smoke Artifact'))
  const selectedArtifactWorkspace = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    title: document.querySelector('.artifact-focus h2')?.textContent || '',
    selected: document.querySelector('.artifact-select[aria-pressed="true"]')?.getAttribute('data-artifact-id') || '',
    text: document.querySelector('.mission-canvas')?.textContent || '',
  }))
  if (selectedArtifactWorkspace.collapsed !== 'true') throw new Error('selecting persisted artifact expanded the spine')
  if (selectedArtifactWorkspace.selected !== 'entry-smoke-artifact') throw new Error(`persisted artifact selection did not mark selected item: ${selectedArtifactWorkspace.selected}`)
  if (!selectedArtifactWorkspace.text.includes(zh('Artifact persisted through the Vela mission API.'))) {
    throw new Error(`selected persisted artifact summary missing: ${selectedArtifactWorkspace.text}`)
  }
  if (!selectedArtifactWorkspace.text.includes(`${zh('Resume mission in shell')} (resume)`)) {
    throw new Error(`selected persisted artifact plan step missing: ${selectedArtifactWorkspace.text}`)
  }
  await page.click('.workspace-mode-tab[data-workspace-mode="plan"]')
  await page.waitForFunction(() => document.querySelector('.workspace-mode-tab[data-workspace-mode="plan"]')?.getAttribute('aria-selected') === 'true')

  await page.click('.spine-tab[data-id="context"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'false')
  const contextText = await page.locator('#spine-panel').textContent() || ''
  if (!contextText.includes('当前活动上下文') || contextText.includes('Active context for')) {
    throw new Error(`context spine summary was not localized: ${contextText}`)
  }
  if (!contextText.includes(zh('Persisted smoke input'))) throw new Error('context spine did not render persisted input')
  if (!contextText.includes(zh('Entry Smoke Handoff'))) throw new Error('context spine did not render latest persisted artifact')
  if (!contextText.includes(zh('Audit chain')) || !contextText.includes('REV') || !contextText.includes(`${zh('Review result')}: ${zh('passed')}`)) {
    throw new Error(`context spine did not render persisted audit chain: ${contextText}`)
  }
  if (!contextText.includes(zh('Voice metrics'))) throw new Error('context spine did not render voice metrics')
  if (!contextText.includes('160 ms')) throw new Error('context spine did not render latest voice latency')

  await page.click('.spine-tab[data-id="memory"]')
  const memoryText = await page.locator('#spine-panel').textContent() || ''
  if (!memoryText.includes(zh('Entry Smoke Memory'))) throw new Error('memory spine did not render persisted memory reference')
  if (!memoryText.includes('entry-smoke')) throw new Error('memory spine did not render memory source')
  if (!memoryText.includes('scripts/smoke-vela-entry.mjs')) throw new Error('memory spine did not render memory provenance')
  if (!memoryText.includes(zh('entry smoke memory provenance'))) throw new Error('memory spine did not render memory query')
  if (!memoryText.includes('0.94')) throw new Error('memory spine did not render memory relevance')
  if (!memoryText.includes('resume')) throw new Error('memory spine did not render memory plan step')

  await page.click('.spine-tab[data-id="tools"]')
  const toolsText = await page.locator('#spine-panel').textContent() || ''
  if (!toolsText.includes(zh('Entry smoke builder action'))) throw new Error('tools spine did not render persisted agent action')
  if (!toolsText.includes('entry.smoke')) throw new Error('tools spine did not render persisted tool call')
  if (!toolsText.includes(zh('Builder'))) throw new Error('tools spine did not render persisted agent role')
  if (!toolsText.includes('resume')) throw new Error('tools spine did not render plan step linkage')

  await page.click('.spine-tab[data-id="guard"]')
  const guardText = await page.locator('#spine-panel').textContent() || ''
  if (!guardText.includes(zh('Approve entry smoke write'))) throw new Error('guard spine did not render persisted permission action')
  if (!guardText.includes(zh('Assist write gate'))) throw new Error('guard spine did not render persisted guard policy')
  if (!guardText.includes('vela://entry-smoke-artifact')) throw new Error('guard spine did not render persisted permission scope')
  if (!guardText.includes(zh('Write'))) throw new Error('guard spine did not render persisted risk class')
  if (!guardText.includes(zh('Entry smoke permission record should surface in Guard.'))) throw new Error('guard spine did not render persisted permission reason')
  if (!guardText.includes('resume')) throw new Error('guard spine did not render persisted permission plan step')
  if (!guardText.includes(zh('Repair review check: Entry smoke review check'))) throw new Error('guard spine did not render review recovery action')
  if (!guardText.includes(zh('resolved'))) throw new Error('guard spine did not render resolved review recovery status')
  if (!guardText.includes(zh('missing persisted evidence assertion'))) throw new Error('guard spine did not render review recovery failure')

  await page.click('.spine-tab[data-id="review"]')
  const reviewText = await page.locator('#spine-panel').textContent() || ''
  if (!reviewText.includes(zh('Entry Smoke Reviewer'))) throw new Error('review spine did not render persisted reviewer')
  if (!reviewText.includes(zh('Persisted mission data renders in the Intelligence Spine.'))) throw new Error('review spine did not render persisted summary')
  if (!reviewText.includes(zh('Entry smoke review check'))) throw new Error('review spine did not render persisted review check')
  if (!reviewText.includes(zh('persisted evidence assertion repaired'))) throw new Error('review spine did not render persisted review evidence')

  const visualPermission = await fetch(`${base}/vela/mission/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'Entry visual approval gate',
      policy: 'Entry visual permission gate',
      scope: 'vela://entry-visual',
      risk: 'Write',
      decision: 'requested',
      reason: 'Visual regression should capture the entry permission attention strip.',
      planStepId: 'resume',
    }),
  }).then(res => res.json())
  if (!visualPermission?.ok || visualPermission?.mission?.state !== 'Waiting for permission') {
    throw new Error('entry visual permission state failed')
  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(expected => document.querySelector('.state-chip')?.textContent?.includes(expected), zh('Waiting for permission'))
  if ((await page.locator('.mission-attention-strip').textContent() || '').includes(zh('Entry visual permission gate')) === false) {
    throw new Error('entry visual permission attention did not render')
  }
  await assertFocusedWorkbenchScreenshot(
    page,
    'entry permission Vela shell',
    path.join(screenshotRoot, 'vela-entry-permission.png'),
    1280,
    840,
  )
  const resolvedVisualPermission = await fetch(`${base}/vela/mission/permissions/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: visualPermission?.mission?.permissions?.at(-1)?.id,
      decision: 'approved',
      approvedBy: 'Entry Visual Smoke',
    }),
  }).then(res => res.json())
  if (!resolvedVisualPermission?.ok || resolvedVisualPermission?.mission?.state !== 'Running') {
    throw new Error('entry visual permission did not resolve')
  }

  const visualReviewBlocker = await fetch(`${base}/vela/mission/review-checks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key: 'entry-visual-review',
      title: 'Entry visual review blocker',
      outcome: 'failed',
      reviewer: 'Entry Visual Reviewer',
      planStepId: 'resume',
      summary: 'Visual regression should capture the review blocker attention strip.',
      failures: ['entry visual blocker evidence'],
    }),
  }).then(res => res.json())
  if (!visualReviewBlocker?.ok || !visualReviewBlocker?.mission?.reviewChecks?.some(item => item.key === 'entry-visual-review' && item.outcome === 'failed')) {
    throw new Error('entry visual review blocker failed')
  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(expected => document.querySelector('.mission-attention-strip')?.textContent?.includes(expected), zh('Entry visual review blocker'))
  await assertFocusedWorkbenchScreenshot(
    page,
    'entry review blocker Vela shell',
    path.join(screenshotRoot, 'vela-entry-review-blocker.png'),
    1280,
    840,
  )
  const resolvedVisualReviewBlocker = await fetch(`${base}/vela/mission/review-checks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key: 'entry-visual-review',
      title: 'Entry visual review blocker',
      outcome: 'passed',
      reviewer: 'Entry Visual Reviewer',
      planStepId: 'resume',
      summary: 'Visual regression accepted the review blocker state.',
      evidence: ['entry visual blocker resolved'],
    }),
  }).then(res => res.json())
  if (!resolvedVisualReviewBlocker?.ok || !resolvedVisualReviewBlocker?.mission?.reviewChecks?.some(item => item.key === 'entry-visual-review' && item.outcome === 'passed')) {
    throw new Error('entry visual review blocker did not resolve')
  }

  const visualPlanMode = await fetch(`${base}/vela/mission`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      permissionMode: 'Plan',
      nextStep: 'Entry visual policy gate is ready.',
    }),
  }).then(res => res.json())
  if (!visualPlanMode?.ok || visualPlanMode?.mission?.permissionMode !== 'Plan') {
    throw new Error('entry visual Plan mode patch failed')
  }
  const visualPolicyBlock = await fetch(`${base}/vela/mission/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'Entry visual execute mutation',
      policy: 'Entry visual policy gate',
      scope: 'workspace',
      risk: 'Execute',
      decision: 'requested',
      reason: 'Visual regression should capture policy-blocked attention.',
      planStepId: 'resume',
    }),
  }).then(res => res.json())
  if (!visualPolicyBlock?.ok || visualPolicyBlock?.mission?.state !== 'Blocked') {
    throw new Error('entry visual policy block failed')
  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(expected => document.querySelector('.state-chip')?.textContent?.includes(expected), zh('Blocked'))
  if ((await page.locator('.mission-attention-strip').textContent() || '').includes(zh('Permission blocked')) === false) {
    throw new Error('entry visual policy block attention did not render')
  }
  await assertFocusedWorkbenchScreenshot(
    page,
    'entry policy blocked Vela shell',
    path.join(screenshotRoot, 'vela-entry-policy-blocked.png'),
    1280,
    840,
  )
  const visualPolicyResume = await fetch(`${base}/vela/mission`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: 'Running',
      permissionMode: 'Assist',
      nextStep: 'Resume this mission from persisted runtime state.',
    }),
  }).then(res => res.json())
  if (!visualPolicyResume?.ok || visualPolicyResume?.mission?.state !== 'Running' || visualPolicyResume?.mission?.permissionMode !== 'Assist') {
    throw new Error('entry visual policy block did not resume')
  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(expected => document.querySelector('.state-chip')?.textContent?.includes(expected), zh('Running'))

  const updated = await fetch(`${base}/vela/mission`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'Running', nextStep: 'Mission runtime is now running.' }),
  }).then(res => res.json())
  if (!updated?.ok || updated?.mission?.state !== 'Running') {
    throw new Error('mission patch API failed')
  }

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(expected => document.querySelector('.state-chip')?.textContent?.includes(expected), zh('Running'))

  await page.fill('.mission-input input', 'UI Created Mission')
  await page.click('.mission-input button')
  await page.waitForFunction(() => document.querySelector('.mission-workspace h1')?.textContent?.includes('UI Created Mission'))
  await page.click('.rail-item[data-id="missions"]')
  await page.waitForFunction(expected => document.querySelector('.mission-switcher h1')?.textContent?.includes(expected), zh('Missions'))
  const switcherSnapshot = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    count: document.querySelectorAll('.mission-list-item').length,
    active: document.querySelector('.mission-list-item.active strong')?.textContent || '',
  }))
  if (switcherSnapshot.collapsed !== 'true') throw new Error('mission switcher opened with expanded spine')
  if (switcherSnapshot.count < 2) throw new Error('mission switcher did not list persisted missions')
  if (!switcherSnapshot.active.includes('UI Created Mission')) throw new Error('mission switcher did not mark UI-created mission active')
  await page.getByRole('button', { name: new RegExp(zh('Smoke Runtime Mission')) }).click()
  await page.waitForFunction(expected => document.querySelector('.mission-workspace h1')?.textContent?.includes(expected), zh('Smoke Runtime Mission'))

  const legacyRoot = await fetch(`${base}/?shell=brain`).then(res => res.text())
  if (!legacyRoot.includes('Longma') || !legacyRoot.includes('/src/ui/brain-ui/app.js')) {
    throw new Error('legacy root flag did not serve the Brain UI shell')
  }

  const legacyBrainUi = await fetch(`${base}/brain-ui`).then(res => res.text())
  if (!legacyBrainUi.includes('Longma') || !legacyBrainUi.includes('/src/ui/brain-ui/app.js')) {
    throw new Error('/brain-ui fallback did not remain available')
  }

  console.log('[PASS] vela entry smoke')
} catch (err) {
  failed = true
  console.error(`[FAIL] vela entry smoke\n${err?.stack || err?.message || String(err)}`)
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  process.exit(failed ? 1 : 0)
}
