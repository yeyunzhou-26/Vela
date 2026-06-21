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

function primaryCapability(mission = {}) {
  return normalizeArray(mission.capabilityReferences).find(item => item?.id === 'browser.web-agent') || null
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
