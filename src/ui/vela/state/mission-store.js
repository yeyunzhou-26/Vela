export const voiceStates = [
  'Idle',
  'Listening',
  'Recognizing',
  'Thinking',
  'Speaking',
  'Interrupted',
  'Needs permission',
  'Error',
]

export const seedMission = {
  id: 'mission-vela-shell',
  title: 'Build Vela Shell',
  goal: 'Create the first mission-first Vela workbench while keeping legacy Brain UI available.',
  state: 'Planned',
  permissionMode: 'Assist',
  modelStatus: 'Local runtime',
  activeSurface: 'Mission Plan',
  nextStep: 'Verify the shell opens with the Intelligence Spine collapsed by default.',
  plan: [
    { label: 'Stabilize runtime base', status: 'Done' },
    { label: 'Open focused workbench', status: 'Active' },
    { label: 'Connect mission runtime', status: 'Next' },
  ],
}

export const railEntries = [
  { id: 'today', label: 'Today', mark: '今', active: true },
  { id: 'missions', label: 'Missions', mark: '任' },
  { id: 'agents', label: 'Agents', mark: '智' },
  { id: 'memory', label: 'Memory', mark: '记' },
  { id: 'apps', label: 'Apps', mark: '应' },
]

export const spineEntries = [
  { id: 'context', label: 'Context', mark: '上', status: 'ready', detail: 'Workspace and screen context will attach to the active mission.' },
  { id: 'memory', label: 'Memory', mark: '记', status: 'idle', detail: 'Memory provenance stays inspectable from this layer.' },
  { id: 'tools', label: 'Tools', mark: '工', status: 'ready', detail: 'Tool calls will map to mission steps and permission decisions.' },
  { id: 'guard', label: 'Guard', mark: '守', status: 'watch', detail: 'Assist mode requires approval for edits and external effects.' },
  { id: 'review', label: 'Review', mark: '审', status: 'idle', detail: 'Reviewer outcomes are required before nontrivial completion.' },
]
