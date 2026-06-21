import { execFetchUrl, execWebSearch } from '../capabilities/tools/web.js'

const MAX_FETCHED_SOURCES = 2
const SUMMARY_EXCERPT_LENGTH = 420
const WEB_TOOL_TIMEOUT_MS = 15000

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
  const raw = await withTimeout(webSearch({ query, limit: 4 }, context), WEB_TOOL_TIMEOUT_MS, 'web_search')
  return safeJson(raw, { ok: false, tool: 'web_search', query, error: 'invalid search response' })
}

async function runFetchUrl(fetchUrl, url, context) {
  const raw = await withTimeout(fetchUrl({
    url,
    max_chars: 2600,
    timeout_ms: 20000,
    no_browser_fallback: true,
  }, context), WEB_TOOL_TIMEOUT_MS, 'fetch_url')
  return safeJson(raw, { ok: false, tool: 'fetch_url', url, error: 'invalid fetch response' })
}

async function withTimeout(promise, timeoutMs, label) {
  let timer = null
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
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

async function fetchReadablePages(urls = [], fetchUrl, context, fallbackResults = []) {
  const pages = []
  const failures = []
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
    } else {
      failures.push({
        url,
        tool: asText(payload.tool, 'fetch_url'),
        reason: asText(payload.error || payload.hint || payload.status, '读取失败'),
      })
    }
  }
  return { pages, failures }
}

export async function readBrowserMission({
  mission = {},
  input = {},
  webSearch = execWebSearch,
  fetchUrl = execFetchUrl,
  signal,
} = {}) {
  const text = missionText(mission, input)
  const context = { signal }
  const urls = extractWebUrls(text)

  if (urls.length) {
    const { pages, failures } = await fetchReadablePages(urls, fetchUrl, context)
    const summary = summarizePages({ mode: 'url', pages, failures })
    return {
      kind: 'browser-read-result',
      ok: pages.length > 0,
      mode: 'url',
      query: '',
      urls,
      sourceTools: ['fetch_url'],
      pages,
      failures,
      summary,
      evidence: [
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
  const { pages, failures } = await fetchReadablePages(resultUrls, fetchUrl, context, results)
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
    sourceTools: ['web_search', 'fetch_url'],
    pages,
    failures,
    summary,
    evidence: [
      `搜索查询：${query}`,
      `搜索来源：${asText(searchPayload.source, 'web_search')}`,
      ...pages.map(pageEvidence),
      ...failures.map(item => `读取失败：${item.url}（${item.reason}）`),
    ],
  }
}
