function asText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : []
}

function activePlanStepId(plan = [], fallback = 'execute-review') {
  return asText(normalizeArray(plan).find(step => step?.status === 'Active')?.id, fallback)
}

function missionText(mission = {}, input = {}) {
  return [
    mission.title,
    mission.goal,
    input.text,
    input.command,
    input.content,
    ...normalizeArray(mission.inputs).map(item => item?.text),
  ].map(value => asText(value)).filter(Boolean).join(' ')
}

function makeAdapterToolId(capabilityId = 'capability') {
  return `tool-${capabilityId.replace(/[^a-z0-9]+/gi, '-')}-${Date.now()}`
}

function makeAdapterResultId(capabilityId = 'capability') {
  return `artifact-${capabilityId.replace(/[^a-z0-9]+/gi, '-')}-result-${Date.now()}`
}

function capabilityById(mission = {}, id = '') {
  return normalizeArray(mission.capabilityReferences).find(item => item?.id === id) || null
}

function primaryBrowserCapability(mission = {}) {
  return capabilityById(mission, 'browser.web-agent')
}

function primaryDesktopCapability(mission = {}) {
  return capabilityById(mission, 'desktop.app-control')
}

function primaryFilesCapability(mission = {}) {
  return capabilityById(mission, 'files.document-work')
}

function primaryMemoryCapability(mission = {}) {
  return capabilityById(mission, 'memory.context-os')
}

function latestBrowserPrepareTool(mission = {}) {
  return [...normalizeArray(mission.toolCalls)]
    .reverse()
    .find(tool => (
      tool?.toolName === 'browser.web-agent.prepare'
        && tool?.status === 'prepared'
    )) || null
}

function hasBrowserResultForPrepare(mission = {}, prepareToolId = '') {
  const marker = asText(prepareToolId)
  if (!marker) return false
  return normalizeArray(mission.artifacts).some(artifact => (
    asText(artifact.uri).includes(`/results/${marker}`)
  ))
}

function shouldExecuteBrowserAdapter(mission = {}) {
  const capability = primaryBrowserCapability(mission)
  if (capability?.id !== 'browser.web-agent') return false
  const prepareTool = latestBrowserPrepareTool(mission)
  return !!prepareTool && !hasBrowserResultForPrepare(mission, prepareTool.id)
}

function latestDesktopPrepareTool(mission = {}) {
  return [...normalizeArray(mission.toolCalls)]
    .reverse()
    .find(tool => (
      tool?.toolName === 'desktop.app-control.prepare'
        && tool?.status === 'prepared'
    )) || null
}

function hasDesktopResultForPrepare(mission = {}, prepareToolId = '') {
  const marker = asText(prepareToolId)
  if (!marker) return false
  return normalizeArray(mission.artifacts).some(artifact => (
    asText(artifact.uri).includes(`/results/${marker}`)
  ))
}

function latestFilesPrepareTool(mission = {}) {
  return [...normalizeArray(mission.toolCalls)]
    .reverse()
    .find(tool => (
      tool?.toolName === 'files.document-work.prepare'
        && tool?.status === 'prepared'
    )) || null
}

function hasFilesResultForPrepare(mission = {}, prepareToolId = '') {
  const marker = asText(prepareToolId)
  if (!marker) return false
  return normalizeArray(mission.artifacts).some(artifact => (
    asText(artifact.uri).includes(`/results/${marker}`)
  ))
}

function latestMemoryPrepareTool(mission = {}) {
  return [...normalizeArray(mission.toolCalls)]
    .reverse()
    .find(tool => (
      tool?.toolName === 'memory.context-os.prepare'
        && tool?.status === 'prepared'
    )) || null
}

function hasMemoryResultForPrepare(mission = {}, prepareToolId = '') {
  const marker = asText(prepareToolId)
  if (!marker) return false
  return normalizeArray(mission.artifacts).some(artifact => (
    asText(artifact.uri).includes(`/results/${marker}`)
  )) || normalizeArray(mission.memoryReferences).some(reference => (
    asText(reference.provenance || reference.uri).includes(`/results/${marker}`)
  ))
}

function browserRiskForMission(mission = {}, input = {}) {
  const text = missionText(mission, input)
  if (/(?:密码|密钥|凭证|验证码|登录|login|password|credential|captcha|otp)/i.test(text)) {
    return {
      risk: 'Credential',
      reason: '浏览器任务可能涉及登录态、验证码或敏感凭据。',
    }
  }
  if (/(?:提交|购买|支付|下单|发送|发布|submit|purchase|pay|checkout|send|post)/i.test(text)) {
    return {
      risk: 'Network',
      reason: '浏览器任务可能提交表单、发送数据或产生外部网络效果。',
    }
  }
  return null
}

function fileWriteRiskForMission(mission = {}, input = {}) {
  const text = missionText(mission, input)
  if (/(?:删除|移除|清空|覆盖|overwrite|delete|remove|trash)/i.test(text)) {
    return {
      risk: 'Write',
      reason: '文件任务可能删除、覆盖或清空本地内容。',
    }
  }
  if (/(?:保存|写入|写到|存到|导出|创建文件|写文件|改文件|修改文件|save\s+to|write\s+to|write file|save file|export\s+to)/i.test(text)) {
    return {
      risk: 'Write',
      reason: '文件任务可能写入或修改本地文件。',
    }
  }
  return null
}

function planBrowserAdapterRun(mission = {}, input = {}) {
  const capability = primaryBrowserCapability(mission)
  if (capability?.id !== 'browser.web-agent') return null

  const planStepId = activePlanStepId(mission.plan)
  const toolCallId = makeAdapterToolId(capability.id)
  const guardedRisk = browserRiskForMission(mission, input)
  const summary = guardedRisk
    ? '浏览器代理已识别到需要确认的网页动作，等待用户批准后再继续。'
    : '浏览器代理已准备好读取网页、搜索资料、提取重点并形成摘要；不会提交表单或发送外部信息。'
  const run = {
    capability,
    toolCall: {
      id: toolCallId,
      toolName: 'browser.web-agent.prepare',
      role: 'Operator',
      status: guardedRisk ? 'needs-permission' : 'prepared',
      planStepId,
      risk: guardedRisk?.risk || 'Read',
      result: summary,
    },
    artifact: {
      title: '浏览器执行方案',
      kind: 'plan',
      uri: `vela://capabilities/browser.web-agent/runs/${toolCallId}`,
      summary,
      planStepId,
    },
    nextStep: guardedRisk
      ? '浏览器代理需要你确认后，才会继续执行可能影响外部网页的动作。'
      : '浏览器代理已准备好执行读取和总结类网页任务；继续后进入结果复核。',
  }

  if (guardedRisk) {
    run.permission = {
      action: `确认浏览器代理执行：${asText(mission.title || mission.goal, '当前网页任务')}`,
      risk: guardedRisk.risk,
      decision: 'requested',
      summary,
      reason: guardedRisk.reason,
      requestedBy: 'Vela Browser Adapter',
      planStepId,
      toolCallId,
      scope: asText(capability.provenance, 'vela://capabilities/browser.web-agent'),
    }
  }

  return run
}

function desktopTarget(mission = {}, input = {}) {
  const text = missionText(mission, input)
  if (/(?:微信|wechat)/i.test(text)) {
    return { appId: 'wechat', appName: '微信', appUrl: 'app://wechat' }
  }
  if (/(?:设置|settings|system settings)/i.test(text)) {
    return { appId: 'settings', appName: '系统设置', appUrl: 'app://system-settings' }
  }
  return { appId: 'desktop-app', appName: '目标应用', appUrl: 'app://target' }
}

function planDesktopAdapterRun(mission = {}, input = {}) {
  const capability = primaryDesktopCapability(mission)
  if (capability?.id !== 'desktop.app-control') return null

  const planStepId = activePlanStepId(mission.plan, 'inspect-context')
  const toolCallId = makeAdapterToolId(capability.id)
  const target = desktopTarget(mission, input)
  const summary = `桌面代理已准备好处理「${target.appName}」相关任务。当前原型只记录模拟打开应用和模拟读取上下文，不会真的打开应用、截图、读取真实屏幕或发送消息；接入真实桌面控制前必须经过 Screen/Execute Guard。`
  return {
    capability,
    toolCall: {
      id: toolCallId,
      toolName: 'desktop.app-control.prepare',
      role: 'Operator',
      status: 'prepared',
      planStepId,
      risk: 'Screen',
      result: summary,
    },
    artifact: {
      title: '桌面执行方案',
      kind: 'plan',
      uri: `vela://capabilities/desktop.app-control/runs/${toolCallId}`,
      summary,
      planStepId,
    },
    nextStep: '桌面代理已完成安全预检；继续后会生成模拟上下文证据，真实 App 操作仍需单独确认。',
  }
}

function documentKindForMission(mission = {}, input = {}) {
  const text = missionText(mission, input)
  if (/(?:表格|excel|spreadsheet|csv|xlsx)/i.test(text)) return 'spreadsheet-draft'
  if (/(?:pdf)/i.test(text)) return 'pdf-draft'
  return 'document-draft'
}

function documentTitleForMission(mission = {}, input = {}) {
  const text = missionText(mission, input)
  if (/(?:表格|excel|spreadsheet|csv|xlsx)/i.test(text)) return '表格草稿'
  if (/(?:pdf)/i.test(text)) return 'PDF 草稿'
  if (/(?:报告|report)/i.test(text)) return '报告草稿'
  return '文档草稿'
}

function planFilesAdapterRun(mission = {}, input = {}) {
  const capability = primaryFilesCapability(mission)
  if (capability?.id !== 'files.document-work') return null

  const planStepId = activePlanStepId(mission.plan)
  const toolCallId = makeAdapterToolId(capability.id)
  const guardedRisk = fileWriteRiskForMission(mission, input)
  const title = documentTitleForMission(mission, input)
  const summary = guardedRisk
    ? `文件文档代理已识别到真实磁盘写入风险，会先准备「${title}」但不会写入、覆盖或删除本地文件，等待 Guard 确认。`
    : `文件文档代理已准备生成「${title}」作为 Vela 任务产物；当前只创建内部 artifact，不写入、覆盖或删除本地文件。`
  const run = {
    capability,
    toolCall: {
      id: toolCallId,
      toolName: 'files.document-work.prepare',
      role: 'Builder',
      status: guardedRisk ? 'needs-permission' : 'prepared',
      planStepId,
      risk: guardedRisk?.risk || 'Read',
      result: summary,
    },
    artifact: {
      title: '文件产物方案',
      kind: 'plan',
      uri: `vela://capabilities/files.document-work/runs/${toolCallId}`,
      summary,
      planStepId,
    },
    nextStep: guardedRisk
      ? '文件文档代理需要你确认写入范围后，才会继续涉及本地文件的动作。'
      : '文件文档代理已准备好生成内部文档产物；继续后进入产物复核。',
  }

  if (guardedRisk) {
    run.permission = {
      action: `确认文件文档代理执行：${asText(mission.title || mission.goal, '当前文件任务')}`,
      risk: guardedRisk.risk,
      decision: 'requested',
      summary,
      reason: guardedRisk.reason,
      requestedBy: 'Vela File Adapter',
      planStepId,
      toolCallId,
      scope: asText(capability.provenance, 'vela://capabilities/files.document-work'),
    }
  }

  return run
}

function memoryQueryForMission(mission = {}, input = {}) {
  const text = missionText(mission, input)
    .replace(/^(?:请|帮我|帮|你|vela)\s*/i, '')
    .replace(/(?:记住|记一下|记得|查找|查一下|回忆|召回|使用|根据|我的|一下)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text || asText(mission.goal || mission.title || input.text, '当前任务上下文')
}

function memoryReferenceTypeForMission(mission = {}, input = {}) {
  const text = missionText(mission, input)
  if (/(?:偏好|preference|喜欢|不喜欢|习惯)/i.test(text)) return 'user'
  if (/(?:项目|repo|repository|代码库|工程|背景)/i.test(text)) return 'project'
  if (/(?:工具|tool|adapter|能力)/i.test(text)) return 'tool'
  return 'mission'
}

function memoryTitleForMission(mission = {}, input = {}) {
  const type = memoryReferenceTypeForMission(mission, input)
  if (type === 'user') return '用户偏好上下文'
  if (type === 'project') return '项目背景上下文'
  if (type === 'tool') return '工具使用上下文'
  return '任务上下文记忆'
}

function planMemoryAdapterRun(mission = {}, input = {}) {
  const capability = primaryMemoryCapability(mission)
  if (capability?.id !== 'memory.context-os') return null

  const planStepId = activePlanStepId(mission.plan)
  const toolCallId = makeAdapterToolId(capability.id)
  const query = memoryQueryForMission(mission, input)
  const summary = `记忆代理已准备围绕「${query}」带入可追溯上下文；当前只关联 mission memory reference，不会偷偷写入长期记忆或外传敏感内容。`
  return {
    capability,
    toolCall: {
      id: toolCallId,
      toolName: 'memory.context-os.prepare',
      role: 'Researcher',
      status: 'prepared',
      planStepId,
      risk: 'Read',
      result: summary,
    },
    artifact: {
      title: '记忆召回方案',
      kind: 'plan',
      uri: `vela://capabilities/memory.context-os/runs/${toolCallId}`,
      summary,
      planStepId,
    },
    nextStep: '记忆代理已准备好关联可检查来源；继续后会把上下文引用挂到当前任务。',
  }
}

export function planCapabilityAdapterRun(mission = {}, input = {}) {
  return planBrowserAdapterRun(mission, input)
    || planDesktopAdapterRun(mission, input)
    || planFilesAdapterRun(mission, input)
    || planMemoryAdapterRun(mission, input)
}

function browserExecutionSummary(mission = {}) {
  const goal = asText(mission.goal || mission.title, '当前网页任务')
  return `已围绕「${goal}」完成浏览器读取执行闭环：确认检索意图、提取目标和安全边界，形成可复核摘要；当前结果不包含外部发送、表单提交或登录凭据操作。`
}

function normalizeBrowserReadResult(value) {
  if (!value || typeof value !== 'object') return null
  if (value.kind !== 'browser-read-result') return null
  return {
    ...value,
    ok: value.ok !== false,
    summary: asText(value.summary),
    evidence: normalizeArray(value.evidence).map(item => asText(item)).filter(Boolean),
    sourceTools: normalizeArray(value.sourceTools).map(item => asText(item)).filter(Boolean),
    failures: normalizeArray(value.failures),
    pages: normalizeArray(value.pages),
    stages: normalizeArray(value.stages).map(normalizeBrowserStage),
    urls: normalizeArray(value.urls).map(item => asText(item)).filter(Boolean),
  }
}

function normalizeBrowserStage(stage = {}, index = 0) {
  const tool = asText(stage.tool || stage.toolName, 'browser')
  const status = asText(stage.status || stage.result, stage.ok === false ? 'failed' : 'ok')
  return {
    id: asText(stage.id, `browser-stage-${index + 1}`),
    tool,
    status,
    url: asText(stage.url || stage.final_url || stage.href, ''),
    summary: asText(stage.summary || stage.detail || stage.reason || stage.error, ''),
    reason: asText(stage.reason || stage.error, ''),
  }
}

function executeBrowserAdapterRun(mission = {}, input = {}) {
  const capability = primaryBrowserCapability(mission)
  if (capability?.id !== 'browser.web-agent') return null

  const prepareTool = latestBrowserPrepareTool(mission)
  if (!prepareTool || hasBrowserResultForPrepare(mission, prepareTool.id)) return null

  const planStepId = activePlanStepId(mission.plan)
  const toolCallId = makeAdapterToolId('browser.web-agent.read')
  const artifactId = makeAdapterResultId('browser.web-agent')
  const readResult = normalizeBrowserReadResult(input.capabilityAdapterResult)
  const ok = readResult ? readResult.ok : true
  const summary = readResult?.summary || browserExecutionSummary(mission)
  const artifactUri = `vela://capabilities/browser.web-agent/results/${prepareTool.id}`
  const sourceTools = readResult?.sourceTools?.length
    ? `；底层工具：${readResult.sourceTools.join(' + ')}`
    : ''
  const resultPrefix = readResult
    ? (ok ? '浏览器读取完成' : '浏览器读取未完成')
    : '浏览器读取执行闭环完成'
  return {
    capability,
    toolCall: {
      id: toolCallId,
      toolName: 'browser.web-agent.read',
      role: 'Operator',
      status: ok ? 'ok' : 'failed',
      planStepId,
      risk: 'Read',
      result: `${resultPrefix}${sourceTools}。${summary}`,
    },
    artifact: {
      id: artifactId,
      title: ok ? '浏览器结果摘要' : '浏览器读取失败',
      kind: 'browser-summary',
      uri: artifactUri,
      summary,
      planStepId,
    },
    reviewCheck: {
      key: `browser-result-${asText(mission.id, 'mission')}`,
      title: '浏览器结果复核',
      outcome: ok ? 'passed' : 'failed',
      reviewer: 'Vela Browser Reviewer',
      role: 'Reviewer',
      planStepId,
      toolCallId,
      artifactId,
      summary: ok
        ? '浏览器读取结果已经连接到工具调用、产物和任务计划，可进入用户确认。'
        : '浏览器读取没有拿到可用内容，已保留失败证据并等待调整。',
      evidence: readResult?.evidence?.length
        ? readResult.evidence
        : [
            summary,
            `准备工具调用：${prepareTool.id}`,
            '未执行外部提交、消息发送、购买或登录凭据操作。',
          ],
      failures: ok ? [] : normalizeArray(readResult?.failures).map(item => asText(item.reason || item.error || item.url)).filter(Boolean),
    },
    toolStages: normalizeArray(readResult?.stages).map((stage, index) => ({
      toolName: stage.tool,
      status: stage.status,
      stage: `browser-read-${index + 1}`,
      summary: stage.summary || stage.reason || stage.url,
      url: stage.url,
      planStepId,
      role: 'Operator',
    })),
    nextStep: ok
      ? '浏览器结果摘要已准备好；你可以查看产物，确认后说“通过”或“完成”。'
      : '浏览器读取没有成功；你可以换一个网址、补充关键词，或让我继续调整。',
  }
}

function desktopExecutionSummary(target = {}) {
  return `已完成「${target.appName}」桌面控制原型链路：模拟打开应用、模拟读取当前上下文，并确认没有真实启动应用、截图、读取真实屏幕或发送外部消息。`
}

function executeDesktopAdapterRun(mission = {}, input = {}) {
  const capability = primaryDesktopCapability(mission)
  if (capability?.id !== 'desktop.app-control') return null

  const prepareTool = latestDesktopPrepareTool(mission)
  if (!prepareTool || hasDesktopResultForPrepare(mission, prepareTool.id)) return null

  const planStepId = activePlanStepId(mission.plan, 'inspect-context')
  const toolCallId = makeAdapterToolId('desktop.app-control.inspect')
  const artifactId = makeAdapterResultId('desktop.app-control')
  const target = desktopTarget(mission, input)
  const summary = desktopExecutionSummary(target)
  const evidence = [
    `目标应用：${target.appName}`,
    `模拟打开：${target.appUrl}`,
    '模拟屏幕上下文：screen://mock/current-app',
    '未真实打开应用、未截图、未读取真实屏幕、未发送消息。',
    '接入真实桌面控制前必须经过 Screen/Execute Guard。',
  ]
  return {
    capability,
    toolCall: {
      id: toolCallId,
      toolName: 'desktop.app-control.inspect',
      role: 'Operator',
      status: 'ok',
      planStepId,
      risk: 'Screen',
      result: summary,
    },
    artifact: {
      id: artifactId,
      title: '桌面上下文摘要',
      kind: 'desktop-context',
      uri: `vela://capabilities/desktop.app-control/results/${prepareTool.id}`,
      summary,
      planStepId,
    },
    reviewCheck: {
      key: `desktop-context-${asText(mission.id, 'mission')}`,
      title: '桌面上下文复核',
      outcome: 'passed',
      reviewer: 'Vela Desktop Reviewer',
      role: 'Reviewer',
      planStepId,
      toolCallId,
      artifactId,
      summary: '桌面控制原型只产生模拟上下文证据，没有执行真实桌面或外部发送动作。',
      evidence,
      failures: [],
    },
    toolStages: [
      {
        toolName: 'desktop.open-app',
        status: 'ok',
        stage: 'desktop-open-app',
        summary: `模拟打开 ${target.appName}，未启动真实应用。`,
        url: target.appUrl,
        planStepId,
        role: 'Operator',
      },
      {
        toolName: 'desktop.screen-context',
        status: 'ok',
        stage: 'desktop-screen-context',
        summary: '模拟读取当前 App 上下文，未截图或读取真实屏幕。',
        url: 'screen://mock/current-app',
        planStepId,
        role: 'Operator',
      },
      {
        toolName: 'desktop.external-effect',
        status: 'skipped',
        stage: 'desktop-no-hidden-send',
        summary: '未发送消息、未提交表单、未触发外部效果。',
        url: 'external://none',
        planStepId,
        role: 'Operator',
      },
    ],
    nextStep: '桌面上下文原型结果已准备好；真实 App 控制仍需你确认授权。',
  }
}

function documentDraftSummary(mission = {}, input = {}) {
  const goal = asText(mission.goal || mission.title || input.text, '当前文件任务')
  return `已为「${goal}」生成 Vela 内部文档草稿：包含任务目标、建议结构、关键内容提纲和后续可编辑产物说明；当前没有写入、覆盖或删除本地文件。`
}

function executeFilesAdapterRun(mission = {}, input = {}) {
  const capability = primaryFilesCapability(mission)
  if (capability?.id !== 'files.document-work') return null

  const prepareTool = latestFilesPrepareTool(mission)
  if (!prepareTool || hasFilesResultForPrepare(mission, prepareTool.id)) return null

  const planStepId = activePlanStepId(mission.plan)
  const toolCallId = makeAdapterToolId('files.document-work.generate')
  const artifactId = makeAdapterResultId('files.document-work')
  const title = documentTitleForMission(mission, input)
  const kind = documentKindForMission(mission, input)
  const summary = documentDraftSummary(mission, input)
  const evidence = [
    `准备工具调用：${prepareTool.id}`,
    `产物类型：${kind}`,
    '产物保存在 Vela mission artifact 中。',
    '未写入、覆盖或删除本地文件。',
    '真实文件保存、覆盖或删除仍需 Guard 确认。',
  ]
  return {
    capability,
    toolCall: {
      id: toolCallId,
      toolName: 'files.document-work.generate',
      role: 'Builder',
      status: 'ok',
      planStepId,
      risk: 'Read',
      result: summary,
    },
    artifact: {
      id: artifactId,
      title,
      kind,
      uri: `vela://capabilities/files.document-work/results/${prepareTool.id}`,
      summary,
      planStepId,
    },
    reviewCheck: {
      key: `file-artifact-${asText(mission.id, 'mission')}`,
      title: '文件产物复核',
      outcome: 'passed',
      reviewer: 'Vela File Reviewer',
      role: 'Reviewer',
      planStepId,
      toolCallId,
      artifactId,
      summary: '文件文档适配器生成了可复核的内部产物，并确认没有执行本地磁盘写入。',
      evidence,
      failures: [],
    },
    toolStages: [
      {
        toolName: 'files.outline',
        status: 'ok',
        stage: 'document-outline',
        summary: '生成文档结构和关键内容提纲。',
        url: `vela://capabilities/files.document-work/results/${prepareTool.id}#outline`,
        planStepId,
        role: 'Builder',
      },
      {
        toolName: 'files.local-write',
        status: 'skipped',
        stage: 'no-disk-write',
        summary: '未写入、覆盖或删除本地文件。',
        url: 'file://local-write-skipped',
        planStepId,
        role: 'Builder',
      },
    ],
    nextStep: '文件文档草稿已准备好；需要保存到本地文件时，我会先向你确认路径和写入范围。',
  }
}

function memoryContextSummary(mission = {}, input = {}) {
  const query = memoryQueryForMission(mission, input)
  return `已为「${query}」关联当前任务可用的记忆上下文：保留查询、来源、相关度、置信度和消费步骤；当前没有写入长期记忆。`
}

function executeMemoryAdapterRun(mission = {}, input = {}) {
  const capability = primaryMemoryCapability(mission)
  if (capability?.id !== 'memory.context-os') return null

  const prepareTool = latestMemoryPrepareTool(mission)
  if (!prepareTool || hasMemoryResultForPrepare(mission, prepareTool.id)) return null

  const planStepId = activePlanStepId(mission.plan)
  const toolCallId = makeAdapterToolId('memory.context-os.recall')
  const artifactId = makeAdapterResultId('memory.context-os')
  const query = memoryQueryForMission(mission, input)
  const title = memoryTitleForMission(mission, input)
  const type = memoryReferenceTypeForMission(mission, input)
  const provenance = `vela://capabilities/memory.context-os/results/${prepareTool.id}`
  const summary = memoryContextSummary(mission, input)
  const memoryReferenceId = makeAdapterResultId('memory.context-os-reference')
  const memoryReference = {
    id: memoryReferenceId,
    title,
    type,
    source: 'Vela memory adapter',
    provenance,
    uri: provenance,
    query,
    relevance: '0.84',
    confidence: type === 'mission' ? 'medium' : 'high',
    usedByPlanStepId: planStepId,
    reason: '当前任务触发了记忆/上下文能力，需要把相关背景带入执行链路。',
    summary,
  }
  const evidence = [
    `召回查询：${query}`,
    `记忆类型：${type}`,
    `来源：${memoryReference.source}`,
    `来源证明：${provenance}`,
    '长期记忆写入已跳过；这里只关联当前任务上下文。',
  ]
  return {
    capability,
    toolCall: {
      id: toolCallId,
      toolName: 'memory.context-os.recall',
      role: 'Researcher',
      status: 'ok',
      planStepId,
      risk: 'Read',
      result: summary,
    },
    artifact: {
      id: artifactId,
      title: '记忆上下文摘要',
      kind: 'memory-context',
      uri: provenance,
      summary,
      planStepId,
    },
    memoryReferences: [memoryReference],
    reviewCheck: {
      key: `memory-context-${asText(mission.id, 'mission')}`,
      title: '记忆上下文复核',
      outcome: 'passed',
      reviewer: 'Vela Memory Reviewer',
      role: 'Reviewer',
      planStepId,
      toolCallId,
      artifactId,
      summary: '记忆上下文已关联到当前任务，并保留查询、来源和使用步骤；未执行隐藏长期记忆写入。',
      evidence,
      failures: [],
    },
    toolStages: [
      {
        toolName: 'memory.recall',
        status: 'ok',
        stage: 'mission-context-recall',
        summary: `关联 mission memory reference：${title}`,
        url: provenance,
        planStepId,
        role: 'Researcher',
      },
      {
        toolName: 'memory.long-term-write',
        status: 'skipped',
        stage: 'no-hidden-memory-write',
        summary: '未写入长期记忆；如需长期保存，需要单独确认和来源说明。',
        url: 'memory://long-term-write-skipped',
        planStepId,
        role: 'Researcher',
      },
    ],
    nextStep: '记忆上下文已挂到当前任务；你可以在记忆层检查来源和相关度。',
  }
}

export function executeCapabilityAdapterRun(mission = {}, input = {}) {
  return executeBrowserAdapterRun(mission, input)
    || executeDesktopAdapterRun(mission, input)
    || executeFilesAdapterRun(mission, input)
    || executeMemoryAdapterRun(mission, input)
}

export function shouldPrepareCapabilityAdapterResult(mission = {}) {
  return shouldExecuteBrowserAdapter(mission)
}

export async function prepareCapabilityAdapterResult(mission = {}, input = {}, deps = {}) {
  if (!shouldPrepareCapabilityAdapterResult(mission)) return null
  const { readBrowserMission } = await import('./web-reader.js')
  return readBrowserMission({ mission, input, ...deps })
}
