import { execBrowserRead, execFetchUrl, execWebSearch } from '../capabilities/tools/web.js'

const MAX_FETCHED_SOURCES = 2
const SUMMARY_EXCERPT_LENGTH = 420
const WEB_TOOL_TIMEOUT_MS = 15000
const BROWSER_READ_TIMEOUT_MS = 22000

function asText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : []
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

function unique(values = []) {
  const seen = new Set()
  return values.filter(value => {
    const key = asText(value).toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function extractWebUrls(value = '') {
  const text = asText(value)
  if (!text) return []
  const matches = text.match(/https?:\/\/[^\s，。；、）)]+|(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s，。；、）)]*)?/gi) || []
  return unique(matches.map(raw => {
    const trimmed = raw.replace(/[.,;:!?，。；：！？）)]+$/g, '')
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    return `https://${trimmed}`
  }))
}

export function extractSearchQuery(value = '') {
  const withoutUrls = asText(value)
    .replace(/https?:\/\/[^\s，。；、）)]+/gi, ' ')
    .replace(/(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s，。；、）)]*)?/gi, ' ')
  const cleaned = withoutUrls
    .replace(/^(?:开始|新建|创建|start|new|create)\s*[:：-]?\s*/i, '')
    .replace(/\b(?:continue|resume|run|start running)\b/gi, ' ')
    .replace(/(?:继续|恢复|运行|帮我|请|打开|网页|网站|浏览器|搜索|查一下|查询|资料|总结|整理|一下|给我|关于)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || asText(value).slice(0, 80)
}

function safeJson(raw, fallback = {}) {
  if (raw && typeof raw === 'object') return raw
  try {
    return JSON.parse(String(raw || ''))
  } catch {
    return fallback
  }
}

function compactContent(value = '', max = SUMMARY_EXCERPT_LENGTH) {
  const text = asText(value)
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= max) return text
  return `${text.slice(0, max)}...`
}

function resultUrl(result = {}) {
  return asText(result.url || result.link || result.href)
}

function resultTitle(result = {}, fallback = '') {
  return asText(result.title || result.name, fallback)
}

function pageEvidence(page = {}, index = 0) {
  const title = asText(page.title, `来源 ${index + 1}`)
  const url = asText(page.final_url || page.url)
  const source = asText(page.fetch_source || page.tool, 'fetch_url')
  const length = page.content_length ? `，正文约 ${page.content_length} 字` : ''
  return `${title}：${url}（${source}${length}）`
}

function summarizePages({ query = '', mode = 'url', searchSource = '', pages = [], failures = [] } = {}) {
  if (!pages.length) {
    const failureText = failures.map(item => item.reason || item.error || item.url).filter(Boolean).join('；')
    return `浏览器代理没有读到可用网页内容。${failureText ? `失败原因：${failureText}` : '可能需要更明确的网址、可访问来源或搜索服务配置。'}`
  }

  const intro = mode === 'search'
    ? `已围绕「${query}」完成网页搜索和读取，搜索来源：${searchSource || 'web_search'}。`
    : `已读取 ${pages.length} 个指定网页。`
  const sourceLine = `来源：${pages.map((page, index) => `${index + 1}. ${asText(page.title, page.url)}`).join('；')}。`
  const findings = pages.map((page, index) => {
    const title = asText(page.title, `来源 ${index + 1}`)
    const excerpt = compactContent(page.content || page.snippet || page.hint)
    return `${index + 1}. ${title}：${excerpt}`
  }).join(' ')
  return `${intro}${sourceLine}要点：${findings}`
}

async function runWebSearch(webSearch, query, context) {
  const raw = await withToolTimeout(
    nextContext => webSearch({ query, limit: 4 }, nextContext),
    context,
    WEB_TOOL_TIMEOUT_MS,
    'web_search',
  )
  return safeJson(raw, { ok: false, tool: 'web_search', query, error: 'invalid search response' })
}

async function runFetchUrl(fetchUrl, url, context) {
  const raw = await withToolTimeout(
    nextContext => fetchUrl({
      url,
      max_chars: 2600,
      timeout_ms: 20000,
      no_browser_fallback: true,
    }, nextContext),
    context,
    WEB_TOOL_TIMEOUT_MS,
    'fetch_url',
  )
  return safeJson(raw, { ok: false, tool: 'fetch_url', url, error: 'invalid fetch response' })
}

async function runBrowserRead(browserRead, url, context) {
  const raw = await withToolTimeout(
    nextContext => browserRead({
      url,
      max_chars: 3600,
      timeout_ms: 18000,
    }, nextContext),
    context,
    BROWSER_READ_TIMEOUT_MS,
    'browser_read',
  )
  return safeJson(raw, { ok: false, tool: 'browser_read', url, error: 'invalid browser response' })
}

function abortSignal(parentSignal, controller) {
  if (!parentSignal) return () => {}
  const abort = () => controller.abort(parentSignal.reason || new Error('operation aborted'))
  if (parentSignal.aborted) {
    abort()
    return () => {}
  }
  parentSignal.addEventListener?.('abort', abort, { once: true })
  return () => parentSignal.removeEventListener?.('abort', abort)
}

async function withToolTimeout(run, context = {}, timeoutMs, label) {
  const controller = new AbortController()
  const cleanupAbort = abortSignal(context.signal, controller)
  let timer = null
  try {
    return await Promise.race([
      run({ ...context, signal: controller.signal }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort(new Error(`${label} timed out after ${timeoutMs}ms`))
          reject(new Error(`${label} timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
    cleanupAbort()
  }
}

function compactPage(payload = {}, fallback = {}) {
  return {
    ok: payload.ok === true,
    tool: asText(payload.tool, 'fetch_url'),
    url: asText(payload.url || fallback.url),
    final_url: asText(payload.final_url || payload.url || fallback.url),
    title: asText(payload.title || fallback.title, fallback.url),
    fetch_source: asText(payload.fetch_source || payload.source, payload.tool || 'fetch_url'),
    content: compactContent(payload.content || payload.snippet || payload.hint, 900),
    content_length: payload.content_length || payload.body_bytes || '',
    truncated: payload.truncated === true,
    body_path: asText(payload.body_path, ''),
  }
}

function shouldEscalateToBrowserRead(payload = {}) {
  const text = [
    payload.error,
    payload.hint,
    payload.reason,
    payload.status,
  ].map(value => asText(value)).join(' ')
  return /browser_read|javascript|render|crawler|no readable content|cloudflare|captcha|403|429|503|blocked|blocks/i.test(text)
}

function failureReason(payload = {}) {
  return asText(payload.error || payload.hint || payload.status, '读取失败')
}

async function fetchReadablePages(urls = [], tools = {}, context, fallbackResults = []) {
  const {
    fetchUrl = execFetchUrl,
    browserRead = execBrowserRead,
  } = tools
  const pages = []
  const failures = []
  const stages = []
  for (const url of unique(urls).slice(0, MAX_FETCHED_SOURCES)) {
    const fallback = fallbackResults.find(result => resultUrl(result) === url) || { url }
    let payload
    try {
      payload = await runFetchUrl(fetchUrl, url, context)
    } catch (err) {
      payload = { ok: false, tool: 'fetch_url', url, error: err?.message || String(err) }
    }
    if (payload.ok) {
      pages.push(compactPage(payload, {
        url,
        title: resultTitle(fallback, url),
      }))
      stages.push({
        url,
        tool: 'fetch_url',
        status: 'ok',
        summary: `轻量读取成功：${resultTitle(payload, url)}`,
      })
    } else {
      const fetchFailure = {
        url,
        tool: asText(payload.tool, 'fetch_url'),
        reason: failureReason(payload),
      }
      stages.push({
        ...fetchFailure,
        status: 'failed',
        summary: `轻量读取失败：${fetchFailure.reason}`,
      })
      if (shouldEscalateToBrowserRead(payload)) {
        let browserPayload
        try {
          browserPayload = await runBrowserRead(browserRead, url, context)
        } catch (err) {
          browserPayload = { ok: false, tool: 'browser_read', url, error: err?.message || String(err) }
        }
        if (browserPayload.ok) {
          pages.push(compactPage({
            ...browserPayload,
            fetch_source: 'browser_read',
          }, {
            url,
            title: resultTitle(fallback, url),
          }))
          stages.push({
            url,
            tool: 'browser_read',
            status: 'ok',
            summary: `浏览器渲染读取成功：${resultTitle(browserPayload, url)}`,
          })
        } else {
          const browserFailure = {
            url,
            tool: 'browser_read',
            reason: failureReason(browserPayload),
          }
          failures.push(browserFailure)
          stages.push({
            ...browserFailure,
            status: 'failed',
            summary: `浏览器渲染读取失败：${browserFailure.reason}`,
          })
        }
      } else {
        failures.push(fetchFailure)
      }
    }
  }
  return { pages, failures, stages }
}

export async function readBrowserMission({
  mission = {},
  input = {},
  webSearch = execWebSearch,
  fetchUrl = execFetchUrl,
  browserRead = execBrowserRead,
  signal,
} = {}) {
  const text = missionText(mission, input)
  const context = { signal }
  const urls = extractWebUrls(text)

  if (urls.length) {
    const { pages, failures, stages } = await fetchReadablePages(urls, { fetchUrl, browserRead }, context)
    const summary = summarizePages({ mode: 'url', pages, failures })
    return {
      kind: 'browser-read-result',
      ok: pages.length > 0,
      mode: 'url',
      query: '',
      urls,
      sourceTools: unique(stages.map(stage => stage.tool)),
      pages,
      failures,
      stages,
      summary,
      evidence: [
        ...stages.map(stage => `${stage.tool} ${stage.status}：${stage.url}（${stage.reason || stage.summary}）`),
        ...pages.map(pageEvidence),
        ...failures.map(item => `读取失败：${item.url}（${item.reason}）`),
      ],
    }
  }

  const query = extractSearchQuery(text)
  let searchPayload
  try {
    searchPayload = await runWebSearch(webSearch, query, context)
  } catch (err) {
    searchPayload = { ok: false, tool: 'web_search', query, error: err?.message || String(err), results: [] }
  }
  if (!searchPayload.ok) {
    const summary = summarizePages({
      query,
      mode: 'search',
      searchSource: searchPayload.source,
      failures: [{ reason: searchPayload.error || searchPayload.hint || '搜索失败' }],
    })
    return {
      kind: 'browser-read-result',
      ok: false,
      mode: 'search',
      query,
      urls: [],
      sourceTools: ['web_search'],
      pages: [],
      failures: [{ tool: 'web_search', reason: searchPayload.error || searchPayload.hint || '搜索失败' }],
      summary,
      evidence: [
        `搜索查询：${query}`,
        `搜索失败：${searchPayload.error || searchPayload.hint || 'unknown'}`,
      ],
    }
  }

  const results = normalizeArray(searchPayload.results)
  const resultUrls = unique(results.map(resultUrl)).slice(0, MAX_FETCHED_SOURCES)
  const { pages, failures, stages } = await fetchReadablePages(resultUrls, { fetchUrl, browserRead }, context, results)
  const summary = summarizePages({
    query,
    mode: 'search',
    searchSource: searchPayload.source,
    pages,
    failures,
  })
  return {
    kind: 'browser-read-result',
    ok: pages.length > 0,
    mode: 'search',
    query,
    urls: resultUrls,
    sourceTools: unique(['web_search', ...stages.map(stage => stage.tool)]),
    pages,
    failures,
    stages,
    summary,
    evidence: [
      `搜索查询：${query}`,
      `搜索来源：${asText(searchPayload.source, 'web_search')}`,
      ...stages.map(stage => `${stage.tool} ${stage.status}：${stage.url}（${stage.reason || stage.summary}）`),
      ...pages.map(pageEvidence),
      ...failures.map(item => `读取失败：${item.url}（${item.reason}）`),
    ],
  }
}
