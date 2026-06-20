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
  title: '开始一项 Vela 任务',
  goal: '告诉 Vela 你想完成什么，它会把任务整理成目标、计划、证据、权限和复核。',
  state: 'Planned',
  permissionMode: 'Assist',
  modelStatus: 'Local runtime',
  activeSurface: 'Mission Plan',
  nextStep: '在下方输入“开始 + 你的任务”，或者直接说出想完成的事。',
  plan: [
    { id: 'describe-mission', label: '说出你要完成的任务', status: 'Active' },
    { id: 'review-plan', label: '确认 Vela 生成的计划', status: 'Next' },
    { id: 'execute-review', label: '执行、产出并复核', status: 'Next' },
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
