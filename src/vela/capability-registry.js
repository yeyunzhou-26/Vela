const CAPABILITY_MATCH_LIMIT = 4
const WEB_URL_RE = /https?:\/\/[^\s，。；、）)]+|(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s，。；、）)]*)?/i

function asText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function normalizeForMatch(value) {
  return asText(value).toLowerCase()
}

function hasAny(value, triggers = []) {
  const text = normalizeForMatch(value)
  if (!text) return false
  return triggers.some(trigger => text.includes(normalizeForMatch(trigger)))
}

export const OPEN_CAPABILITY_REGISTRY = [
  {
    id: 'browser.web-agent',
    category: 'browser',
    label: '浏览器代理',
    summary: '打开网页、理解页面、填写表单、提取结构化信息，并在失败时恢复。',
    triggers: ['browser', 'web', 'website', 'url', '网页', '网站', '浏览器', '搜索', '打开网址', '填写表单', '提取'],
    agentRole: 'Operator',
    riskClasses: ['Network', 'Screen', 'Credential'],
    permissionBoundary: '涉及登录态、验证码、提交表单或外部发送前需要确认。',
    openSourceRefs: [
      {
        name: 'browser-use/browser-use',
        url: 'https://github.com/browser-use/browser-use',
        lesson: 'Browser agent action space, recovery loops, custom tools, and task-oriented browser automation.',
        licensePolicy: 'direct-eligible',
      },
      {
        name: 'browserbase/stagehand',
        url: 'https://github.com/browserbase/stagehand',
        lesson: 'Blend code-driven repeatable browser workflows with AI-driven natural-language actions.',
        licensePolicy: 'direct-eligible',
      },
    ],
    integrationStatus: 'planned',
    evaluation: 'Add browser adapter smoke with navigation, extraction, and guarded form submission.',
  },
  {
    id: 'tool.mcp-bridge',
    category: 'tool',
    label: 'MCP 工具桥',
    summary: '把文件、Git、抓取、时间、记忆等成熟工具作为标准化能力接入。',
    triggers: ['mcp', 'tool', '工具', '集成', '接入', '插件', 'github', 'git', '文件系统', '数据库'],
    agentRole: 'Builder',
    riskClasses: ['Read', 'Write', 'Execute', 'Network'],
    permissionBoundary: '未知工具、写入、执行命令、网络访问和凭证使用必须走 Guard。',
    openSourceRefs: [
      {
        name: 'modelcontextprotocol/servers',
        url: 'https://github.com/modelcontextprotocol/servers',
        lesson: 'Reference servers show secure, controlled access to files, git, memory, fetch, and time tools.',
        licensePolicy: 'adapter-only',
      },
    ],
    integrationStatus: 'planned',
    evaluation: 'Add MCP registry eval that verifies risk declaration and trace linkage before execution.',
  },
  {
    id: 'agent.orchestration',
    category: 'agent',
    label: '多 Agent 编排',
    summary: '把复杂任务拆给 Planner、Researcher、Builder、Operator、Reviewer 协作。',
    triggers: ['agent', 'agents', '多agent', '多代理', '自动完成', '全自动', '复杂任务', '长期任务', '计划', '执行', '复核'],
    agentRole: 'Planner',
    riskClasses: ['Read', 'Execute'],
    permissionBoundary: '非平凡任务必须保留计划、证据和 Reviewer 结果；外部效果仍需确认。',
    openSourceRefs: [
      {
        name: 'microsoft/autogen',
        url: 'https://github.com/microsoft/autogen',
        lesson: 'Multi-agent applications, workbench-style tool use, and human collaboration patterns.',
        licensePolicy: 'learn-only',
      },
    ],
    integrationStatus: 'planned',
    evaluation: 'Add mission golden trace for planner-builder-reviewer handoff and recovery.',
  },
  {
    id: 'desktop.app-control',
    category: 'desktop',
    label: '桌面和 App 控制',
    summary: '打开本机应用、读取屏幕上下文、操作窗口，并把外部动作交给用户确认。',
    triggers: ['app', 'desktop', 'window', 'screen', '电脑', '桌面', '屏幕', '窗口', '打开应用', '打开微信', '微信', '设置'],
    agentRole: 'Operator',
    riskClasses: ['Screen', 'Execute', 'Credential'],
    permissionBoundary: '读取屏幕、控制应用、使用登录态或执行系统动作前需要明确边界。',
    openSourceRefs: [
      {
        name: 'Vela local desktop adapters',
        url: 'vela://capabilities/desktop-local',
        lesson: 'Start local-first, then evaluate open-source desktop automation projects behind Screen and Execute guards.',
        licensePolicy: 'internal',
      },
    ],
    integrationStatus: 'adapter-ready',
    evaluation: 'test:vela-mission covers mocked app open, screen context, and no hidden send action.',
  },
  {
    id: 'files.document-work',
    category: 'files',
    label: '文件和文档处理',
    summary: '读取、整理、生成、修改文件和文档，并把产物作为 mission artifact。',
    triggers: ['file', 'document', 'pdf', 'docx', 'excel', 'spreadsheet', 'write file', 'save file', 'create document', '文件', '文档', '表格', '报告', '整理', '生成', '写文件', '保存', '导出', '创建文件', '生成报告'],
    agentRole: 'Builder',
    riskClasses: ['Read', 'Write'],
    permissionBoundary: '读取可在 Plan/Assist 下进行；写入、覆盖、删除必须按模式和范围确认。',
    openSourceRefs: [
      {
        name: 'modelcontextprotocol/filesystem reference',
        url: 'https://github.com/modelcontextprotocol/servers',
        lesson: 'Filesystem access should be scoped by allowed roots and audited as tool use.',
        licensePolicy: 'adapter-only',
      },
    ],
    integrationStatus: 'adapter-ready',
    evaluation: 'test:vela-mission covers document draft artifact generation, review evidence, and guarded disk write requests.',
  },
  {
    id: 'messages.outbound',
    category: 'messaging',
    label: '消息发送',
    summary: '草拟微信、短信、邮件或社交回复，并在真正发送前请求用户确认。',
    triggers: ['send', 'message', 'email', 'reply', 'wechat', 'dm', '发消息', '发信息', '发邮件', '回复', '回个', '微信', '老婆', '妻子', '太太', '媳妇', '老公'],
    agentRole: 'Operator',
    riskClasses: ['External message', 'Screen', 'Credential'],
    permissionBoundary: '所有外部发送必须先展示草稿，并由用户确认后才执行。',
    openSourceRefs: [
      {
        name: 'Vela guarded external-message flow',
        url: 'vela://capabilities/messages/outbound',
        lesson: 'Local message draft and final confirmation are the baseline before real adapters are enabled.',
        licensePolicy: 'internal',
      },
    ],
    integrationStatus: 'adapter-ready',
    evaluation: 'test:vela-mission covers draft creation, External message risk, approval, send receipt, and no hidden pre-approval send.',
  },
  {
    id: 'memory.context-os',
    category: 'memory',
    label: '记忆和上下文',
    summary: '把用户、项目、任务和工具记忆带入任务，同时保留来源和可撤销性。',
    triggers: ['memory', 'remember', 'context', '记忆', '记住', '上下文', '偏好', '项目背景', '资料'],
    agentRole: 'Researcher',
    riskClasses: ['Read'],
    permissionBoundary: '记忆必须显示来源；敏感记忆注入和外传需要单独确认。',
    openSourceRefs: [
      {
        name: 'modelcontextprotocol/memory reference',
        url: 'https://github.com/modelcontextprotocol/servers',
        lesson: 'Knowledge-graph memory can be adapted if provenance and user controls stay visible.',
        licensePolicy: 'adapter-only',
      },
    ],
    integrationStatus: 'planned',
    evaluation: 'eval:vela-memory-recall verifies provenance, relevance, and consuming plan step.',
  },
  {
    id: 'voice.system-entry',
    category: 'voice',
    label: '系统级语音入口',
    summary: '把口语输入、打断、修正和继续都路由到同一个 mission/capability 管线。',
    triggers: ['voice', 'speak', 'listen', '说话', '语音', '听我说', '打断', '修正', '继续'],
    agentRole: 'Planner',
    riskClasses: ['Screen', 'Credential', 'External message'],
    permissionBoundary: '语音可以触发任务，但敏感上下文和外部发送仍需要可见确认。',
    openSourceRefs: [
      {
        name: 'Vela Voice Layer',
        url: 'vela://capabilities/voice/system-entry',
        lesson: 'Voice is an input layer, not a separate behavior path.',
        licensePolicy: 'internal',
      },
    ],
    integrationStatus: 'adapter-ready',
    evaluation: 'eval:vela-voice-latency and test:vela-mission cover voice routing and privacy gates.',
  },
]

export function listOpenCapabilities() {
  return OPEN_CAPABILITY_REGISTRY.map(capability => ({
    ...capability,
    triggers: [...capability.triggers],
    riskClasses: [...capability.riskClasses],
    openSourceRefs: capability.openSourceRefs.map(ref => ({ ...ref })),
  }))
}

export function findOpenCapabilitiesForText(value, options = {}) {
  const text = asText(value)
  const limit = Number.isFinite(Number(options.limit))
    ? Math.max(1, Math.floor(Number(options.limit)))
    : CAPABILITY_MATCH_LIMIT
  const matches = OPEN_CAPABILITY_REGISTRY
    .map(capability => {
      const triggerHits = capability.triggers.filter(trigger => hasAny(text, [trigger]))
      const urlHit = capability.id === 'browser.web-agent' && WEB_URL_RE.test(text)
      const score = triggerHits.length + (urlHit ? 1 : 0)
      return { capability, triggerHits, score }
    })
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.capability.id.localeCompare(right.capability.id))
    .slice(0, limit)

  if (matches.length) return matches.map(toCapabilityReference)

  return [toCapabilityReference({
    capability: OPEN_CAPABILITY_REGISTRY.find(item => item.id === 'agent.orchestration'),
    triggerHits: [],
    score: 0,
    fallback: true,
  })]
}

export function primaryCapabilityForText(value) {
  return findOpenCapabilitiesForText(value, { limit: 1 })[0]
}

function toCapabilityReference(match = {}) {
  const capability = match.capability || {}
  const primarySource = capability.openSourceRefs?.[0] || {}
  const confidence = match.fallback ? 'low' : match.score >= 3 ? 'high' : 'medium'
  return {
    id: capability.id,
    title: capability.label,
    category: capability.category,
    summary: capability.summary,
    agentRole: capability.agentRole,
    riskClasses: [...(capability.riskClasses || [])],
    permissionBoundary: capability.permissionBoundary,
    integrationStatus: capability.integrationStatus,
    source: primarySource.name || 'Vela capability registry',
    provenance: primarySource.url || `vela://capabilities/${capability.id}`,
    licensePolicy: primarySource.licensePolicy || 'internal',
    reason: match.fallback
      ? 'No direct trigger matched; route through general agent orchestration.'
      : `Matched triggers: ${match.triggerHits.join(', ')}`,
    confidence,
    evaluation: capability.evaluation,
  }
}
