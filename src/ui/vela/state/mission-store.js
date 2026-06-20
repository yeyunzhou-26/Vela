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
  title: 'Vela',
  goal: '直接告诉 Vela 你想办什么。它会在后台整理任务、调用工具、保留证据，并在发送消息、改文件或高风险动作前自然确认。',
  state: 'Planned',
  permissionMode: 'Assist',
  modelStatus: 'Local runtime',
  activeSurface: 'Mission Plan',
  nextStep: '直接说一件想办的事，例如：帮我打开微信，给我老婆回个信息。',
  plan: [
    { id: 'describe-mission', label: '说出你想办的事', status: 'Active' },
    { id: 'work-backstage', label: 'Vela 在后台处理', status: 'Next' },
    { id: 'confirm-action', label: '关键动作前确认', status: 'Next' },
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
