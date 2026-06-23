import fs from 'fs'
import os from 'os'
import path from 'path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blm-vela-mission-'))
process.env.BAILONGMA_USER_DIR = tmp

let failed = 0
function assert(condition, label) {
  if (!condition) {
    console.error(`FAIL: ${label}`)
    failed += 1
    process.exitCode = 1
  } else {
    console.log(`PASS: ${label}`)
  }
}

try {
  const runtime = await import('./vela/mission-runtime.js')
  const capabilityAdapters = await import('./vela/capability-adapters.js')
  const capabilityRegistry = await import('./vela/capability-registry.js')
  const desktopAdapterBridge = await import('./vela/desktop-adapter-bridge.js')
  const wechatIlinkAdapter = await import('./vela/wechat-ilink-adapter.js')
  const githubReader = await import('./vela/github-reader.js')

  const wechatIlinkPreflight = wechatIlinkAdapter.preflightWechatIlinkAdapter({ env: {} })
  assert(wechatIlinkPreflight.packageAvailable === true, 'WeChat iLink preflight detects installed client package')
  assert(wechatIlinkPreflight.credentialStatus === 'missing', 'WeChat iLink preflight reports missing credentials')
  assert(wechatIlinkPreflight.missingCredentials.includes('VELA_WECHAT_ILINK_TOKEN'), 'WeChat iLink preflight lists missing token')
  assert(wechatIlinkPreflight.recipientStatus === 'missing', 'WeChat iLink preflight requires a recipient user id for send')
  assert(wechatIlinkAdapter.wechatIlinkEvidence(wechatIlinkPreflight).some(item => item.includes('微信库可用：yes')), 'WeChat iLink evidence records package availability')
  const readyWechatIlink = wechatIlinkAdapter.preflightWechatIlinkAdapter({
    env: {
      VELA_WECHAT_ILINK_TOKEN: 'test-token',
      VELA_WECHAT_ILINK_ACCOUNT_ID: 'test-account',
      VELA_WECHAT_ILINK_DEFAULT_TO_USER_ID: 'test-user',
    },
  })
  assert(readyWechatIlink.available === true, 'WeChat iLink preflight can become available with credentials and recipient')
  assert(readyWechatIlink.executionMode === 'live', 'WeChat iLink preflight marks configured adapter live')
  const wechatCredentialFile = path.join(tmp, 'wechat-ilink-test-credentials.json')
  const savedWechatCredentials = wechatIlinkAdapter.saveWechatIlinkCredentials({
    token: 'test-token-1234567890',
    accountId: 'test-account-1234567890',
    defaultRecipientUserId: 'wife-user-123456',
  }, { filePath: wechatCredentialFile, savedAt: '2026-06-23T00:00:00.000Z' })
  assert(savedWechatCredentials.filePath === wechatCredentialFile, 'WeChat iLink credential save returns store path')
  assert(savedWechatCredentials.credentials.token !== 'test-token-1234567890', 'WeChat iLink credential save returns redacted token')
  const loadedWechatCredentials = wechatIlinkAdapter.loadWechatIlinkStoredCredentials({ filePath: wechatCredentialFile })
  assert(loadedWechatCredentials.token === 'test-token-1234567890', 'WeChat iLink credential store loads token')
  assert(loadedWechatCredentials.accountId === 'test-account-1234567890', 'WeChat iLink credential store loads account id')
  const storedWechatPreflight = wechatIlinkAdapter.preflightWechatIlinkAdapter({ env: {}, filePath: wechatCredentialFile })
  assert(storedWechatPreflight.available === true, 'WeChat iLink preflight can use stored credentials')
  assert(storedWechatPreflight.credentialSource === 'local-store', 'WeChat iLink preflight records local credential source')
  assert(storedWechatPreflight.recipientStatus === 'configured', 'WeChat iLink preflight uses stored default recipient')
  const dryWechatSend = await wechatIlinkAdapter.sendWechatIlinkTextMessage({
    filePath: wechatCredentialFile,
    text: '测试发送内容',
    env: {},
  })
  assert(dryWechatSend.status === 'simulated', 'WeChat iLink send is simulated by default')
  assert(dryWechatSend.messageSent === false, 'WeChat iLink simulated send does not send message')
  assert(wechatIlinkAdapter.wechatIlinkSendEvidence(dryWechatSend).some(item => item.includes('微信消息已发送：no')), 'WeChat iLink send evidence records unsent state')
  const missingWechatSendText = await wechatIlinkAdapter.sendWechatIlinkTextMessage({
    filePath: wechatCredentialFile,
    env: {},
    allowSend: true,
  })
  assert(missingWechatSendText.status === 'blocked', 'WeChat iLink send requires message text')
  let fakeWechatSendOpts = null
  let fakeWechatSendCall = null
  const liveWechatSend = await wechatIlinkAdapter.sendWechatIlinkTextMessage({
    filePath: wechatCredentialFile,
    text: '真实发送测试',
    contextToken: 'ctx-send-1',
    allowSend: true,
    clientModule: {
      WeChatClient: class {
        constructor(opts) {
          fakeWechatSendOpts = opts
        }

        async sendText(to, text, contextToken) {
          fakeWechatSendCall = { to, text, contextToken }
          return { status: 'ok' }
        }
      },
    },
    env: {},
  })
  assert(liveWechatSend.status === 'sent', 'WeChat iLink live send records sent status')
  assert(liveWechatSend.messageSent === true, 'WeChat iLink live send marks message sent')
  assert(fakeWechatSendOpts.token === 'test-token-1234567890', 'WeChat iLink live send passes token to client only')
  assert(fakeWechatSendOpts.accountId === 'test-account-1234567890', 'WeChat iLink live send passes account id to client')
  assert(fakeWechatSendCall.to === 'wife-user-123456', 'WeChat iLink live send uses stored default recipient')
  assert(fakeWechatSendCall.text === '真实发送测试', 'WeChat iLink live send passes approved text')
  assert(fakeWechatSendCall.contextToken === 'ctx-send-1', 'WeChat iLink live send passes context token')
  assert(!wechatIlinkAdapter.wechatIlinkSendEvidence(liveWechatSend).join('\n').includes('test-token-1234567890'), 'WeChat iLink send evidence does not expose raw token')
  const missingWechatSendClient = await wechatIlinkAdapter.sendWechatIlinkTextMessage({
    filePath: wechatCredentialFile,
    text: '真实发送测试',
    allowSend: true,
    clientModule: {},
    env: {},
  })
  assert(missingWechatSendClient.status === 'blocked', 'WeChat iLink live send blocks when WeChatClient export is missing')
  const dryWechatRead = await wechatIlinkAdapter.readWechatIlinkRecentMessages({
    filePath: wechatCredentialFile,
    env: {},
  })
  assert(dryWechatRead.status === 'simulated', 'WeChat iLink recent read is simulated by default')
  assert(dryWechatRead.messageCount === 0, 'WeChat iLink simulated recent read does not read messages by default')
  const mockWechatRead = await wechatIlinkAdapter.readWechatIlinkRecentMessages({
    filePath: wechatCredentialFile,
    mockMessages: [{
      from_user_id: 'wife-user-123456',
      context_token: 'ctx-mock-read',
      item_list: [{ type: 1, text_item: { text: '今晚几点回家？' } }],
    }],
    env: {},
  })
  assert(mockWechatRead.status === 'simulated', 'WeChat iLink mock recent read stays simulated')
  assert(mockWechatRead.messageCount === 1, 'WeChat iLink mock recent read keeps injected message')
  assert(mockWechatRead.messages[0].text === '今晚几点回家？', 'WeChat iLink mock recent read extracts text')
  let fakeWechatReadTimeout = null
  const liveWechatRead = await wechatIlinkAdapter.readWechatIlinkRecentMessages({
    filePath: wechatCredentialFile,
    allowRead: true,
    timeoutMs: 25,
    clientModule: {
      ApiClient: class {
        async getUpdates(syncBuf, timeoutMs) {
          fakeWechatReadTimeout = timeoutMs
          return {
            get_updates_buf: 'sync-after-read',
            msgs: [
              {
                from_user_id: 'wife-user-123456',
                to_user_id: 'test-account-1234567890',
                context_token: 'ctx-live-read',
                item_list: [{ type: 1, text_item: { text: '记得带牛奶。' } }],
              },
              {
                from_user_id: 'someone-else',
                item_list: [{ type: 1, text_item: { text: '忽略我' } }],
              },
            ],
          }
        }
      },
      WeChatClient: {
        extractText(message) {
          return message.item_list?.[0]?.text_item?.text || ''
        },
      },
    },
    env: {},
  })
  assert(liveWechatRead.status === 'ok', 'WeChat iLink live recent read records ok status')
  assert(fakeWechatReadTimeout === 25, 'WeChat iLink live recent read uses bounded timeout')
  assert(liveWechatRead.messageCount === 1, 'WeChat iLink live recent read filters recipient messages')
  assert(liveWechatRead.messages[0].text === '记得带牛奶。', 'WeChat iLink live recent read extracts live text')
  assert(liveWechatRead.syncBuf === 'sync-after-read', 'WeChat iLink live recent read records sync buffer')
  assert(wechatIlinkAdapter.wechatIlinkReadEvidence(liveWechatRead).some(item => item.includes('微信消息数量：1')), 'WeChat iLink recent read evidence records message count')
  const missingWechatReadClient = await wechatIlinkAdapter.readWechatIlinkRecentMessages({
    filePath: wechatCredentialFile,
    allowRead: true,
    clientModule: {},
    env: {},
  })
  assert(missingWechatReadClient.status === 'blocked', 'WeChat iLink live recent read blocks when ApiClient export is missing')
  const loginRequest = wechatIlinkAdapter.prepareWechatIlinkLoginRequest({ filePath: wechatCredentialFile })
  assert(loginRequest.risk === 'Credential', 'WeChat iLink login request is credential-gated')
  assert(loginRequest.guardrail.includes('必须分别经过用户确认'), 'WeChat iLink login request records separate confirmations')
  assert(loginRequest.realQrLoginEnabled === false, 'WeChat iLink login request keeps real QR network disabled by default')
  const dryWechatQrSession = await wechatIlinkAdapter.startWechatIlinkQrLoginSession({
    filePath: wechatCredentialFile,
    env: {},
    createdAt: '2026-06-23T00:00:00.000Z',
  })
  assert(dryWechatQrSession.status === 'waiting-for-network-enable', 'WeChat iLink QR session does not call network by default')
  assert(dryWechatQrSession.executionMode === 'simulated', 'WeChat iLink QR session is simulated until explicitly enabled')
  assert(dryWechatQrSession.tokenSaved === false, 'WeChat iLink QR session does not save credentials')
  assert(dryWechatQrSession.messageSent === false, 'WeChat iLink QR session does not send messages')
  assert(wechatIlinkAdapter.wechatIlinkQrSessionEvidence(dryWechatQrSession).some(item => item.includes('二维码请求已启用：no')), 'WeChat iLink QR evidence records disabled network')
  let fakeQrBotType = ''
  let fakeQrBaseUrl = ''
  let fakeQrRouteTag = ''
  const liveWechatQrSession = await wechatIlinkAdapter.startWechatIlinkQrLoginSession({
    filePath: wechatCredentialFile,
    env: {
      VELA_WECHAT_ILINK_ENABLE_REAL_LOGIN: '1',
      VELA_WECHAT_ILINK_BOT_TYPE: '9',
      VELA_WECHAT_ILINK_BASE_URL: 'https://ilink.example.test',
      VELA_WECHAT_ILINK_ROUTE_TAG: 'vela-test-route',
    },
    clientModule: {
      ApiClient: class {
        constructor(opts = {}) {
          fakeQrBaseUrl = opts.baseUrl
          fakeQrRouteTag = opts.routeTag
        }

        async getQRCode(botType) {
          fakeQrBotType = botType
          return {
            qrcode: 'qr-session-123',
            qrcode_img_content: 'https://qr.example.test/session-123',
          }
        }
      },
    },
    createdAt: '2026-06-23T00:00:00.000Z',
  })
  assert(liveWechatQrSession.status === 'qr-ready', 'WeChat iLink QR session can produce a QR URL through ApiClient')
  assert(liveWechatQrSession.executionMode === 'live', 'WeChat iLink QR session records live mode when enabled')
  assert(liveWechatQrSession.qrCodeId === 'qr-session-123', 'WeChat iLink QR session records QR id')
  assert(liveWechatQrSession.qrCodeUrl === 'https://qr.example.test/session-123', 'WeChat iLink QR session records QR URL')
  assert(fakeQrBotType === '9', 'WeChat iLink QR session forwards bot type')
  assert(fakeQrBaseUrl === 'https://ilink.example.test', 'WeChat iLink QR session forwards base URL')
  assert(fakeQrRouteTag === 'vela-test-route', 'WeChat iLink QR session forwards route tag')
  assert(liveWechatQrSession.tokenSaved === false, 'WeChat iLink QR URL generation still does not save credentials')
  assert(liveWechatQrSession.messageSent === false, 'WeChat iLink QR URL generation still does not send messages')
  assert(wechatIlinkAdapter.wechatIlinkQrSessionEvidence(liveWechatQrSession).some(item => item.includes('二维码状态：qr-ready')), 'WeChat iLink QR evidence records ready status')
  const dryWechatQrStatus = await wechatIlinkAdapter.pollWechatIlinkQrLoginStatus({
    qrCodeId: 'qr-session-123',
    filePath: wechatCredentialFile,
    env: {},
  })
  assert(dryWechatQrStatus.status === 'waiting-for-network-enable', 'WeChat iLink QR status does not poll network by default')
  assert(dryWechatQrStatus.tokenSaved === false, 'WeChat iLink QR status does not save credentials by default')
  const missingQrStatus = await wechatIlinkAdapter.pollWechatIlinkQrLoginStatus({
    allowNetwork: true,
    env: {},
  })
  assert(missingQrStatus.status === 'blocked', 'WeChat iLink QR status requires QR id')
  const scannedQrStatus = await wechatIlinkAdapter.pollWechatIlinkQrLoginStatus({
    qrCodeId: 'qr-session-123',
    allowNetwork: true,
    clientModule: {
      ApiClient: class {
        async pollQRCodeStatus(qrcode) {
          return { status: qrcode === 'qr-session-123' ? 'scaned' : 'wait' }
        }
      },
    },
    env: {},
  })
  assert(scannedQrStatus.status === 'scaned', 'WeChat iLink QR status records scanned state')
  assert(scannedQrStatus.credentialsReady === false, 'WeChat iLink scanned status does not expose credentials yet')
  assert(scannedQrStatus.tokenSaved === false, 'WeChat iLink scanned status does not save credentials')
  const confirmedQrStatus = await wechatIlinkAdapter.pollWechatIlinkQrLoginStatus({
    qrCodeId: 'qr-session-123',
    allowNetwork: true,
    clientModule: {
      ApiClient: class {
        async pollQRCodeStatus() {
          return {
            status: 'confirmed',
            bot_token: 'confirmed-token-123456',
            ilink_bot_id: 'confirmed-account@im.bot',
            baseurl: 'https://ilink-confirmed.example.test',
            ilink_user_id: 'confirmed-user-123',
          }
        }
      },
    },
    env: {},
  })
  assert(confirmedQrStatus.status === 'confirmed', 'WeChat iLink QR status records confirmed state')
  assert(confirmedQrStatus.credentialsReady === true, 'WeChat iLink confirmed status exposes in-memory credentials for next guard')
  assert(confirmedQrStatus.credentials.token === 'confirmed-token-123456', 'WeChat iLink confirmed status keeps token in adapter result')
  assert(confirmedQrStatus.redactedCredentials.token !== 'confirmed-token-123456', 'WeChat iLink confirmed status redacts token for evidence')
  assert(confirmedQrStatus.tokenSaved === false, 'WeChat iLink confirmed status still does not save credentials')
  assert(confirmedQrStatus.messageSent === false, 'WeChat iLink confirmed status still does not send messages')
  assert(wechatIlinkAdapter.wechatIlinkQrStatusEvidence(confirmedQrStatus).some(item => item.includes('凭据就绪：yes')), 'WeChat iLink QR status evidence records ready credentials')
  const missingQrApiSession = await wechatIlinkAdapter.startWechatIlinkQrLoginSession({
    allowNetwork: true,
    clientModule: {},
    env: {},
  })
  assert(missingQrApiSession.status === 'blocked', 'WeChat iLink QR session blocks when ApiClient export is missing')
  assert(missingQrApiSession.reason.includes('ApiClient'), 'WeChat iLink QR missing API session explains missing ApiClient')
  wechatIlinkAdapter.removeWechatIlinkCredentials({ filePath: wechatCredentialFile })
  assert(!fs.existsSync(wechatCredentialFile), 'WeChat iLink credential removal deletes local store')

  const wechatScreenAdapter = desktopAdapterBridge.describeDesktopAdapter({ appId: 'wechat', appName: '微信', appUrl: 'app://wechat' }, 'screen-context')
  assert(wechatScreenAdapter.realAdapterEntry === 'desktop://adapters/wechat/screen-context', 'desktop bridge describes WeChat screen-context entrypoint')
  assert(wechatScreenAdapter.executionMode === 'simulated', 'desktop bridge defaults real adapters to simulated mode')
  assert(wechatScreenAdapter.adapterStatus === 'real-adapter-pending', 'desktop bridge marks unavailable real adapters as pending')
  assert(wechatScreenAdapter.available === false, 'desktop bridge reports unavailable real adapter')
  assert(desktopAdapterBridge.desktopAdapterEvidence(wechatScreenAdapter).some(item => item.includes('真实适配器可用：no')), 'desktop bridge evidence records adapter availability')
  const wechatSendAdapter = desktopAdapterBridge.describeDesktopAdapter({ appId: 'wechat', appName: '微信', appUrl: 'app://wechat' }, 'messages.confirmed-send')
  assert(wechatSendAdapter.realAdapterEntry === 'desktop://adapters/wechat/messages.confirmed-send', 'desktop bridge describes WeChat confirmed-send entrypoint')
  assert(wechatSendAdapter.requiredGuards.includes('External message'), 'desktop bridge keeps external-message guard on send adapter')
  assert(wechatSendAdapter.preflight?.adapterId === 'wechat-ilink', 'desktop bridge attaches WeChat iLink preflight to send adapter')
  assert(desktopAdapterBridge.desktopAdapterEvidence(wechatSendAdapter).some(item => item.includes('微信凭据状态：missing')), 'desktop bridge evidence includes WeChat iLink credential state')
  const previousRealDesktopAdapters = process.env.VELA_REAL_DESKTOP_ADAPTERS
  process.env.VELA_REAL_DESKTOP_ADAPTERS = 'wechat'
  const liveWechatAdapter = desktopAdapterBridge.describeDesktopAdapter({ appId: 'wechat', appName: '微信', appUrl: 'app://wechat' }, 'screen-context')
  assert(liveWechatAdapter.executionMode === 'live', 'desktop bridge can mark configured adapters as live')
  assert(liveWechatAdapter.adapterStatus === 'real-adapter-ready', 'desktop bridge can mark configured adapters ready')
  if (previousRealDesktopAdapters === undefined) {
    delete process.env.VELA_REAL_DESKTOP_ADAPTERS
  } else {
    process.env.VELA_REAL_DESKTOP_ADAPTERS = previousRealDesktopAdapters
  }

  const browserCapability = capabilityRegistry.findOpenCapabilitiesForText('帮我打开网页填写表单')[0]
  assert(browserCapability.id === 'browser.web-agent', 'capability registry routes browser tasks to browser agent')
  assert(browserCapability.riskClasses.includes('Network'), 'browser capability declares network risk')
  assert(browserCapability.integrationStatus === 'adapter-ready', 'browser capability is marked adapter-ready')
  const urlCapability = capabilityRegistry.findOpenCapabilitiesForText('总结 https://example.com/vela')[0]
  assert(urlCapability.id === 'browser.web-agent', 'capability registry routes bare URLs to browser agent')
  const wechatSessionCapability = capabilityRegistry.findOpenCapabilitiesForText('连接微信')[0]
  assert(wechatSessionCapability.id === 'wechat.ilink-session', 'capability registry routes WeChat login tasks to iLink session')
  assert(wechatSessionCapability.riskClasses.includes('Credential'), 'WeChat iLink session declares credential risk')
  const browserAdapterPlan = capabilityAdapters.planCapabilityAdapterRun({
    title: '帮我打开网页搜索资料并总结',
    plan: [{ id: 'execute-review', label: '执行并复核', status: 'Active' }],
    capabilityReferences: [browserCapability],
  })
  assert(browserAdapterPlan.toolCall.toolName === 'browser.web-agent.prepare', 'browser adapter prepares a browser tool call')
  assert(!browserAdapterPlan.permission, 'browser read adapter does not request permission for read-only browsing')
  const browserAdapterLiveRun = capabilityAdapters.executeCapabilityAdapterRun({
    id: 'mission-live-browser',
    title: '帮我搜索 Vela 浏览器能力',
    goal: '帮我搜索 Vela 浏览器能力',
    plan: [{ id: 'execute-review', label: '执行并复核', status: 'Active' }],
    capabilityReferences: [browserCapability],
    toolCalls: [browserAdapterPlan.toolCall],
    artifacts: [browserAdapterPlan.artifact],
  }, {
    capabilityAdapterResult: {
      kind: 'browser-read-result',
      ok: true,
      sourceTools: ['web_search', 'fetch_url'],
      summary: '已围绕「Vela 浏览器能力」完成网页搜索和读取。',
      evidence: ['搜索查询：Vela 浏览器能力', 'Capability Map：https://example.com/capability（direct）'],
      observations: [{ title: 'Capability Map', url: 'https://example.com/capability', source: 'direct', summary: 'Vela browser capability map.' }],
      proposedActions: [{ action: 'summarize', label: '总结页面并给出结论', risk: 'Read', status: 'ready', requiresConfirmation: false }],
      recoveryHints: [],
    },
  })
  assert(browserAdapterLiveRun.toolCall.result.includes('web_search + fetch_url'), 'browser adapter result records live web tools')
  assert(browserAdapterLiveRun.artifact.summary.includes('网页搜索和读取'), 'browser adapter artifact uses live web summary')
  assert(browserAdapterLiveRun.artifact.summary.includes('下一步建议'), 'browser adapter artifact includes action-space next step')
  assert(browserAdapterLiveRun.reviewCheck.evidence.some(item => item.includes('example.com')), 'browser adapter review uses live evidence')
  assert(browserAdapterLiveRun.reviewCheck.evidence.some(item => item.includes('页面观察')), 'browser adapter review keeps page observations')
  assert(browserAdapterLiveRun.reviewCheck.evidence.some(item => item.includes('建议动作')), 'browser adapter review keeps proposed actions')
  const mcpCapability = capabilityRegistry.findOpenCapabilitiesForText('用 github 工具查看 issue')[0]
  assert(mcpCapability.id === 'tool.mcp-bridge', 'capability registry routes GitHub tool tasks to MCP bridge')
  assert(mcpCapability.riskClasses.includes('Network'), 'MCP bridge capability declares network risk')
  assert(mcpCapability.integrationStatus === 'adapter-ready', 'MCP bridge capability is marked adapter-ready')
  const githubSearchCapability = capabilityRegistry.findOpenCapabilitiesForText('用 GitHub 搜索 browser automation agent 开源项目')[0]
  assert(githubSearchCapability.id === 'tool.mcp-bridge', 'capability registry routes GitHub repository search to MCP bridge')
  const githubTarget = githubReader.extractGitHubTarget('用 GitHub 查看 https://github.com/yeyunzhou-26/Vela/issues')
  assert(githubTarget.owner === 'yeyunzhou-26' && githubTarget.repo === 'Vela', 'GitHub reader extracts repository target from URL')
  let githubReaderSawHeaders = false
  const githubReadResult = await githubReader.readGitHubMission({
    mission: {
      title: '用 github 工具查看 yeyunzhou-26/Vela issue',
      goal: '用 github 工具查看 yeyunzhou-26/Vela issue',
      inputs: [],
    },
    fetchJson: async ({ url, headers }) => {
      githubReaderSawHeaders = headers.Accept === 'application/vnd.github+json'
        && !!headers['X-GitHub-Api-Version']
      if (url.includes('/issues?')) {
        return [
          {
            number: 7,
            title: 'Polish Vela mission review',
            state: 'open',
            html_url: 'https://github.com/yeyunzhou-26/Vela/issues/7',
            user: { login: 'yeyunzhou-26' },
            labels: [{ name: 'vela' }],
            updated_at: '2026-06-21T12:00:00Z',
          },
        ]
      }
      return {
        full_name: 'yeyunzhou-26/Vela',
        name: 'Vela',
        owner: { login: 'yeyunzhou-26' },
        html_url: 'https://github.com/yeyunzhou-26/Vela',
        description: 'Mission-first AI Operating Desk',
        default_branch: 'main',
        stargazers_count: 0,
        forks_count: 0,
        open_issues_count: 1,
        visibility: 'public',
        updated_at: '2026-06-21T12:00:00Z',
      }
    },
  })
  assert(githubReadResult.ok === true, 'GitHub reader completes read-only repo and issue lookup')
  assert(githubReaderSawHeaders === true, 'GitHub reader sends recommended API headers')
  assert(githubReadResult.sourceTools.includes('github.repo.get'), 'GitHub reader records repo endpoint')
  assert(githubReadResult.sourceTools.includes('github.issues.list'), 'GitHub reader records issues endpoint')
  assert(githubReadResult.summary.includes('Polish Vela mission review'), 'GitHub reader summarizes issue titles')
  assert(githubReadResult.evidence.some(item => item.includes('未写评论')), 'GitHub reader records read-only boundary evidence')
  const githubDetailTarget = githubReader.extractGitHubTarget('用 GitHub 查看 https://github.com/yeyunzhou-26/Vela/issues/11 的详情和评论')
  assert(githubDetailTarget.issueNumber === 11, 'GitHub reader extracts issue number from issue URL')
  const githubIssueDetailResult = await githubReader.readGitHubMission({
    mission: {
      title: '用 GitHub 查看 https://github.com/yeyunzhou-26/Vela/issues/11 的详情和评论',
      goal: '用 GitHub 查看 https://github.com/yeyunzhou-26/Vela/issues/11 的详情和评论',
      inputs: [],
    },
    fetchJson: async ({ url }) => {
      if (url.includes('/issues/11/comments')) {
        return [
          {
            id: 1001,
            body: 'Reviewer confirmed the read-only path should keep comments in evidence.',
            html_url: 'https://github.com/yeyunzhou-26/Vela/issues/11#issuecomment-1001',
            user: { login: 'reviewer' },
            author_association: 'COLLABORATOR',
            created_at: '2026-06-22T09:30:00Z',
            updated_at: '2026-06-22T09:35:00Z',
          },
        ]
      }
      if (url.match(/\/issues\/11$/)) {
        return {
          number: 11,
          title: 'Read a concrete issue with comments',
          state: 'open',
          html_url: 'https://github.com/yeyunzhou-26/Vela/issues/11',
          user: { login: 'yeyunzhou-26' },
          labels: [{ name: 'github' }],
          body: 'Vela should read a single issue body and the first comments before planning a reply.',
          comments: 1,
          created_at: '2026-06-22T09:00:00Z',
          updated_at: '2026-06-22T09:20:00Z',
        }
      }
      return {
        full_name: 'yeyunzhou-26/Vela',
        name: 'Vela',
        owner: { login: 'yeyunzhou-26' },
        html_url: 'https://github.com/yeyunzhou-26/Vela',
        description: 'Mission-first AI Operating Desk',
        default_branch: 'main',
        stargazers_count: 0,
        forks_count: 0,
        open_issues_count: 1,
        visibility: 'public',
        updated_at: '2026-06-22T09:00:00Z',
      }
    },
  })
  assert(githubIssueDetailResult.ok === true, 'GitHub reader completes issue detail lookup')
  assert(githubIssueDetailResult.mode === 'github-issue-detail', 'GitHub reader records issue detail mode')
  assert(githubIssueDetailResult.sourceTools.includes('github.issue.get'), 'GitHub reader records issue detail endpoint')
  assert(githubIssueDetailResult.sourceTools.includes('github.issue.comments.list'), 'GitHub reader records issue comments endpoint')
  assert(githubIssueDetailResult.issueDetail.bodyExcerpt.includes('single issue body'), 'GitHub reader keeps issue body excerpt')
  assert(githubIssueDetailResult.comments.at(-1).bodyExcerpt.includes('comments in evidence'), 'GitHub reader keeps comment excerpt')
  assert(githubIssueDetailResult.summary.includes('Read a concrete issue with comments'), 'GitHub reader summarizes issue detail')
  const githubPullTarget = githubReader.extractGitHubTarget('用 GitHub 查看 https://github.com/yeyunzhou-26/Vela/pull/13 的改动和 review')
  assert(githubPullTarget.pullNumber === 13, 'GitHub reader extracts pull request number from PR URL')
  assert(githubPullTarget.issueNumber === null, 'GitHub reader does not treat PR URL as a plain issue target')
  const githubPullReadResult = await githubReader.readGitHubMission({
    mission: {
      title: '用 GitHub 查看 https://github.com/yeyunzhou-26/Vela/pull/13 的改动和 review',
      goal: '用 GitHub 查看 https://github.com/yeyunzhou-26/Vela/pull/13 的改动和 review',
      inputs: [],
    },
    fetchJson: async ({ url }) => {
      if (url.includes('/pulls/13/files')) {
        return [
          {
            filename: 'src/vela/github-reader.js',
            status: 'modified',
            additions: 42,
            deletions: 3,
            changes: 45,
            blob_url: 'https://github.com/yeyunzhou-26/Vela/blob/pr/src/vela/github-reader.js',
            patch: '@@ -1,3 +1,6 @@\n+read pull request files',
          },
        ]
      }
      if (url.includes('/pulls/13/reviews')) {
        return [
          {
            id: 1301,
            state: 'APPROVED',
            body: 'Looks safe for read-only PR analysis.',
            html_url: 'https://github.com/yeyunzhou-26/Vela/pull/13#pullrequestreview-1301',
            user: { login: 'reviewer' },
            submitted_at: '2026-06-22T11:00:00Z',
          },
        ]
      }
      if (url.includes('/issues/13/comments')) {
        return [
          {
            id: 1302,
            body: 'Please include changed files before summarizing.',
            html_url: 'https://github.com/yeyunzhou-26/Vela/pull/13#issuecomment-1302',
            user: { login: 'operator' },
            created_at: '2026-06-22T11:05:00Z',
          },
        ]
      }
      if (url.match(/\/pulls\/13$/)) {
        return {
          number: 13,
          title: 'Read pull request files and reviews',
          state: 'open',
          html_url: 'https://github.com/yeyunzhou-26/Vela/pull/13',
          user: { login: 'yeyunzhou-26' },
          body: 'Vela should read PR metadata, changed files, and review status.',
          base: { ref: 'main' },
          head: { ref: 'feat/pr-reader' },
          mergeable: true,
          draft: false,
          additions: 42,
          deletions: 3,
          changed_files: 1,
          commits: 2,
          comments: 1,
          review_comments: 0,
          created_at: '2026-06-22T10:30:00Z',
          updated_at: '2026-06-22T10:55:00Z',
        }
      }
      return {
        full_name: 'yeyunzhou-26/Vela',
        name: 'Vela',
        owner: { login: 'yeyunzhou-26' },
        html_url: 'https://github.com/yeyunzhou-26/Vela',
        description: 'Mission-first AI Operating Desk',
        default_branch: 'main',
        stargazers_count: 0,
        forks_count: 0,
        open_issues_count: 1,
        visibility: 'public',
        updated_at: '2026-06-22T10:30:00Z',
      }
    },
  })
  assert(githubPullReadResult.ok === true, 'GitHub reader completes pull request detail lookup')
  assert(githubPullReadResult.mode === 'github-pull-detail', 'GitHub reader records pull detail mode')
  assert(githubPullReadResult.sourceTools.includes('github.pull.get'), 'GitHub reader records PR detail endpoint')
  assert(githubPullReadResult.sourceTools.includes('github.pull.files.list'), 'GitHub reader records PR files endpoint')
  assert(githubPullReadResult.sourceTools.includes('github.pull.reviews.list'), 'GitHub reader records PR reviews endpoint')
  assert(githubPullReadResult.pullFiles.at(-1).filename === 'src/vela/github-reader.js', 'GitHub reader keeps PR changed file metadata')
  assert(githubPullReadResult.pullReviews.at(-1).state === 'APPROVED', 'GitHub reader keeps PR review state')
  assert(githubPullReadResult.summary.includes('Read pull request files and reviews'), 'GitHub reader summarizes PR detail')
  assert(githubPullReadResult.summary.includes('src/vela/github-reader.js'), 'GitHub reader summarizes PR changed files')
  const githubContentTarget = githubReader.extractGitHubTarget('用 GitHub 查看 https://github.com/yeyunzhou-26/Vela/blob/main/package.json')
  const githubContentRequest = githubReader.extractGitHubContentRequest('用 GitHub 查看 https://github.com/yeyunzhou-26/Vela/blob/main/package.json')
  const githubIssuesFileRequest = githubReader.extractGitHubContentRequest('用 GitHub 查看 yeyunzhou-26/Vela 文件 src/issues.js')
  assert(githubContentTarget.owner === 'yeyunzhou-26' && githubContentTarget.repo === 'Vela', 'GitHub reader extracts repository target from content URL')
  assert(githubContentRequest.path === 'package.json', 'GitHub reader extracts content path from blob URL')
  assert(githubContentRequest.ref === 'main', 'GitHub reader extracts content ref from blob URL')
  assert(githubIssuesFileRequest.path === 'src/issues.js', 'GitHub reader treats issue-named paths as repository content')
  const githubContentReadResult = await githubReader.readGitHubMission({
    mission: {
      title: '用 GitHub 查看 https://github.com/yeyunzhou-26/Vela/blob/main/package.json',
      goal: '用 GitHub 查看 https://github.com/yeyunzhou-26/Vela/blob/main/package.json',
      inputs: [],
    },
    fetchJson: async ({ url }) => {
      if (url.includes('/contents/package.json?ref=main')) {
        return {
          type: 'file',
          name: 'package.json',
          path: 'package.json',
          encoding: 'base64',
          content: 'ewogICJuYW1lIjogInZlbGEiLAogICJzY3JpcHRzIjogewogICAgImNoZWNrOnZlbGEiOiAibnBtIHJ1biB0ZXN0OnZlbGEtbWlzc2lvbiIKICB9Cn0K',
          size: 88,
          sha: 'content-sha',
          html_url: 'https://github.com/yeyunzhou-26/Vela/blob/main/package.json',
          download_url: 'https://raw.githubusercontent.com/yeyunzhou-26/Vela/main/package.json',
        }
      }
      return {
        full_name: 'yeyunzhou-26/Vela',
        name: 'Vela',
        owner: { login: 'yeyunzhou-26' },
        html_url: 'https://github.com/yeyunzhou-26/Vela',
        description: 'Mission-first AI Operating Desk',
        default_branch: 'main',
        stargazers_count: 0,
        forks_count: 0,
        open_issues_count: 1,
        visibility: 'public',
        updated_at: '2026-06-22T12:30:00Z',
      }
    },
  })
  assert(githubContentReadResult.ok === true, 'GitHub reader completes content file lookup')
  assert(githubContentReadResult.mode === 'github-content', 'GitHub reader records content mode')
  assert(githubContentReadResult.sourceTools.includes('github.contents.get'), 'GitHub reader records contents endpoint')
  assert(githubContentReadResult.contentDetail.path === 'package.json', 'GitHub reader keeps content file path')
  assert(githubContentReadResult.contentDetail.contentExcerpt.includes('check:vela'), 'GitHub reader decodes content file excerpt')
  assert(githubContentReadResult.summary.includes('package.json'), 'GitHub reader summarizes content file')
  assert(githubContentReadResult.evidence.some(item => item.includes('未改 issue/PR/文件')), 'GitHub reader records content read-only boundary evidence')
  const githubDirectoryReadResult = await githubReader.readGitHubMission({
    mission: {
      title: '用 GitHub 查看 https://github.com/yeyunzhou-26/Vela/tree/main/src/ui/vela 的目录结构',
      goal: '用 GitHub 查看 https://github.com/yeyunzhou-26/Vela/tree/main/src/ui/vela 的目录结构',
      inputs: [],
    },
    fetchJson: async ({ url }) => {
      if (url.includes('/contents/src/ui/vela?ref=main')) {
        return [
          {
            type: 'file',
            name: 'app-shell.js',
            path: 'src/ui/vela/app-shell.js',
            size: 2048,
            sha: 'app-shell-sha',
            html_url: 'https://github.com/yeyunzhou-26/Vela/blob/main/src/ui/vela/app-shell.js',
          },
          {
            type: 'dir',
            name: 'styles',
            path: 'src/ui/vela/styles',
            size: 0,
            sha: 'styles-sha',
            html_url: 'https://github.com/yeyunzhou-26/Vela/tree/main/src/ui/vela/styles',
          },
        ]
      }
      return {
        full_name: 'yeyunzhou-26/Vela',
        name: 'Vela',
        owner: { login: 'yeyunzhou-26' },
        html_url: 'https://github.com/yeyunzhou-26/Vela',
        description: 'Mission-first AI Operating Desk',
        default_branch: 'main',
        stargazers_count: 0,
        forks_count: 0,
        open_issues_count: 1,
        visibility: 'public',
        updated_at: '2026-06-22T12:40:00Z',
      }
    },
  })
  assert(githubDirectoryReadResult.ok === true, 'GitHub reader completes content directory lookup')
  assert(githubDirectoryReadResult.contentItems.length === 2, 'GitHub reader keeps directory entries')
  assert(githubDirectoryReadResult.summary.includes('src/ui/vela/app-shell.js'), 'GitHub reader summarizes directory entries')
  const githubReadmeReadResult = await githubReader.readGitHubMission({
    mission: {
      title: '用 GitHub 查看 yeyunzhou-26/Vela README',
      goal: '用 GitHub 查看 yeyunzhou-26/Vela README',
      inputs: [],
    },
    fetchJson: async ({ url }) => {
      if (url.includes('/readme')) {
        return {
          type: 'file',
          name: 'README.md',
          path: 'README.md',
          encoding: 'base64',
          content: 'IyBWZWxhCk1pc3Npb24tZmlyc3QgQUkgT3BlcmF0aW5nIERlc2sK',
          size: 39,
          sha: 'readme-sha',
          html_url: 'https://github.com/yeyunzhou-26/Vela/blob/main/README.md',
          download_url: 'https://raw.githubusercontent.com/yeyunzhou-26/Vela/main/README.md',
        }
      }
      return {
        full_name: 'yeyunzhou-26/Vela',
        name: 'Vela',
        owner: { login: 'yeyunzhou-26' },
        html_url: 'https://github.com/yeyunzhou-26/Vela',
        description: 'Mission-first AI Operating Desk',
        default_branch: 'main',
        stargazers_count: 0,
        forks_count: 0,
        open_issues_count: 1,
        visibility: 'public',
        updated_at: '2026-06-22T12:45:00Z',
      }
    },
  })
  assert(githubReadmeReadResult.ok === true, 'GitHub reader completes README lookup')
  assert(githubReadmeReadResult.sourceTools.includes('github.readme.get'), 'GitHub reader records README endpoint')
  assert(githubReadmeReadResult.contentDetail.contentExcerpt.includes('Mission-first AI Operating Desk'), 'GitHub reader decodes README excerpt')
  const githubSearchRequest = githubReader.extractGitHubRepoSearchRequest('用 GitHub 搜索 browser automation agent 开源项目')
  assert(githubSearchRequest.query === 'browser automation agent', 'GitHub reader extracts repository search query')
  assert(githubReader.extractGitHubTarget('用 GitHub 搜索 browser automation agent 开源项目') === null, 'GitHub reader does not require owner/repo for repository search')
  let githubRepoSearchSeenSearchEndpoint = false
  const githubRepoSearchFetchJson = async ({ url }) => {
    if (url.includes('/search/repositories')) {
      githubRepoSearchSeenSearchEndpoint = true
      return {
        total_count: 42,
        incomplete_results: false,
        items: [
          {
            full_name: 'browser-use/browser-use',
            name: 'browser-use',
            owner: { login: 'browser-use' },
            html_url: 'https://github.com/browser-use/browser-use',
            description: 'Make websites accessible for AI agents',
            language: 'Python',
            topics: ['browser-automation', 'ai-agent'],
            license: { spdx_id: 'MIT' },
            stargazers_count: 50000,
            forks_count: 5000,
            open_issues_count: 123,
            default_branch: 'main',
            updated_at: '2026-06-22T13:00:00Z',
            pushed_at: '2026-06-22T12:50:00Z',
          },
          {
            full_name: 'microsoft/playwright-mcp',
            name: 'playwright-mcp',
            owner: { login: 'microsoft' },
            html_url: 'https://github.com/microsoft/playwright-mcp',
            description: 'Browser automation through a model context server',
            language: 'TypeScript',
            topics: ['playwright', 'mcp'],
            license: { spdx_id: 'Apache-2.0' },
            stargazers_count: 12000,
            forks_count: 800,
            open_issues_count: 45,
            default_branch: 'main',
            updated_at: '2026-06-22T12:30:00Z',
          },
        ],
      }
    }
    if (url.endsWith('/repos/browser-use/browser-use/readme')) {
      return {
        type: 'file',
        name: 'README.md',
        path: 'README.md',
        encoding: 'base64',
        content: Buffer.from('# Browser Use\n\nAI browser agent action space and recovery loops.\n').toString('base64'),
        size: 61,
        sha: 'browser-readme-sha',
        html_url: 'https://github.com/browser-use/browser-use/blob/main/README.md',
      }
    }
    if (url.endsWith('/repos/browser-use/browser-use/contents/src')) {
      return [
        { type: 'file', name: 'index.ts', path: 'src/index.ts', size: 300, html_url: 'https://github.com/browser-use/browser-use/blob/main/src/index.ts' },
        { type: 'file', name: 'agent.ts', path: 'src/agent.ts', size: 900, html_url: 'https://github.com/browser-use/browser-use/blob/main/src/agent.ts' },
      ]
    }
    if (url.endsWith('/repos/browser-use/browser-use/contents/src/index.ts')) {
      return {
        type: 'file',
        name: 'index.ts',
        path: 'src/index.ts',
        encoding: 'base64',
        content: Buffer.from('export function observePage() { return "browser observation"; }\n').toString('base64'),
        size: 61,
        sha: 'browser-index-sha',
        html_url: 'https://github.com/browser-use/browser-use/blob/main/src/index.ts',
      }
    }
    if (url.endsWith('/repos/browser-use/browser-use/contents/src/agent.ts')) {
      return {
        type: 'file',
        name: 'agent.ts',
        path: 'src/agent.ts',
        encoding: 'base64',
        content: Buffer.from('export class BrowserAgent { recover() { return "retry with state"; } }\n').toString('base64'),
        size: 72,
        sha: 'browser-agent-sha',
        html_url: 'https://github.com/browser-use/browser-use/blob/main/src/agent.ts',
      }
    }
    if (url.endsWith('/repos/browser-use/browser-use/contents/package.json')) {
      return {
        type: 'file',
        name: 'package.json',
        path: 'package.json',
        encoding: 'base64',
        content: Buffer.from('{"name":"browser-use","description":"AI browser automation toolkit"}\n').toString('base64'),
        size: 65,
        sha: 'browser-package-sha',
        html_url: 'https://github.com/browser-use/browser-use/blob/main/package.json',
      }
    }
    if (url.endsWith('/repos/browser-use/browser-use/contents')) {
      return [
        { type: 'file', name: 'README.md', path: 'README.md', size: 61, html_url: 'https://github.com/browser-use/browser-use/blob/main/README.md' },
        { type: 'file', name: 'package.json', path: 'package.json', size: 65, html_url: 'https://github.com/browser-use/browser-use/blob/main/package.json' },
        { type: 'dir', name: 'src', path: 'src', size: 0, html_url: 'https://github.com/browser-use/browser-use/tree/main/src' },
      ]
    }
    if (url.endsWith('/repos/microsoft/playwright-mcp/readme')) {
      return {
        type: 'file',
        name: 'README.md',
        path: 'README.md',
        encoding: 'base64',
        content: Buffer.from('# Playwright MCP\n\nModel context server for browser automation.\n').toString('base64'),
        size: 60,
        sha: 'playwright-readme-sha',
        html_url: 'https://github.com/microsoft/playwright-mcp/blob/main/README.md',
      }
    }
    if (url.endsWith('/repos/microsoft/playwright-mcp/contents/src')) {
      return [
        { type: 'file', name: 'index.ts', path: 'src/index.ts', size: 450, html_url: 'https://github.com/microsoft/playwright-mcp/blob/main/src/index.ts' },
      ]
    }
    if (url.endsWith('/repos/microsoft/playwright-mcp/contents/src/index.ts')) {
      return {
        type: 'file',
        name: 'index.ts',
        path: 'src/index.ts',
        encoding: 'base64',
        content: Buffer.from('export function registerTools() { return ["browser_snapshot", "browser_click"]; }\n').toString('base64'),
        size: 80,
        sha: 'playwright-index-sha',
        html_url: 'https://github.com/microsoft/playwright-mcp/blob/main/src/index.ts',
      }
    }
    if (url.endsWith('/repos/microsoft/playwright-mcp/contents/package.json')) {
      return {
        type: 'file',
        name: 'package.json',
        path: 'package.json',
        encoding: 'base64',
        content: Buffer.from('{"name":"playwright-mcp","description":"MCP browser automation server"}\n').toString('base64'),
        size: 70,
        sha: 'playwright-package-sha',
        html_url: 'https://github.com/microsoft/playwright-mcp/blob/main/package.json',
      }
    }
    if (url.endsWith('/repos/microsoft/playwright-mcp/contents')) {
      return [
        { type: 'file', name: 'README.md', path: 'README.md', size: 60, html_url: 'https://github.com/microsoft/playwright-mcp/blob/main/README.md' },
        { type: 'file', name: 'package.json', path: 'package.json', size: 70, html_url: 'https://github.com/microsoft/playwright-mcp/blob/main/package.json' },
        { type: 'dir', name: 'src', path: 'src', size: 0, html_url: 'https://github.com/microsoft/playwright-mcp/tree/main/src' },
      ]
    }
    return {
      ok: false,
      status: 404,
      message: `Unexpected GitHub endpoint in repository search test: ${url}`,
    }
  }
  const githubRepoSearchResult = await githubReader.readGitHubMission({
    mission: {
      title: '用 GitHub 搜索 browser automation agent 开源项目',
      goal: '用 GitHub 搜索 browser automation agent 开源项目',
      inputs: [],
    },
    fetchJson: githubRepoSearchFetchJson,
  })
  assert(githubRepoSearchResult.ok === true, 'GitHub reader completes repository search')
  assert(githubRepoSearchResult.mode === 'github-repo-search', 'GitHub reader records repository search mode')
  assert(githubRepoSearchSeenSearchEndpoint === true, 'GitHub reader calls repository search endpoint')
  assert(githubRepoSearchResult.sourceTools.includes('github.search.repositories'), 'GitHub reader records repository search endpoint')
  assert(githubRepoSearchResult.sourceTools.includes('github.search.candidate.readme'), 'GitHub reader records candidate README reads')
  assert(githubRepoSearchResult.sourceTools.includes('github.search.candidate.entry'), 'GitHub reader records candidate entry-file reads')
  assert(githubRepoSearchResult.sourceTools.includes('github.search.lessons.synthesize'), 'GitHub reader records candidate lesson synthesis')
  assert(githubRepoSearchResult.sourceTools.includes('github.search.read-plan.synthesize'), 'GitHub reader records candidate read-plan synthesis')
  assert(githubRepoSearchResult.sourceTools.includes('github.search.planned-source.read'), 'GitHub reader records planned source reads')
  assert(githubRepoSearchResult.sourceTools.includes('github.search.capability-draft.synthesize'), 'GitHub reader records capability draft synthesis')
  assert(githubRepoSearchResult.sourceTools.includes('github.search.implementation-queue.synthesize'), 'GitHub reader records implementation queue synthesis')
  assert(githubRepoSearchResult.repoSearchResults.at(0).fullName === 'browser-use/browser-use', 'GitHub reader keeps repository search candidates')
  assert(githubRepoSearchResult.repoSearchAnalyses.length === 2, 'GitHub reader deep-reads top repository search candidates')
  assert(githubRepoSearchResult.repoSearchAnalyses.at(0).readme.contentExcerpt.includes('AI browser agent'), 'GitHub reader keeps candidate README excerpts')
  assert(githubRepoSearchResult.repoSearchAnalyses.at(0).entryFile.path === 'package.json', 'GitHub reader keeps candidate manifest excerpts')
  assert(githubRepoSearchResult.repoSearchAnalyses.at(0).sourceItems.some(item => item.path === 'src/index.ts'), 'GitHub reader keeps candidate source directory clues')
  assert(githubRepoSearchResult.repoSearchLessons.length === 2, 'GitHub reader synthesizes open-source lessons from candidates')
  assert(githubRepoSearchResult.repoSearchLessons.at(0).capabilityIdeas.some(item => item.includes('浏览器操作空间')), 'GitHub reader turns candidate analysis into capability ideas')
  assert(githubRepoSearchResult.repoSearchLessons.at(0).nextAction.includes('package.json'), 'GitHub reader records a concrete next read action')
  assert(githubRepoSearchResult.repoSearchReadPlans.length === 2, 'GitHub reader synthesizes follow-up source read plans')
  assert(githubRepoSearchResult.repoSearchReadPlans.at(0).targets.some(item => item.path === 'src/index.ts'), 'GitHub reader plans high-signal source reads')
  assert(githubRepoSearchResult.repoSearchReadPlans.at(0).targets.every(item => item.risk === 'Read'), 'GitHub reader keeps read plans read-only')
  assert(githubRepoSearchResult.repoSearchSourceReads.length === 3, 'GitHub reader executes bounded planned source reads')
  assert(githubRepoSearchResult.repoSearchSourceReads.at(0).path === 'src/index.ts', 'GitHub reader reads planned source paths')
  assert(githubRepoSearchResult.repoSearchSourceReads.at(0).contentDetail.contentExcerpt.includes('observePage'), 'GitHub reader keeps planned source excerpts')
  assert(githubRepoSearchResult.repoSearchSourceReads.every(item => item.risk === 'Read'), 'GitHub reader keeps planned source reads read-only')
  assert(githubRepoSearchResult.repoSearchCapabilityDrafts.length === 2, 'GitHub reader synthesizes local capability drafts')
  assert(githubRepoSearchResult.repoSearchCapabilityDrafts.at(0).title.includes('浏览器操作空间'), 'GitHub reader names capability drafts from lessons')
  assert(githubRepoSearchResult.repoSearchCapabilityDrafts.at(0).localTargets.includes('src/vela/capability-adapters.js'), 'GitHub reader maps capability drafts to local Vela modules')
  assert(githubRepoSearchResult.repoSearchCapabilityDrafts.at(0).sourceEvidence.some(item => item.includes('observePage')), 'GitHub reader grounds capability drafts in source evidence')
  assert(githubRepoSearchResult.repoSearchCapabilityDrafts.at(0).permissionBoundary.includes('Guard'), 'GitHub reader records capability draft permission boundary')
  assert(githubRepoSearchResult.repoSearchImplementationQueue.length === 2, 'GitHub reader turns capability drafts into implementation tickets')
  assert(githubRepoSearchResult.repoSearchImplementationQueue.at(0).id.includes('browser-workspace'), 'GitHub reader gives implementation tickets stable capability ids')
  assert(githubRepoSearchResult.repoSearchImplementationQueue.at(0).status === 'ready-for-implementation', 'GitHub reader marks evidenced implementation tickets ready')
  assert(githubRepoSearchResult.repoSearchImplementationQueue.at(0).targetFiles.includes('src/vela/capability-adapters.js'), 'GitHub reader maps implementation tickets to local files')
  assert(githubRepoSearchResult.repoSearchImplementationQueue.at(0).acceptanceCriteria.some(item => item.includes('聊天入口')), 'GitHub reader gives implementation tickets user-facing acceptance criteria')
  assert(githubRepoSearchResult.summary.includes('browser-use/browser-use'), 'GitHub reader summarizes repository candidates')
  assert(githubRepoSearchResult.summary.includes('README'), 'GitHub reader summarizes candidate deep-read evidence')
  assert(githubRepoSearchResult.summary.includes('开源吸收建议'), 'GitHub reader summarizes synthesized lessons')
  assert(githubRepoSearchResult.summary.includes('后续源码读取计划'), 'GitHub reader summarizes synthesized read plans')
  assert(githubRepoSearchResult.summary.includes('源码目标'), 'GitHub reader summarizes planned source reads')
  assert(githubRepoSearchResult.summary.includes('本地能力草案'), 'GitHub reader summarizes local capability drafts')
  assert(githubRepoSearchResult.summary.includes('本地实施票'), 'GitHub reader summarizes implementation tickets')
  assert(githubRepoSearchResult.evidence.some(item => item.includes('候选吸收建议')), 'GitHub reader keeps lesson evidence')
  assert(githubRepoSearchResult.evidence.some(item => item.includes('候选读取计划')), 'GitHub reader keeps read-plan evidence')
  assert(githubRepoSearchResult.evidence.some(item => item.includes('候选源码证据')), 'GitHub reader keeps planned source evidence')
  assert(githubRepoSearchResult.evidence.some(item => item.includes('Vela 能力草案')), 'GitHub reader keeps capability draft evidence')
  assert(githubRepoSearchResult.evidence.some(item => item.includes('Vela 实施队列')), 'GitHub reader keeps implementation queue evidence')
  assert(githubRepoSearchResult.evidence.some(item => item.includes('未 star')), 'GitHub reader records repository search read-only boundary')
  const githubRepoSearchPlanOnlyResult = await githubReader.readGitHubMission({
    mission: {
      title: '用 GitHub 搜索 browser automation agent 开源项目',
      goal: '用 GitHub 搜索 browser automation agent 开源项目',
      inputs: [],
    },
    fetchJson: githubRepoSearchFetchJson,
    repoSourceReadLimit: 0,
  })
  assert(githubRepoSearchPlanOnlyResult.repoSearchReadPlans.length === 2, 'GitHub reader still plans source reads when planned source read limit is zero')
  assert(githubRepoSearchPlanOnlyResult.repoSearchSourceReads.length === 0, 'GitHub reader honors zero planned source read limit')
  assert(!githubRepoSearchPlanOnlyResult.sourceTools.includes('github.search.planned-source.read'), 'GitHub reader skips planned source read tool when limit is zero')
  const multiCapabilityRefs = capabilityRegistry.findOpenCapabilitiesForText('用 github 工具查看 issue 并生成报告')
  assert(multiCapabilityRefs[0].id === 'tool.mcp-bridge', 'capability registry ranks MCP bridge first for GitHub tool plus report tasks')
  assert(multiCapabilityRefs.some(item => item.id === 'files.document-work'), 'capability registry also keeps document capability for GitHub report tasks')
  const multiCapabilityPlan = capabilityAdapters.planCapabilityAdapterRun({
    id: 'mission-mcp-report-adapter',
    title: '用 github 工具查看 issue 并生成报告',
    goal: '用 github 工具查看 issue 并生成报告',
    plan: [{ id: 'execute-review', label: '产出结果并复核', status: 'Active' }],
    capabilityReferences: multiCapabilityRefs,
  })
  assert(multiCapabilityPlan.toolCall.toolName === 'tool.mcp-bridge.prepare', 'adapter dispatcher follows primary capability order before fixed adapter order')
  const mcpAdapterPlan = capabilityAdapters.planCapabilityAdapterRun({
    id: 'mission-mcp-adapter',
    title: '用 github 工具查看 issue',
    goal: '用 github 工具查看 issue',
    plan: [{ id: 'execute-review', label: '产出结果并复核', status: 'Active' }],
    capabilityReferences: [mcpCapability],
  })
  assert(mcpAdapterPlan.toolCall.toolName === 'tool.mcp-bridge.prepare', 'MCP bridge adapter prepares a tool routing call')
  assert(mcpAdapterPlan.artifact.title === 'MCP 工具路由方案', 'MCP bridge adapter creates routing plan artifact')
  assert(mcpAdapterPlan.agentActions.at(-1).title === '规划 MCP 工具路由', 'MCP bridge adapter records routing planner action')
  assert(!mcpAdapterPlan.permission, 'MCP bridge adapter does not request permission before route-only planning')
  const mcpAdapterRun = capabilityAdapters.executeCapabilityAdapterRun({
    id: 'mission-mcp-adapter',
    title: '用 github 工具查看 issue',
    goal: '用 github 工具查看 issue',
    plan: [{ id: 'execute-review', label: '产出结果并复核', status: 'Active' }],
    capabilityReferences: [mcpCapability],
    toolCalls: [mcpAdapterPlan.toolCall],
    artifacts: [mcpAdapterPlan.artifact],
  })
  assert(mcpAdapterRun.toolCall.toolName === 'tool.mcp-bridge.route', 'MCP bridge adapter records route summary')
  assert(mcpAdapterRun.artifact.kind === 'mcp-route-summary', 'MCP bridge adapter creates route summary artifact')
  assert(mcpAdapterRun.reviewCheck.title === 'MCP 工具桥复核', 'MCP bridge adapter creates reviewer check')
  assert(mcpAdapterRun.reviewCheck.outcome === 'passed', 'MCP bridge reviewer check passes')
  assert(mcpAdapterRun.toolStages.some(item => item.toolName === 'mcp.registry.resolve'), 'MCP bridge adapter records registry resolution stage')
  assert(mcpAdapterRun.toolStages.some(item => item.toolName === 'mcp.candidate.github'), 'MCP bridge adapter records GitHub candidate stage')
  assert(mcpAdapterRun.toolStages.some(item => item.toolName === 'mcp.external-tool-execution' && item.status === 'skipped'), 'MCP bridge adapter records skipped external tool execution')
  const mcpAdapterLiveRun = capabilityAdapters.executeCapabilityAdapterRun({
    id: 'mission-mcp-live-adapter',
    title: '用 github 工具查看 yeyunzhou-26/Vela issue',
    goal: '用 github 工具查看 yeyunzhou-26/Vela issue',
    plan: [{ id: 'execute-review', label: '产出结果并复核', status: 'Active' }],
    capabilityReferences: [mcpCapability],
    toolCalls: [mcpAdapterPlan.toolCall],
    artifacts: [mcpAdapterPlan.artifact],
  }, {
    capabilityAdapterResult: githubReadResult,
  })
  assert(mcpAdapterLiveRun.toolCall.status === 'ok', 'MCP bridge live GitHub run records successful tool call')
  assert(mcpAdapterLiveRun.toolCall.result.includes('github.repo.get + github.issues.list'), 'MCP bridge live GitHub run records source tools')
  assert(mcpAdapterLiveRun.artifact.kind === 'mcp-github-read-summary', 'MCP bridge live GitHub run creates GitHub read artifact')
  assert(mcpAdapterLiveRun.reviewCheck.title === 'GitHub 只读复核', 'MCP bridge live GitHub run creates GitHub review check')
  assert(mcpAdapterLiveRun.reviewCheck.evidence.some(item => item.includes('Vela/issues/7')), 'MCP bridge live GitHub run keeps issue evidence')
  assert(mcpAdapterLiveRun.toolStages.some(item => item.toolName === 'github.repo.get' && item.status === 'ok'), 'MCP bridge live GitHub run records repo stage')
  assert(mcpAdapterLiveRun.toolStages.some(item => item.toolName === 'github.issues.list' && item.status === 'ok'), 'MCP bridge live GitHub run records issues stage')
  assert(mcpAdapterLiveRun.toolStages.some(item => item.toolName === 'mcp.write-action' && item.status === 'skipped'), 'MCP bridge live GitHub run records skipped write action')
  const fallbackCapability = capabilityRegistry.findOpenCapabilitiesForText('帮我处理一个很复杂的新任务')[0]
  assert(fallbackCapability.id === 'agent.orchestration', 'capability registry falls back to agent orchestration')
  assert(fallbackCapability.integrationStatus === 'adapter-ready', 'agent orchestration capability is marked adapter-ready')
  const orchestrationAdapterPlan = capabilityAdapters.planCapabilityAdapterRun({
    id: 'mission-agent-adapter',
    title: '帮我处理一个很复杂的新任务',
    goal: '帮我处理一个很复杂的新任务',
    plan: [{ id: 'execute-review', label: '产出结果并复核', status: 'Active' }],
    capabilityReferences: [fallbackCapability],
  })
  assert(orchestrationAdapterPlan.toolCall.toolName === 'agent.orchestration.plan', 'agent orchestration adapter prepares a planning tool call')
  assert(orchestrationAdapterPlan.agentActions.at(-1).role === 'Planner', 'agent orchestration adapter records planner decomposition')
  assert(!orchestrationAdapterPlan.permission, 'agent orchestration adapter does not request permission for internal planning')
  const orchestrationAdapterRun = capabilityAdapters.executeCapabilityAdapterRun({
    id: 'mission-agent-adapter',
    title: '帮我处理一个很复杂的新任务',
    goal: '帮我处理一个很复杂的新任务',
    plan: [{ id: 'execute-review', label: '产出结果并复核', status: 'Active' }],
    capabilityReferences: [fallbackCapability],
    toolCalls: [orchestrationAdapterPlan.toolCall],
    artifacts: [orchestrationAdapterPlan.artifact],
  })
  assert(orchestrationAdapterRun.toolCall.toolName === 'agent.orchestration.execute', 'agent orchestration adapter records execution summary')
  assert(orchestrationAdapterRun.artifact.kind === 'orchestration-summary', 'agent orchestration adapter creates orchestration artifact')
  assert(orchestrationAdapterRun.reviewCheck.title === '多 Agent 编排复核', 'agent orchestration adapter creates reviewer check')
  assert(orchestrationAdapterRun.reviewCheck.outcome === 'passed', 'agent orchestration reviewer check passes')
  assert(orchestrationAdapterRun.agentActions.some(item => item.role === 'Researcher'), 'agent orchestration adapter records researcher handoff')
  assert(orchestrationAdapterRun.agentActions.some(item => item.role === 'Builder'), 'agent orchestration adapter records builder handoff')
  assert(orchestrationAdapterRun.agentActions.some(item => item.role === 'Operator'), 'agent orchestration adapter records operator handoff')
  assert(orchestrationAdapterRun.agentActions.some(item => item.role === 'Reviewer'), 'agent orchestration adapter records reviewer handoff')
  assert(orchestrationAdapterRun.toolStages.some(item => item.toolName === 'agent.role-handoff'), 'agent orchestration adapter records role handoff stage')
  assert(orchestrationAdapterRun.toolStages.some(item => item.toolName === 'agent.external-effect' && item.status === 'skipped'), 'agent orchestration adapter records no hidden external effect')
  const desktopCapability = capabilityRegistry.findOpenCapabilitiesForText('帮我打开微信')[0]
  assert(desktopCapability.id === 'desktop.app-control', 'capability registry routes desktop app tasks to desktop control')
  assert(desktopCapability.riskClasses.includes('Screen'), 'desktop capability declares screen risk')
  assert(desktopCapability.integrationStatus === 'adapter-ready', 'desktop capability is marked adapter-ready')
  const desktopAdapterPlan = capabilityAdapters.planCapabilityAdapterRun({
    title: '帮我打开微信',
    plan: [{ id: 'inspect-context', label: '查看应用上下文', status: 'Active' }],
    capabilityReferences: [desktopCapability],
  })
  assert(desktopAdapterPlan.toolCall.toolName === 'desktop.app-control.prepare', 'desktop adapter prepares a desktop tool call')
  assert(!desktopAdapterPlan.permission, 'desktop adapter prototype does not request permission before mocked inspection')
  assert(desktopAdapterPlan.artifact.summary.includes('不会真的打开应用'), 'desktop adapter plan states no real app action')
  assert(desktopAdapterPlan.artifact.summary.includes('desktop://adapters/wechat/screen-context'), 'desktop adapter plan records real adapter entrypoint')
  const desktopAdapterRun = capabilityAdapters.executeCapabilityAdapterRun({
    id: 'mission-desktop-adapter',
    title: '帮我打开微信',
    goal: '帮我打开微信',
    plan: [{ id: 'inspect-context', label: '查看应用上下文', status: 'Active' }],
    capabilityReferences: [desktopCapability],
    toolCalls: [desktopAdapterPlan.toolCall],
    artifacts: [desktopAdapterPlan.artifact],
  })
  assert(desktopAdapterRun.toolCall.toolName === 'desktop.app-control.inspect', 'desktop adapter records mocked desktop inspection')
  assert(desktopAdapterRun.artifact.title === '桌面上下文摘要', 'desktop adapter creates desktop context artifact')
  assert(desktopAdapterRun.reviewCheck.outcome === 'passed', 'desktop adapter review passes for mocked inspection')
  assert(desktopAdapterRun.reviewCheck.evidence.some(item => item.includes('执行模式：simulated')), 'desktop adapter review records execution mode')
  assert(desktopAdapterRun.reviewCheck.evidence.some(item => item.includes('真实适配器入口：desktop://adapters/wechat/screen-context')), 'desktop adapter review records real adapter entrypoint')
  assert(desktopAdapterRun.toolStages.some(item => item.toolName === 'desktop.open-app' && item.url === 'app://wechat'), 'desktop adapter records mocked app-open stage')
  assert(desktopAdapterRun.toolStages.some(item => item.toolName === 'desktop.real-adapter' && item.status === 'skipped'), 'desktop adapter records skipped real-adapter stage')
  assert(desktopAdapterRun.toolStages.some(item => item.toolName === 'desktop.external-effect' && item.status === 'skipped'), 'desktop adapter records no hidden external effect')
  const filesCapability = capabilityRegistry.findOpenCapabilitiesForText('帮我生成一份报告')[0]
  assert(filesCapability.id === 'files.document-work', 'capability registry routes document tasks to file work')
  assert(filesCapability.integrationStatus === 'adapter-ready', 'files capability is marked adapter-ready')
  const filesAdapterPlan = capabilityAdapters.planCapabilityAdapterRun({
    title: '帮我生成一份报告',
    plan: [{ id: 'execute-review', label: '产出结果并复核', status: 'Active' }],
    capabilityReferences: [filesCapability],
  })
  assert(filesAdapterPlan.toolCall.toolName === 'files.document-work.prepare', 'files adapter prepares a document tool call')
  assert(!filesAdapterPlan.permission, 'files adapter does not request permission for internal artifacts')
  const filesAdapterRun = capabilityAdapters.executeCapabilityAdapterRun({
    id: 'mission-files-adapter',
    title: '帮我生成一份报告',
    goal: '帮我生成一份报告',
    plan: [{ id: 'execute-review', label: '产出结果并复核', status: 'Active' }],
    capabilityReferences: [filesCapability],
    toolCalls: [filesAdapterPlan.toolCall],
    artifacts: [filesAdapterPlan.artifact],
  })
  assert(filesAdapterRun.toolCall.toolName === 'files.document-work.generate', 'files adapter records document generation')
  assert(filesAdapterRun.artifact.kind === 'document-draft', 'files adapter creates document draft artifact')
  assert(filesAdapterRun.reviewCheck.title === '文件产物复核', 'files adapter creates artifact review')
  assert(filesAdapterRun.toolStages.some(item => item.toolName === 'files.local-write' && item.status === 'skipped'), 'files adapter skips local write by default')
  const filesWritePlan = capabilityAdapters.planCapabilityAdapterRun({
    title: '帮我保存报告到本地文件',
    plan: [{ id: 'execute-review', label: '产出结果并复核', status: 'Active' }],
    capabilityReferences: [filesCapability],
  })
  assert(filesWritePlan.permission?.risk === 'Write', 'files adapter gates local disk write')
  const memoryCapability = capabilityRegistry.findOpenCapabilitiesForText('记住我的偏好：我喜欢中文界面')[0]
  assert(memoryCapability.id === 'memory.context-os', 'capability registry routes memory tasks to context os')
  assert(memoryCapability.integrationStatus === 'adapter-ready', 'memory capability is marked adapter-ready')
  const memoryAdapterPlan = capabilityAdapters.planCapabilityAdapterRun({
    title: '记住我的偏好：我喜欢中文界面',
    plan: [{ id: 'execute-review', label: '产出结果并复核', status: 'Active' }],
    capabilityReferences: [memoryCapability],
  })
  assert(memoryAdapterPlan.toolCall.toolName === 'memory.context-os.prepare', 'memory adapter prepares context recall')
  assert(!memoryAdapterPlan.permission, 'memory adapter does not request permission for mission-scoped context')
  const memoryAdapterRun = capabilityAdapters.executeCapabilityAdapterRun({
    id: 'mission-memory-adapter',
    title: '记住我的偏好：我喜欢中文界面',
    goal: '记住我的偏好：我喜欢中文界面',
    plan: [{ id: 'execute-review', label: '产出结果并复核', status: 'Active' }],
    capabilityReferences: [memoryCapability],
    toolCalls: [memoryAdapterPlan.toolCall],
    artifacts: [memoryAdapterPlan.artifact],
  })
  assert(memoryAdapterRun.toolCall.toolName === 'memory.context-os.recall', 'memory adapter records context recall')
  assert(memoryAdapterRun.artifact.kind === 'memory-context', 'memory adapter creates memory context artifact')
  assert(memoryAdapterRun.memoryReferences.at(-1).type === 'user', 'memory adapter creates user memory reference')
  assert(memoryAdapterRun.memoryReferences.at(-1).provenance.includes('/results/'), 'memory adapter records provenance')
  assert(memoryAdapterRun.reviewCheck.title === '记忆上下文复核', 'memory adapter creates memory review')
  assert(memoryAdapterRun.toolStages.some(item => item.toolName === 'memory.long-term-write' && item.status === 'skipped'), 'memory adapter skips hidden long-term write')

  const seed = runtime.getCurrentMission()
  assert(seed.id === 'mission-vela-shell', 'seed mission is available before persistence')
  assert(seed.state === 'Planned', 'seed mission state is Planned')
  assert(Array.isArray(seed.capabilityReferences), 'seed mission normalizes capability references')

  const mission = runtime.startMission({
    title: 'Smoke Mission Runtime',
    goal: 'Verify Vela missions persist and resume.',
    plan: [
      { id: 'one', label: 'Create mission', status: 'Done' },
      { id: 'two', label: 'Resume mission', status: 'Active' },
    ],
    artifacts: [
      {
        name: 'Initial Runtime Brief',
        type: 'report',
        path: 'vela://runtime-brief',
        detail: 'Initial artifact should normalize through mission creation.',
        planStepId: 'one',
      },
    ],
  })
  assert(mission.state === 'Planned', 'started mission defaults to Planned')
  assert(mission.plan.length === 2, 'started mission keeps provided plan')
  assert(mission.artifacts.at(-1).title === 'Initial Runtime Brief', 'started mission normalizes initial artifact title')
  assert(mission.artifacts.at(-1).kind === 'report', 'started mission normalizes initial artifact kind')
  assert(mission.artifacts.at(-1).uri === 'vela://runtime-brief', 'started mission normalizes initial artifact uri')
  assert(mission.artifacts.at(-1).summary.includes('mission creation'), 'started mission normalizes initial artifact summary')
  assert(mission.artifacts.at(-1).planStepId === 'one', 'started mission links initial artifact to plan step')
  assert(mission.trace.some(event => event.type === 'mission.started'), 'started mission records trace event')
  assert(mission.trace.at(-1).missionId === mission.id, 'started mission trace is linked to mission id')
  assert(mission.capabilityReferences.some(item => item.id === 'agent.orchestration'), 'started mission records matched capability references')
  assert(mission.trace.some(event => event.type === 'capability.matched'), 'started mission records capability match trace')

  const running = runtime.updateCurrentMission({ state: 'Running', nextStep: 'Continue runtime verification.' })
  assert(running.state === 'Running', 'mission transitions Planned -> Running')
  assert(running.nextStep === 'Continue runtime verification.', 'mission patch updates next step')
  assert(running.trace.some(event => event.type === 'state.changed' && event.detail === 'Planned -> Running'), 'state transition records trace event')
  assert(running.trace.at(-1).missionId === mission.id, 'state trace is linked to mission id')

  const waitingForPermission = runtime.appendCurrentMissionPermission({
    action: 'Approve runtime smoke write',
    policy: 'Assist write gate',
    scope: 'vela://runtime-smoke',
    risk: 'Write',
    decision: 'requested',
    reason: 'Mission needs approval before continuing.',
    planStepId: 'two',
    toolCallId: 'runtime.write',
  })
  assert(waitingForPermission.state === 'Waiting for permission', 'pending permission moves mission to Waiting for permission')
  assert(waitingForPermission.permissions.at(-1).risk === 'Write', 'mission permission is appended')
  assert(waitingForPermission.permissions.at(-1).policy === 'Assist write gate', 'mission permission records guard policy')
  assert(waitingForPermission.permissions.at(-1).scope === 'vela://runtime-smoke', 'mission permission records scope')
  assert(waitingForPermission.permissions.at(-1).reason.includes('approval'), 'mission permission records reason')
  assert(waitingForPermission.trace.at(-1).permissionDecision === 'requested', 'mission permission records trace decision')
  assert(waitingForPermission.trace.at(-1).planStepId === 'two', 'mission permission trace links plan step')
  assert(waitingForPermission.trace.at(-1).toolName === 'runtime.write', 'mission permission trace links tool call')

  const resumedAfterPermission = runtime.updateCurrentMission({ state: 'Running', nextStep: 'Continue runtime verification.' })
  assert(resumedAfterPermission.state === 'Running', 'mission resumes from Waiting for permission')

  const actMode = runtime.updateCurrentMission({ permissionMode: 'Act' })
  assert(actMode.permissionMode === 'Act', 'mission permission mode can switch to Act')
  assert(actMode.trace.at(-1).type === 'permission.mode.changed', 'permission mode switch records trace event')
  assert(actMode.trace.at(-1).detail === 'Assist -> Act', 'permission mode trace records mode transition')

  const actWrite = runtime.appendCurrentMissionPermission({
    action: 'Write local runtime note',
    risk: 'Write',
    decision: 'requested',
    requestedBy: 'Runtime test',
  })
  assert(actWrite.state === 'Running', 'Act mode allows scoped write without pausing')
  assert(actWrite.permissions.at(-1).decision === 'approved', 'Act mode auto-approves scoped write permission')
  assert(actWrite.permissions.at(-1).policy === 'Act scoped-action allow', 'Act mode records scoped-action policy')

  runtime.updateCurrentMission({ permissionMode: 'Auto' })
  const autoUntrusted = runtime.appendCurrentMissionPermission({
    action: 'Run untrusted recurring write',
    risk: 'Write',
    decision: 'requested',
    requestedBy: 'Runtime test',
  })
  assert(autoUntrusted.state === 'Waiting for permission', 'Auto mode gates untrusted recurring actions')
  assert(autoUntrusted.permissions.at(-1).decision === 'requested', 'Auto mode keeps untrusted action pending')
  assert(autoUntrusted.permissions.at(-1).policy === 'Auto trusted-task gate', 'Auto mode records trusted-task gate policy')

  runtime.updateCurrentMission({ state: 'Running', nextStep: 'Continue runtime verification.' })
  const autoTrusted = runtime.appendCurrentMissionPermission({
    action: 'Run trusted recurring write',
    risk: 'Write',
    decision: 'requested',
    requestedBy: 'Runtime test',
    trustedRecurring: true,
  })
  assert(autoTrusted.state === 'Running', 'Auto mode allows trusted recurring low-risk actions')
  assert(autoTrusted.permissions.at(-1).decision === 'approved', 'Auto mode auto-approves trusted recurring action')
  assert(autoTrusted.permissions.at(-1).policy === 'Auto trusted-recurring allow', 'Auto mode records trusted-recurring policy')

  let invalidPermissionModeRejected = false
  try {
    runtime.updateCurrentMission({ permissionMode: 'Root' })
  } catch {
    invalidPermissionModeRejected = true
  }
  assert(invalidPermissionModeRejected, 'invalid permission mode is rejected')

  runtime.updateCurrentMission({ permissionMode: 'Plan' })
  const planBlocked = runtime.appendCurrentMissionPermission({
    action: 'Execute runtime mutation',
    risk: 'Execute',
    decision: 'requested',
    requestedBy: 'Runtime test',
  })
  assert(planBlocked.state === 'Blocked', 'Plan mode blocks non-read actions')
  assert(planBlocked.permissions.at(-1).decision === 'denied', 'Plan mode denies non-read permission')
  assert(planBlocked.trace.at(-1).permissionDecision === 'denied', 'Plan mode denial is auditable in trace')

  const blocked = runtime.appendCurrentMissionRecoveryAction({
    title: 'Repair runtime verification gap',
    summary: 'A recovery action should keep the mission visible.',
  })
  assert(blocked.state === 'Blocked', 'open recovery action moves mission to Blocked')
  assert(blocked.recoveryActions.at(-1).title === 'Repair runtime verification gap', 'mission recovery action is appended')
  assert(blocked.trace.at(-1).type === 'recovery.added', 'mission recovery action records trace event')

  const resolvedRecovery = runtime.updateCurrentMissionRecoveryAction(blocked.recoveryActions.at(-1).id, {
    status: 'resolved',
    summary: 'Runtime verification gap repaired.',
    nextStep: 'Continue runtime verification.',
  })
  assert(resolvedRecovery.state === 'Running', 'resolved recovery action resumes mission from Blocked')
  assert(resolvedRecovery.recoveryActions.at(-1).status === 'resolved', 'mission recovery action status updates')
  assert(resolvedRecovery.trace.at(-1).type === 'recovery.updated', 'mission recovery update records trace event')

  const resumedAfterRecovery = runtime.updateCurrentMission({ state: 'Running', nextStep: 'Continue runtime verification.' })
  assert(resumedAfterRecovery.state === 'Running', 'mission remains Running after recovery resolution')

  const stepDone = runtime.updateCurrentMissionPlanStep('two', {
    status: 'Done',
    nextStep: 'Runtime plan step updated.',
  })
  assert(stepDone.plan.find(step => step.id === 'two')?.status === 'Done', 'plan step status updates')
  assert(stepDone.nextStep === 'Runtime plan step updated.', 'plan step update can refresh next step')
  assert(stepDone.trace.at(-1).type === 'plan.step.updated', 'plan step update records trace event')
  assert(stepDone.trace.at(-1).planStepId === 'two', 'plan step update trace links step id')

  const stepActive = runtime.updateCurrentMissionPlanStep('one', { status: 'Active' })
  assert(stepActive.plan.find(step => step.id === 'one')?.status === 'Active', 'plan step can become active')
  assert(stepActive.plan.filter(step => step.status === 'Active').length === 1, 'plan keeps a single active step')

  const withInput = runtime.appendCurrentMissionInput({ text: 'Continue with runtime trace checks.', source: 'test' })
  assert(withInput.inputs.at(-1).source === 'test', 'mission input is appended')
  assert(withInput.trace.at(-1).type === 'input.added', 'mission input records trace event')

  const withArtifact = runtime.appendCurrentMissionArtifact({
    title: 'Runtime Notes',
    kind: 'note',
    uri: 'memory://runtime-notes',
    summary: 'Traceable runtime artifact.',
    planStepId: 'two',
  })
  assert(withArtifact.artifacts.at(-1).title === 'Runtime Notes', 'mission artifact is appended')
  assert(withArtifact.artifacts.at(-1).planStepId === 'two', 'mission artifact links to plan step')
  assert(withArtifact.trace.at(-1).type === 'artifact.added', 'mission artifact records trace event')
  assert(withArtifact.trace.at(-1).planStepId === 'two', 'mission artifact trace links plan step')
  assert(withArtifact.trace.at(-1).artifactId === withArtifact.artifacts.at(-1).id, 'mission artifact trace links artifact id')

  const withMemory = runtime.appendCurrentMissionMemoryReference({
    title: 'Runtime Memory',
    type: 'project',
    source: 'test',
    provenance: 'src/test-vela-mission.js',
    query: 'runtime mission trace memory',
    relevance: '0.91',
    confidence: 'high',
    usedByPlanStepId: 'two',
    reason: 'This memory explains the runtime mission test contract.',
    summary: 'Mission runtime test memory reference.',
  })
  assert(withMemory.memoryReferences.at(-1).title === 'Runtime Memory', 'mission memory reference is appended')
  assert(withMemory.memoryReferences.at(-1).provenance === 'src/test-vela-mission.js', 'mission memory reference records provenance')
  assert(withMemory.memoryReferences.at(-1).query === 'runtime mission trace memory', 'mission memory reference records recall query')
  assert(withMemory.memoryReferences.at(-1).usedByPlanStepId === 'two', 'mission memory reference records consuming plan step')
  assert(withMemory.trace.at(-1).type === 'memory.reference', 'mission memory reference records trace event')
  assert(withMemory.trace.at(-1).memoryReferenceId === withMemory.memoryReferences.at(-1).id, 'mission memory reference trace links memory id')
  assert(withMemory.trace.at(-1).planStepId === 'two', 'mission memory reference trace links consuming plan step')

  const withAgentAction = runtime.appendCurrentMissionAgentAction({
    role: 'Builder',
    title: 'Run runtime trace checks',
    status: 'done',
    planStepId: 'two',
    summary: 'Builder completed runtime trace checks.',
    result: 'passed',
    requiresReview: true,
  })
  assert(withAgentAction.agentActions.at(-1).role === 'Builder', 'mission agent action records role')
  assert(withAgentAction.agentActions.at(-1).status === 'done', 'mission agent action records status')
  assert(withAgentAction.trace.at(-1).type === 'agent.action', 'mission agent action records trace event')
  assert(withAgentAction.trace.at(-1).agentRole === 'Builder', 'mission agent action trace records agent role')
  assert(withAgentAction.trace.at(-1).reviewOutcome === 'required', 'mission agent action trace records review requirement')

  const withToolCall = runtime.appendCurrentMissionToolCall({
    toolName: 'test.runner',
    role: 'Builder',
    status: 'ok',
    planStepId: 'two',
    result: 'Runtime trace checks passed.',
  })
  assert(withToolCall.toolCalls.at(-1).toolName === 'test.runner', 'mission tool call is appended')
  assert(withToolCall.toolCalls.at(-1).role === 'Builder', 'mission tool call records agent role')
  assert(withToolCall.trace.at(-1).type === 'tool.called', 'mission tool call records trace event')
  assert(withToolCall.trace.at(-1).agentRole === 'Builder', 'mission tool call trace records agent role')
  assert(withToolCall.trace.at(-1).toolCallId === withToolCall.toolCalls.at(-1).id, 'mission tool call trace links tool call id')

  const withToolStage = runtime.appendCurrentMissionToolStage({
    toolName: 'test.runner',
    toolCallId: withToolCall.toolCalls.at(-1).id,
    role: 'Builder',
    status: 'ok',
    stage: 'stdout-read',
    url: 'vela://runtime-tool-stage',
    planStepId: 'two',
    summary: 'Runtime stage evidence was captured.',
  })
  assert(withToolStage.trace.at(-1).type === 'tool.stage', 'mission tool stage records trace event')
  assert(withToolStage.trace.at(-1).toolName === 'test.runner', 'mission tool stage records tool name')
  assert(withToolStage.trace.at(-1).toolCallId === withToolCall.toolCalls.at(-1).id, 'mission tool stage links tool call id')
  assert(withToolStage.trace.at(-1).stage === 'stdout-read', 'mission tool stage records stage name')
  assert(withToolStage.trace.at(-1).url === 'vela://runtime-tool-stage', 'mission tool stage records stage URL')
  assert(withToolStage.trace.at(-1).result === 'ok', 'mission tool stage records stage result')

  const withReviewCheck = runtime.appendCurrentMissionReviewCheck({
    title: 'Runtime claim accuracy',
    outcome: 'passed',
    reviewer: 'Mission Runtime Test',
    planStepId: 'two',
    artifactId: withArtifact.artifacts.at(-1).id,
    toolCallId: withToolCall.toolCalls.at(-1).id,
    summary: 'Reviewer checked runtime trace evidence.',
    evidence: ['runtime trace includes tool call and plan step linkage'],
  })
  assert(withReviewCheck.reviewChecks.at(-1).title === 'Runtime claim accuracy', 'mission review check is appended')
  assert(withReviewCheck.reviewChecks.at(-1).outcome === 'passed', 'mission review check records outcome')
  assert(withReviewCheck.reviewChecks.at(-1).evidence.at(-1).includes('plan step linkage'), 'mission review check records evidence')
  assert(withReviewCheck.trace.at(-1).type === 'review.check', 'mission review check records trace event')
  assert(withReviewCheck.trace.at(-1).reviewOutcome === 'passed', 'mission review check trace records review outcome')
  assert(withReviewCheck.trace.at(-1).artifactId === withArtifact.artifacts.at(-1).id, 'mission review check trace links artifact id')

  const reviewing = runtime.updateCurrentMission({ state: 'Reviewing', nextStep: 'Reviewer outcome required before completion.' })
  assert(reviewing.state === 'Reviewing', 'mission transitions Running -> Reviewing')

  let reviewGateRejected = false
  try {
    runtime.updateCurrentMission({ state: 'Complete' })
  } catch (err) {
    reviewGateRejected = err?.code === 'review_required'
  }
  assert(reviewGateRejected, 'mission cannot complete without reviewer outcome')

  const reviewed = runtime.setCurrentMissionReview({
    outcome: 'passed',
    reviewer: 'Mission Runtime Test',
    summary: 'Runtime trace surface is coherent.',
    evidence: ['Review check passed with linked tool evidence.'],
    failures: [],
  })
  assert(reviewed.reviewResult.outcome === 'passed', 'mission review result is recorded')
  assert(reviewed.reviewResult.evidence.at(-1).includes('linked tool evidence'), 'mission review records evidence')
  assert(reviewed.trace.at(-1).reviewOutcome === 'passed', 'mission review records trace outcome')

  const failedReviewCheck = runtime.appendCurrentMissionReviewCheck({
    title: 'Runtime claim accuracy',
    outcome: 'failed',
    reviewer: 'Mission Runtime Test',
    planStepId: 'two',
    artifactId: withArtifact.artifacts.at(-1).id,
    toolCallId: withToolCall.toolCalls.at(-1).id,
    summary: 'Reviewer found missing claim evidence.',
    failures: ['claim evidence missing before completion'],
  })
  assert(failedReviewCheck.reviewChecks.at(-1).key === withReviewCheck.reviewChecks.at(-1).key, 'matching review checks share a blocking key')
  assert(failedReviewCheck.recoveryActions.at(-1).source === 'review_blocked', 'blocking review check opens a recovery action')
  assert(failedReviewCheck.recoveryActions.at(-1).reviewCheckKey === failedReviewCheck.reviewChecks.at(-1).key, 'review recovery action links blocking check key')
  assert(failedReviewCheck.recoveryActions.at(-1).failures.at(-1).includes('claim evidence'), 'review recovery action carries failure evidence')

  let reviewBlockedRejected = false
  let reviewBlockedMission = null
  try {
    runtime.updateCurrentMission({ state: 'Complete' })
  } catch (err) {
    reviewBlockedRejected = err?.code === 'review_blocked'
    reviewBlockedMission = err?.mission
  }
  assert(reviewBlockedRejected, 'mission cannot complete with unresolved blocking review checks')
  assert(reviewBlockedMission?.recoveryActions?.some(item => item.source === 'review_blocked' && item.status === 'open'), 'review blocked error carries mission with open recovery action')

  const resolvedReviewCheck = runtime.appendCurrentMissionReviewCheck({
    title: 'Runtime claim accuracy',
    outcome: 'passed',
    reviewer: 'Mission Runtime Test',
    planStepId: 'two',
    artifactId: withArtifact.artifacts.at(-1).id,
    toolCallId: withToolCall.toolCalls.at(-1).id,
    summary: 'Reviewer accepted the repaired claim evidence.',
    evidence: ['claim evidence repaired before completion'],
  })
  assert(resolvedReviewCheck.reviewChecks.at(-1).key === failedReviewCheck.reviewChecks.at(-1).key, 'passing check resolves the same blocking key')
  assert(resolvedReviewCheck.recoveryActions.some(item => item.source === 'review_blocked' && item.reviewCheckKey === failedReviewCheck.reviewChecks.at(-1).key && item.status === 'resolved'), 'passing review check resolves linked recovery action')

  const completed = runtime.updateCurrentMission({ state: 'Complete', nextStep: 'Mission complete.' })
  assert(completed.state === 'Complete', 'mission completes after reviewer outcome')

  const reloaded = runtime.getCurrentMission()
  assert(reloaded.id === mission.id, 'current mission reloads from disk')
  assert(reloaded.state === 'Complete', 'mission state persists to disk')
  assert(reloaded.permissions.some(item => item.risk === 'Write'), 'mission permissions persist to disk')
  assert(reloaded.recoveryActions.some(item => item.title === 'Repair runtime verification gap'), 'mission recovery actions persist to disk')
  assert(reloaded.artifacts.some(item => item.title === 'Runtime Notes'), 'mission artifacts persist to disk')
  assert(reloaded.memoryReferences.some(item => item.title === 'Runtime Memory'), 'mission memory references persist to disk')
  assert(reloaded.agentActions.some(item => item.title === 'Run runtime trace checks' && item.role === 'Builder'), 'mission agent actions persist to disk')
  assert(reloaded.toolCalls.some(item => item.toolName === 'test.runner' && item.role === 'Builder'), 'mission tool calls persist to disk')
  assert(reloaded.reviewChecks.some(item => item.title === 'Runtime claim accuracy' && item.outcome === 'passed'), 'mission review checks persist to disk')
  assert(reloaded.reviewResult?.reviewer === 'Mission Runtime Test', 'mission review persists to disk')

  let invalidTransitionRejected = false
  try {
    runtime.updateCurrentMission({ state: 'Draft' })
  } catch {
    invalidTransitionRejected = true
  }
  assert(invalidTransitionRejected, 'invalid mission transition is rejected')

  const missions = runtime.listMissions()
  assert(missions.some(item => item.id === mission.id), 'mission list includes current mission')

  const second = runtime.startMission({
    title: 'Second Mission',
    goal: 'Verify mission switching.',
  })
  assert(runtime.getCurrentMission().id === second.id, 'new mission becomes current')
  const selected = runtime.selectMission(mission.id)
  assert(selected.id === mission.id, 'selectMission returns selected mission')
  assert(runtime.getCurrentMission().id === mission.id, 'selectMission changes current mission')

  const commandMission = runtime.applyCurrentMissionCommand({
    text: 'Command Pipeline Mission',
    source: 'test-command',
  })
  assert(commandMission.title === 'Command Pipeline Mission', 'plain command starts a mission')
  assert(commandMission.inputs.at(-1).source === 'test-command', 'command mission captures typed input')
  assert(commandMission.artifacts.some(item => item.title === '任务简报'), 'plain command mission creates a task brief artifact')
  assert(commandMission.artifacts.at(-1).summary.includes('Command Pipeline Mission'), 'task brief summarizes the command mission goal')
  assert(commandMission.artifacts.at(-1).planStepId === 'draft-plan', 'task brief links to the active planning step')
  assert(commandMission.trace.some(item => item.type === 'mission.brief.created'), 'task brief creation is auditable in trace')
  assert(commandMission.trace.at(-1).type === 'command.started_mission', 'command mission records command trace')
  assert(commandMission.capabilityReferences.some(item => item.id === 'agent.orchestration'), 'plain command mission keeps capability routing evidence')

  const commandRunning = runtime.applyCurrentMissionCommand({ text: 'continue', source: 'test-command' })
  assert(commandRunning.state === 'Running', 'continue command moves Planned -> Running')
  assert(commandRunning.plan.find(item => item.id === 'draft-plan')?.status === 'Done', 'continue command marks planning step done')
  assert(commandRunning.plan.find(item => item.id === 'execute-review')?.status === 'Active', 'continue command activates execution step')
  assert(commandRunning.agentActions.some(item => item.role === 'Planner' && item.planStepId === 'draft-plan'), 'continue command records Planner action')
  assert(commandRunning.toolCalls.at(-1).toolName === 'agent.orchestration.plan', 'generic command records orchestration planning tool call')
  assert(commandRunning.artifacts.at(-1).title === '多 Agent 编排方案', 'generic command creates orchestration plan artifact')
  assert(commandRunning.agentActions.at(-1).title === '拆解通用任务', 'generic command records planner decomposition')
  assert(commandRunning.trace.at(-1).type === 'agent.action', 'orchestration planner action is auditable in trace')

  const commandReviewing = runtime.applyCurrentMissionCommand({ text: 'continue', source: 'test-command' })
  assert(commandReviewing.state === 'Reviewing', 'continue command moves Running -> Reviewing')
  assert(commandReviewing.plan.find(item => item.id === 'execute-review')?.status === 'Reviewing', 'continue command marks execution step reviewing')
  assert(commandReviewing.agentActions.some(item => item.role === 'Builder' && item.requiresReview === true), 'review continue records Builder action requiring review')
  assert(commandReviewing.toolCalls.at(-1).toolName === 'agent.orchestration.execute', 'generic command records orchestration execution tool call')
  assert(commandReviewing.artifacts.at(-1).kind === 'orchestration-summary', 'generic command creates orchestration summary artifact')
  assert(commandReviewing.reviewChecks.at(-1).title === '多 Agent 编排复核', 'generic command creates orchestration reviewer check')
  assert(commandReviewing.reviewChecks.at(-1).outcome === 'passed', 'generic command orchestration review passes')
  assert(commandReviewing.agentActions.some(item => item.role === 'Researcher'), 'generic command records researcher handoff')
  assert(commandReviewing.agentActions.some(item => item.role === 'Operator'), 'generic command records operator handoff')
  assert(commandReviewing.agentActions.some(item => item.role === 'Reviewer'), 'generic command records reviewer handoff')
  const orchestrationExecuteToolId = commandReviewing.toolCalls.at(-1).id
  const orchestrationStages = commandReviewing.trace.filter(item => item.type === 'tool.stage' && item.toolCallId === orchestrationExecuteToolId)
  assert(orchestrationStages.some(item => item.toolName === 'agent.role-handoff' && item.result === 'ok'), 'generic command records orchestration role handoff stage')
  assert(orchestrationStages.some(item => item.toolName === 'agent.external-effect' && item.result === 'skipped'), 'generic command records skipped external-effect stage')

  let commandReviewGateRejected = false
  try {
    runtime.applyCurrentMissionCommand({ text: 'complete', source: 'test-command' })
  } catch (err) {
    commandReviewGateRejected = err?.code === 'review_required'
  }
  assert(commandReviewGateRejected, 'complete command is blocked without reviewer outcome')

  const commandReviewed = runtime.applyCurrentMissionCommand({ text: 'review passed', source: 'test-command' })
  assert(commandReviewed.reviewResult?.outcome === 'passed', 'review command records reviewer outcome')

  const commandCompleted = runtime.applyCurrentMissionCommand({ text: 'complete', source: 'test-command' })
  assert(commandCompleted.state === 'Complete', 'complete command succeeds after reviewer outcome')

  const mcpCommandMission = runtime.applyCurrentMissionCommand({
    text: '用 github 工具查看 issue',
    source: 'test-command',
  })
  assert(mcpCommandMission.capabilityReferences.some(item => item.id === 'tool.mcp-bridge'), 'MCP command mission matches tool bridge capability')
  const mcpCommandRunning = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(mcpCommandRunning.state === 'Running', 'MCP command enters running state')
  assert(mcpCommandRunning.toolCalls.at(-1).toolName === 'tool.mcp-bridge.prepare', 'MCP command records bridge prepare tool call')
  assert(mcpCommandRunning.artifacts.at(-1).title === 'MCP 工具路由方案', 'MCP command creates routing plan artifact')
  const mcpCommandReviewing = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(mcpCommandReviewing.state === 'Reviewing', 'MCP command moves to reviewing after routing')
  assert(mcpCommandReviewing.toolCalls.at(-1).toolName === 'tool.mcp-bridge.route', 'MCP command records bridge routing tool call')
  assert(mcpCommandReviewing.artifacts.at(-1).kind === 'mcp-route-summary', 'MCP command creates route summary artifact')
  assert(mcpCommandReviewing.reviewChecks.at(-1).title === 'MCP 工具桥复核', 'MCP command creates MCP bridge review check')
  assert(mcpCommandReviewing.reviewChecks.at(-1).outcome === 'passed', 'MCP command review passes')
  const mcpRouteToolId = mcpCommandReviewing.toolCalls.at(-1).id
  const mcpStages = mcpCommandReviewing.trace.filter(item => item.type === 'tool.stage' && item.toolCallId === mcpRouteToolId)
  assert(mcpStages.some(item => item.toolName === 'mcp.candidate.github' && item.result === 'ok'), 'MCP command records GitHub candidate stage')
  assert(mcpStages.some(item => item.toolName === 'mcp.external-tool-execution' && item.result === 'skipped'), 'MCP command records skipped MCP execution')

  const githubCommandMission = runtime.applyCurrentMissionCommand({
    text: '用 github 工具查看 yeyunzhou-26/Vela issue',
    source: 'test-command',
  })
  assert(githubCommandMission.capabilityReferences[0]?.id === 'tool.mcp-bridge', 'GitHub command keeps MCP bridge as primary capability')
  const githubCommandRunning = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(githubCommandRunning.state === 'Running', 'GitHub command enters running state')
  const githubCommandReviewing = await runtime.applyCurrentMissionCommandWithAdapters({
    text: '继续',
    source: 'test-command',
    capabilityAdapterDeps: {
      fetchJson: async ({ url }) => {
        if (url.includes('/issues?')) {
          return [
            {
              number: 9,
              title: 'Ship GitHub read-only mission execution',
              state: 'open',
              html_url: 'https://github.com/yeyunzhou-26/Vela/issues/9',
              user: { login: 'yeyunzhou-26' },
              labels: [{ name: 'runtime' }],
              updated_at: '2026-06-22T08:00:00Z',
            },
          ]
        }
        return {
          full_name: 'yeyunzhou-26/Vela',
          name: 'Vela',
          owner: { login: 'yeyunzhou-26' },
          html_url: 'https://github.com/yeyunzhou-26/Vela',
          description: 'Mission-first AI Operating Desk',
          default_branch: 'main',
          stargazers_count: 0,
          forks_count: 0,
          open_issues_count: 1,
          visibility: 'public',
          updated_at: '2026-06-22T08:00:00Z',
        }
      },
    },
  })
  assert(githubCommandReviewing.state === 'Reviewing', 'async GitHub command moves to reviewing')
  assert(githubCommandReviewing.toolCalls.at(-1).status === 'ok', 'async GitHub command records successful tool call')
  assert(githubCommandReviewing.toolCalls.at(-1).result.includes('github.repo.get + github.issues.list'), 'async GitHub command records GitHub source tools')
  assert(githubCommandReviewing.artifacts.at(-1).kind === 'mcp-github-read-summary', 'async GitHub command creates GitHub artifact')
  assert(githubCommandReviewing.artifacts.at(-1).summary.includes('Ship GitHub read-only mission execution'), 'async GitHub command summarizes issue list')
  assert(githubCommandReviewing.reviewChecks.at(-1).title === 'GitHub 只读复核', 'async GitHub command creates GitHub review check')
  assert(githubCommandReviewing.reviewChecks.at(-1).outcome === 'passed', 'async GitHub command review passes')
  const githubReadToolId = githubCommandReviewing.toolCalls.at(-1).id
  const githubStages = githubCommandReviewing.trace.filter(item => item.type === 'tool.stage' && item.toolCallId === githubReadToolId)
  assert(githubStages.some(item => item.toolName === 'github.repo.get' && item.result === 'ok'), 'async GitHub command records repo read stage')
  assert(githubStages.some(item => item.toolName === 'github.issues.list' && item.result === 'ok'), 'async GitHub command records issue read stage')
  assert(githubStages.some(item => item.toolName === 'mcp.write-action' && item.result === 'skipped'), 'async GitHub command records skipped write-action stage')

  runtime.applyCurrentMissionCommand({
    text: '用 github 工具查看 https://github.com/yeyunzhou-26/Vela/issues/12 的详情和评论',
    source: 'test-command',
  })
  runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  const githubDetailReviewing = await runtime.applyCurrentMissionCommandWithAdapters({
    text: '继续',
    source: 'test-command',
    capabilityAdapterDeps: {
      fetchJson: async ({ url }) => {
        if (url.includes('/issues/12/comments')) {
          return [
            {
              id: 1201,
              body: 'The operator should summarize this before drafting any response.',
              html_url: 'https://github.com/yeyunzhou-26/Vela/issues/12#issuecomment-1201',
              user: { login: 'operator' },
              author_association: 'MEMBER',
              created_at: '2026-06-22T10:30:00Z',
              updated_at: '2026-06-22T10:30:00Z',
            },
          ]
        }
        if (url.match(/\/issues\/12$/)) {
          return {
            number: 12,
            title: 'Understand issue context before acting',
            state: 'open',
            html_url: 'https://github.com/yeyunzhou-26/Vela/issues/12',
            user: { login: 'yeyunzhou-26' },
            labels: [{ name: 'runtime' }],
            body: 'Before Vela replies or edits anything, it should read the issue body and comments.',
            comments: 1,
            created_at: '2026-06-22T10:00:00Z',
            updated_at: '2026-06-22T10:15:00Z',
          }
        }
        return {
          full_name: 'yeyunzhou-26/Vela',
          name: 'Vela',
          owner: { login: 'yeyunzhou-26' },
          html_url: 'https://github.com/yeyunzhou-26/Vela',
          description: 'Mission-first AI Operating Desk',
          default_branch: 'main',
          stargazers_count: 0,
          forks_count: 0,
          open_issues_count: 1,
          visibility: 'public',
          updated_at: '2026-06-22T10:00:00Z',
        }
      },
    },
  })
  assert(githubDetailReviewing.state === 'Reviewing', 'async GitHub issue detail command moves to reviewing')
  assert(githubDetailReviewing.toolCalls.at(-1).result.includes('github.issue.get'), 'async GitHub issue detail command records detail source tool')
  assert(githubDetailReviewing.toolCalls.at(-1).result.includes('github.issue.comments.list'), 'async GitHub issue detail command records comments source tool')
  assert(githubDetailReviewing.artifacts.at(-1).summary.includes('Understand issue context before acting'), 'async GitHub issue detail command summarizes issue detail')
  assert(githubDetailReviewing.artifacts.at(-1).summary.includes('operator'), 'async GitHub issue detail command summarizes comments')
  assert(githubDetailReviewing.reviewChecks.at(-1).evidence.some(item => item.includes('issuecomment-1201')), 'async GitHub issue detail command keeps comment evidence')
  const githubDetailToolId = githubDetailReviewing.toolCalls.at(-1).id
  const githubDetailStages = githubDetailReviewing.trace.filter(item => item.type === 'tool.stage' && item.toolCallId === githubDetailToolId)
  assert(githubDetailStages.some(item => item.toolName === 'github.issue.get' && item.result === 'ok'), 'async GitHub issue detail command records detail read stage')
  assert(githubDetailStages.some(item => item.toolName === 'github.issue.comments.list' && item.result === 'ok'), 'async GitHub issue detail command records comments read stage')
  assert(githubDetailStages.some(item => item.toolName === 'mcp.write-action' && item.result === 'skipped'), 'async GitHub issue detail command records skipped write-action stage')

  runtime.applyCurrentMissionCommand({
    text: '用 github 工具查看 https://github.com/yeyunzhou-26/Vela/pull/14 的改动文件和 review',
    source: 'test-command',
  })
  runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  const githubPullReviewing = await runtime.applyCurrentMissionCommandWithAdapters({
    text: '继续',
    source: 'test-command',
    capabilityAdapterDeps: {
      fetchJson: async ({ url }) => {
        if (url.includes('/pulls/14/files')) {
          return [
            {
              filename: 'src/vela/capability-adapters.js',
              status: 'modified',
              additions: 8,
              deletions: 1,
              changes: 9,
              blob_url: 'https://github.com/yeyunzhou-26/Vela/blob/pr/src/vela/capability-adapters.js',
              patch: '@@ -700,6 +700,8 @@\n+normalize pull request result',
            },
          ]
        }
        if (url.includes('/pulls/14/reviews')) {
          return [
            {
              id: 1401,
              state: 'COMMENTED',
              body: 'Please verify trace evidence includes changed files.',
              html_url: 'https://github.com/yeyunzhou-26/Vela/pull/14#pullrequestreview-1401',
              user: { login: 'reviewer' },
              submitted_at: '2026-06-22T12:00:00Z',
            },
          ]
        }
        if (url.includes('/issues/14/comments')) {
          return [
            {
              id: 1402,
              body: 'The PR should stay read-only until approval.',
              html_url: 'https://github.com/yeyunzhou-26/Vela/pull/14#issuecomment-1402',
              user: { login: 'operator' },
              created_at: '2026-06-22T12:05:00Z',
            },
          ]
        }
        if (url.match(/\/pulls\/14$/)) {
          return {
            number: 14,
            title: 'Preserve PR context in mission review',
            state: 'open',
            html_url: 'https://github.com/yeyunzhou-26/Vela/pull/14',
            user: { login: 'yeyunzhou-26' },
            body: 'Mission review should include PR metadata, files, reviews, and comments.',
            base: { ref: 'main' },
            head: { ref: 'feat/pr-context' },
            mergeable: false,
            draft: true,
            additions: 8,
            deletions: 1,
            changed_files: 1,
            commits: 1,
            comments: 1,
            review_comments: 1,
            created_at: '2026-06-22T11:45:00Z',
            updated_at: '2026-06-22T12:10:00Z',
          }
        }
        return {
          full_name: 'yeyunzhou-26/Vela',
          name: 'Vela',
          owner: { login: 'yeyunzhou-26' },
          html_url: 'https://github.com/yeyunzhou-26/Vela',
          description: 'Mission-first AI Operating Desk',
          default_branch: 'main',
          stargazers_count: 0,
          forks_count: 0,
          open_issues_count: 1,
          visibility: 'public',
          updated_at: '2026-06-22T11:45:00Z',
        }
      },
    },
  })
  assert(githubPullReviewing.state === 'Reviewing', 'async GitHub PR command moves to reviewing')
  assert(githubPullReviewing.toolCalls.at(-1).result.includes('github.pull.get'), 'async GitHub PR command records pull source tool')
  assert(githubPullReviewing.toolCalls.at(-1).result.includes('github.pull.files.list'), 'async GitHub PR command records files source tool')
  assert(githubPullReviewing.toolCalls.at(-1).result.includes('github.pull.reviews.list'), 'async GitHub PR command records reviews source tool')
  assert(githubPullReviewing.artifacts.at(-1).summary.includes('Preserve PR context in mission review'), 'async GitHub PR command summarizes PR detail')
  assert(githubPullReviewing.artifacts.at(-1).summary.includes('src/vela/capability-adapters.js'), 'async GitHub PR command summarizes changed files')
  assert(githubPullReviewing.reviewChecks.at(-1).evidence.some(item => item.includes('pullrequestreview-1401')), 'async GitHub PR command keeps review evidence')
  const githubPullToolId = githubPullReviewing.toolCalls.at(-1).id
  const githubPullStages = githubPullReviewing.trace.filter(item => item.type === 'tool.stage' && item.toolCallId === githubPullToolId)
  assert(githubPullStages.some(item => item.toolName === 'github.pull.get' && item.result === 'ok'), 'async GitHub PR command records pull read stage')
  assert(githubPullStages.some(item => item.toolName === 'github.pull.files.list' && item.result === 'ok'), 'async GitHub PR command records files read stage')
  assert(githubPullStages.some(item => item.toolName === 'github.pull.reviews.list' && item.result === 'ok'), 'async GitHub PR command records reviews read stage')
  assert(githubPullStages.some(item => item.toolName === 'github.issue.comments.list' && item.result === 'ok'), 'async GitHub PR command records issue comments stage')
  assert(githubPullStages.some(item => item.toolName === 'mcp.write-action' && item.result === 'skipped'), 'async GitHub PR command records skipped write-action stage')

  runtime.applyCurrentMissionCommand({
    text: '用 github 工具查看 https://github.com/yeyunzhou-26/Vela/blob/main/src/vela/github-reader.js 的源码',
    source: 'test-command',
  })
  runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  const githubContentReviewing = await runtime.applyCurrentMissionCommandWithAdapters({
    text: '继续',
    source: 'test-command',
    capabilityAdapterDeps: {
      fetchJson: async ({ url }) => {
        if (url.includes('/contents/src/vela/github-reader.js?ref=main')) {
          return {
            type: 'file',
            name: 'github-reader.js',
            path: 'src/vela/github-reader.js',
            encoding: 'base64',
            content: 'ZXhwb3J0IGZ1bmN0aW9uIHJlYWRHaXRIdWJNaXNzaW9uKCkgewogIHJldHVybiAiY29udGVudCByZWFkZXIiCn0K',
            size: 68,
            sha: 'github-reader-content-sha',
            html_url: 'https://github.com/yeyunzhou-26/Vela/blob/main/src/vela/github-reader.js',
            download_url: 'https://raw.githubusercontent.com/yeyunzhou-26/Vela/main/src/vela/github-reader.js',
          }
        }
        return {
          full_name: 'yeyunzhou-26/Vela',
          name: 'Vela',
          owner: { login: 'yeyunzhou-26' },
          html_url: 'https://github.com/yeyunzhou-26/Vela',
          description: 'Mission-first AI Operating Desk',
          default_branch: 'main',
          stargazers_count: 0,
          forks_count: 0,
          open_issues_count: 1,
          visibility: 'public',
          updated_at: '2026-06-22T12:35:00Z',
        }
      },
    },
  })
  assert(githubContentReviewing.state === 'Reviewing', 'async GitHub content command moves to reviewing')
  assert(githubContentReviewing.toolCalls.at(-1).result.includes('github.contents.get'), 'async GitHub content command records contents source tool')
  assert(githubContentReviewing.artifacts.at(-1).summary.includes('src/vela/github-reader.js'), 'async GitHub content command summarizes file path')
  assert(githubContentReviewing.artifacts.at(-1).summary.includes('content reader'), 'async GitHub content command summarizes file excerpt')
  assert(githubContentReviewing.reviewChecks.at(-1).evidence.some(item => item.includes('github-reader.js')), 'async GitHub content command keeps file evidence')
  const githubContentToolId = githubContentReviewing.toolCalls.at(-1).id
  const githubContentStages = githubContentReviewing.trace.filter(item => item.type === 'tool.stage' && item.toolCallId === githubContentToolId)
  assert(githubContentStages.some(item => item.toolName === 'github.contents.get' && item.result === 'ok'), 'async GitHub content command records contents read stage')
  assert(githubContentStages.some(item => item.toolName === 'mcp.write-action' && item.result === 'skipped'), 'async GitHub content command records skipped write-action stage')

  runtime.applyCurrentMissionCommand({
    text: '用 GitHub 搜索 browser automation agent 开源项目',
    source: 'test-command',
  })
  runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  const githubSearchReviewing = await runtime.applyCurrentMissionCommandWithAdapters({
    text: '继续',
    source: 'test-command',
    capabilityAdapterDeps: {
      fetchJson: githubRepoSearchFetchJson,
    },
  })
  assert(githubSearchReviewing.state === 'Reviewing', 'async GitHub repository search command moves to reviewing')
  assert(githubSearchReviewing.toolCalls.at(-1).result.includes('github.search.repositories'), 'async GitHub repository search command records search source tool')
  assert(githubSearchReviewing.toolCalls.at(-1).result.includes('github.search.candidate.readme'), 'async GitHub repository search command records candidate README source tool')
  assert(githubSearchReviewing.toolCalls.at(-1).result.includes('github.search.lessons.synthesize'), 'async GitHub repository search command records lesson synthesis source tool')
  assert(githubSearchReviewing.toolCalls.at(-1).result.includes('github.search.read-plan.synthesize'), 'async GitHub repository search command records read-plan synthesis source tool')
  assert(githubSearchReviewing.toolCalls.at(-1).result.includes('github.search.planned-source.read'), 'async GitHub repository search command records planned source read tool')
  assert(githubSearchReviewing.toolCalls.at(-1).result.includes('github.search.capability-draft.synthesize'), 'async GitHub repository search command records capability draft source tool')
  assert(githubSearchReviewing.toolCalls.at(-1).result.includes('github.search.implementation-queue.synthesize'), 'async GitHub repository search command records implementation queue source tool')
  assert(githubSearchReviewing.artifacts.at(-1).summary.includes('browser-use/browser-use'), 'async GitHub repository search command summarizes candidates')
  assert(githubSearchReviewing.artifacts.at(-1).summary.includes('README'), 'async GitHub repository search command summarizes candidate deep-read evidence')
  assert(githubSearchReviewing.artifacts.at(-1).summary.includes('开源吸收建议'), 'async GitHub repository search command summarizes synthesized lessons')
  assert(githubSearchReviewing.artifacts.at(-1).summary.includes('后续源码读取计划'), 'async GitHub repository search command summarizes read plans')
  assert(githubSearchReviewing.artifacts.at(-1).summary.includes('源码目标'), 'async GitHub repository search command summarizes planned source reads')
  assert(githubSearchReviewing.artifacts.at(-1).summary.includes('本地能力草案'), 'async GitHub repository search command summarizes capability drafts')
  assert(githubSearchReviewing.artifacts.at(-1).summary.includes('本地实施票'), 'async GitHub repository search command summarizes implementation queue')
  assert(githubSearchReviewing.reviewChecks.at(-1).evidence.some(item => item.includes('playwright-mcp')), 'async GitHub repository search command keeps candidate evidence')
  assert(githubSearchReviewing.reviewChecks.at(-1).evidence.some(item => item.includes('候选深读')), 'async GitHub repository search command keeps candidate analysis evidence')
  assert(githubSearchReviewing.reviewChecks.at(-1).evidence.some(item => item.includes('候选吸收建议')), 'async GitHub repository search command keeps lesson evidence')
  assert(githubSearchReviewing.reviewChecks.at(-1).evidence.some(item => item.includes('候选读取计划')), 'async GitHub repository search command keeps read-plan evidence')
  assert(githubSearchReviewing.reviewChecks.at(-1).evidence.some(item => item.includes('候选源码证据')), 'async GitHub repository search command keeps planned source evidence')
  assert(githubSearchReviewing.reviewChecks.at(-1).evidence.some(item => item.includes('Vela 能力草案')), 'async GitHub repository search command keeps capability draft evidence')
  assert(githubSearchReviewing.reviewChecks.at(-1).evidence.some(item => item.includes('Vela 实施队列')), 'async GitHub repository search command keeps implementation queue evidence')
  const githubSearchToolId = githubSearchReviewing.toolCalls.at(-1).id
  const githubSearchStages = githubSearchReviewing.trace.filter(item => item.type === 'tool.stage' && item.toolCallId === githubSearchToolId)
  assert(githubSearchStages.some(item => item.toolName === 'github.search.repositories' && item.result === 'ok'), 'async GitHub repository search command records search stage')
  assert(githubSearchStages.some(item => item.toolName === 'github.search.candidate.entry' && item.result === 'ok'), 'async GitHub repository search command records candidate entry stage')
  assert(githubSearchStages.some(item => item.toolName === 'github.search.lessons.synthesize' && item.result === 'ok'), 'async GitHub repository search command records lesson synthesis stage')
  assert(githubSearchStages.some(item => item.toolName === 'github.search.read-plan.synthesize' && item.result === 'ok'), 'async GitHub repository search command records read-plan synthesis stage')
  assert(githubSearchStages.some(item => item.toolName === 'github.search.planned-source.read' && item.result === 'ok'), 'async GitHub repository search command records planned source read stage')
  assert(githubSearchStages.some(item => item.toolName === 'github.search.capability-draft.synthesize' && item.result === 'ok'), 'async GitHub repository search command records capability draft stage')
  assert(githubSearchStages.some(item => item.toolName === 'github.search.implementation-queue.synthesize' && item.result === 'ok'), 'async GitHub repository search command records implementation queue stage')
  assert(githubSearchStages.some(item => item.toolName === 'mcp.write-action' && item.result === 'skipped'), 'async GitHub repository search command records skipped write-action stage')

  runtime.applyCurrentMissionCommand({
    text: '用 github 工具查看 missing-owner/missing-repo issue',
    source: 'test-command',
  })
  runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  const failedGithubReviewing = await runtime.applyCurrentMissionCommandWithAdapters({
    text: '继续',
    source: 'test-command',
    capabilityAdapterDeps: {
      fetchJson: async () => ({
        ok: false,
        status: 404,
        message: 'Not Found',
      }),
    },
  })
  assert(failedGithubReviewing.state === 'Reviewing', 'failed GitHub command still reaches reviewing with evidence')
  assert(failedGithubReviewing.toolCalls.at(-1).status === 'failed', 'failed GitHub command records failed tool call')
  assert(failedGithubReviewing.reviewChecks.at(-1).outcome === 'failed', 'failed GitHub command records failed review check')
  assert(failedGithubReviewing.reviewChecks.at(-1).failures.some(item => item.includes('Not Found')), 'failed GitHub command records API failure reason')
  assert(failedGithubReviewing.recoveryActions.some(item => item.source === 'review_blocked' && item.status === 'open'), 'failed GitHub command opens review recovery action')
  const failedGithubToolId = failedGithubReviewing.toolCalls.at(-1).id
  const failedGithubStages = failedGithubReviewing.trace.filter(item => item.type === 'tool.stage' && item.toolCallId === failedGithubToolId)
  assert(failedGithubStages.some(item => item.toolName === 'github.repo.get' && item.result === 'failed'), 'failed GitHub command records failed repo stage')
  assert(failedGithubStages.some(item => item.toolName === 'mcp.write-action' && item.result === 'skipped'), 'failed GitHub command still records skipped write-action stage')

  const mcpReportMission = runtime.applyCurrentMissionCommand({
    text: '用 github 工具查看 issue 并生成报告',
    source: 'test-command',
  })
  assert(mcpReportMission.capabilityReferences[0]?.id === 'tool.mcp-bridge', 'MCP report command keeps tool bridge as primary capability')
  assert(mcpReportMission.capabilityReferences.some(item => item.id === 'files.document-work'), 'MCP report command keeps file capability as secondary')
  const mcpReportRunning = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(mcpReportRunning.toolCalls.at(-1).toolName === 'tool.mcp-bridge.prepare', 'MCP report command dispatches through primary capability order')

  const browserCommandMission = runtime.applyCurrentMissionCommand({
    text: '帮我打开网页搜索资料并总结',
    source: 'test-command',
  })
  assert(browserCommandMission.capabilityReferences.some(item => item.id === 'browser.web-agent'), 'browser command mission matches browser capability')
  assert(!browserCommandMission.capabilityReferences.some(item => item.id === 'voice.system-entry'), 'browser command mission does not match voice from default next-step copy')
  const browserCommandRunning = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(browserCommandRunning.state === 'Running', 'browser command continues without permission for read-only browsing')
  assert(browserCommandRunning.toolCalls.at(-1).toolName === 'browser.web-agent.prepare', 'browser command records browser adapter tool call')
  assert(browserCommandRunning.toolCalls.at(-1).status === 'prepared', 'browser command tool call is prepared')
  assert(browserCommandRunning.artifacts.at(-1).title === '浏览器执行方案', 'browser command creates browser execution plan artifact')
  const browserCommandReviewing = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(browserCommandReviewing.state === 'Reviewing', 'browser command moves to reviewing after adapter execution')
  assert(browserCommandReviewing.toolCalls.at(-1).toolName === 'browser.web-agent.read', 'browser command records browser read execution')
  assert(browserCommandReviewing.toolCalls.at(-1).status === 'ok', 'browser read execution succeeds')
  assert(browserCommandReviewing.artifacts.at(-1).title === '浏览器结果摘要', 'browser command creates browser result artifact')
  assert(browserCommandReviewing.reviewChecks.at(-1).title === '浏览器结果复核', 'browser command creates browser review check')
  assert(browserCommandReviewing.reviewChecks.at(-1).outcome === 'passed', 'browser command review check passes')
  assert(browserCommandReviewing.reviewChecks.at(-1).toolCallId === browserCommandReviewing.toolCalls.at(-1).id, 'browser review check links executed tool call')
  assert(browserCommandReviewing.reviewChecks.at(-1).artifactId === browserCommandReviewing.artifacts.at(-1).id, 'browser review check links result artifact')

  const liveBrowserCommandMission = runtime.applyCurrentMissionCommand({
    text: '帮我打开网页总结 https://example.com/vela',
    source: 'test-command',
  })
  assert(liveBrowserCommandMission.capabilityReferences.some(item => item.id === 'browser.web-agent'), 'live browser command matches browser capability')
  const liveBrowserRunning = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(liveBrowserRunning.state === 'Running', 'live browser command enters running state')
  const liveBrowserReviewing = await runtime.applyCurrentMissionCommandWithAdapters({
    text: '继续',
    source: 'test-command',
    capabilityAdapterDeps: {
      fetchUrl: async (args) => JSON.stringify({
        ok: true,
        tool: 'fetch_url',
        url: args.url,
        fetch_source: 'direct',
        title: 'Vela Live Browser Source',
        content: 'Live browser adapter results flow through the async command wrapper into mission artifacts.',
        content_length: 91,
      }),
    },
  })
  assert(liveBrowserReviewing.state === 'Reviewing', 'async browser command moves to reviewing')
  assert(liveBrowserReviewing.toolCalls.at(-1).result.includes('fetch_url'), 'async browser command records live fetch tool')
  assert(liveBrowserReviewing.artifacts.at(-1).summary.includes('Vela Live Browser Source'), 'async browser command writes live source summary')
  assert(liveBrowserReviewing.artifacts.at(-1).summary.includes('下一步建议'), 'async browser command writes action-space next step')
  assert(liveBrowserReviewing.reviewChecks.at(-1).evidence.some(item => item.includes('example.com/vela')), 'async browser command review keeps source evidence')
  assert(liveBrowserReviewing.reviewChecks.at(-1).evidence.some(item => item.includes('页面观察')), 'async browser command review keeps page observations')
  assert(liveBrowserReviewing.reviewChecks.at(-1).evidence.some(item => item.includes('建议动作')), 'async browser command review keeps proposed actions')
  const liveBrowserReadToolId = liveBrowserReviewing.toolCalls.at(-1).id
  const liveBrowserFetchStage = liveBrowserReviewing.trace.find(item => (
    item.type === 'tool.stage'
      && item.toolCallId === liveBrowserReadToolId
      && item.toolName === 'fetch_url'
      && item.url.includes('example.com/vela')
  ))
  assert(liveBrowserFetchStage?.result === 'ok', 'async browser command records fetch_url stage success')

  runtime.applyCurrentMissionCommand({
    text: '帮我打开网页总结 https://example.com/js-fail',
    source: 'test-command',
  })
  runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  const failedBrowserReviewing = await runtime.applyCurrentMissionCommandWithAdapters({
    text: '继续',
    source: 'test-command',
    capabilityAdapterDeps: {
      fetchUrl: async (args) => JSON.stringify({
        ok: false,
        tool: 'fetch_url',
        url: args.url,
        error: 'no readable content',
        hint: 'The page requires JavaScript or blocks crawlers. Use browser_read instead.',
      }),
      browserRead: async (args) => JSON.stringify({
        ok: false,
        tool: 'browser_read',
        url: args.url,
        error: 'captcha required',
      }),
    },
  })
  assert(failedBrowserReviewing.state === 'Reviewing', 'failed browser command still reaches reviewing with evidence')
  assert(failedBrowserReviewing.toolCalls.at(-1).status === 'failed', 'failed browser command records failed tool call')
  assert(failedBrowserReviewing.reviewChecks.at(-1).outcome === 'failed', 'failed browser command records failed review check')
  assert(failedBrowserReviewing.reviewChecks.at(-1).failures.some(item => item.includes('captcha required')), 'failed browser command records browser failure reason')
  assert(failedBrowserReviewing.artifacts.at(-1).summary.includes('恢复建议'), 'failed browser command artifact includes recovery hint')
  assert(failedBrowserReviewing.reviewChecks.at(-1).evidence.some(item => item.includes('恢复建议')), 'failed browser command review keeps recovery hints')
  assert(failedBrowserReviewing.recoveryActions.some(item => item.source === 'review_blocked' && item.status === 'open'), 'failed browser command opens review recovery action')
  const failedBrowserReadToolId = failedBrowserReviewing.toolCalls.at(-1).id
  const failedBrowserStages = failedBrowserReviewing.trace.filter(item => (
    item.type === 'tool.stage' && item.toolCallId === failedBrowserReadToolId
  ))
  assert(failedBrowserStages.some(item => item.toolName === 'fetch_url' && item.result === 'failed'), 'failed browser command records failed fetch_url stage')
  assert(failedBrowserStages.some(item => item.toolName === 'browser_read' && item.result === 'failed'), 'failed browser command records failed browser_read stage')
  assert(failedBrowserStages.some(item => item.url.includes('example.com/js-fail')), 'failed browser command stage trace keeps target URL')

  const browserSubmitMission = runtime.applyCurrentMissionCommand({
    text: '帮我打开网页填写表单并提交',
    source: 'test-command',
  })
  assert(browserSubmitMission.capabilityReferences.some(item => item.id === 'browser.web-agent'), 'browser submit mission matches browser capability')
  const browserSubmitGate = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(browserSubmitGate.state === 'Waiting for permission', 'browser submit command waits for permission')
  assert(browserSubmitGate.toolCalls.at(-1).status === 'needs-permission', 'browser submit tool call records permission need')
  assert(browserSubmitGate.permissions.at(-1).requestedBy === 'Vela Browser Adapter', 'browser submit permission records adapter requester')
  assert(browserSubmitGate.permissions.at(-1).toolCallId === browserSubmitGate.toolCalls.at(-1).id, 'browser submit permission links to tool call')

  const filesCommandMission = runtime.applyCurrentMissionCommand({
    text: '帮我生成一份 Vela 进展报告',
    source: 'test-command',
  })
  assert(filesCommandMission.capabilityReferences.some(item => item.id === 'files.document-work'), 'files command mission matches file capability')
  const filesCommandRunning = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(filesCommandRunning.state === 'Running', 'files command enters running state')
  assert(filesCommandRunning.toolCalls.at(-1).toolName === 'files.document-work.prepare', 'files command records file prepare tool call')
  assert(filesCommandRunning.artifacts.at(-1).title === '文件产物方案', 'files command creates file plan artifact')
  const filesCommandReviewing = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(filesCommandReviewing.state === 'Reviewing', 'files command moves to reviewing after draft generation')
  assert(filesCommandReviewing.toolCalls.at(-1).toolName === 'files.document-work.generate', 'files command records document generation')
  assert(filesCommandReviewing.artifacts.at(-1).kind === 'document-draft', 'files command creates document draft artifact')
  assert(filesCommandReviewing.reviewChecks.at(-1).title === '文件产物复核', 'files command creates file review check')
  assert(filesCommandReviewing.reviewChecks.at(-1).outcome === 'passed', 'files command review passes')
  const filesGenerateToolId = filesCommandReviewing.toolCalls.at(-1).id
  const filesStages = filesCommandReviewing.trace.filter(item => item.type === 'tool.stage' && item.toolCallId === filesGenerateToolId)
  assert(filesStages.some(item => item.toolName === 'files.outline' && item.result === 'ok'), 'files command records outline stage')
  assert(filesStages.some(item => item.toolName === 'files.local-write' && item.result === 'skipped'), 'files command records skipped local write stage')

  const filesWriteMission = runtime.applyCurrentMissionCommand({
    text: '帮我保存报告到本地文件',
    source: 'test-command',
  })
  assert(filesWriteMission.capabilityReferences.some(item => item.id === 'files.document-work'), 'files write mission matches file capability')
  const filesWriteGate = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(filesWriteGate.state === 'Waiting for permission', 'files write command waits for permission')
  assert(filesWriteGate.toolCalls.at(-1).toolName === 'files.document-work.prepare', 'files write command records prepare tool')
  assert(filesWriteGate.toolCalls.at(-1).status === 'needs-permission', 'files write command records permission need')
  assert(filesWriteGate.permissions.at(-1).requestedBy === 'Vela File Adapter', 'files write permission records adapter requester')
  assert(filesWriteGate.permissions.at(-1).risk === 'Write', 'files write permission records write risk')

  const memoryCommandMission = runtime.applyCurrentMissionCommand({
    text: '记住我的偏好：我喜欢中文界面',
    source: 'test-command',
  })
  assert(memoryCommandMission.capabilityReferences.some(item => item.id === 'memory.context-os'), 'memory command mission matches memory capability')
  const memoryCommandRunning = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(memoryCommandRunning.state === 'Running', 'memory command enters running state')
  assert(memoryCommandRunning.toolCalls.at(-1).toolName === 'memory.context-os.prepare', 'memory command records memory prepare tool call')
  assert(memoryCommandRunning.artifacts.at(-1).title === '记忆召回方案', 'memory command creates recall plan artifact')
  const memoryCommandReviewing = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(memoryCommandReviewing.state === 'Reviewing', 'memory command moves to reviewing after context recall')
  assert(memoryCommandReviewing.toolCalls.at(-1).toolName === 'memory.context-os.recall', 'memory command records memory recall')
  assert(memoryCommandReviewing.artifacts.at(-1).kind === 'memory-context', 'memory command creates memory context artifact')
  assert(memoryCommandReviewing.memoryReferences.at(-1).title === '用户偏好上下文', 'memory command attaches user preference memory')
  assert(memoryCommandReviewing.memoryReferences.at(-1).provenance.includes('memory.context-os'), 'memory command keeps memory provenance')
  assert(memoryCommandReviewing.trace.some(item => item.type === 'memory.reference' && item.memoryReferenceId === memoryCommandReviewing.memoryReferences.at(-1).id), 'memory command records memory reference trace')
  assert(memoryCommandReviewing.reviewChecks.at(-1).title === '记忆上下文复核', 'memory command creates memory review check')
  assert(memoryCommandReviewing.reviewChecks.at(-1).outcome === 'passed', 'memory command review passes')
  const memoryRecallToolId = memoryCommandReviewing.toolCalls.at(-1).id
  const memoryStages = memoryCommandReviewing.trace.filter(item => item.type === 'tool.stage' && item.toolCallId === memoryRecallToolId)
  assert(memoryStages.some(item => item.toolName === 'memory.recall' && item.result === 'ok'), 'memory command records recall stage')
  assert(memoryStages.some(item => item.toolName === 'memory.long-term-write' && item.result === 'skipped'), 'memory command records skipped long-term write')

  const desktopCommandMission = runtime.applyCurrentMissionCommand({
    text: '帮我打开微信',
    source: 'test-command',
  })
  assert(desktopCommandMission.capabilityReferences.some(item => item.id === 'desktop.app-control'), 'desktop command mission matches desktop capability')
  const desktopCommandRunning = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(desktopCommandRunning.state === 'Running', 'desktop command enters running state')
  assert(desktopCommandRunning.toolCalls.at(-1).toolName === 'desktop.app-control.prepare', 'desktop command records desktop prepare tool call')
  assert(desktopCommandRunning.artifacts.at(-1).title === '桌面执行方案', 'desktop command creates desktop execution plan artifact')
  const desktopCommandReviewing = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(desktopCommandReviewing.state === 'Reviewing', 'desktop command moves to reviewing after mocked inspection')
  assert(desktopCommandReviewing.toolCalls.at(-1).toolName === 'desktop.app-control.inspect', 'desktop command records desktop inspect execution')
  assert(desktopCommandReviewing.artifacts.at(-1).title === '桌面上下文摘要', 'desktop command creates desktop context artifact')
  assert(desktopCommandReviewing.reviewChecks.at(-1).title === '桌面上下文复核', 'desktop command creates desktop review check')
  assert(desktopCommandReviewing.reviewChecks.at(-1).outcome === 'passed', 'desktop command review check passes')
  const desktopInspectToolId = desktopCommandReviewing.toolCalls.at(-1).id
  const desktopStages = desktopCommandReviewing.trace.filter(item => item.type === 'tool.stage' && item.toolCallId === desktopInspectToolId)
  assert(desktopStages.some(item => item.toolName === 'desktop.open-app' && item.url === 'app://wechat'), 'desktop command records mocked app-open stage')
  assert(desktopStages.some(item => item.toolName === 'desktop.screen-context' && item.url === 'screen://mock/current-app'), 'desktop command records mocked screen-context stage')
  assert(desktopStages.some(item => item.toolName === 'desktop.real-adapter' && item.result === 'skipped'), 'desktop command records skipped real-adapter stage')
  assert(desktopStages.some(item => item.toolName === 'desktop.external-effect' && item.result === 'skipped'), 'desktop command records skipped external-effect stage')

  const wechatLoginMission = runtime.applyCurrentMissionCommand({
    text: '连接微信',
    source: 'test-command',
  })
  assert(wechatLoginMission.title.includes('微信'), 'WeChat login command starts a natural login mission')
  assert(wechatLoginMission.nextStep.includes('扫码登录'), 'WeChat login mission explains QR login confirmation')
  assert(wechatLoginMission.plan.find(item => item.id === 'prepare-login')?.status === 'Active', 'WeChat login mission activates login preparation')
  assert(wechatLoginMission.plan.find(item => item.id === 'confirm-login')?.label.includes('确认'), 'WeChat login mission keeps QR login confirmation')
  assert(wechatLoginMission.agentActions.at(-1).title === '准备连接微信', 'WeChat login mission records operator preparation')
  assert(wechatLoginMission.capabilityReferences.at(0)?.id === 'wechat.ilink-session', 'WeChat login mission prioritizes iLink session capability')
  assert(wechatLoginMission.capabilityReferences.some(item => item.riskClasses.includes('Credential')), 'WeChat login mission declares credential risk')
  const wechatLoginGate = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(wechatLoginGate.state === 'Waiting for permission', 'WeChat login continue waits for QR login permission')
  assert(wechatLoginGate.nextStep.includes('生成微信 iLink 扫码登录请求'), 'WeChat login continue asks for login permission in the main workflow')
  assert(wechatLoginGate.plan.find(item => item.id === 'confirm-login')?.status === 'Active', 'WeChat login continue activates confirmation step')
  assert(wechatLoginGate.toolCalls.some(item => item.toolName === 'wechat-ilink.qr-login.prepare'), 'WeChat login continue records iLink preparation tool')
  assert(wechatLoginGate.artifacts.some(item => item.title === '微信登录准备'), 'WeChat login continue creates preparation artifact')
  assert(wechatLoginGate.artifacts.some(item => item.kind === 'credential-login-preflight'), 'WeChat login preparation artifact is credential preflight')
  assert(wechatLoginGate.permissions.at(-1).risk === 'Credential', 'WeChat login permission records credential risk')
  assert(wechatLoginGate.permissions.at(-1).toolCallId === 'wechat-ilink.qr-login', 'WeChat login permission scopes QR login tool')
  assert(wechatLoginGate.permissions.at(-1).reason.includes('必须分别经过用户确认'), 'WeChat login permission records separate confirmation guardrail')
  assert(wechatLoginGate.reviewChecks.some(item => item.title === '微信登录准备复核' && item.outcome === 'passed'), 'WeChat login preparation is reviewed')
  assert(wechatLoginGate.reviewChecks.some(item => item.evidence?.some(evidence => evidence.includes('未生成二维码'))), 'WeChat login review records no QR before approval')
  assert(wechatLoginGate.reviewChecks.some(item => item.evidence?.some(evidence => evidence.includes('未保存 token/accountId'))), 'WeChat login review records no credential save before approval')
  assert(!wechatLoginGate.toolCalls.some(item => item.toolName === 'messages.outbound.send'), 'WeChat login preparation does not send messages')
  const wechatLoginPrepareTool = wechatLoginGate.toolCalls.find(item => item.toolName === 'wechat-ilink.qr-login.prepare')
  const wechatLoginPrepareStages = wechatLoginGate.trace.filter(item => item.type === 'tool.stage' && item.toolCallId === wechatLoginPrepareTool?.id)
  assert(wechatLoginPrepareStages.some(item => item.toolName === 'wechat-ilink.package' && item.result === 'ok'), 'WeChat login preparation checks iLink package')
  assert(wechatLoginPrepareStages.some(item => item.toolName === 'wechat-ilink.credential-store' && item.result === 'ok'), 'WeChat login preparation prepares credential store')
  assert(wechatLoginPrepareStages.some(item => item.toolName === 'wechat-ilink.qr-login' && item.result === 'skipped'), 'WeChat login preparation skips QR before approval')
  assert(wechatLoginPrepareStages.some(item => item.toolName === 'wechat-ilink.credential-save' && item.result === 'skipped'), 'WeChat login preparation skips credential save before approval')
  const wechatLoginApproved = runtime.applyCurrentMissionCommand({ text: '可以', source: 'test-command' })
  assert(wechatLoginApproved.state === 'Running', 'WeChat login approval resumes the mission')
  assert(wechatLoginApproved.permissions.at(-1).decision === 'approved', 'WeChat login approval resolves credential permission')
  assert(wechatLoginApproved.toolCalls.some(item => item.toolName === 'wechat-ilink.qr-login.authorize'), 'WeChat login approval records QR authorization tool')
  assert(wechatLoginApproved.artifacts.some(item => item.kind === 'credential-login-ready'), 'WeChat login approval creates login-ready artifact')
  assert(wechatLoginApproved.plan.find(item => item.id === 'save-credentials')?.status === 'Active', 'WeChat login approval moves to credential-save step')
  assert(wechatLoginApproved.nextStep.includes('展示二维码'), 'WeChat login approval reports next QR display step')
  assert(wechatLoginApproved.reviewChecks.some(item => item.title === '微信登录授权复核' && item.outcome === 'passed'), 'WeChat login approval records authorization review')
  assert(wechatLoginApproved.reviewChecks.some(item => item.evidence?.some(evidence => evidence.includes('授权后仍未生成二维码'))), 'WeChat login authorization review records no real QR yet')
  assert(wechatLoginApproved.reviewChecks.some(item => item.evidence?.some(evidence => evidence.includes('授权后仍未保存 token/accountId'))), 'WeChat login authorization review records no saved credentials yet')
  const wechatLoginAuthorizeTool = wechatLoginApproved.toolCalls.find(item => item.toolName === 'wechat-ilink.qr-login.authorize')
  const wechatLoginAuthorizeStages = wechatLoginApproved.trace.filter(item => item.type === 'tool.stage' && item.toolCallId === wechatLoginAuthorizeTool?.id)
  assert(wechatLoginAuthorizeStages.some(item => item.toolName === 'wechat-ilink.qr-login' && item.result === 'skipped'), 'WeChat login approval still skips real QR generation')
  assert(wechatLoginAuthorizeStages.some(item => item.toolName === 'wechat-ilink.credential-save' && item.result === 'skipped'), 'WeChat login approval still skips credential save')
  assert(!wechatLoginApproved.toolCalls.some(item => item.toolName === 'messages.outbound.send'), 'WeChat login approval does not send messages')

  runtime.applyCurrentMissionCommand({
    text: '登录微信',
    source: 'test-command',
  })
  runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  const wechatLoginQrMission = await runtime.applyCurrentMissionCommandWithAdapters({
    text: '可以',
    source: 'test-command',
    wechatIlinkLoginDeps: {
      allowNetwork: true,
      filePath: wechatCredentialFile,
      env: {
        VELA_WECHAT_ILINK_BOT_TYPE: '8',
        VELA_WECHAT_ILINK_BASE_URL: 'https://ilink-runtime.example.test',
      },
      clientModule: {
        ApiClient: class {
          async getQRCode(botType) {
            return {
              qrcode: `runtime-qr-${botType}`,
              qrcode_img_content: `https://qr.runtime.example.test/${botType}`,
            }
          }
        },
      },
    },
  })
  assert(wechatLoginQrMission.state === 'Running', 'async WeChat login approval resumes the mission')
  assert(wechatLoginQrMission.permissions.at(-1).decision === 'approved', 'async WeChat login approval resolves permission')
  assert(wechatLoginQrMission.toolCalls.some(item => item.toolName === 'wechat-ilink.qr-login.authorize' && item.status === 'qr-ready'), 'async WeChat login approval records ready QR tool')
  assert(wechatLoginQrMission.artifacts.some(item => item.kind === 'credential-login-qr'), 'async WeChat login approval creates QR artifact')
  assert(wechatLoginQrMission.artifacts.some(item => item.uri === 'https://qr.runtime.example.test/8'), 'async WeChat login QR artifact stores QR URL')
  assert(wechatLoginQrMission.artifacts.some(item => item.metadata?.qrCodeId === 'runtime-qr-8'), 'async WeChat login QR artifact stores QR id metadata')
  assert(wechatLoginQrMission.nextStep.includes('请扫码'), 'async WeChat login approval asks user to scan QR')
  assert(wechatLoginQrMission.reviewChecks.some(item => item.title === '微信登录授权复核' && item.outcome === 'passed'), 'async WeChat login QR approval records review')
  assert(wechatLoginQrMission.reviewChecks.some(item => item.evidence?.some(evidence => evidence.includes('二维码状态：qr-ready'))), 'async WeChat login QR review records ready QR evidence')
  assert(wechatLoginQrMission.reviewChecks.some(item => item.evidence?.some(evidence => evidence.includes('凭据保存：no'))), 'async WeChat login QR review records no credential save')
  assert(wechatLoginQrMission.reviewChecks.some(item => item.evidence?.some(evidence => evidence.includes('消息发送：no'))), 'async WeChat login QR review records no message send')
  const wechatLoginQrTool = wechatLoginQrMission.toolCalls.find(item => item.toolName === 'wechat-ilink.qr-login.authorize' && item.status === 'qr-ready')
  const wechatLoginQrStages = wechatLoginQrMission.trace.filter(item => item.type === 'tool.stage' && item.toolCallId === wechatLoginQrTool?.id)
  assert(wechatLoginQrStages.some(item => item.toolName === 'wechat-ilink.qr-login' && item.result === 'ok' && item.url === 'https://qr.runtime.example.test/8'), 'async WeChat login QR approval records QR URL stage')
  assert(wechatLoginQrStages.some(item => item.toolName === 'wechat-ilink.credential-save' && item.result === 'skipped'), 'async WeChat login QR approval still skips credential save')
  assert(!wechatLoginQrMission.toolCalls.some(item => item.toolName === 'messages.outbound.send'), 'async WeChat login QR approval does not send messages')
  const wechatLoginQrScanned = await runtime.applyCurrentMissionCommandWithAdapters({
    text: '我扫了',
    source: 'test-command',
    wechatIlinkLoginDeps: {
      allowNetwork: true,
      filePath: wechatCredentialFile,
      clientModule: {
        ApiClient: class {
          async pollQRCodeStatus(qrcode) {
            return { status: qrcode === 'runtime-qr-8' ? 'scaned' : 'wait' }
          }
        },
      },
    },
  })
  assert(wechatLoginQrScanned.state === 'Running', 'async WeChat QR scanned check keeps mission running')
  assert(wechatLoginQrScanned.toolCalls.some(item => item.toolName === 'wechat-ilink.qr-login.poll' && item.status === 'waiting'), 'async WeChat QR scanned check records waiting poll tool')
  assert(wechatLoginQrScanned.artifacts.some(item => item.kind === 'credential-login-poll'), 'async WeChat QR scanned check creates poll artifact')
  assert(wechatLoginQrScanned.reviewChecks.some(item => item.evidence?.some(evidence => evidence.includes('扫码状态：scaned'))), 'async WeChat QR scanned check records scanned evidence')
  assert(!wechatLoginQrScanned.permissions.some(item => item.toolCallId === 'wechat-ilink.credential-save'), 'async WeChat QR scanned check does not request credential save yet')
  assert(!wechatLoginQrScanned.toolCalls.some(item => item.toolName === 'messages.outbound.send'), 'async WeChat QR scanned check does not send messages')
  const wechatLoginQrConfirmed = await runtime.applyCurrentMissionCommandWithAdapters({
    text: '继续',
    source: 'test-command',
    wechatIlinkLoginDeps: {
      allowNetwork: true,
      filePath: wechatCredentialFile,
      clientModule: {
        ApiClient: class {
          async pollQRCodeStatus(qrcode) {
            return {
              status: qrcode === 'runtime-qr-8' ? 'confirmed' : 'wait',
              bot_token: 'runtime-confirmed-token-888',
              ilink_bot_id: 'runtime-account@im.bot',
              baseurl: 'https://ilink-runtime.example.test',
              ilink_user_id: 'runtime-default-user',
            }
          }
        },
      },
    },
  })
  assert(wechatLoginQrConfirmed.state === 'Waiting for permission', 'async WeChat QR confirmed check waits for credential save permission')
  assert(wechatLoginQrConfirmed.toolCalls.some(item => item.toolName === 'wechat-ilink.qr-login.poll' && item.status === 'ok'), 'async WeChat QR confirmed check records ok poll tool')
  assert(wechatLoginQrConfirmed.artifacts.some(item => item.kind === 'credential-login-status'), 'async WeChat QR confirmed check creates credential-ready artifact')
  assert(wechatLoginQrConfirmed.permissions.at(-1).toolCallId === 'wechat-ilink.credential-save', 'async WeChat QR confirmed check requests credential save permission')
  assert(wechatLoginQrConfirmed.permissions.at(-1).risk === 'Credential', 'async WeChat QR confirmed save permission carries credential risk')
  assert(wechatLoginQrConfirmed.reviewChecks.some(item => item.evidence?.some(evidence => evidence.includes('凭据就绪：yes'))), 'async WeChat QR confirmed check records credential-ready evidence')
  assert(!JSON.stringify(wechatLoginQrConfirmed).includes('runtime-confirmed-token-888'), 'async WeChat QR confirmed mission does not persist raw token in mission state')
  assert(!wechatLoginQrConfirmed.toolCalls.some(item => item.toolName === 'messages.outbound.send'), 'async WeChat QR confirmed check does not send messages')
  const wechatLoginSaveStillWaiting = await runtime.applyCurrentMissionCommandWithAdapters({
    text: '继续',
    source: 'test-command',
  })
  assert(wechatLoginSaveStillWaiting.state === 'Waiting for permission', 'continue cannot bypass WeChat credential save permission')
  assert(wechatLoginSaveStillWaiting.permissions.at(-1).decision === 'requested', 'continue leaves WeChat credential save permission pending')
  assert(wechatLoginSaveStillWaiting.nextStep.includes('需要先确认'), 'continue reminds user to confirm WeChat credential save')
  assert(!wechatIlinkAdapter.readWechatIlinkCredentials({ filePath: wechatCredentialFile, env: {} }).token, 'continue does not save WeChat credentials without approval')
  const wechatLoginSaved = await runtime.applyCurrentMissionCommandWithAdapters({
    text: '可以',
    source: 'test-command',
  })
  assert(wechatLoginSaved.state === 'Complete', 'async WeChat credential save approval completes login mission')
  assert(wechatLoginSaved.permissions.at(-1).decision === 'approved', 'async WeChat credential save approval resolves save permission')
  assert(wechatLoginSaved.toolCalls.some(item => item.toolName === 'wechat-ilink.credential-save' && item.status === 'ok'), 'async WeChat credential save approval records save tool')
  assert(wechatLoginSaved.artifacts.some(item => item.kind === 'credential-save-receipt'), 'async WeChat credential save approval creates save receipt')
  assert(wechatLoginSaved.plan.find(item => item.id === 'save-credentials')?.status === 'Done', 'async WeChat credential save approval completes save step')
  assert(wechatLoginSaved.reviewResult?.outcome === 'passed', 'async WeChat credential save approval records reviewer outcome')
  assert(!JSON.stringify(wechatLoginSaved).includes('runtime-confirmed-token-888'), 'async WeChat credential save mission does not persist raw token in mission state')
  const storedRuntimeWechatCredentials = wechatIlinkAdapter.readWechatIlinkCredentials({
    filePath: wechatCredentialFile,
    env: {},
  })
  assert(storedRuntimeWechatCredentials.token === 'runtime-confirmed-token-888', 'async WeChat credential save approval writes token to local credential store')
  assert(storedRuntimeWechatCredentials.accountId === 'runtime-account@im.bot', 'async WeChat credential save approval writes account id to local credential store')
  assert(!wechatLoginSaved.toolCalls.some(item => item.toolName === 'messages.outbound.send'), 'async WeChat credential save approval does not send messages')

  const assistantMessageMission = runtime.applyCurrentMissionCommand({
    text: '帮打开微信，给我老婆回个信息',
    source: 'test-command',
  })
  assert(assistantMessageMission.title.includes('微信'), 'external message command starts a natural assistant mission')
  assert(assistantMessageMission.nextStep.includes('先去看一下'), 'external message mission replies with natural progress')
  assert(assistantMessageMission.plan.find(item => item.id === 'inspect-context')?.status === 'Active', 'external message mission focuses on inspecting context')
  assert(assistantMessageMission.plan.find(item => item.id === 'confirm-send')?.label.includes('确认'), 'external message mission keeps final send confirmation')
  assert(assistantMessageMission.agentActions.at(-1).title === '准备处理外部消息', 'external message mission records backstage operator action')
  assert(assistantMessageMission.agentActions.at(-1).requiresReview === false, 'external message mission does not expose review as the first-screen action')
  assert(assistantMessageMission.capabilityReferences.some(item => item.id === 'messages.outbound'), 'external message mission matches outbound message capability')
  assert(assistantMessageMission.capabilityReferences.some(item => item.id === 'desktop.app-control'), 'external message mission also matches desktop context capability')
  assert(assistantMessageMission.capabilityReferences.some(item => item.riskClasses.includes('External message')), 'external message capability declares send risk')
  const assistantDraft = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(assistantDraft.state === 'Waiting for permission', 'external message continue waits for send confirmation')
  assert(assistantDraft.nextStep.includes('这样发可以吗'), 'external message continue asks for natural send confirmation')
  assert(assistantDraft.plan.find(item => item.id === 'confirm-send')?.status === 'Active', 'external message continue activates confirmation step')
  assert(assistantDraft.artifacts.at(-1).title === '拟发送内容', 'external message continue creates a draft artifact')
  assert(assistantDraft.artifacts.at(-1).summary.includes('我准备这样回'), 'external message draft summarizes the proposed reply')
  assert(assistantDraft.artifacts.at(-1).summary.includes('对象：老婆'), 'external message draft records recipient')
  assert(assistantDraft.artifacts.at(-1).summary.includes('渠道：微信'), 'external message draft records channel')
  assert(assistantDraft.artifacts.at(-1).summary.includes('模式：模拟链路'), 'external message draft records execution mode')
  assert(assistantDraft.artifacts.at(-1).summary.includes('真实适配器入口：desktop://adapters/wechat/messages.confirmed-send'), 'external message draft records real adapter entrypoint')
  assert(assistantDraft.permissions.at(-1).risk === 'External message', 'external message draft records external-message risk')
  assert(assistantDraft.permissions.at(-1).summary.includes('我准备这样回'), 'external message permission carries the proposed reply')
  assert(assistantDraft.permissions.at(-1).scope.includes(encodeURIComponent('老婆')), 'external message permission scopes the recipient')
  assert(assistantDraft.permissions.at(-1).reason.includes('用户明确确认前不发送'), 'external message permission records send guardrail')
  assert(assistantDraft.permissions.at(-1).reason.includes('真实适配器入口：desktop://adapters/wechat/messages.confirmed-send'), 'external message permission records real adapter entrypoint')
  const assistantDraftSendPermissionId = assistantDraft.permissions.at(-1).id
  assert(assistantDraft.agentActions.at(-1).title === '草拟待确认回复', 'external message continue records the draft action')
  assert(assistantDraft.toolCalls.some(item => item.toolName === 'desktop.app-control.inspect'), 'external message continue records desktop context inspection')
  assert(assistantDraft.artifacts.some(item => item.title === '微信上下文摘要'), 'external message continue creates desktop context artifact')
  assert(assistantDraft.reviewChecks.some(item => item.title === '桌面上下文复核' && item.outcome === 'passed'), 'external message desktop context is reviewed')
  assert(assistantDraft.reviewChecks.some(item => item.evidence?.some(evidence => evidence.includes('消息对象：老婆'))), 'external message desktop context keeps recipient evidence')
  assert(assistantDraft.reviewChecks.some(item => item.evidence?.some(evidence => evidence.includes('执行模式：simulated'))), 'external message desktop context keeps execution-mode evidence')
  assert(assistantDraft.reviewChecks.some(item => item.evidence?.some(evidence => evidence.includes('真实适配器入口：desktop://adapters/wechat/messages.confirmed-send'))), 'external message desktop context keeps real adapter evidence')
  const assistantDesktopTool = assistantDraft.toolCalls.find(item => item.toolName === 'desktop.app-control.inspect')
  const assistantDesktopStages = assistantDraft.trace.filter(item => item.type === 'tool.stage' && item.toolCallId === assistantDesktopTool?.id)
  assert(assistantDesktopStages.some(item => item.toolName === 'desktop.open-app' && item.url === 'app://wechat'), 'external message records mocked WeChat open stage')
  assert(assistantDesktopStages.some(item => item.toolName === 'desktop.real-adapter' && item.result === 'skipped'), 'external message records skipped real-adapter stage')
  assert(assistantDesktopStages.some(item => item.toolName === 'desktop.external-effect' && item.result === 'skipped'), 'external message records no hidden send stage')
  assert(!assistantDraft.toolCalls.some(item => item.toolName === 'messages.outbound.send'), 'external message does not send before approval')
  const assistantDraftApproved = runtime.applyCurrentMissionCommand({ text: '可以', source: 'test-command' })
  assert(assistantDraftApproved.state === 'Complete', 'external message approval completes the confirmed send mission')
  assert(assistantDraftApproved.permissions.at(-1).decision === 'approved', 'external message approval resolves the pending send confirmation')
  assert(assistantDraftApproved.toolCalls.some(item => item.toolName === 'messages.outbound.send'), 'external message approval records outbound send tool')
  assert(assistantDraftApproved.artifacts.some(item => item.kind === 'send-receipt'), 'external message approval creates send receipt')
  assert(assistantDraftApproved.reviewChecks.some(item => item.title === '外部发送复核' && item.outcome === 'passed'), 'external message approval records send review')
  assert(assistantDraftApproved.reviewResult?.outcome === 'passed', 'external message approval records reviewer outcome')
  assert(assistantDraftApproved.plan.find(item => item.id === 'confirm-send')?.status === 'Done', 'external message approval marks confirm step done')
  assert(assistantDraftApproved.nextStep.includes('已按确认记录微信模拟发送给老婆'), 'external message approval reports simulated send receipt')
  const outboundSendTool = assistantDraftApproved.toolCalls.find(item => item.toolName === 'messages.outbound.send')
  const outboundSendStages = assistantDraftApproved.trace.filter(item => item.type === 'tool.stage' && item.toolCallId === outboundSendTool?.id)
  assert(outboundSendStages.some(item => item.toolName === 'messages.external-send' && item.result === 'ok'), 'external message approval records confirmed send stage')
  assert(outboundSendStages.some(item => item.toolName === 'messages.real-adapter' && item.result === 'skipped'), 'external message approval records skipped real-adapter send stage')
  assert(assistantDraftApproved.reviewChecks.some(item => item.evidence?.some(evidence => evidence.includes('发送对象：老婆'))), 'external message approval keeps recipient evidence')
  assert(assistantDraftApproved.reviewChecks.some(item => item.evidence?.some(evidence => evidence.includes('真实适配器入口：desktop://adapters/wechat/messages.confirmed-send'))), 'external message approval keeps real adapter evidence')
  const assistantDraftRepeatedApproval = runtime.resolveCurrentMissionPermission(assistantDraftSendPermissionId, {
    decision: 'approved',
    approvedBy: 'Retry',
  })
  assert(assistantDraftRepeatedApproval.state === 'Complete', 'external message repeated approval keeps completed mission')
  assert(assistantDraftRepeatedApproval.toolCalls.filter(item => item.toolName === 'messages.outbound.send').length === 1, 'external message repeated approval does not record another outbound send')
  assert(assistantDraftRepeatedApproval.artifacts.filter(item => item.kind === 'send-receipt').length === 1, 'external message repeated approval does not record another send receipt')

  runtime.applyCurrentMissionCommand({
    text: '帮打开微信，给我老婆回个信息',
    source: 'test-command',
  })
  runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  const assistantRevisedDraft = runtime.applyCurrentMissionCommand({ text: '改成：我马上到楼下', source: 'test-command' })
  assert(assistantRevisedDraft.state === 'Waiting for permission', 'external message revised draft keeps waiting for confirmation')
  assert(assistantRevisedDraft.nextStep.includes('我马上到楼下'), 'external message revised draft asks with updated text')
  assert(assistantRevisedDraft.permissions.at(-1).summary.includes('我马上到楼下'), 'external message revised draft updates pending permission summary')
  assert(assistantRevisedDraft.artifacts.at(-1).summary.includes('我马上到楼下'), 'external message revised draft records updated draft artifact')
  assert(!assistantRevisedDraft.toolCalls.some(item => item.toolName === 'messages.outbound.send'), 'external message revised draft does not send before approval')
  const assistantRevisedDraftApproved = runtime.applyCurrentMissionCommand({ text: '可以', source: 'test-command' })
  assert(assistantRevisedDraftApproved.state === 'Complete', 'external message revised draft approval completes mission')
  assert(assistantRevisedDraftApproved.artifacts.some(item => item.kind === 'send-receipt' && item.summary.includes('我马上到楼下')), 'external message revised draft approval sends updated text')

  runtime.applyCurrentMissionCommand({
    text: '帮打开微信，给我老婆回个信息',
    source: 'test-command',
  })
  runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  const assistantDraftDenied = runtime.applyCurrentMissionCommand({ text: '别发', source: 'test-command' })
  assert(assistantDraftDenied.state === 'Waiting for user', 'external message denied send waits for user instead of blocking')
  assert(assistantDraftDenied.nextStep.includes('不会发送'), 'external message denied send explains nothing was sent')
  assert(assistantDraftDenied.permissions.at(-1).decision === 'denied', 'external message denied send records denied permission')
  assert(!assistantDraftDenied.toolCalls.some(item => item.toolName === 'messages.outbound.send'), 'external message denied send does not record outbound send')

  runtime.applyCurrentMissionCommand({
    text: '帮打开微信，给我老婆回个信息',
    source: 'test-command',
  })
  let runtimeWechatReadOpts = null
  let runtimeWechatReadTimeout = null
  const assistantWechatContextDraft = await runtime.applyCurrentMissionCommandWithAdapters({
    text: '继续',
    source: 'test-command',
    wechatIlinkReadDeps: {
      allowRead: true,
      filePath: wechatCredentialFile,
      timeoutMs: 25,
      clientModule: {
        ApiClient: class {
          constructor(opts) {
            runtimeWechatReadOpts = opts
          }

          async getUpdates(syncBuf, timeoutMs) {
            runtimeWechatReadTimeout = timeoutMs
            return {
              get_updates_buf: 'runtime-sync-after-read',
              msgs: [
                {
                  from_user_id: 'runtime-default-user',
                  to_user_id: 'runtime-account@im.bot',
                  context_token: 'runtime-context-token-1',
                  item_list: [{ type: 1, text_item: { text: '路上帮我买牛奶。' } }],
                },
                {
                  from_user_id: 'someone-else',
                  item_list: [{ type: 1, text_item: { text: '忽略这条。' } }],
                },
              ],
            }
          }
        },
        WeChatClient: {
          extractText(message) {
            return message.item_list?.[0]?.text_item?.text || ''
          },
        },
      },
    },
  })
  assert(assistantWechatContextDraft.state === 'Waiting for permission', 'external message live WeChat context still waits for send confirmation')
  assert(runtimeWechatReadOpts.token === 'runtime-confirmed-token-888', 'external message live WeChat context passes stored token to ApiClient only')
  assert(runtimeWechatReadTimeout === 25, 'external message live WeChat context uses bounded read timeout')
  assert(assistantWechatContextDraft.artifacts.some(item => item.title === '微信上下文摘要' && item.summary.includes('路上帮我买牛奶。')), 'external message live WeChat context records recent message summary')
  assert(assistantWechatContextDraft.artifacts.some(item => item.metadata?.contextToken === 'runtime-context-token-1'), 'external message live WeChat context stores reply context token metadata')
  assert(assistantWechatContextDraft.reviewChecks.some(item => item.evidence?.some(evidence => evidence.includes('微信消息数量：1'))), 'external message live WeChat context records read evidence')
  assert(assistantWechatContextDraft.reviewChecks.some(item => item.evidence?.some(evidence => evidence.includes('最近消息摘要'))), 'external message live WeChat context records message summary evidence')
  assert(!assistantWechatContextDraft.toolCalls.some(item => item.toolName === 'messages.outbound.send'), 'external message live WeChat context does not send before approval')
  let contextualWechatSendCall = null
  const assistantContextualWechatSent = await runtime.applyCurrentMissionCommandWithAdapters({
    text: '可以',
    source: 'test-command',
    wechatIlinkSendDeps: {
      allowSend: true,
      filePath: wechatCredentialFile,
      clientModule: {
        WeChatClient: class {
          async sendText(to, text, contextToken) {
            contextualWechatSendCall = { to, text, contextToken }
            return { status: 'ok' }
          }
        },
      },
    },
  })
  assert(assistantContextualWechatSent.state === 'Complete', 'external message contextual WeChat send completes after approval')
  assert(contextualWechatSendCall.to === 'runtime-default-user', 'external message contextual WeChat send uses saved recipient')
  assert(contextualWechatSendCall.contextToken === 'runtime-context-token-1', 'external message contextual WeChat send passes read context token')
  assert(assistantContextualWechatSent.reviewChecks.some(item => item.evidence?.some(evidence => evidence.includes('微信消息已发送：yes'))), 'external message contextual WeChat send records live send evidence')

  runtime.applyCurrentMissionCommand({
    text: '帮打开微信，给我老婆回个信息',
    source: 'test-command',
  })
  const missingWechatContextDraft = await runtime.applyCurrentMissionCommandWithAdapters({
    text: '继续',
    source: 'test-command',
    wechatIlinkReadDeps: {
      allowRead: true,
      filePath: path.join(tmp, 'missing-wechat-context-creds.json'),
      env: {},
    },
  })
  assert(missingWechatContextDraft.state === 'Blocked', 'external message missing WeChat context blocks before drafting send')
  assert(missingWechatContextDraft.nextStep.includes('缺少微信 iLink token/accountId'), 'external message missing WeChat context explains missing credentials')
  assert(missingWechatContextDraft.plan.find(item => item.id === 'inspect-context')?.status === 'Blocked', 'external message missing WeChat context blocks inspect step')
  assert(missingWechatContextDraft.recoveryActions.some(item => item.title.includes('连接微信 iLink')), 'external message missing WeChat context opens connection recovery action')
  assert(missingWechatContextDraft.reviewChecks.some(item => item.title === '桌面上下文复核' && item.outcome === 'blocked'), 'external message missing WeChat context records blocked review')
  assert(!missingWechatContextDraft.permissions.some(item => item.risk === 'External message' && runtime.isPendingPermissionDecision(item.decision)), 'external message missing WeChat context does not request send approval')
  assert(!missingWechatContextDraft.toolCalls.some(item => item.toolName === 'messages.outbound.send'), 'external message missing WeChat context does not send')
  let recoveredWechatReadCalled = false
  const recoveredWechatContextDraft = await runtime.applyCurrentMissionCommandWithAdapters({
    text: '继续',
    source: 'test-command',
    wechatIlinkReadDeps: {
      allowRead: true,
      filePath: wechatCredentialFile,
      clientModule: {
        ApiClient: class {
          async getUpdates() {
            recoveredWechatReadCalled = true
            return {
              get_updates_buf: 'runtime-sync-after-recovery',
              msgs: [{
                from_user_id: 'runtime-default-user',
                context_token: 'runtime-context-token-recovered',
                item_list: [{ type: 1, text_item: { text: '我到楼下了。' } }],
              }],
            }
          }
        },
        WeChatClient: {
          extractText(message) {
            return message.item_list?.[0]?.text_item?.text || ''
          },
        },
      },
    },
  })
  assert(recoveredWechatReadCalled === true, 'external message retry after recovery reruns WeChat context read')
  assert(recoveredWechatContextDraft.state === 'Waiting for permission', 'external message retry after recovery waits for send confirmation')
  assert(recoveredWechatContextDraft.nextStep.includes('这样发可以吗'), 'external message retry after recovery asks for send confirmation')
  assert(recoveredWechatContextDraft.recoveryActions.some(item => item.title.includes('连接微信 iLink') && item.status === 'resolved'), 'external message retry after recovery resolves connection recovery action')
  assert(recoveredWechatContextDraft.artifacts.some(item => item.title === '微信上下文摘要' && item.summary.includes('我到楼下了。')), 'external message retry after recovery records fresh context artifact')
  assert(recoveredWechatContextDraft.artifacts.some(item => item.metadata?.contextToken === 'runtime-context-token-recovered'), 'external message retry after recovery stores fresh context token')
  assert(recoveredWechatContextDraft.permissions.some(item => item.risk === 'External message' && runtime.isPendingPermissionDecision(item.decision)), 'external message retry after recovery requests send approval')
  assert(!recoveredWechatContextDraft.toolCalls.some(item => item.toolName === 'messages.outbound.send'), 'external message retry after recovery does not send before approval')

  runtime.applyCurrentMissionCommand({
    text: '帮打开微信，给我老婆回个信息',
    source: 'test-command',
  })
  const assistantLiveWechatDraft = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  const assistantLiveWechatPermissionId = assistantLiveWechatDraft.permissions.at(-1).id
  let liveExternalWechatSendOpts = null
  let liveExternalWechatSendCall = null
  let liveExternalWechatSendCalls = 0
  const assistantLiveWechatSent = await runtime.applyCurrentMissionCommandWithAdapters({
    text: '可以',
    source: 'test-command',
    wechatIlinkSendDeps: {
      allowSend: true,
      filePath: wechatCredentialFile,
      clientModule: {
        WeChatClient: class {
          constructor(opts) {
            liveExternalWechatSendOpts = opts
          }

          async sendText(to, text, contextToken) {
            liveExternalWechatSendCalls += 1
            liveExternalWechatSendCall = { to, text, contextToken }
            return { status: 'ok' }
          }
        },
      },
    },
  })
  assert(assistantLiveWechatSent.state === 'Complete', 'external message live WeChat send completes mission')
  assert(liveExternalWechatSendOpts.token === 'runtime-confirmed-token-888', 'external message live WeChat send passes stored token to client only')
  assert(liveExternalWechatSendCall.to === 'runtime-default-user', 'external message live WeChat send uses saved default recipient')
  assert(liveExternalWechatSendCall.text === '收到，我晚点跟你说。', 'external message live WeChat send sends approved draft text')
  assert(liveExternalWechatSendCalls === 1, 'external message live WeChat send calls adapter once')
  assert(assistantLiveWechatSent.nextStep.includes('通过微信 iLink 发送'), 'external message live WeChat send reports live iLink send')
  assert(assistantLiveWechatSent.reviewChecks.some(item => item.evidence?.some(evidence => evidence.includes('微信消息已发送：yes'))), 'external message live WeChat send records send evidence')
  const liveOutboundSendTool = assistantLiveWechatSent.toolCalls.find(item => item.toolName === 'messages.outbound.send')
  const liveOutboundStages = assistantLiveWechatSent.trace.filter(item => item.type === 'tool.stage' && item.toolCallId === liveOutboundSendTool?.id)
  assert(liveOutboundStages.some(item => item.toolName === 'messages.real-adapter' && item.result === 'ok'), 'external message live WeChat send records real adapter stage')
  assert(!JSON.stringify(assistantLiveWechatSent).includes('runtime-confirmed-token-888'), 'external message live WeChat send does not persist raw token in mission state')
  const assistantLiveWechatRepeatedApproval = await runtime.resolveCurrentMissionPermissionWithAdapters(assistantLiveWechatPermissionId, {
    decision: 'approved',
    approvedBy: 'Retry',
    wechatIlinkSendDeps: {
      allowSend: true,
      filePath: wechatCredentialFile,
      clientModule: {
        WeChatClient: class {
          async sendText() {
            liveExternalWechatSendCalls += 1
            return { status: 'ok' }
          }
        },
      },
    },
  })
  assert(liveExternalWechatSendCalls === 1, 'external message repeated live approval does not call adapter again')
  assert(assistantLiveWechatRepeatedApproval.toolCalls.filter(item => item.toolName === 'messages.outbound.send').length === 1, 'external message repeated live approval does not record another outbound send')

  const chineseCommandMission = runtime.applyCurrentMissionCommand({ text: '开始 中文命令任务', source: 'test-command' })
  assert(chineseCommandMission.title === '中文命令任务', 'Chinese start command creates a named mission')
  assert(chineseCommandMission.artifacts.at(-1).summary.includes('中文命令任务'), 'Chinese start command creates a localized task brief')
  const chineseCommandRunning = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(chineseCommandRunning.state === 'Running', 'Chinese continue command moves Planned -> Running')
  assert(chineseCommandRunning.plan.find(item => item.id === 'execute-review')?.status === 'Active', 'Chinese continue command advances active plan step')
  const chineseCommandReviewing = runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  assert(chineseCommandReviewing.state === 'Reviewing', 'Chinese continue command moves Running -> Reviewing')
  assert(chineseCommandReviewing.agentActions.some(item => item.role === 'Builder' && item.requiresReview === true), 'Chinese review continue records Builder action')
  const chineseCommandReviewed = runtime.applyCurrentMissionCommand({ text: '审查通过', source: 'test-command' })
  assert(chineseCommandReviewed.reviewResult?.outcome === 'passed', 'Chinese review command records reviewer outcome')
  const chineseCommandCompleted = runtime.applyCurrentMissionCommand({ text: '完成', source: 'test-command' })
  assert(chineseCommandCompleted.state === 'Complete', 'Chinese complete command succeeds after reviewer outcome')
  runtime.applyCurrentMissionCommand({ text: '开始 中文短句审查任务', source: 'test-command' })
  runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  runtime.applyCurrentMissionCommand({ text: '继续', source: 'test-command' })
  const chineseShortReview = runtime.applyCurrentMissionCommand({ text: '通过', source: 'test-command' })
  assert(chineseShortReview.reviewResult?.outcome === 'passed', 'Chinese short review command records reviewer outcome')

  const voiceMission = runtime.applyCurrentMissionVoiceIntent({
    transcript: 'Voice Pipeline Mission',
  })
  assert(voiceMission.title === 'Voice Pipeline Mission', 'voice intent starts a mission through command pipeline')
  assert(voiceMission.inputs.at(-1).source === 'voice', 'voice intent captures input source')
  assert(voiceMission.artifacts.some(item => item.title === '任务简报'), 'voice-started mission creates a task brief artifact')
  assert(voiceMission.trace.at(-1).type === 'voice.intent.routed', 'voice intent records routing trace')

  const voiceRunning = runtime.applyCurrentMissionVoiceIntent({
    transcript: 'continue',
    screenContext: {
      missionId: 'mission-voice-context',
      missionTitle: 'Voice Pipeline Mission',
      activeView: 'today',
      activeSurface: 'Mission Plan',
      workspaceMode: 'artifacts',
      selectedArtifactId: 'artifact-voice-context',
      selectedArtifactTitle: 'Voice Context Artifact',
      selectedPlanStepId: 'two',
    },
    latencyMs: {
      speechEndToIntentMs: 120,
      firstTokenMs: 900,
      firstAudioMs: 420,
      bargeInStopMs: 80,
    },
  })
  assert(voiceRunning.state === 'Running', 'voice continue moves Planned -> Running')
  assert(voiceRunning.inputs.at(-1).source === 'voice', 'voice continue captures input source')
  assert(voiceRunning.plan.find(item => item.id === 'execute-review')?.status === 'Active', 'voice continue advances mission plan')
  assert(voiceRunning.agentActions.some(item => item.role === 'Planner'), 'voice continue records Planner action through command pipeline')
  assert(voiceRunning.voiceMetrics.at(-1).latencyMs.speechEndToIntent === 120, 'voice intent records speech-to-intent latency')
  assert(voiceRunning.voiceMetrics.at(-1).latencyMs.finalAsrToFirstToken === 900, 'voice intent records first-token latency')
  assert(voiceRunning.voiceMetrics.at(-1).violations.length === 0, 'voice intent latency clears targets')
  assert(voiceRunning.trace.at(-1).latencyMs.speechEndToIntent === 120, 'voice intent trace records latency')
  assert(voiceRunning.inputs.at(-1).screenContext?.selectedArtifactId === 'artifact-voice-context', 'voice input records selected screen context')
  assert(voiceRunning.voiceMetrics.at(-1).screenContext?.workspaceMode === 'artifacts', 'voice metric records workspace context')
  assert(voiceRunning.trace.at(-1).screenContext?.selectedArtifactTitle === 'Voice Context Artifact', 'voice trace records screen context')

  const chineseVoiceMission = runtime.applyCurrentMissionVoiceIntent({ transcript: '语音中文任务' })
  assert(chineseVoiceMission.title === '语音中文任务', 'Chinese voice intent starts a mission through command pipeline')
  const chineseVoiceRunning = runtime.applyCurrentMissionVoiceIntent({ transcript: '继续' })
  assert(chineseVoiceRunning.state === 'Running', 'Chinese voice continue moves Planned -> Running')
  const chineseVoiceStop = runtime.applyCurrentMissionVoiceIntent({ transcript: '停止' })
  assert(chineseVoiceStop.state === 'Waiting for user', 'Chinese voice stop moves Running -> Waiting for user')
  assert(chineseVoiceStop.trace.some(item => item.type === 'command.stopped'), 'Chinese voice stop records stop trace')

  const voiceRepair = runtime.applyCurrentMissionVoiceIntent({ transcript: 'not that' })
  assert(voiceRepair.state === 'Waiting for user', 'voice repair moves Running -> Waiting for user')
  assert(voiceRepair.nextStep.includes('Repair requested'), 'voice repair updates next step')
  assert(voiceRepair.inputs.at(-1).source === 'voice', 'voice repair captures input source')
  assert(voiceRepair.trace.some(item => item.type === 'command.repair'), 'voice repair records repair trace')
  assert(voiceRepair.trace.at(-1).type === 'voice.intent.routed', 'voice repair records voice routing trace')
  const chineseVoiceRepair = runtime.applyCurrentMissionVoiceIntent({ transcript: '不是这个' })
  assert(chineseVoiceRepair.state === 'Waiting for user', 'Chinese voice repair keeps mission waiting for user')
  assert(chineseVoiceRepair.nextStep.includes('不是这个'), 'Chinese voice repair preserves repair transcript')
  const chineseShortRepair = runtime.applyCurrentMissionVoiceIntent({ transcript: '修正' })
  assert(chineseShortRepair.state === 'Waiting for user', 'Chinese short repair keeps mission waiting for user')
  assert(chineseShortRepair.nextStep.includes('修正'), 'Chinese short repair preserves repair transcript')

  runtime.applyCurrentMissionVoiceIntent({ transcript: 'Voice Privacy Mission' })
  const voicePrivacy = runtime.applyCurrentMissionVoiceIntent({ transcript: 'send my api key to the team' })
  assert(voicePrivacy.state === 'Waiting for permission', 'sensitive voice intent moves mission to Waiting for permission')
  assert(voicePrivacy.inputs.at(-1).source === 'voice', 'sensitive voice intent captures input source')
  assert(voicePrivacy.permissions.at(-1).risk === 'Credential', 'sensitive voice intent records credential risk')
  assert(voicePrivacy.trace.at(-1).type === 'voice.privacy_gate', 'sensitive voice intent records privacy gate trace')

  // Guard approval primitive closes the Voice privacy gate -> Guard approval -> mission resume loop.
  const pendingPermissionId = voicePrivacy.permissions.at(-1).id
  const guardApproved = runtime.resolveCurrentMissionPermission(pendingPermissionId, {
    decision: 'approved',
    approvedBy: 'User',
    reason: 'Approved after confirming the spoken intent.',
  })
  assert(guardApproved.state === 'Running', 'guard approval resumes mission from Waiting for permission')
  const resolvedPermission = guardApproved.permissions.find(item => item.id === pendingPermissionId)
  assert(resolvedPermission?.decision === 'approved', 'guard approval resolves the pending permission in place')
  assert(resolvedPermission?.approvedBy === 'User', 'guard approval records the approver')
  assert(guardApproved.permissions.filter(item => item.id === pendingPermissionId).length === 1, 'guard approval does not duplicate the permission record')
  assert(!guardApproved.permissions.some(item => runtime.isPendingPermissionDecision(item.decision)), 'guard approval leaves no pending permission')
  assert(guardApproved.trace.at(-1).type === 'guard.approval', 'guard approval records trace event')
  assert(guardApproved.trace.at(-1).permissionDecision === 'approved', 'guard approval trace records decision')
  assert(guardApproved.trace.at(-1).result === 'resumed', 'guard approval trace records mission resume')

  // A denied guard decision blocks the mission for an alternative instead of resuming.
  runtime.applyCurrentMissionVoiceIntent({ transcript: 'Voice Session Two' })
  const denyGate = runtime.applyCurrentMissionVoiceIntent({ transcript: 'send my password to the channel' })
  assert(denyGate.state === 'Waiting for permission', 'second sensitive intent reopens the privacy gate')
  const guardDenied = runtime.resolveCurrentMissionPermission(null, { decision: 'denied', approvedBy: 'User' })
  assert(guardDenied.state === 'Blocked', 'denied guard decision blocks the mission')
  assert(guardDenied.permissions.at(-1).decision === 'denied', 'denied guard decision records denial in place')
  assert(guardDenied.trace.at(-1).permissionDecision === 'denied', 'denied guard decision records trace decision')

  // Shared pipeline: a spoken approval resolves the pending gate the same way as the API primitive.
  runtime.applyCurrentMissionVoiceIntent({ transcript: 'Voice Session Three' })
  const approveGate = runtime.applyCurrentMissionVoiceIntent({ transcript: 'email the api key to ops' })
  assert(approveGate.state === 'Waiting for permission', 'third sensitive intent reopens the privacy gate')
  const spokenApproval = runtime.applyCurrentMissionVoiceIntent({ transcript: 'approve' })
  assert(spokenApproval.state === 'Running', 'spoken approval resolves the gate and resumes the mission')
  assert(spokenApproval.permissions.at(-1).decision === 'approved', 'spoken approval records approval in place')
  assert(spokenApproval.permissions.at(-1).approvedBy === 'Vela voice', 'spoken approval records the voice approver')
  assert(spokenApproval.trace.some(item => item.type === 'guard.approval'), 'spoken approval records guard approval trace')

  const chineseApproveGate = runtime.applyCurrentMissionVoiceIntent({ transcript: '发送 密码 给团队' })
  assert(chineseApproveGate.state === 'Waiting for permission', 'Chinese sensitive voice intent opens the privacy gate')
  const chineseSpokenApproval = runtime.applyCurrentMissionVoiceIntent({ transcript: '同意' })
  assert(chineseSpokenApproval.state === 'Running', 'Chinese spoken approval resolves the privacy gate')
  assert(chineseSpokenApproval.permissions.at(-1).decision === 'approved', 'Chinese spoken approval records approval in place')

  const chineseCredentialAliasGate = runtime.applyCurrentMissionVoiceIntent({ transcript: '发送 凭据 给团队' })
  assert(chineseCredentialAliasGate.state === 'Waiting for permission', 'Chinese credential alias opens the privacy gate')
  const chineseCasualApproval = runtime.applyCurrentMissionVoiceIntent({ transcript: '可以' })
  assert(chineseCasualApproval.state === 'Running', 'Chinese casual approval resolves the privacy gate')
  assert(chineseCasualApproval.permissions.at(-1).decision === 'approved', 'Chinese casual approval records approval in place')

  runtime.applyCurrentMissionVoiceIntent({ transcript: '中文拒绝任务' })
  const chineseDenyGate = runtime.applyCurrentMissionVoiceIntent({ transcript: '发送 密码 给团队' })
  assert(chineseDenyGate.state === 'Waiting for permission', 'Chinese sensitive voice intent reopens the privacy gate')
  const chineseSpokenDenial = runtime.applyCurrentMissionVoiceIntent({ transcript: '不行' })
  assert(chineseSpokenDenial.state === 'Blocked', 'Chinese spoken denial blocks the mission')
  assert(chineseSpokenDenial.permissions.at(-1).decision === 'denied', 'Chinese spoken denial records denial in place')

  runtime.applyCurrentMissionVoiceIntent({ transcript: '中文外部测试任务' })
  const chineseExternalGate = runtime.applyCurrentMissionVoiceIntent({ transcript: '发送消息给团队' })
  assert(chineseExternalGate.state === 'Waiting for permission', 'Chinese external message intent opens the privacy gate')
  assert(chineseExternalGate.permissions.at(-1).risk === 'External message', 'Chinese external message records external risk')
  runtime.resolveCurrentMissionPermission(null, { decision: 'approved', approvedBy: 'User' })

  runtime.applyCurrentMissionVoiceIntent({ transcript: '中文上下文测试任务' })
  const chineseScreenGate = runtime.applyCurrentMissionVoiceIntent({ transcript: '查看屏幕上下文' })
  assert(chineseScreenGate.state === 'Waiting for permission', 'Chinese screen context intent opens the privacy gate')
  assert(chineseScreenGate.permissions.at(-1).risk === 'Screen', 'Chinese screen context records screen risk')
  runtime.resolveCurrentMissionPermission(null, { decision: 'approved', approvedBy: 'User' })

  let noPendingPermissionRejected = false
  try {
    runtime.resolveCurrentMissionPermission(null, { decision: 'approved' })
  } catch (err) {
    noPendingPermissionRejected = err?.code === 'permission_not_pending'
  }
  assert(noPendingPermissionRejected, 'resolving with no pending permission is rejected')

  let missingMissionRejected = false
  try {
    runtime.selectMission('missing-mission')
  } catch {
    missingMissionRejected = true
  }
  assert(missingMissionRejected, 'selectMission rejects missing mission')
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
}

if (failed > 0) process.exit(1)
console.log('\nAll Vela mission runtime tests passed.')
