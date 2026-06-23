import { seedMission } from './state/mission-store.js'
import { loadMissionSnapshot, recordCurrentMissionReviewCheck, resolveCurrentMissionPermission, selectMission, sendMissionCommand, sendVoiceIntent, updateCurrentMission } from './adapters/mission-api.js'
import { renderCommandBar } from './command-bar.js'
import { renderMissionRail } from './mission-rail.js'
import { renderMissionWorkspace } from './mission-workspace.js'
import { renderMissionSurface } from './mission-surface.js'
import { renderMissionSwitcher } from './mission-switcher.js'
import { renderIntelligenceSpine } from './intelligence-spine.js'
import { renderVoiceLayer } from './voice-layer.js'

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function text(value, fallback = '') {
  const result = String(value ?? '').trim()
  return result || fallback
}

function artifactId(artifact = {}, index = 0) {
  return text(artifact.id || artifact.uri || artifact.path || artifact.title || artifact.name, `artifact-${index + 1}`)
}

function selectedArtifactForContext(mission = {}, selectedArtifactId = '', workspaceMode = 'plan') {
  const artifacts = asArray(mission.artifacts)
  if (!artifacts.length) return null
  const selected = artifacts.find((artifact, index) => artifactId(artifact, index) === selectedArtifactId)
  return selected || (workspaceMode === 'artifacts' ? artifacts[artifacts.length - 1] : null)
}

function activePlanStepForContext(mission = {}) {
  return asArray(mission.plan).find(step => String(step.status || '').toLowerCase() === 'active')
    || asArray(mission.plan).find(step => String(step.status || '').toLowerCase() === 'next')
    || null
}

function buildVoiceContext(state) {
  const mission = state.mission || {}
  const artifact = selectedArtifactForContext(mission, state.selectedArtifactId, state.workspaceMode)
  const planStep = artifact?.planStepId
    ? { id: artifact.planStepId }
    : activePlanStepForContext(mission)
  return {
    missionId: text(mission.id),
    missionTitle: text(mission.title),
    activeView: text(state.activeView),
    activeSurface: text(mission.activeSurface),
    workspaceMode: text(state.workspaceMode, 'plan'),
    selectedArtifactId: artifact ? artifactId(artifact, asArray(mission.artifacts).indexOf(artifact)) : '',
    selectedArtifactTitle: text(artifact?.title || artifact?.name),
    selectedArtifactKind: text(artifact?.kind || artifact?.type),
    selectedPlanStepId: text(planStep?.id),
  }
}

function mountVelaShell(root) {
  const state = {
    activeView: 'today',
    mission: seedMission,
    missions: [seedMission],
    notice: '',
    openSpinePanel: '',
    workspaceMode: 'plan',
    selectedArtifactId: '',
    voiceState: 'Idle',
    voiceNotice: '',
    isSubmittingCommand: false,
  }

  const rerender = () => renderVelaShell(root, state, {
    onSelectView: (view) => {
      state.activeView = view
      state.notice = ''
      rerender()
    },
    onSelectWorkspaceMode: (mode) => {
      state.workspaceMode = mode === 'artifacts' ? 'artifacts' : 'plan'
      state.notice = ''
      rerender()
    },
    onSelectArtifact: (artifactId) => {
      state.selectedArtifactId = artifactId || ''
      state.workspaceMode = 'artifacts'
      state.notice = ''
      rerender()
    },
    onSubmitCommand: async (text) => {
      const command = String(text || '').trim()
      if (!command || state.isSubmittingCommand) return
      try {
        state.isSubmittingCommand = true
        state.notice = ''
        rerender()
        const mission = await sendMissionCommand(command)
        if (!mission) return
        state.mission = mission
        state.activeView = 'today'
        await refreshMissions(state)
      } catch (err) {
        if (err?.mission) {
          state.mission = err.mission
          await refreshMissions(state)
        }
        state.notice = formatMissionErrorNotice(err, 'Unable to send mission command')
      } finally {
        state.isSubmittingCommand = false
        rerender()
      }
    },
    onSelectPermissionMode: async (permissionMode) => {
      const mode = text(permissionMode)
      if (!mode || mode === state.mission?.permissionMode) return
      try {
        state.notice = ''
        const mission = await updateCurrentMission({ permissionMode: mode })
        if (!mission) return
        state.mission = mission
        await refreshMissions(state)
      } catch (err) {
        if (err?.mission) {
          state.mission = err.mission
          await refreshMissions(state)
        }
        state.notice = formatMissionErrorNotice(err, 'Unable to update permission mode')
      }
      rerender()
    },
    onStartListening: () => {
      state.notice = ''
      state.voiceState = 'Listening'
      state.voiceNotice = 'Ready for spoken command'
      rerender()
    },
    onSubmitVoiceIntent: async (text, timing = {}) => {
      try {
        state.notice = ''
        state.voiceNotice = ''
        state.voiceState = 'Recognizing'
        rerender()
        state.voiceState = 'Thinking'
        rerender()
        const intentSubmittedAt = Date.now()
        const mission = await sendVoiceIntent(text, {
          ...timing,
          screenContext: buildVoiceContext(state),
          speechEndedAt: timing.speechEndedAt || intentSubmittedAt,
          intentSubmittedAt,
        })
        if (!mission) {
          state.voiceState = 'Idle'
          rerender()
          return
        }
        state.mission = mission
        state.activeView = 'today'
        state.voiceState = voiceStateForIntent(text, mission)
        state.voiceNotice = mission.state
        await refreshMissions(state)
      } catch (err) {
        if (err?.mission) {
          state.mission = err.mission
          await refreshMissions(state)
        }
        state.voiceState = ['review_required', 'review_blocked'].includes(err?.code) ? 'Needs permission' : 'Error'
        state.voiceNotice = formatMissionErrorNotice(err, 'Unable to send voice intent')
        state.notice = state.voiceNotice
      }
      rerender()
    },
    onSelectMission: async (id) => {
      try {
        state.notice = ''
        const mission = await selectMission(id)
        if (!mission) return
        state.mission = mission
        state.activeView = 'today'
        await refreshMissions(state)
      } catch (err) {
        state.notice = formatMissionErrorNotice(err, 'Unable to select mission')
      }
      rerender()
    },
    onResolveReviewCheck: async (check) => {
      try {
        state.notice = ''
        const mission = await recordCurrentMissionReviewCheck(reviewResolutionPayload(check))
        if (!mission) return
        state.mission = mission
        await refreshMissions(state)
      } catch (err) {
        if (err?.mission) {
          state.mission = err.mission
          await refreshMissions(state)
        }
        state.notice = formatMissionErrorNotice(err, 'Unable to resolve review check')
      }
      rerender()
    },
    onApprovePermission: async (permission) => {
      try {
        state.notice = ''
        const resolvedMission = await resolveCurrentMissionPermission(permissionResolutionPayload(permission))
        if (!resolvedMission) return
        state.mission = resolvedMission
        state.voiceState = 'Idle'
        state.voiceNotice = 'Permission approved'
        await refreshMissions(state)
        state.openSpinePanel = 'guard'
      } catch (err) {
        if (err?.mission) {
          state.mission = err.mission
          await refreshMissions(state)
        }
        state.notice = formatMissionErrorNotice(err, 'Unable to approve permission')
      }
      rerender()
      state.openSpinePanel = ''
    },
    onOpenSpinePanel: (panelId) => {
      state.openSpinePanel = panelId
      rerender()
      state.openSpinePanel = ''
    },
    onRequestReviewCheck: async (check) => {
      try {
        state.notice = ''
        const mission = await recordCurrentMissionReviewCheck(check)
        if (!mission) return
        state.mission = mission
        await refreshMissions(state)
        state.openSpinePanel = 'review'
      } catch (err) {
        if (err?.mission) {
          state.mission = err.mission
          await refreshMissions(state)
        }
        state.notice = formatMissionErrorNotice(err, 'Unable to send review check')
      }
      rerender()
      state.openSpinePanel = ''
    },
  })

  rerender()
  refreshMissions(state).then(rerender)
}

const root = document.getElementById('vela-root')
if (root) mountVelaShell(root)

function voiceStateForIntent(text, mission) {
  const value = String(text || '').trim()
  if (/^(stop|pause|cancel|interrupt|not that|change it to|change that to|停止|暂停|打断|取消|不是这个|改成|改为)/i.test(value)) {
    return 'Interrupted'
  }
  if (mission?.state === 'Waiting for permission') return 'Needs permission'
  return 'Speaking'
}

function formatMissionErrorNotice(err, fallbackMessage) {
  if (err?.code === 'review_blocked') return reviewBlockedNotice(err)
  if (err?.code === 'review_required') {
    return 'Reviewer outcome required before completion. Record the review result in the Review Spine.'
  }
  return err?.message || fallbackMessage
}

function reviewBlockedNotice(err) {
  const blockingCheck = firstBlockingReviewCheck(err?.details?.blockingReviewChecks)
    || firstOpenReviewRecovery(err?.mission?.recoveryActions)
  const title = reviewCheckTitle(blockingCheck)
  if (title) return `Complete blocked: repair review check "${title}" in the Review or Guard Spine.`
  return 'Complete blocked: repair the blocking review check in the Review or Guard Spine.'
}

function firstBlockingReviewCheck(checks) {
  if (!Array.isArray(checks)) return null
  return checks.find(check => /^(failed|blocked)$/i.test(check?.outcome || check?.status || '')) || checks[0] || null
}

function firstOpenReviewRecovery(actions) {
  if (!Array.isArray(actions)) return null
  return [...actions].reverse().find(action => (
    action?.source === 'review_blocked'
      && !/^(done|closed|resolved)$/i.test(action?.status || 'open')
  )) || null
}

function reviewCheckTitle(value) {
  const raw = String(value?.title || value?.summary || value?.reviewCheckKey || value?.key || '').trim()
  return raw.replace(/^Repair review check:\s*/i, '').trim()
}

function reviewResolutionPayload(check = {}) {
  const title = reviewCheckTitle(check) || 'Review check'
  return {
    key: check.key || check.checkKey,
    title,
    outcome: 'passed',
    reviewer: 'Vela Review Spine',
    planStepId: check.planStepId || '',
    toolCallId: check.toolCallId || '',
    artifactId: check.artifactId || '',
    summary: `Resolved blocking review check: ${title}`,
    evidence: ['Resolved from the Review Spine.'],
  }
}

function permissionResolutionPayload(permission = {}, decision = 'approved') {
  const action = String(permission.action || permission.title || 'Permission request').trim()
  const verb = decision === 'denied' ? 'Denied' : 'Approved'
  return {
    id: permission.id || permission.permissionId || '',
    decision,
    reason: `${verb} from Guard Spine: ${action}`,
    approvedBy: 'Vela Guard Spine',
  }
}

async function refreshMissions(state) {
  const snapshot = await loadMissionSnapshot()
  state.mission = snapshot.mission
  state.missions = snapshot.missions
}

function renderVelaShell(root, state, handlers) {
  const shell = document.createElement('div')
  shell.className = 'vela-shell'
  let workspace
  if (state.activeView === 'missions') {
    workspace = renderMissionSwitcher({
      missions: state.missions,
      currentMissionId: state.mission.id,
      onSelectMission: handlers.onSelectMission,
    })
  } else if (['agents', 'memory', 'apps'].includes(state.activeView)) {
    workspace = renderMissionSurface(state.activeView, state.mission, {
      onOpenSpinePanel: handlers.onOpenSpinePanel,
      onRequestReviewCheck: handlers.onRequestReviewCheck,
    })
  } else {
    workspace = renderMissionWorkspace(state.mission, {
      notice: state.notice,
      workspaceMode: state.workspaceMode,
      selectedArtifactId: state.selectedArtifactId,
      onSelectWorkspaceMode: handlers.onSelectWorkspaceMode,
      onSelectArtifact: handlers.onSelectArtifact,
      onRequestArtifactReview: handlers.onRequestReviewCheck,
      onApprovePermission: handlers.onApprovePermission,
      onResolveReviewCheck: handlers.onResolveReviewCheck,
      onOpenSpinePanel: handlers.onOpenSpinePanel,
      onSubmitCommand: handlers.onSubmitCommand,
      isSubmittingCommand: state.isSubmittingCommand,
    })
  }

  shell.append(
    renderCommandBar(state.mission, {
      onSubmitCommand: handlers.onSubmitCommand,
      onSelectPermissionMode: handlers.onSelectPermissionMode,
      isSubmittingCommand: state.isSubmittingCommand,
    }),
    renderMissionRail({
      activeView: state.activeView,
      onSelectView: handlers.onSelectView,
    }),
    workspace,
    renderIntelligenceSpine(state.mission, {
      openPanelId: state.openSpinePanel,
      onResolveReviewCheck: handlers.onResolveReviewCheck,
      onApprovePermission: handlers.onApprovePermission,
    }),
    renderVoiceLayer({
      activeState: state.voiceState,
      notice: state.voiceNotice,
      onStartListening: handlers.onStartListening,
      onSubmitVoiceIntent: handlers.onSubmitVoiceIntent,
    }),
  )
  root.replaceChildren(shell)
}
