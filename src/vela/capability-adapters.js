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

function primaryCapability(mission = {}) {
  return normalizeArray(mission.capabilityReferences).find(item => item?.id === 'browser.web-agent') || null
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
  const capability = primaryCapability(mission)
  if (capability?.id !== 'browser.web-agent') return false
  const prepareTool = latestBrowserPrepareTool(mission)
  return !!prepareTool && !hasBrowserResultForPrepare(mission, prepareTool.id)
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

function planBrowserAdapterRun(mission = {}, input = {}) {
  const capability = primaryCapability(mission)
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

export function planCapabilityAdapterRun(mission = {}, input = {}) {
  return planBrowserAdapterRun(mission, input)
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
    urls: normalizeArray(value.urls).map(item => asText(item)).filter(Boolean),
  }
}

function executeBrowserAdapterRun(mission = {}, input = {}) {
  const capability = primaryCapability(mission)
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
    nextStep: ok
      ? '浏览器结果摘要已准备好；你可以查看产物，确认后说“通过”或“完成”。'
      : '浏览器读取没有成功；你可以换一个网址、补充关键词，或让我继续调整。',
  }
}

export function executeCapabilityAdapterRun(mission = {}, input = {}) {
  return executeBrowserAdapterRun(mission, input)
}

export function shouldPrepareCapabilityAdapterResult(mission = {}) {
  return shouldExecuteBrowserAdapter(mission)
}

export async function prepareCapabilityAdapterResult(mission = {}, input = {}, deps = {}) {
  if (!shouldPrepareCapabilityAdapterResult(mission)) return null
  const { readBrowserMission } = await import('./web-reader.js')
  return readBrowserMission({ mission, input, ...deps })
}
