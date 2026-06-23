import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { chromium } from 'playwright'
import { zh } from '../src/ui/vela/locale.js'
import {
  assertFocusedWorkbenchScreenshot as assertSharedFocusedWorkbenchScreenshot,
  assertNoEnglishShellChrome,
} from './vela-visual-assertions.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const velaRoot = path.join(root, 'src', 'ui', 'vela')
const screenshotRoot = path.join(root, 'output', 'playwright', 'vela')

function includesText(value, expected) {
  return String(value || '').includes(expected)
}

function assertIncludes(value, expected, label) {
  if (!includesText(value, expected)) {
    throw new Error(`${label}: ${value}`)
  }
}

function assertNoRawPolicyText(value, label) {
  const bodyText = String(value || '')
  const forbidden = [
    'Plan read-only block',
    'Assist approval gate',
    'Assist external-effect gate',
    'Assist destructive-action gate',
    'Act scoped-action allow',
    'Act high-risk gate',
    'Auto trusted-recurring allow',
    'Auto trusted-task gate',
    'Voice privacy gate',
    'External message',
  ]
  const matches = forbidden.filter(item => bodyText.includes(item))
  if (matches.length) {
    throw new Error(`${label} leaked raw policy text: ${matches.join(', ')}`)
  }
}

async function assertFocusedWorkbenchScreenshot(page, label, filename, expectedWidth, expectedHeight) {
  await assertSharedFocusedWorkbenchScreenshot(
    page,
    label,
    path.join(screenshotRoot, filename),
    expectedWidth,
    expectedHeight,
  )
}

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    default: return 'text/plain; charset=utf-8'
  }
}

function isPathInside(parentDir, candidatePath) {
  const parent = path.resolve(parentDir)
  const candidate = path.resolve(candidatePath)
  const relative = path.relative(parent, candidate)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function sendFile(res, filePath) {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) throw new Error('not a file')
    res.writeHead(200, {
      'Content-Type': contentTypeFor(filePath),
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    })
    fs.createReadStream(filePath).pipe(res)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
}

function createServer() {
  let missions = [
    {
      id: 'mission-vela-shell',
      title: 'Build Vela Shell',
      goal: 'Create the first mission-first Vela workbench while keeping legacy Brain UI available.',
      state: 'Planned',
      permissionMode: 'Assist',
      modelStatus: 'Local runtime',
      activeSurface: 'Mission Plan',
      nextStep: 'Smoke spine data is loaded from the runtime.',
      plan: [
        { id: 'stabilize-runtime', label: 'Stabilize runtime base', status: 'Done' },
        { id: 'open-workbench', label: 'Open focused workbench', status: 'Active' },
        { id: 'connect-runtime', label: 'Connect mission runtime', status: 'Next' },
      ],
      inputs: [
        { id: 'input-smoke', text: 'Seeded screen context', source: 'smoke' },
      ],
      artifacts: [
        {
          id: 'artifact-wechat-qr',
          title: '微信登录二维码',
          kind: 'credential-login-qr',
          uri: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 120 120%22%3E%3Crect width=%22120%22 height=%22120%22 fill=%22white%22/%3E%3Cpath d=%22M10 10h30v30H10zM80 10h30v30H80zM10 80h30v30H10zM52 52h12v12H52zM70 52h10v10H70zM92 52h18v12H92zM52 72h18v18H52zM80 80h10v10H80zM100 92h10v18H92V98h8z%22 fill=%22%23111820%22/%3E%3C/svg%3E',
          summary: '请用微信扫码；保存凭据前仍会再次确认。',
          planStepId: 'connect-runtime',
        },
        { id: 'artifact-smoke', title: 'Seed Shell Snapshot', kind: 'preview', summary: 'Shell rendered for smoke verification.', planStepId: 'open-workbench' },
        { id: 'artifact-handoff', title: 'Shell Handoff Note', kind: 'note', uri: 'vela://shell-handoff', summary: 'Artifact handoff remains inspectable in the mission workspace.', planStepId: 'connect-runtime' },
      ],
      agentActions: [
        { id: 'action-smoke', role: 'Builder', title: 'Build shell action', status: 'done', planStepId: 'open-workbench', summary: 'Builder prepared Vela Shell.', requiresReview: true },
      ],
      toolCalls: [
        { id: 'tool-smoke', toolName: 'smoke.runtime', role: 'Builder', status: 'ok', planStepId: 'open-workbench', result: 'Shell served locally.' },
      ],
      permissions: [],
      memoryReferences: [
        { id: 'memory-smoke', title: 'Vela spec', provenance: 'docs/superpowers/specs' },
      ],
      reviewResult: {
        outcome: 'passed',
        reviewer: 'Smoke Reviewer',
        summary: 'Initial shell contract holds.',
        evidence: ['Shell smoke reviewer checked the first-screen contract.'],
        failures: [],
      },
      reviewChecks: [
        {
          id: 'review-check-smoke',
          key: 'shell-contract',
          title: 'Shell contract review check',
          outcome: 'passed',
          reviewer: 'Smoke Reviewer',
          planStepId: 'open-workbench',
          toolCallId: 'tool-smoke',
          summary: 'Reviewer checked mission workspace, spine collapse, and voice layer.',
          evidence: ['spine collapsed by default', 'workspace width preserved'],
          failures: [],
        },
        {
          id: 'review-check-smoke-blocked',
          key: 'shell-unresolved-evidence',
          title: 'Unresolved shell review check',
          outcome: 'failed',
          reviewer: 'Smoke Reviewer',
          planStepId: 'connect-runtime',
          toolCallId: 'tool-smoke',
          summary: 'Reviewer is missing one runtime evidence link.',
          evidence: [],
          failures: ['runtime evidence link missing'],
        },
      ],
      recoveryActions: [],
      trace: [
        { id: 'trace-smoke', type: 'tool.called', title: 'Tool called: smoke.runtime', toolName: 'smoke.runtime', result: 'ok' },
      ],
      updatedAt: new Date().toISOString(),
    },
  ]
  let currentMissionId = missions[0].id

  function sendJson(res, body, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')) } catch (err) { reject(err) }
      })
      req.on('error', reject)
    })
  }

  function reviewCheckKeyFor(check = {}, index = 0) {
    return String(check.key || check.checkKey || check.id || `review-check-${index + 1}`).trim()
  }

  function blockingReviewChecksFor(mission) {
    const latestByKey = new Map()
    const checks = Array.isArray(mission.reviewChecks) ? mission.reviewChecks : []
    checks.forEach((check, index) => {
      const key = reviewCheckKeyFor(check, index)
      latestByKey.set(key, { ...check, key })
    })
    return [...latestByKey.values()].filter(check => /^(failed|blocked)$/i.test(check.outcome || check.status || ''))
  }

  function syncReviewBlockedRecovery(current, blockingReviewChecks) {
    const now = new Date().toISOString()
    const existingKeys = new Set((current.recoveryActions || [])
      .filter(action => action.source === 'review_blocked' && !/^(done|closed|resolved)$/i.test(action.status || 'open'))
      .map(action => action.reviewCheckKey || action.key)
      .filter(Boolean))
    const newActions = blockingReviewChecks
      .filter(check => !existingKeys.has(check.key))
      .map(check => ({
        id: `recovery-smoke-${Date.now()}`,
        title: `Repair review check: ${check.title || check.key}`,
        status: 'open',
        source: 'review_blocked',
        reviewCheckKey: check.key,
        reviewCheckId: check.id || '',
        planStepId: check.planStepId || '',
        toolCallId: check.toolCallId || '',
        artifactId: check.artifactId || '',
        summary: check.summary || 'Resolve the blocking reviewer check before completion.',
        failures: Array.isArray(check.failures) ? check.failures : [],
        createdAt: now,
      }))
    current.recoveryActions = [...(current.recoveryActions || []), ...newActions]
    current.nextStep = 'Resolve blocking review checks before completion.'
    current.updatedAt = now
  }

  function nextCommandStateFor(state) {
    switch (state) {
      case 'Draft':
        return 'Planned'
      case 'Planned':
      case 'Waiting for user':
      case 'Waiting for permission':
      case 'Blocked':
      case 'Failed':
      case 'Complete':
        return 'Running'
      case 'Running':
        return 'Reviewing'
      case 'Reviewing':
        return 'Complete'
      default:
        return 'Running'
    }
  }

  function assertCanCompleteCurrent(current, res) {
    if (!/^(pass|passed|approved|ok|ready)$/i.test(current.reviewResult?.outcome || '')) {
      sendJson(res, {
        ok: false,
        code: 'review_required',
        error: 'Reviewer outcome required before mission can be completed.',
      }, 409)
      return false
    }
    const blockingReviewChecks = blockingReviewChecksFor(current)
    if (blockingReviewChecks.length) {
      syncReviewBlockedRecovery(current, blockingReviewChecks)
      sendJson(res, {
        ok: false,
        code: 'review_blocked',
        error: 'Blocking review checks must be resolved before mission can be completed.',
        mission: current,
        details: { blockingReviewChecks },
      }, 409)
      return false
    }
    return true
  }

  function createMissionFromText(text) {
    const title = String(text || '').trim() || 'Smoke Mission'
    const isBlockedReviewMission = /^Blocked Review Mission$/i.test(title)
    const isPolicyBlockedMission = /^Policy Blocked Mission$/i.test(title)
    const now = new Date().toISOString()
    const mission = {
      id: `mission-smoke-${Date.now()}`,
      title,
      goal: title,
      state: isBlockedReviewMission ? 'Reviewing' : (isPolicyBlockedMission ? 'Blocked' : 'Planned'),
      permissionMode: isPolicyBlockedMission ? 'Plan' : 'Assist',
      modelStatus: 'Local runtime',
      activeSurface: 'Mission Plan',
      nextStep: isPolicyBlockedMission
        ? 'Plan policy blocked Execute blocked mutation.'
        : isBlockedReviewMission
        ? 'Resolve blocking review checks before completion.'
        : 'Review the generated plan and continue.',
      plan: [
        { id: 'clarify-goal', label: 'Clarify mission goal', status: 'Done' },
        { id: 'draft-plan', label: 'Draft mission plan', status: 'Active' },
        { id: 'execute-review', label: 'Execute, verify, and review', status: 'Next' },
      ],
      inputs: [
        { id: `input-smoke-${Date.now()}`, text, source: 'typed', createdAt: now },
      ],
      permissions: isPolicyBlockedMission ? [
        {
          id: 'permission-policy-blocked',
          action: 'Execute blocked mutation',
          mode: 'Plan',
          policy: 'Plan read-only block',
          scope: 'workspace',
          risk: 'Execute',
          decision: 'denied',
          reason: 'Plan mode blocks non-read actions.',
          requestedBy: 'Smoke policy gate',
          planStepId: 'execute-review',
          toolCallId: 'tool-policy-blocked',
          createdAt: now,
        },
      ] : [],
      reviewResult: isBlockedReviewMission ? {
        outcome: 'passed',
        reviewer: 'Smoke Reviewer',
        summary: 'Primary review passed, but a blocking check still needs repair.',
      } : null,
      reviewChecks: isBlockedReviewMission ? [
        {
          id: 'review-check-smoke-ui-blocked',
          key: 'smoke-ui-evidence-trace',
          title: 'Evidence trace review',
          outcome: 'failed',
          reviewer: 'Smoke Reviewer',
          planStepId: 'execute-review',
          toolCallId: 'tool-smoke-ui',
          summary: 'Reviewer needs the evidence trace repaired.',
          evidence: [],
          failures: ['raw failure detail should stay in the spine'],
        },
      ] : [],
      recoveryActions: [],
      trace: isPolicyBlockedMission ? [
        {
          id: 'trace-policy-blocked',
          type: 'permission.recorded',
          title: 'Permission denied: Execute blocked mutation',
          permissionDecision: 'denied',
          planStepId: 'execute-review',
          toolCallId: 'tool-policy-blocked',
          result: 'Plan read-only block',
          createdAt: now,
        },
      ] : [],
      updatedAt: now,
    }
    missions = [mission, ...missions]
    currentMissionId = mission.id
    return mission
  }

  function appendReviewCheckToCurrent(body = {}) {
    const current = missions.find(mission => mission.id === currentMissionId) || missions[0]
    const now = new Date().toISOString()
    const record = {
      id: body.id || `review-check-smoke-${Date.now()}`,
      key: reviewCheckKeyFor(body),
      title: body.title || body.summary || 'Review check',
      outcome: body.outcome || body.status || 'pending',
      reviewer: body.reviewer || 'Smoke Reviewer',
      planStepId: body.planStepId || '',
      toolCallId: body.toolCallId || '',
      artifactId: body.artifactId || '',
      summary: body.summary || '',
      evidence: Array.isArray(body.evidence) ? body.evidence : [],
      failures: Array.isArray(body.failures) ? body.failures : [],
      createdAt: now,
    }
    current.reviewChecks = [...(current.reviewChecks || []), record]
    if (/^(pass|passed|approved|ok|ready)$/i.test(record.outcome)) {
      current.recoveryActions = (current.recoveryActions || []).map(action => {
        if (action.source !== 'review_blocked' || action.reviewCheckKey !== record.key) return action
        return { ...action, status: 'resolved', resolvedAt: now }
      })
    }
    current.updatedAt = now
    return current
  }

  function appendPermissionToCurrent(body = {}) {
    const current = missions.find(mission => mission.id === currentMissionId) || missions[0]
    const now = new Date().toISOString()
    const record = {
      id: body.id || `permission-smoke-${Date.now()}`,
      action: body.action || body.title || 'Permission request',
      mode: body.mode || body.permissionMode || 'Assist',
      policy: body.policy || 'Assist guard',
      scope: body.scope || '',
      risk: body.risk || body.riskClass || 'Write',
      decision: body.decision || body.status || 'requested',
      reason: body.reason || body.summary || '',
      summary: body.summary || body.reason || '',
      planStepId: body.planStepId || '',
      toolCallId: body.toolCallId || '',
      requestedBy: body.requestedBy || body.actor || 'Vela',
      approvedBy: body.approvedBy || '',
      createdAt: now,
    }
    current.permissions = [...(current.permissions || []), record]
    current.trace = [...(current.trace || []), {
      id: `trace-smoke-${Date.now()}`,
      type: 'permission.recorded',
      title: `Permission ${record.decision}: ${record.action}`,
      permissionDecision: record.decision,
      result: record.policy || record.risk,
      createdAt: now,
    }]
    current.updatedAt = now
    return current
  }

  function resolvePermissionOnCurrent(body = {}) {
    const current = missions.find(mission => mission.id === currentMissionId) || missions[0]
    const now = new Date().toISOString()
    const pendingRe = /^(requested|pending|needs approval|waiting)$/i
    const permissions = Array.isArray(current.permissions) ? current.permissions : []
    const requestedId = String(body.id || body.permissionId || '').trim()
    const target = requestedId
      ? permissions.find(item => item.id === requestedId)
      : [...permissions].reverse().find(item => pendingRe.test(item.decision || ''))
    if (!target) {
      return { status: 400, body: { ok: false, code: 'permission_not_pending', error: 'No pending permission to resolve.', mission: current } }
    }
    const decision = /^(deny|denied|decline|declined|reject|rejected|disallow)$/i.test(String(body.decision || '')) ? 'denied' : 'approved'
    target.decision = decision
    target.approvedBy = body.approvedBy || 'User'
    target.reason = body.reason || target.reason
    target.resolvedAt = now
    const stillPending = permissions.some(item => pendingRe.test(item.decision || ''))
    if (current.state === 'Waiting for permission') {
      if (decision === 'approved' && !stillPending) {
        current.state = 'Running'
        current.nextStep = `Approved: ${target.action}. Resuming mission.`
      } else if (decision === 'denied') {
        current.state = 'Blocked'
        current.nextStep = `Denied: ${target.action}. Mission needs an alternative.`
      }
    }
    current.trace = [...(current.trace || []), {
      id: `trace-smoke-${Date.now()}`,
      type: 'guard.approval',
      title: `Permission ${decision}: ${target.action}`,
      permissionDecision: decision,
      result: decision === 'approved' ? 'resumed' : 'blocked',
      createdAt: now,
    }]
    current.updatedAt = now
    return { status: 200, body: { ok: true, mission: current } }
  }

  function screenContextFrom(body = {}) {
    return body.screenContext && typeof body.screenContext === 'object' ? body.screenContext : undefined
  }

  function handleCommand(body, res) {
    const text = String(body.text || body.transcript || '').trim()
    const current = missions.find(mission => mission.id === currentMissionId) || missions[0]
    const screenContext = screenContextFrom(body)
    if (body.transcript && /(?:\b(?:api key|secret|token|password|credential)\b|密码|密钥|令牌|凭据)/i.test(text)) {
      const now = new Date().toISOString()
      current.inputs = [...(current.inputs || []), {
        id: `input-smoke-${Date.now()}`,
        text,
        source: 'voice',
        screenContext,
        createdAt: now,
      }]
      current.permissions = [...(current.permissions || []), {
        id: `permission-smoke-${Date.now()}`,
        action: 'Review voice intent before using sensitive credentials.',
        mode: 'Assist',
        policy: 'Voice privacy gate',
        risk: 'Credential',
        decision: 'requested',
        reason: text,
        requestedBy: 'Vela voice privacy gate',
        createdAt: now,
      }]
      current.trace = [...(current.trace || []), {
        id: `trace-smoke-${Date.now()}`,
        type: 'voice.privacy_gate',
        title: 'Voice privacy gate requested permission',
        permissionDecision: 'requested',
        screenContext,
        result: 'Credential',
        createdAt: now,
      }]
      current.state = 'Waiting for permission'
      current.nextStep = 'Review voice intent before using sensitive credentials.'
      current.updatedAt = now
      sendJson(res, { ok: true, mission: current })
      return
    }
    if (body.transcript && /^(stop|pause|cancel|interrupt|停止|暂停|打断|取消)$/i.test(text)) {
      const now = new Date().toISOString()
      current.inputs = [...(current.inputs || []), {
        id: `input-smoke-${Date.now()}`,
        text,
        source: 'voice',
        screenContext,
        createdAt: now,
      }]
      current.trace = [...(current.trace || []), {
        id: `trace-smoke-${Date.now()}`,
        type: 'command.stopped',
        title: 'Command stopped',
        screenContext,
        result: 'Waiting for user',
        createdAt: now,
      }]
      current.state = 'Waiting for user'
      current.nextStep = 'Stopped. Awaiting user direction.'
      current.updatedAt = now
      sendJson(res, { ok: true, mission: current })
      return
    }
    if (body.transcript && /^(not that|change it to|change that to|repair that|不是这个|改成|改为|修正)$/i.test(text)) {
      const now = new Date().toISOString()
      current.inputs = [...(current.inputs || []), {
        id: `input-smoke-${Date.now()}`,
        text,
        source: 'voice',
        screenContext,
        createdAt: now,
      }]
      current.trace = [...(current.trace || []), {
        id: `trace-smoke-${Date.now()}`,
        type: 'command.repair',
        title: 'Command repair requested',
        screenContext,
        result: 'Waiting for user',
        createdAt: now,
      }]
      current.state = 'Waiting for user'
      current.nextStep = `Repair requested: ${text}`
      current.updatedAt = now
      sendJson(res, { ok: true, mission: current })
      return
    }
    if (/^(continue|resume|run|继续|恢复|运行)$/i.test(text)) {
      const nextState = nextCommandStateFor(current.state)
      if (nextState === 'Complete' && !assertCanCompleteCurrent(current, res)) return
      current.inputs = [...(current.inputs || []), {
        id: `input-smoke-${Date.now()}`,
        text,
        source: body.transcript ? 'voice' : 'typed',
        screenContext,
        createdAt: new Date().toISOString(),
      }]
      current.trace = [...(current.trace || []), {
        id: `trace-smoke-${Date.now()}`,
        type: body.transcript ? 'voice.intent.routed' : 'command.routed',
        title: body.transcript ? 'Voice intent routed' : 'Command routed',
        screenContext,
        result: current.state,
      }]
      current.state = nextState
      current.updatedAt = new Date().toISOString()
      sendJson(res, { ok: true, mission: current })
      return
    }
    if (/^(review\s+)?(pass|passed|approved|审核通过|审查通过|通过审核|通过审查)$/i.test(text)) {
      current.reviewResult = {
        outcome: 'passed',
        reviewer: body.transcript ? 'Smoke voice' : 'Smoke command',
        summary: text,
        createdAt: new Date().toISOString(),
      }
      current.updatedAt = new Date().toISOString()
      sendJson(res, { ok: true, mission: current })
      return
    }
    if (/^(complete|finish|done|完成|结束)$/i.test(text)) {
      if (!/^(pass|passed|approved|ok|ready)$/i.test(current.reviewResult?.outcome || '')) {
        sendJson(res, {
          ok: false,
          code: 'review_required',
          error: 'Reviewer outcome required before mission can be completed.',
        }, 409)
        return
      }
      current.state = 'Complete'
      current.updatedAt = new Date().toISOString()
      sendJson(res, { ok: true, mission: current })
      return
    }
    sendJson(res, { ok: true, mission: createMissionFromText(text.replace(/^(start|new|create)\s+/i, '')) })
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname === '/' || url.pathname === '/vela' || url.pathname === '/vela.html') {
      sendFile(res, path.join(root, 'vela.html'))
      return
    }
    if (url.pathname === '/vela/mission') {
      const current = missions.find(mission => mission.id === currentMissionId) || missions[0]
      if (req.method === 'PATCH') {
        readJson(req).then(body => {
          if (body.state === 'Complete' && !/^(pass|passed|approved|ok|ready)$/i.test(current.reviewResult?.outcome || '')) {
            sendJson(res, {
              ok: false,
              code: 'review_required',
              error: 'Reviewer outcome required before mission can be completed.',
            }, 409)
            return
          }
          const blockingReviewChecks = body.state === 'Complete' ? blockingReviewChecksFor(current) : []
          if (blockingReviewChecks.length) {
            syncReviewBlockedRecovery(current, blockingReviewChecks)
            sendJson(res, {
              ok: false,
              code: 'review_blocked',
              error: 'Blocking review checks must be resolved before mission can be completed.',
              mission: current,
              details: { blockingReviewChecks },
            }, 409)
            return
          }
          if (body.permissionMode && body.permissionMode !== current.permissionMode) {
            const now = new Date().toISOString()
            current.trace = [...(current.trace || []), {
              id: `trace-smoke-${Date.now()}`,
              type: 'permission.mode.changed',
              title: `Permission mode changed to ${body.permissionMode}`,
              detail: `${current.permissionMode || 'Assist'} -> ${body.permissionMode}`,
              result: body.permissionMode,
              createdAt: now,
            }]
          }
          Object.assign(current, body, { updatedAt: new Date().toISOString() })
          sendJson(res, { ok: true, mission: current })
        }).catch(err => {
          res.writeHead(400)
          res.end(err.message)
        })
        return
      }
      sendJson(res, { ok: true, mission: current })
      return
    }
    if (url.pathname === '/vela/mission/commands' && req.method === 'POST') {
      readJson(req).then(body => {
        handleCommand(body, res)
      }).catch(err => {
        res.writeHead(400)
        res.end(err.message)
      })
      return
    }
    if (url.pathname === '/vela/mission/review-checks' && req.method === 'POST') {
      readJson(req).then(body => {
        sendJson(res, { ok: true, mission: appendReviewCheckToCurrent(body) })
      }).catch(err => {
        res.writeHead(400)
        res.end(err.message)
      })
      return
    }
    if (url.pathname === '/vela/mission/permissions/resolve' && req.method === 'POST') {
      readJson(req).then(body => {
        const { status, body: payload } = resolvePermissionOnCurrent(body)
        sendJson(res, payload, status)
      }).catch(err => {
        res.writeHead(400)
        res.end(err.message)
      })
      return
    }
    if (url.pathname === '/vela/mission/permissions' && req.method === 'POST') {
      readJson(req).then(body => {
        sendJson(res, { ok: true, mission: appendPermissionToCurrent(body) })
      }).catch(err => {
        res.writeHead(400)
        res.end(err.message)
      })
      return
    }
    if (url.pathname === '/vela/voice/intent' && req.method === 'POST') {
      readJson(req).then(body => {
        handleCommand(body, res)
      }).catch(err => {
        res.writeHead(400)
        res.end(err.message)
      })
      return
    }
    if (url.pathname === '/vela/missions') {
      if (req.method === 'POST') {
        readJson(req).then(body => {
          sendJson(res, { ok: true, mission: createMissionFromText(body.title || body.goal || 'Smoke Mission') })
        }).catch(err => {
          res.writeHead(400)
          res.end(err.message)
        })
        return
      }
      sendJson(res, { ok: true, missions })
      return
    }
    const selectMatch = url.pathname.match(/^\/vela\/missions\/([^/]+)\/current$/)
    if (req.method === 'POST' && selectMatch) {
      currentMissionId = decodeURIComponent(selectMatch[1])
      const mission = missions.find(item => item.id === currentMissionId)
      if (!mission) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      sendJson(res, { ok: true, mission })
      return
    }
    if (url.pathname.startsWith('/src/ui/vela/')) {
      const relativePath = decodeURIComponent(url.pathname.slice('/src/ui/vela/'.length))
      const assetPath = path.resolve(velaRoot, relativePath)
      if (!isPathInside(velaRoot, assetPath)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      sendFile(res, assetPath)
      return
    }
    res.writeHead(404)
    res.end('not found')
  })
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
    server.on('error', reject)
  })
}

const server = createServer()
const port = await listen(server)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 840 } })
const errors = []
page.on('pageerror', err => errors.push(err.message))
page.on('console', msg => {
  const text = msg.text()
  if (msg.type() === 'error' && !text.includes('409 (Conflict)')) errors.push(text)
})
page.on('response', response => {
  if (response.status() === 409 && response.url().endsWith('/vela/mission')) return
  if (response.status() === 409 && response.url().endsWith('/vela/mission/commands')) return
  if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`)
})

let failed = false
try {
  fs.mkdirSync(screenshotRoot, { recursive: true })
  if (zh('Repair requested: not that') !== '已请求修正：不是这个') {
    throw new Error('locale did not translate persisted English repair transcript')
  }
  if (zh('Assist approval gate') !== '协助模式批准闸门' || zh('External message') !== '外部消息') {
    throw new Error('locale did not translate guard policy and risk labels')
  }
  await page.goto(`http://127.0.0.1:${port}/vela`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.vela-shell', { timeout: 5000 })
  await page.waitForSelector('.mission-workspace h1', { timeout: 5000 })
  await page.waitForFunction(expected => document.querySelector('.next-step-strip strong')?.textContent?.includes(expected), zh('Smoke spine data is loaded from the runtime.'))

  const before = await page.locator('.mission-workspace').boundingBox()
  const initial = await page.evaluate(() => ({
    htmlLang: document.documentElement.lang || '',
    documentTitle: document.title || '',
    title: document.querySelector('.mission-workspace h1')?.textContent || '',
    spineCollapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    expanded: [...document.querySelectorAll('.spine-tab')].map(button => button.getAttribute('aria-expanded')),
    voiceLabel: document.querySelector('.voice-core strong')?.textContent || '',
    voiceInput: document.querySelector('.voice-intent-input')?.getAttribute('placeholder') || '',
    voiceButton: document.querySelector('.voice-intent-submit')?.textContent || '',
    voiceControls: [...document.querySelectorAll('.voice-control')].map(item => item.textContent?.trim()),
    commandInput: document.querySelector('.command-search input')?.getAttribute('placeholder') || '',
    modeButtons: [...document.querySelectorAll('.mode-segment-button')].map(item => ({
      mode: item.dataset.permissionMode,
      pressed: item.getAttribute('aria-pressed'),
      text: item.textContent?.trim(),
    })),
    workspaceTabs: [...document.querySelectorAll('.workspace-mode-tab')].map(item => ({
      mode: item.dataset.workspaceMode,
      selected: item.getAttribute('aria-selected'),
      text: item.textContent?.trim(),
    })),
    canvasText: document.querySelector('.mission-canvas')?.textContent || '',
    dashboardText: document.body.textContent?.includes('Dashboard') || false,
  }))

  if (initial.htmlLang !== 'zh-CN') throw new Error(`Vela shell should declare zh-CN lang: ${initial.htmlLang}`)
  if (!initial.documentTitle.includes('Vela') || !initial.documentTitle.includes('AI 操作台')) {
    throw new Error(`Vela shell title should be Chinese: ${initial.documentTitle}`)
  }
  assertIncludes(initial.title, zh('Build Vela Shell'), 'active mission title missing')
  if (initial.spineCollapsed !== 'true') throw new Error('Intelligence Spine is not collapsed by default')
  if (initial.expanded.some(value => value !== 'false')) throw new Error('spine tabs should be aria-expanded=false on first load')
  if (initial.voiceLabel !== 'Vela Voice') throw new Error('voice layer missing')
  assertIncludes(initial.voiceInput, zh('Voice intent'), 'voice intent input missing')
  assertIncludes(initial.voiceButton, zh('Send'), 'voice intent submit missing')
  if (![zh('Listen'), zh('Stop'), zh('Repair')].every(item => initial.voiceControls.some(control => control.includes(item)))) {
    throw new Error(`voice controls missing: ${initial.voiceControls.join(', ')}`)
  }
  assertIncludes(initial.commandInput, zh('Command or search the current mission'), 'top command input missing')
  if (initial.modeButtons.length !== 4 || !initial.modeButtons.some(item => item.mode === 'Assist' && item.pressed === 'true')) {
    throw new Error(`permission mode segment missing Assist state: ${JSON.stringify(initial.modeButtons)}`)
  }
  if (!initial.workspaceTabs.some(item => item.mode === 'plan' && item.selected === 'true')) {
    throw new Error(`workspace should default to plan mode: ${JSON.stringify(initial.workspaceTabs)}`)
  }
  if (!initial.workspaceTabs.some(item => item.mode === 'artifacts' && item.text.includes('3'))) {
    throw new Error(`workspace artifact tab did not show artifact count: ${JSON.stringify(initial.workspaceTabs)}`)
  }
  if (!initial.canvasText.includes(zh('Create the first mission-first Vela workbench while keeping legacy Brain UI available.'))) {
    throw new Error('plan workspace did not render mission goal')
  }
  if (initial.dashboardText) throw new Error('workspace should not present as a dashboard')
  await assertFocusedWorkbenchScreenshot(page, 'initial Vela shell', 'vela-shell-desktop.png', 1280, 840)

  await page.click('.mode-segment-button[data-permission-mode="Act"]')
  await page.waitForFunction(() => document.querySelector('.mode-segment-button[data-permission-mode="Act"]')?.getAttribute('aria-pressed') === 'true')
  const modeSwitch = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    selectedMode: document.querySelector('.mode-segment-button[aria-pressed="true"]')?.dataset.permissionMode || '',
  }))
  if (modeSwitch.collapsed !== 'true') throw new Error('permission mode switch should not expand the spine')
  if (modeSwitch.selectedMode !== 'Act') throw new Error(`permission mode did not switch to Act: ${modeSwitch.selectedMode}`)
  await page.click('.spine-tab[data-id="guard"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'false')
  const modeGuardText = await page.locator('#spine-panel').textContent() || ''
  if (!modeGuardText.includes(zh('Act'))) throw new Error(`guard spine did not render updated permission mode: ${modeGuardText}`)
  await page.click('.spine-tab[data-id="guard"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'true')
  await page.click('.spine-tab[data-id="context"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'false')
  const modeContextText = await page.locator('#spine-panel').textContent() || ''
  if (!modeContextText.includes(zh('Permission mode changed to Act')) || !modeContextText.includes('GRD')) {
    throw new Error(`context audit chain did not render permission mode switch: ${modeContextText}`)
  }
  await page.click('.spine-tab[data-id="context"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'true')

  await page.click('.workspace-mode-tab[data-workspace-mode="artifacts"]')
  await page.waitForFunction(() => document.querySelector('.workspace-mode-tab[data-workspace-mode="artifacts"]')?.getAttribute('aria-selected') === 'true')
  const artifactWorkspace = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    canvasText: document.querySelector('.mission-canvas')?.textContent || '',
    title: document.querySelector('.artifact-focus h2')?.textContent || '',
    selected: document.querySelector('.artifact-select[aria-pressed="true"] strong')?.textContent || '',
  }))
  if (artifactWorkspace.collapsed !== 'true') throw new Error('artifact workspace should not expand the spine by default')
  if (!artifactWorkspace.title.includes(zh('Shell Handoff Note'))) throw new Error(`artifact workspace missing latest focused artifact: ${artifactWorkspace.title}`)
  if (artifactWorkspace.selected !== zh('Shell Handoff Note')) throw new Error(`artifact workspace did not mark latest artifact selected: ${artifactWorkspace.selected}`)
  if (!artifactWorkspace.canvasText.includes(zh('Artifact handoff remains inspectable in the mission workspace.'))) {
    throw new Error(`artifact workspace missing artifact summary: ${artifactWorkspace.canvasText}`)
  }
  if (!artifactWorkspace.canvasText.includes(`${zh('Connect mission runtime')} (connect-runtime)`)) {
    throw new Error(`artifact workspace missing latest artifact plan step: ${artifactWorkspace.canvasText}`)
  }
  await assertFocusedWorkbenchScreenshot(page, 'artifact workspace Vela shell', 'vela-shell-artifacts.png', 1280, 840)
  await page.click('.artifact-review-action[data-artifact-id="artifact-handoff"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'false')
  const artifactReviewText = await page.locator('#spine-panel').textContent() || ''
  if (!artifactReviewText.includes(zh('Review Shell Handoff Note')) || !artifactReviewText.includes(zh('pending'))) {
    throw new Error(`artifact workspace did not send artifact to review: ${artifactReviewText}`)
  }
  if (!artifactReviewText.includes('connect-runtime') || !artifactReviewText.includes('artifact-handoff')) {
    throw new Error(`artifact review did not preserve plan/artifact linkage: ${artifactReviewText}`)
  }
  if (!artifactReviewText.includes(zh('Artifact handoff remains inspectable in the mission workspace.'))) {
    throw new Error(`artifact review did not carry artifact evidence: ${artifactReviewText}`)
  }
  await page.click('.spine-tab[data-id="review"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'true')
  await page.click('.artifact-select[data-artifact-id="artifact-smoke"]')
  await page.waitForFunction(expected => document.querySelector('.artifact-focus h2')?.textContent?.includes(expected), zh('Seed Shell Snapshot'))
  const selectedArtifactWorkspace = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    title: document.querySelector('.artifact-focus h2')?.textContent || '',
    selected: document.querySelector('.artifact-select[aria-pressed="true"]')?.getAttribute('data-artifact-id') || '',
    canvasText: document.querySelector('.mission-canvas')?.textContent || '',
  }))
  if (selectedArtifactWorkspace.collapsed !== 'true') throw new Error('selecting artifact should not expand the spine')
  if (selectedArtifactWorkspace.selected !== 'artifact-smoke') throw new Error(`artifact selection did not mark chosen artifact: ${selectedArtifactWorkspace.selected}`)
  if (!selectedArtifactWorkspace.canvasText.includes(zh('Shell rendered for smoke verification.'))) {
    throw new Error(`selected artifact summary missing: ${selectedArtifactWorkspace.canvasText}`)
  }
  if (!selectedArtifactWorkspace.canvasText.includes(`${zh('Open focused workbench')} (open-workbench)`)) {
    throw new Error(`selected artifact plan step missing: ${selectedArtifactWorkspace.canvasText}`)
  }

  await page.click('.artifact-select[data-artifact-id="artifact-wechat-qr"]')
  await page.waitForFunction(expected => document.querySelector('.artifact-focus h2')?.textContent?.includes(expected), '微信登录二维码')
  const qrArtifactWorkspace = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    title: document.querySelector('.artifact-focus h2')?.textContent || '',
    selected: document.querySelector('.artifact-select[aria-pressed="true"]')?.getAttribute('data-artifact-id') || '',
    imgSrc: document.querySelector('.artifact-qr-frame img')?.getAttribute('src') || '',
    canvasText: document.querySelector('.mission-canvas')?.textContent || '',
  }))
  if (qrArtifactWorkspace.collapsed !== 'true') throw new Error('selecting QR artifact should not expand the spine')
  if (qrArtifactWorkspace.selected !== 'artifact-wechat-qr') throw new Error(`QR artifact selection did not mark chosen artifact: ${qrArtifactWorkspace.selected}`)
  if (!qrArtifactWorkspace.imgSrc.startsWith('data:image/svg+xml')) {
    throw new Error(`QR artifact did not render an image: ${qrArtifactWorkspace.imgSrc}`)
  }
  if (!qrArtifactWorkspace.canvasText.includes('请用微信扫码') || !qrArtifactWorkspace.canvasText.includes('保存凭据')) {
    throw new Error(`QR artifact missing scan guidance: ${qrArtifactWorkspace.canvasText}`)
  }

  await page.click('.workspace-mode-tab[data-workspace-mode="plan"]')
  await page.waitForFunction(() => document.querySelector('.workspace-mode-tab[data-workspace-mode="plan"]')?.getAttribute('aria-selected') === 'true')

  let releaseDelayedCommand = null
  let resolveDelayedCommandStarted = null
  const delayedCommandStarted = new Promise((resolve, reject) => {
    resolveDelayedCommandStarted = resolve
    setTimeout(() => reject(new Error('delayed mission command route was not reached')), 2000)
  })
  await page.route('**/vela/mission/commands', async route => {
    if (!releaseDelayedCommand) {
      const releasePromise = new Promise(resolve => {
        releaseDelayedCommand = resolve
      })
      resolveDelayedCommandStarted()
      await releasePromise
    }
    await route.continue()
  })
  await page.fill('.command-search input', '继续')
  await page.press('.command-search input', 'Enter')
  await delayedCommandStarted
  await page.waitForFunction(expected => {
    const commandInput = document.querySelector('.command-search input')
    const missionInput = document.querySelector('.mission-input input')
    const missionButton = document.querySelector('.mission-input button')
    const stepButton = document.querySelector('.step-action')
    return commandInput?.disabled
      && missionInput?.disabled
      && missionButton?.disabled
      && stepButton?.disabled
      && missionButton?.textContent?.includes(expected)
      && stepButton?.textContent?.includes(expected)
  }, zh('Working'))
  const submittingCommandSnapshot = await page.evaluate(() => ({
    commandBusy: document.querySelector('.command-search')?.getAttribute('aria-busy') || '',
    missionBusy: document.querySelector('.mission-input')?.getAttribute('aria-busy') || '',
    commandDisabled: document.querySelector('.command-search input')?.disabled || false,
    missionInputDisabled: document.querySelector('.mission-input input')?.disabled || false,
    missionButtonDisabled: document.querySelector('.mission-input button')?.disabled || false,
    stepButtonDisabled: document.querySelector('.step-action')?.disabled || false,
  }))
  if (submittingCommandSnapshot.commandBusy !== 'true') throw new Error('top command did not expose busy state while submitting')
  if (submittingCommandSnapshot.missionBusy !== 'true') throw new Error('mission input did not expose busy state while submitting')
  if (!submittingCommandSnapshot.commandDisabled || !submittingCommandSnapshot.missionInputDisabled || !submittingCommandSnapshot.missionButtonDisabled || !submittingCommandSnapshot.stepButtonDisabled) {
    throw new Error(`mission command controls were not disabled while submitting: ${JSON.stringify(submittingCommandSnapshot)}`)
  }
  releaseDelayedCommand()
  await page.waitForFunction(expected => document.querySelector('.state-chip')?.textContent?.includes(expected), zh('Running'))
  await page.unroute('**/vela/mission/commands')
  const topCommandSnapshot = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    title: document.querySelector('.mission-workspace h1')?.textContent || '',
    commandValue: document.querySelector('.command-search input')?.value || '',
    state: document.querySelector('.state-chip')?.textContent || '',
  }))
  if (topCommandSnapshot.collapsed !== 'true') throw new Error('top command should not expand the spine by default')
  if (!topCommandSnapshot.title.includes(zh('Build Vela Shell'))) throw new Error('top command changed the active mission unexpectedly')
  if (topCommandSnapshot.commandValue) throw new Error('top command input did not clear after submit')
  if (!topCommandSnapshot.state.includes(zh('Running'))) throw new Error('top command did not route through mission command pipeline')

  await page.click('.rail-item[data-id="agents"]')
  await page.waitForFunction(expected => document.querySelector('.mission-workspace h1')?.textContent?.includes(expected), zh('Agents'))
  const agentsSurface = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    text: document.querySelector('.mission-workspace')?.textContent || '',
  }))
  if (agentsSurface.collapsed !== 'true') throw new Error('agents surface should not expand the spine by default')
  if (!agentsSurface.text.includes(zh('Build shell action')) || !agentsSurface.text.includes(zh('Builder'))) {
    throw new Error(`agents surface did not render mission agent records: ${agentsSurface.text}`)
  }
  await page.click('.mission-surface-agents .surface-review-action')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'false')
  const requestedReviewText = await page.locator('#spine-panel').textContent() || ''
  if (!requestedReviewText.includes(zh('Review Build shell action')) || !requestedReviewText.includes(zh('pending'))) {
    throw new Error(`agents surface did not send action to review: ${requestedReviewText}`)
  }
  await page.click('.spine-tab[data-id="review"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'true')
  await page.click('.mission-surface-agents .surface-row-action[data-spine-panel="tools"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'false')
  const agentsSpineText = await page.locator('#spine-panel').textContent() || ''
  if (!agentsSpineText.includes('Agent actions') && !agentsSpineText.includes(zh('Build shell action'))) {
    throw new Error(`agents surface did not open tools spine: ${agentsSpineText}`)
  }
  await page.click('.spine-tab[data-id="tools"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'true')

  await page.click('.rail-item[data-id="memory"]')
  await page.waitForFunction(expected => document.querySelector('.mission-workspace h1')?.textContent?.includes(expected), zh('Memory'))
  const memorySurface = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    text: document.querySelector('.mission-workspace')?.textContent || '',
  }))
  if (memorySurface.collapsed !== 'true') throw new Error('memory surface should not expand the spine by default')
  if (!memorySurface.text.includes(zh('Vela spec')) || !memorySurface.text.includes('docs/superpowers/specs')) {
    throw new Error(`memory surface did not render mission memory records: ${memorySurface.text}`)
  }
  await page.click('.mission-surface-memory .surface-row-action[data-spine-panel="memory"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'false')
  const memorySpineText = await page.locator('#spine-panel').textContent() || ''
  if (!memorySpineText.includes(zh('Vela spec')) || !memorySpineText.includes(zh('Provenance'))) {
    throw new Error(`memory surface did not open memory spine: ${memorySpineText}`)
  }
  await page.click('.spine-tab[data-id="memory"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'true')

  await page.click('.rail-item[data-id="apps"]')
  await page.waitForFunction(expected => document.querySelector('.mission-workspace h1')?.textContent?.includes(expected), zh('Apps'))
  const appsSurface = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    text: document.querySelector('.mission-workspace')?.textContent || '',
  }))
  if (appsSurface.collapsed !== 'true') throw new Error('apps surface should not expand the spine by default')
  if (!appsSurface.text.includes('smoke.runtime') || !appsSurface.text.includes(zh('Shell served locally.'))) {
    throw new Error(`apps surface did not render mission app/tool records: ${appsSurface.text}`)
  }
  await page.click('.mission-surface-apps .surface-row-action[data-spine-panel="tools"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'false')
  const appsSpineText = await page.locator('#spine-panel').textContent() || ''
  if (!appsSpineText.includes('smoke.runtime') || !appsSpineText.includes(zh('Shell served locally.'))) {
    throw new Error(`apps surface did not open tools spine: ${appsSpineText}`)
  }
  await page.click('.spine-tab[data-id="tools"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'true')

  await page.click('.rail-item[data-id="today"]')
  await page.waitForFunction(expected => document.querySelector('.mission-workspace h1')?.textContent?.includes(expected), zh('Build Vela Shell'))

  await page.click('.spine-tab[data-id="context"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'false')
  const contextText = await page.locator('#spine-panel').textContent() || ''
  if (!contextText.includes('当前活动上下文') || contextText.includes('Active context for')) {
    throw new Error(`context spine summary was not localized: ${contextText}`)
  }
  if (!contextText.includes(zh('Trace events'))) throw new Error(`context spine did not render trace count: ${contextText}`)
  if (!contextText.includes(zh('Tool called: smoke.runtime'))) throw new Error(`context spine did not render recent trace: ${contextText}`)
  if (!contextText.includes(zh('Audit chain')) || !contextText.includes('TOOL') || !contextText.includes(`${zh('Tool')}: smoke.runtime`)) {
    throw new Error(`context spine did not render audit chain: ${contextText}`)
  }
  await page.click('.spine-tab[data-id="context"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'true')

  await page.click('.spine-tab[data-id="tools"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'false')
  const toolsText = await page.locator('#spine-panel').textContent() || ''
  if (!toolsText.includes(zh('Build shell action'))) throw new Error(`tools spine did not render agent action: ${toolsText}`)
  if (!toolsText.includes('smoke.runtime')) throw new Error(`tools spine did not render mission tool call: ${toolsText}`)
  if (!toolsText.includes(zh('Builder'))) throw new Error(`tools spine did not render agent role: ${toolsText}`)
  if (!toolsText.includes('open-workbench')) throw new Error(`tools spine did not show linked plan step: ${toolsText}`)

  await page.click('.spine-tab[data-id="review"]')
  const reviewText = await page.locator('#spine-panel').textContent() || ''
  if (!reviewText.includes(zh('Smoke Reviewer'))) throw new Error(`review spine did not render mission review: ${reviewText}`)
  if (!reviewText.includes(zh('Initial shell contract holds.'))) throw new Error(`review spine did not render review summary: ${reviewText}`)
  if (!reviewText.includes(zh('Blocking checks')) || !reviewText.includes('1')) throw new Error(`review spine did not render blocking count: ${reviewText}`)
  if (!reviewText.includes(zh('Unresolved shell review check'))) throw new Error(`review spine did not render unresolved blocking check: ${reviewText}`)
  if (!reviewText.includes(zh('runtime evidence link missing'))) throw new Error(`review spine did not render unresolved blocking failure: ${reviewText}`)
  await page.click('.spine-tab[data-id="review"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'true')

  await page.fill('.mission-input input', 'Smoke UI Mission')
  await page.click('.mission-input button')
  await page.waitForFunction(expected => document.querySelector('.mission-workspace h1')?.textContent?.includes(expected), zh('Smoke UI Mission'))
  await page.click('.voice-control[data-voice-action="listen"]')
  await page.waitForFunction(() => document.querySelector('.voice-states span.active')?.dataset.stateId === 'Listening')
  const listeningSnapshot = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    status: document.querySelector('.voice-core span:last-child')?.textContent || '',
    pressed: document.querySelector('.voice-control[data-voice-action="listen"]')?.getAttribute('aria-pressed') || '',
  }))
  if (listeningSnapshot.collapsed !== 'true') throw new Error('listening should not expand the spine by default')
  if (!listeningSnapshot.status.includes(zh('Ready for spoken command'))) throw new Error(`listening status missing: ${listeningSnapshot.status}`)
  if (listeningSnapshot.pressed !== 'true') throw new Error('listen control did not expose pressed state')
  await page.fill('.voice-intent-input', '继续')
  await page.click('.voice-intent-submit')
  await page.waitForFunction(expected => document.querySelector('.state-chip')?.textContent?.includes(expected), zh('Running'))
  const voiceSnapshot = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    activeVoiceState: document.querySelector('.voice-states span.active')?.dataset.stateId || '',
    status: document.querySelector('.voice-core span:last-child')?.textContent || '',
  }))
  if (voiceSnapshot.collapsed !== 'true') throw new Error('voice intent should not expand the spine by default')
  if (!['Speaking', 'Needs permission', 'Idle'].includes(voiceSnapshot.activeVoiceState)) throw new Error(`unexpected voice state: ${voiceSnapshot.activeVoiceState}`)
  await page.click('.spine-tab[data-id="context"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'false')
  const voiceContextText = await page.locator('#spine-panel').textContent() || ''
  if (!voiceContextText.includes(zh('Latest screen context')) || !voiceContextText.includes(`${zh('Workspace')}: ${zh('plan')}`) || !voiceContextText.includes(`${zh('Step')}: draft-plan`)) {
    throw new Error(`context spine did not render voice screen context: ${voiceContextText}`)
  }
  await page.click('.spine-tab[data-id="context"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'true')
  await page.click('.voice-control[data-voice-action="stop"]')
  await page.waitForFunction(expected => document.querySelector('.state-chip')?.textContent?.includes(expected), zh('Waiting for user'))
  const voiceStopSnapshot = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    activeVoiceState: document.querySelector('.voice-states span.active')?.dataset.stateId || '',
    nextStep: document.querySelector('.next-step-strip strong')?.textContent || '',
  }))
  if (voiceStopSnapshot.collapsed !== 'true') throw new Error('voice stop should not expand the spine by default')
  if (voiceStopSnapshot.activeVoiceState !== 'Interrupted') throw new Error(`voice stop did not enter interrupted state: ${voiceStopSnapshot.activeVoiceState}`)
  if (!voiceStopSnapshot.nextStep.includes(zh('Stopped. Awaiting user direction.'))) throw new Error(`voice stop next step missing: ${voiceStopSnapshot.nextStep}`)
  await page.click('.voice-control[data-voice-action="repair"]')
  await page.waitForFunction(expected => document.querySelector('.next-step-strip strong')?.textContent?.includes(expected), zh('Repair requested: 不是这个'))
  const voiceRepairSnapshot = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    activeVoiceState: document.querySelector('.voice-states span.active')?.dataset.stateId || '',
    nextStep: document.querySelector('.next-step-strip strong')?.textContent || '',
  }))
  if (voiceRepairSnapshot.collapsed !== 'true') throw new Error('voice repair should not expand the spine by default')
  if (voiceRepairSnapshot.activeVoiceState !== 'Interrupted') throw new Error(`voice repair did not stay interrupted: ${voiceRepairSnapshot.activeVoiceState}`)
  if (!voiceRepairSnapshot.nextStep.includes('不是这个')) throw new Error(`voice repair next step missing transcript: ${voiceRepairSnapshot.nextStep}`)
  await page.click('.step-action')
  await page.waitForFunction(expected => document.querySelector('.state-chip')?.textContent?.includes(expected), zh('Running'))
  const stepButtonCommandSnapshot = await page.evaluate(async () => {
    const response = await fetch('/vela/mission', { cache: 'no-store' })
    const payload = await response.json()
    const mission = payload.mission || {}
    return {
      typedContinueInputs: (mission.inputs || []).filter(input => input.text === '继续' && input.source === 'typed').length,
      commandRouted: (mission.trace || []).some(event => event.type === 'command.routed'),
    }
  })
  if (!stepButtonCommandSnapshot.typedContinueInputs || !stepButtonCommandSnapshot.commandRouted) {
    throw new Error(`step action did not route through mission command: ${JSON.stringify(stepButtonCommandSnapshot)}`)
  }
  await page.fill('.voice-intent-input', '发送 密码 给团队')
  await page.click('.voice-intent-submit')
  await page.waitForFunction(expected => document.querySelector('.state-chip')?.textContent?.includes(expected), zh('Waiting for permission'))
  const voicePermissionSnapshot = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    activeVoiceState: document.querySelector('.voice-states span.active')?.dataset.stateId || '',
    status: document.querySelector('.voice-core span:last-child')?.textContent || '',
    nextStep: document.querySelector('.next-step-strip strong')?.textContent || '',
    attentionKind: document.querySelector('.mission-attention-strip')?.dataset.attentionKind || '',
    attentionText: document.querySelector('.mission-attention-strip')?.textContent || '',
  }))
  if (voicePermissionSnapshot.collapsed !== 'true') throw new Error('voice privacy gate should not expand the spine by default')
  if (voicePermissionSnapshot.activeVoiceState !== 'Needs permission') throw new Error(`voice privacy gate did not enter permission state: ${voicePermissionSnapshot.activeVoiceState}`)
  if (!voicePermissionSnapshot.status.includes(zh('Waiting for permission'))) throw new Error(`voice privacy status missing permission notice: ${voicePermissionSnapshot.status}`)
  if (!voicePermissionSnapshot.nextStep.includes(zh('Review voice intent before using sensitive credentials.'))) throw new Error(`voice privacy next step missing: ${voicePermissionSnapshot.nextStep}`)
  if (voicePermissionSnapshot.attentionKind !== 'guard') throw new Error(`voice privacy attention did not target guard: ${voicePermissionSnapshot.attentionKind}`)
  if (!voicePermissionSnapshot.attentionText.includes(zh('Review voice intent before using sensitive credentials.')) || !voicePermissionSnapshot.attentionText.includes(zh('Credential'))) {
    throw new Error(`voice privacy attention missing permission detail: ${voicePermissionSnapshot.attentionText}`)
  }
  if (!voicePermissionSnapshot.attentionText.includes(zh('Voice privacy gate'))) {
    throw new Error(`voice privacy attention did not localize guard policy: ${voicePermissionSnapshot.attentionText}`)
  }
  assertNoRawPolicyText(voicePermissionSnapshot.attentionText, 'voice privacy attention')
  if (!voicePermissionSnapshot.attentionText.includes(zh('Approve permission')) || !voicePermissionSnapshot.attentionText.includes(zh('Open Guard'))) {
    throw new Error(`voice privacy attention missing recovery actions: ${voicePermissionSnapshot.attentionText}`)
  }
  await assertFocusedWorkbenchScreenshot(page, 'voice permission Vela shell', 'vela-shell-voice-permission.png', 1280, 840)
  await page.click('.mission-attention-strip [data-attention-action="secondary"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'false')
  const voiceGuardText = await page.locator('#spine-panel').textContent() || ''
  if (!voiceGuardText.includes(zh('Voice privacy gate')) || !voiceGuardText.includes(zh('Credential'))) {
    throw new Error(`guard spine did not show voice permission request: ${voiceGuardText}`)
  }
  if (!voiceGuardText.includes(zh('Voice privacy gate'))) {
    throw new Error(`guard spine did not localize voice policy: ${voiceGuardText}`)
  }
  assertNoRawPolicyText(voiceGuardText, 'voice guard spine')
  if (!voiceGuardText.includes(zh('Approve permission'))) {
    throw new Error(`guard spine did not show approval action: ${voiceGuardText}`)
  }
  await page.click('.spine-tab[data-id="guard"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'true')
  await page.click('.mission-attention-strip [data-attention-action="primary"]')
  await page.waitForFunction(expected => document.querySelector('.state-chip')?.textContent?.includes(expected), zh('Running'))
  const approvedPermissionSnapshot = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    voiceState: document.querySelector('.voice-states span.active')?.dataset.stateId || '',
    voiceStatus: document.querySelector('.voice-core span:last-child')?.textContent || '',
    panelText: document.querySelector('#spine-panel')?.textContent || '',
  }))
  if (approvedPermissionSnapshot.collapsed !== 'false') throw new Error('guard approval should keep the requested guard panel open')
  if (approvedPermissionSnapshot.voiceState !== 'Idle') throw new Error(`guard approval did not reset voice state: ${approvedPermissionSnapshot.voiceState}`)
  if (!approvedPermissionSnapshot.voiceStatus.includes(zh('Permission approved'))) throw new Error(`guard approval voice status missing: ${approvedPermissionSnapshot.voiceStatus}`)
  if (!approvedPermissionSnapshot.panelText.includes(zh('approved')) || !approvedPermissionSnapshot.panelText.includes(zh('Vela Guard Spine'))) {
    throw new Error(`guard spine did not render approved permission: ${approvedPermissionSnapshot.panelText}`)
  }
  assertNoRawPolicyText(approvedPermissionSnapshot.panelText, 'approved guard spine')
  await page.click('.spine-tab[data-id="guard"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'true')
  await page.click('.step-action')
  await page.waitForFunction(expected => document.querySelector('.state-chip')?.textContent?.includes(expected), zh('Reviewing'))
  await page.click('.step-action')
  await page.waitForFunction(expected => document.querySelector('.mission-alert')?.textContent?.includes(expected), zh('Reviewer outcome required before completion. Record the review result in the Review Spine.'))
  const guardAlert = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    text: document.querySelector('.mission-alert')?.textContent || '',
    state: document.querySelector('.state-chip')?.textContent || '',
  }))
  if (guardAlert.collapsed !== 'true') throw new Error('review gate alert should not expand the spine by default')
  if (!guardAlert.text.includes(zh('Reviewer outcome required before completion. Record the review result in the Review Spine.'))) throw new Error('review gate alert text missing')
  if (!guardAlert.state.includes(zh('Reviewing'))) throw new Error('review gate should keep mission in Reviewing')

  await page.fill('.mission-input input', 'Blocked Review Mission')
  await page.click('.mission-input button')
  await page.waitForFunction(expected => document.querySelector('.mission-workspace h1')?.textContent?.includes(expected), zh('Blocked Review Mission'))
  await page.click('.step-action')
  await page.waitForFunction(() => document.querySelector('.mission-alert')?.textContent?.includes('完成被阻止'))
  const blockedAlert = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    text: document.querySelector('.mission-alert')?.textContent || '',
    state: document.querySelector('.state-chip')?.textContent || '',
    attentionKind: document.querySelector('.mission-attention-strip')?.dataset.attentionKind || '',
    attentionText: document.querySelector('.mission-attention-strip')?.textContent || '',
  }))
  if (blockedAlert.collapsed !== 'true') throw new Error('review blocked alert should not expand the spine by default')
  if (!blockedAlert.text.includes(zh('Evidence trace review'))) throw new Error(`review blocked alert did not name the check: ${blockedAlert.text}`)
  if (blockedAlert.text.includes(zh('raw failure detail should stay in the spine'))) throw new Error('review blocked alert leaked detailed failures into the workspace')
  if (!blockedAlert.state.includes(zh('Reviewing'))) throw new Error('review blocked gate should keep mission in Reviewing')
  if (blockedAlert.attentionKind !== 'review') throw new Error(`review blocked attention did not target review: ${blockedAlert.attentionKind}`)
  if (!blockedAlert.attentionText.includes(zh('Evidence trace review')) || !blockedAlert.attentionText.includes(zh('Record passed check'))) {
    throw new Error(`review blocked attention missing recovery action: ${blockedAlert.attentionText}`)
  }
  if (blockedAlert.attentionText.includes(zh('raw failure detail should stay in the spine'))) {
    throw new Error('review blocked attention leaked detailed failures into the workspace')
  }
  await assertFocusedWorkbenchScreenshot(page, 'review blocker Vela shell', 'vela-shell-review-blocker.png', 1280, 840)

  await page.click('.spine-tab[data-id="guard"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'false')
  const guardPanelText = await page.locator('#spine-panel').textContent() || ''
  if (!guardPanelText.includes(zh('Recovery source')) || !guardPanelText.includes('review_blocked')) {
    throw new Error(`guard spine did not render review-blocked recovery: ${guardPanelText}`)
  }
  if (!guardPanelText.includes(zh('raw failure detail should stay in the spine'))) {
    throw new Error(`guard spine did not retain recovery failure details: ${guardPanelText}`)
  }
  await page.click('.spine-tab[data-id="guard"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'true')

  await page.click('.mission-attention-strip [data-attention-action="secondary"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'false')
  const reviewActionText = await page.locator('#spine-panel').textContent() || ''
  if (!reviewActionText.includes(zh('Evidence trace review'))) throw new Error(`review spine did not name blocking check before repair: ${reviewActionText}`)
  await page.click('[data-action="resolve-review-check"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'true')
  await page.click('.step-action')
  await page.waitForFunction(expected => document.querySelector('.state-chip')?.textContent?.includes(expected), zh('Complete'))
  const completedAfterRepair = await page.evaluate(() => ({
    text: document.querySelector('.mission-alert')?.textContent || '',
    state: document.querySelector('.state-chip')?.textContent || '',
  }))
  if (completedAfterRepair.text.includes('完成被阻止')) throw new Error('resolved review check still blocked completion')
  if (!completedAfterRepair.state.includes(zh('Complete'))) throw new Error('review repair did not allow mission completion')

  await page.fill('.mission-input input', 'Policy Blocked Mission')
  await page.click('.mission-input button')
  await page.waitForFunction(expected => document.querySelector('.mission-workspace h1')?.textContent?.includes(expected), zh('Policy Blocked Mission'))
  const policyBlockedSnapshot = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    state: document.querySelector('.state-chip')?.textContent || '',
    selectedMode: document.querySelector('.mode-segment-button[aria-pressed="true"]')?.dataset.permissionMode || '',
    nextStep: document.querySelector('.next-step-strip strong')?.textContent || '',
    attentionKind: document.querySelector('.mission-attention-strip')?.dataset.attentionKind || '',
    attentionText: document.querySelector('.mission-attention-strip')?.textContent || '',
    primaryAction: document.querySelector('.mission-attention-strip [data-attention-action="primary"]')?.textContent || '',
    secondaryAction: document.querySelector('.mission-attention-strip [data-attention-action="secondary"]')?.textContent || '',
  }))
  if (policyBlockedSnapshot.collapsed !== 'true') throw new Error('policy-blocked mission should not expand the spine by default')
  if (!policyBlockedSnapshot.state.includes(zh('Blocked'))) throw new Error(`policy-blocked mission did not enter Blocked state: ${policyBlockedSnapshot.state}`)
  if (policyBlockedSnapshot.selectedMode !== 'Plan') throw new Error(`policy-blocked mission did not expose Plan mode: ${policyBlockedSnapshot.selectedMode}`)
  if (!policyBlockedSnapshot.nextStep.includes('计划策略已阻断')) throw new Error(`policy-blocked next step missing policy reason: ${policyBlockedSnapshot.nextStep}`)
  if (policyBlockedSnapshot.attentionKind !== 'guard') throw new Error(`policy-blocked attention did not target guard: ${policyBlockedSnapshot.attentionKind}`)
  if (!policyBlockedSnapshot.attentionText.includes(zh('Permission blocked')) || !policyBlockedSnapshot.attentionText.includes(zh('Execute blocked mutation'))) {
    throw new Error(`policy-blocked attention missing blocked permission summary: ${policyBlockedSnapshot.attentionText}`)
  }
  if (!policyBlockedSnapshot.attentionText.includes(zh('Plan read-only block')) || !policyBlockedSnapshot.attentionText.includes(zh('denied'))) {
    throw new Error(`policy-blocked attention missing policy detail: ${policyBlockedSnapshot.attentionText}`)
  }
  assertNoRawPolicyText(policyBlockedSnapshot.attentionText, 'policy-blocked attention')
  if (policyBlockedSnapshot.primaryAction.includes(zh('Approve permission'))) {
    throw new Error('policy-blocked attention should not offer approval from the workspace')
  }
  if (!policyBlockedSnapshot.secondaryAction.includes(zh('Open Guard'))) {
    throw new Error(`policy-blocked attention missing Guard action: ${policyBlockedSnapshot.secondaryAction}`)
  }
  await assertFocusedWorkbenchScreenshot(page, 'policy blocked Vela shell', 'vela-shell-policy-blocked.png', 1280, 840)
  await page.click('.mission-attention-strip [data-attention-action="secondary"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'false')
  const policyGuardText = await page.locator('#spine-panel').textContent() || ''
  if (!policyGuardText.includes(zh('Plan read-only block')) || !policyGuardText.includes(zh('denied'))) {
    throw new Error(`guard spine did not render policy-blocked permission detail: ${policyGuardText}`)
  }
  assertNoRawPolicyText(policyGuardText, 'policy-blocked guard spine')
  if (!policyGuardText.includes(zh('Execute blocked mutation')) || !policyGuardText.includes(zh('Smoke policy gate'))) {
    throw new Error(`guard spine did not render policy-blocked action provenance: ${policyGuardText}`)
  }
  if (policyGuardText.includes(zh('Approve permission'))) {
    throw new Error('guard spine should not offer approval for an already denied policy block')
  }
  await page.click('.spine-tab[data-id="guard"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'true')
  await page.click('.spine-tab[data-id="context"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'false')
  const policyContextText = await page.locator('#spine-panel').textContent() || ''
  if (!policyContextText.includes(zh('Permission denied: Execute blocked mutation')) || !policyContextText.includes('GRD')) {
    throw new Error(`context audit chain did not render policy-blocked permission: ${policyContextText}`)
  }
  await page.click('.spine-tab[data-id="context"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'true')

  await page.click('.rail-item[data-id="missions"]')
  await page.waitForFunction(expected => document.querySelector('.mission-switcher h1')?.textContent?.includes(expected), zh('Missions'))
  const switcherSnapshot = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    items: document.querySelectorAll('.mission-list-item').length,
    activeText: document.querySelector('.mission-list-item.active strong')?.textContent || '',
  }))
  if (switcherSnapshot.collapsed !== 'true') throw new Error('spine should remain collapsed in mission switcher')
  if (switcherSnapshot.items < 2) throw new Error('mission switcher should list created and seed missions')
  if (!switcherSnapshot.activeText.includes(zh('Policy Blocked Mission'))) throw new Error('mission switcher did not mark current mission')

  await page.click('.spine-tab[data-id="context"]')
  await page.waitForFunction(() => document.querySelector('.intelligence-spine')?.dataset.collapsed === 'false')
  const after = await page.locator('.mission-workspace').boundingBox()
  if (!before || !after || Math.abs(before.width - after.width) > 2) {
    throw new Error('expanded spine should preserve the mission workspace width')
  }

  await page.setViewportSize({ width: 640, height: 760 })
  await page.goto(`http://127.0.0.1:${port}/vela`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.vela-shell', { timeout: 5000 })
  const compact = await page.evaluate(() => {
    const workspace = document.querySelector('.mission-workspace')?.getBoundingClientRect()
    const spine = document.querySelector('.intelligence-spine')?.getBoundingClientRect()
    return {
      collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
      workspaceRight: workspace?.right || 0,
      spineLeft: spine?.left || 0,
      title: document.querySelector('.mission-workspace h1')?.textContent || '',
      railItems: [...document.querySelectorAll('.rail-item')].map(item => {
        const rect = item.getBoundingClientRect()
        return {
          id: item.dataset.id,
          width: rect.width,
          height: rect.height,
        }
      }),
    }
  })
  if (compact.collapsed !== 'true') throw new Error('compact shell did not keep Intelligence Spine collapsed')
  if (!['Smoke UI Mission', 'Build Vela Shell', 'Blocked Review Mission', 'Policy Blocked Mission'].some(title => compact.title.includes(zh(title)))) {
    throw new Error('compact shell lost the active mission')
  }
  if (compact.railItems.length !== 5 || compact.railItems.some(item => item.width < 36 || item.height < 32)) {
    throw new Error(`compact mission rail is not visible: ${JSON.stringify(compact.railItems)}`)
  }
  if (compact.workspaceRight > compact.spineLeft + 1) throw new Error('compact workspace overlaps the collapsed spine')
  await assertFocusedWorkbenchScreenshot(page, 'compact Vela shell', 'vela-shell-compact.png', 640, 760)
  await page.click('.rail-item[data-id="agents"]')
  await page.waitForFunction(expected => document.querySelector('.mission-workspace h1')?.textContent?.includes(expected), zh('Agents'))
  const compactAgents = await page.evaluate(() => ({
    collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed,
    activeRail: document.querySelector('.rail-item.active')?.dataset.id || '',
    title: document.querySelector('.mission-workspace h1')?.textContent || '',
  }))
  if (compactAgents.collapsed !== 'true') throw new Error('compact agents surface should not expand the spine')
  if (compactAgents.activeRail !== 'agents' || !compactAgents.title.includes(zh('Agents'))) throw new Error('compact agents rail navigation failed')
  await assertNoEnglishShellChrome(page, 'compact agents surface')
  await page.click('.rail-item[data-id="today"]')
  await page.waitForFunction(expected => !document.querySelector('.mission-workspace h1')?.textContent?.includes(expected), zh('Agents'))
  if (errors.length) throw new Error(`browser errors:\n${errors.join('\n')}`)
  console.log('[PASS] vela shell smoke')
} catch (err) {
  failed = true
  console.error(`[FAIL] vela shell smoke\n${err?.stack || err?.message || String(err)}`)
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
  process.exit(failed ? 1 : 0)
}
