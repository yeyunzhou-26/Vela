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
  const reader = await import('./vela/web-reader.js')

  const urls = reader.extractWebUrls('帮我总结 https://example.com/docs 和 www.openai.com/news。')
  assert(urls.includes('https://example.com/docs'), 'extractWebUrls keeps explicit https URLs')
  assert(urls.includes('https://www.openai.com/news'), 'extractWebUrls normalizes www URLs')

  const query = reader.extractSearchQuery('帮我打开网页搜索资料并总结 Vela 浏览器能力')
  assert(query.includes('Vela'), 'extractSearchQuery keeps the subject')
  assert(!query.includes('搜索资料'), 'extractSearchQuery removes command filler')

  let directNoBrowserFallback = false
  const directRead = await reader.readBrowserMission({
    mission: {
      title: '总结 https://example.com/vela',
      goal: '总结 https://example.com/vela',
      inputs: [],
    },
    fetchUrl: async (args) => {
      directNoBrowserFallback = args.no_browser_fallback === true
      return JSON.stringify({
        ok: true,
        tool: 'fetch_url',
        url: args.url,
        status: 200,
        fetch_source: 'direct',
        title: 'Vela Browser Notes',
        content: 'Vela can read webpages, extract useful details, and produce a reviewable artifact.',
        content_length: 82,
      })
    },
  })
  assert(directRead.ok === true, 'direct URL mission reads successfully')
  assert(directRead.mode === 'url', 'direct URL mission records url mode')
  assert(directRead.sourceTools.includes('fetch_url'), 'direct URL mission records fetch_url tool source')
  assert(directRead.summary.includes('Vela Browser Notes'), 'direct URL summary includes page title')
  assert(directRead.evidence.at(-1).includes('example.com/vela'), 'direct URL evidence includes source URL')
  assert(directRead.pages.at(-1).ok === true, 'direct URL stores a compact successful page')
  assert(directNoBrowserFallback === true, 'direct URL disables implicit browser fallback')

  const escalatedCalls = []
  const browserEscalatedRead = await reader.readBrowserMission({
    mission: {
      title: '帮我打开网页总结 https://example.com/js-app',
      goal: '帮我打开网页总结 https://example.com/js-app',
      inputs: [],
    },
    fetchUrl: async (args) => {
      escalatedCalls.push(['fetch', args.url, args.no_browser_fallback])
      return JSON.stringify({
        ok: false,
        tool: 'fetch_url',
        url: args.url,
        error: 'no readable content',
        hint: 'The page requires JavaScript or blocks crawlers. Use browser_read instead.',
      })
    },
    browserRead: async (args) => {
      escalatedCalls.push(['browser', args.url, args.timeout_ms])
      return JSON.stringify({
        ok: true,
        tool: 'browser_read',
        url: args.url,
        final_url: args.url,
        title: 'Rendered JS App',
        content: 'Chromium rendered the JavaScript page and extracted readable Vela content.',
        content_length: 76,
      })
    },
  })
  assert(browserEscalatedRead.ok === true, 'browser fallback succeeds when lightweight fetch needs rendering')
  assert(browserEscalatedRead.sourceTools.join('+') === 'fetch_url+browser_read', 'browser fallback records both source tools')
  assert(browserEscalatedRead.pages.at(-1).fetch_source === 'browser_read', 'browser fallback marks rendered source')
  assert(browserEscalatedRead.stages.some(stage => stage.tool === 'fetch_url' && stage.status === 'failed'), 'browser fallback records lightweight failure stage')
  assert(browserEscalatedRead.stages.some(stage => stage.tool === 'browser_read' && stage.status === 'ok'), 'browser fallback records browser success stage')
  assert(browserEscalatedRead.evidence.some(item => item.includes('browser_read ok')), 'browser fallback evidence includes browser stage')
  assert(escalatedCalls.some(call => call[0] === 'browser'), 'browser fallback invokes browser_read explicitly')

  const browserFailedRead = await reader.readBrowserMission({
    mission: {
      title: '帮我打开网页总结 https://example.com/captcha',
      goal: '帮我打开网页总结 https://example.com/captcha',
      inputs: [],
    },
    fetchUrl: async (args) => JSON.stringify({
      ok: false,
      tool: 'fetch_url',
      url: args.url,
      error: 'access denied',
      hint: 'Use browser_read instead.',
    }),
    browserRead: async (args) => JSON.stringify({
      ok: false,
      tool: 'browser_read',
      url: args.url,
      error: 'captcha required',
      hint: 'The page may require login or CAPTCHA.',
    }),
  })
  assert(browserFailedRead.ok === false, 'browser failure remains non-ok after fallback fails')
  assert(browserFailedRead.failures.at(-1).tool === 'browser_read', 'browser failure records browser_read as final failed tool')
  assert(browserFailedRead.summary.includes('captcha required'), 'browser failure summary includes recovery reason')

  const calls = []
  const searchRead = await reader.readBrowserMission({
    mission: {
      title: '帮我打开网页搜索资料并总结 Vela 浏览器能力',
      goal: '帮我打开网页搜索资料并总结 Vela 浏览器能力',
      inputs: [],
    },
    webSearch: async (args) => {
      calls.push(['search', args.query])
      return JSON.stringify({
        ok: true,
        tool: 'web_search',
        query: args.query,
        source: 'stub-search',
        results: [
          { title: 'Vela capability map', url: 'https://example.com/capability', snippet: 'Capability map' },
          { title: 'Vela browser design', url: 'https://example.com/browser', snippet: 'Browser design' },
        ],
      })
    },
    fetchUrl: async (args) => {
      calls.push(['fetch', args.url])
      return JSON.stringify({
        ok: true,
        tool: 'fetch_url',
        url: args.url,
        fetch_source: 'direct',
        title: args.url.includes('capability') ? 'Capability Map' : 'Browser Design',
        content: args.url.includes('capability')
          ? 'The capability map explains browser, desktop, file, memory, voice, and messaging adapters.'
          : 'The browser design keeps read-only browsing separate from guarded form submission.',
        content_length: 120,
      })
    },
  })
  assert(searchRead.ok === true, 'search mission reads successfully')
  assert(searchRead.mode === 'search', 'search mission records search mode')
  assert(searchRead.sourceTools.join('+') === 'web_search+fetch_url', 'search mission records search and fetch tools')
  assert(searchRead.pages.length === 2, 'search mission fetches top sources')
  assert(calls.some(call => call[0] === 'search'), 'search mission calls web search')
  assert(calls.filter(call => call[0] === 'fetch').length === 2, 'search mission fetches two result URLs')
  assert(searchRead.summary.includes('Capability Map'), 'search summary includes fetched source titles')

  const failedSearch = await reader.readBrowserMission({
    mission: {
      title: '帮我搜索一个不存在的内部代号',
      goal: '帮我搜索一个不存在的内部代号',
      inputs: [],
    },
    webSearch: async () => JSON.stringify({
      ok: false,
      tool: 'web_search',
      error: 'all search engines failed',
    }),
  })
  assert(failedSearch.ok === false, 'failed search returns non-ok result')
  assert(failedSearch.summary.includes('没有读到可用网页内容'), 'failed search summary is user-readable')
  assert(failedSearch.evidence.some(item => item.includes('搜索失败')), 'failed search records evidence')
} catch (err) {
  console.error(err)
  failed += 1
  process.exitCode = 1
}

if (failed) {
  console.error(`${failed} Vela web reader assertion(s) failed`)
  process.exit(process.exitCode || 1)
}

console.log('Vela web reader checks passed')
