const DEFAULT_GITHUB_API_VERSION = '2022-11-28'
const DEFAULT_ISSUE_LIMIT = 5
const DEFAULT_COMMENT_LIMIT = 5
const DEFAULT_PR_FILE_LIMIT = 12
const DEFAULT_PR_REVIEW_LIMIT = 5
const DEFAULT_CONTENT_ENTRY_LIMIT = 20
const DEFAULT_REPO_SEARCH_LIMIT = 5
const DEFAULT_REPO_ANALYSIS_LIMIT = 2
const DEFAULT_REPO_SOURCE_READ_LIMIT = 4
const BODY_EXCERPT_LENGTH = 360
const CONTENT_EXCERPT_LENGTH = 1600

function asText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : []
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

function safeJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value
  try {
    return JSON.parse(String(value || ''))
  } catch {
    return fallback
  }
}

function cleanRepoName(value = '') {
  return asText(value)
    .replace(/\.git$/i, '')
    .replace(/[.,;:!?，。；：！？）)]+$/g, '')
}

function compactText(value = '', max = BODY_EXCERPT_LENGTH) {
  const text = asText(value)
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
  if (text.length <= max) return text
  return `${text.slice(0, max)}...`
}

function compactContentText(value = '') {
  return compactText(value, CONTENT_EXCERPT_LENGTH)
}

function decodeGitHubValue(value = '') {
  const text = asText(value)
  if (!text) return ''
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function cleanGitHubPath(value = '') {
  return decodeGitHubValue(value)
    .replace(/[?#].*$/g, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/[.,;:!?，。；：！？）)]+$/g, '')
    .split('/')
    .filter(part => part && part !== '.' && part !== '..')
    .join('/')
}

function encodeGitHubPath(value = '') {
  return cleanGitHubPath(value)
    .split('/')
    .filter(Boolean)
    .map(part => encodeURIComponent(part))
    .join('/')
}

function hasGitHubContext(text = '') {
  return /(?:github|repo|repository|仓库|issue|issues|议题|pull request|pr\b|拉取请求|readme|文件|目录|源码|代码|package\.json|src\/|docs\/|scripts\/)/i.test(text)
}

function hasPullIntent(text = '') {
  return /(?:\/pull\/|pull request|pr\b|拉取请求)/i.test(text)
}

function hasIssueIntent(text = '') {
  return /(?:\/issues\/|\bissues?\b|议题|问题|bug)/i.test(text)
}

function hasRepoSearchIntent(text = '') {
  return /(?:github|开源|open source|repo|repository|仓库|项目|project|library|framework|工具|tool)/i.test(text)
    && /(?:搜索|查找|寻找|找|推荐|候选|对比|调研|search|find|discover|recommend|compare|research)/i.test(text)
}

export function extractGitHubTarget(value = '') {
  const text = asText(value)
  if (!text) return null

  const urlMatch = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([a-z0-9_.-]+)\/([a-z0-9_.-]+)(?:\.git)?(?:[/?#][^\s，。；、）)]*)?/i)
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: cleanRepoName(urlMatch[2]),
      issueNumber: extractGitHubIssueNumber(text),
      pullNumber: extractGitHubPullNumber(text),
      source: 'github-url',
    }
  }

  if (!hasGitHubContext(text)) return null
  const slugMatch = text.match(/\b([a-z0-9][a-z0-9-]{0,38})\/([a-z0-9._-]+)(?:\.git)?\b/i)
  if (!slugMatch) return null
  return {
    owner: slugMatch[1],
    repo: cleanRepoName(slugMatch[2]),
    issueNumber: extractGitHubIssueNumber(text),
    pullNumber: extractGitHubPullNumber(text),
    source: 'owner-repo',
  }
}

export function extractGitHubIssueNumber(value = '') {
  const text = asText(value)
  if (!text) return null
  const urlMatch = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/issues\/(\d+)/i)
  if (urlMatch) return Number(urlMatch[1])

  if (!hasGitHubContext(text)) return null
  const labeledMatch = text.match(/(?:issue|issues|议题|问题|bug)\s*#?\s*(\d+)/i)
  if (labeledMatch) return Number(labeledMatch[1])
  if (hasPullIntent(text)) return null
  const hashMatch = text.match(/#(\d+)\b/)
  return hashMatch ? Number(hashMatch[1]) : null
}

export function extractGitHubPullNumber(value = '') {
  const text = asText(value)
  if (!text) return null
  const urlMatch = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/pull\/(\d+)/i)
  if (urlMatch) return Number(urlMatch[1])

  if (!hasGitHubContext(text)) return null
  const labeledMatch = text.match(/(?:pull request|pr|拉取请求)\s*#?\s*(\d+)/i)
  if (labeledMatch) return Number(labeledMatch[1])
  return null
}

function extractGitHubRef(value = '') {
  const text = asText(value)
  if (!text) return ''
  const labeledMatch = text.match(/(?:ref|branch|分支)\s*[：:=]?\s*([a-z0-9._/@+-]+)/i)
  return labeledMatch ? cleanGitHubPath(labeledMatch[1]) : ''
}

function explicitContentPathForText(text = '') {
  const labeledMatch = text.match(/(?:文件|源码文件|代码文件|file|path|目录|directory|folder)\s*[：:]?\s*([a-z0-9._@/+~-]+(?:\/[a-z0-9._@/+~-]+)*)(?=\s|$|[，。；,;])/i)
  if (labeledMatch) return cleanGitHubPath(labeledMatch[1])

  const knownFileMatch = text.match(/\b((?:README(?:\.[a-z0-9]+)?)|package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|tsconfig\.json|vite\.config\.[a-z0-9]+|src\/[a-z0-9._@/+~-]+|docs\/[a-z0-9._@/+~-]+|scripts\/[a-z0-9._@/+~-]+)\b/i)
  return knownFileMatch ? cleanGitHubPath(knownFileMatch[1]) : ''
}

function hasDirectoryIntent(text = '') {
  return /(?:\/tree\/|目录|文件列表|目录结构|代码结构|根目录|root|directory|folder|tree|list files)/i.test(text)
}

function hasReadmeIntent(text = '') {
  return /(?:readme|自述|说明文档|项目说明)/i.test(text)
}

function wantsRepoContent(text = '') {
  if (!text || hasPullIntent(text)) return false
  const strongContentIntent = /(?:\/blob\/|\/tree\/|readme|自述|说明文档|项目说明|文件|目录|源码|代码|package\.json|src\/|docs\/|scripts\/|文件列表|目录结构|代码结构)/i.test(text)
  if (strongContentIntent) return true
  if (hasIssueIntent(text)) return false
  return /(?:root|folder|directory|content|contents)/i.test(text)
}

export function extractGitHubContentRequest(value = '') {
  const text = asText(value)
  if (!text || !wantsRepoContent(text)) return null

  const urlPathMatch = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+(?:\.git)?\/(blob|tree)\/([^/\s?#，。；、）)]+)(?:\/([^\s?#，。；、）)]+))?/i)
  if (urlPathMatch) {
    const path = cleanGitHubPath(urlPathMatch[3] || '')
    return {
      kind: urlPathMatch[1].toLowerCase() === 'tree' ? 'directory' : 'file',
      path,
      ref: cleanGitHubPath(urlPathMatch[2]),
      source: `github-${urlPathMatch[1].toLowerCase()}-url`,
    }
  }

  const ref = extractGitHubRef(text)
  const explicitPath = explicitContentPathForText(text)
  if (explicitPath) {
    const readme = hasReadmeIntent(explicitPath)
    return {
      kind: readme ? 'readme' : (hasDirectoryIntent(text) ? 'directory' : 'file'),
      path: readme ? 'README' : explicitPath,
      ref,
      source: readme ? 'readme-path-intent' : 'path-intent',
    }
  }

  if (hasReadmeIntent(text)) {
    return {
      kind: 'readme',
      path: 'README',
      ref,
      source: 'readme-intent',
    }
  }

  if (hasDirectoryIntent(text) || /(?:源码|代码)/i.test(text)) {
    return {
      kind: 'directory',
      path: '',
      ref,
      source: 'directory-intent',
    }
  }

  return null
}

function cleanRepoSearchQuery(value = '') {
  return asText(value)
    .replace(/(?:https?:\/\/)?(?:www\.)?github\.com\/search\?[^ \n\t，。；]+/ig, ' ')
    .replace(/(?:用|使用|帮我|帮|请|给我|通过)?\s*(?:github|GitHub)\s*(?:工具|tool)?/ig, ' ')
    .replace(/(?:搜索|查找|寻找|找一下|找|推荐|候选|对比|调研|研究|search|find|discover|recommend|compare|research)/ig, ' ')
    .replace(/(?:开源项目|开源仓库|项目|仓库|repo(?:sitories)?|repository|repositories|open source projects?|projects?)/ig, ' ')
    .replace(/(?:可以|能够|能|适合|相关|类似|优秀|好的|好用的|强大|参考|借鉴|吸取|众家之长)/ig, ' ')
    .replace(/[“”"'`]/g, ' ')
    .replace(/[，。；、,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractGitHubRepoSearchRequest(value = '') {
  const text = asText(value)
  if (!text || !hasRepoSearchIntent(text) || extractGitHubTarget(text)) return null
  const query = cleanRepoSearchQuery(text)
  if (!query) return null
  const sort = /(?:recent|recently|updated|活跃|最近|更新|维护)/i.test(text) ? 'updated' : 'stars'
  return {
    query,
    sort,
    order: 'desc',
    source: 'repo-search-intent',
  }
}

function wantsIssues(text = '') {
  return /(?:issue|issues|议题|问题|bug|pull request|pr\b|拉取请求)/i.test(text)
}

function issueStateForText(text = '') {
  if (/(?:closed|已关闭|关闭的|resolved|解决)/i.test(text)) return 'closed'
  if (/(?:all|全部|所有)/i.test(text)) return 'all'
  return 'open'
}

function headersForGitHub({ token = '', apiVersion = DEFAULT_GITHUB_API_VERSION } = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': apiVersion,
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function normalizeFetchResult(raw, url = '') {
  const value = safeJson(raw, raw)
  if (!value || typeof value !== 'object') {
    return {
      ok: false,
      status: 0,
      url,
      body: null,
      error: 'invalid GitHub response',
    }
  }
  if ('ok' in value && ('body' in value || 'data' in value)) {
    return {
      ok: value.ok !== false,
      status: value.status || (value.ok === false ? 0 : 200),
      url: asText(value.url, url),
      body: value.body ?? value.data,
      error: asText(value.error || value.reason || value.message),
    }
  }
  if (value.ok === false || Number(value.status) >= 400) {
    return {
      ok: false,
      status: Number(value.status) || 0,
      url: asText(value.url, url),
      body: value.body ?? value.data ?? value,
      error: asText(value.error || value.reason || value.message, `GitHub request failed${value.status ? ` (${value.status})` : ''}`),
    }
  }
  if ('status' in value && ('body' in value || 'data' in value)) {
    return {
      ok: true,
      status: Number(value.status) || 200,
      url,
      body: value.body ?? value.data,
      error: '',
    }
  }
  return {
    ok: true,
    status: Number(value.status) || 200,
    url,
    body: value,
    error: '',
  }
}

async function defaultFetchJson({ url, headers, signal }) {
  if (typeof fetch !== 'function') {
    return {
      ok: false,
      status: 0,
      url,
      body: null,
      error: 'global fetch is not available',
    }
  }
  const response = await fetch(url, { method: 'GET', headers, signal })
  let body = null
  try {
    body = await response.json()
  } catch {
    body = { message: response.statusText || 'empty response' }
  }
  return {
    ok: response.ok,
    status: response.status,
    url,
    body,
    error: response.ok ? '' : asText(body?.message, response.statusText),
  }
}

async function readJson(fetchJson, request) {
  try {
    const raw = await (fetchJson || defaultFetchJson)(request)
    return normalizeFetchResult(raw, request.url)
  } catch (err) {
    return {
      ok: false,
      status: 0,
      url: request.url,
      body: null,
      error: err?.message || String(err),
    }
  }
}

function compactRepo(repo = {}, target = {}) {
  const owner = asText(repo.owner?.login || target.owner)
  const name = asText(repo.name || target.repo)
  const fullName = asText(repo.full_name, `${owner}/${name}`)
  return {
    owner,
    name,
    fullName,
    htmlUrl: asText(repo.html_url, `https://github.com/${fullName}`),
    description: asText(repo.description, 'No description provided.'),
    visibility: asText(repo.visibility || (repo.private ? 'private' : 'public')),
    defaultBranch: asText(repo.default_branch, ''),
    stars: Number(repo.stargazers_count || 0),
    forks: Number(repo.forks_count || repo.forks || 0),
    openIssues: Number(repo.open_issues_count || 0),
    updatedAt: asText(repo.updated_at, ''),
  }
}

function compactIssue(issue = {}) {
  return {
    number: Number(issue.number || 0),
    title: asText(issue.title, 'Untitled issue'),
    state: asText(issue.state, ''),
    htmlUrl: asText(issue.html_url, ''),
    user: asText(issue.user?.login, ''),
    labels: normalizeArray(issue.labels).map(label => asText(label?.name || label)).filter(Boolean),
    bodyExcerpt: compactText(issue.body || issue.body_text || ''),
    commentsCount: Number(issue.comments || 0),
    createdAt: asText(issue.created_at, ''),
    updatedAt: asText(issue.updated_at, ''),
    closedAt: asText(issue.closed_at, ''),
    stateReason: asText(issue.state_reason, ''),
    isPullRequest: !!issue.pull_request,
  }
}

function compactComment(comment = {}) {
  return {
    id: Number(comment.id || 0),
    user: asText(comment.user?.login, ''),
    bodyExcerpt: compactText(comment.body || comment.body_text || ''),
    htmlUrl: asText(comment.html_url, ''),
    createdAt: asText(comment.created_at, ''),
    updatedAt: asText(comment.updated_at, ''),
    authorAssociation: asText(comment.author_association, ''),
  }
}

function compactPull(pull = {}) {
  return {
    number: Number(pull.number || 0),
    title: asText(pull.title, 'Untitled pull request'),
    state: asText(pull.state, ''),
    htmlUrl: asText(pull.html_url, ''),
    user: asText(pull.user?.login, ''),
    bodyExcerpt: compactText(pull.body || pull.body_text || ''),
    base: asText(pull.base?.ref, ''),
    head: asText(pull.head?.ref, ''),
    merged: pull.merged === true,
    mergeable: pull.mergeable === null ? 'unknown' : String(pull.mergeable === true),
    draft: pull.draft === true,
    additions: Number(pull.additions || 0),
    deletions: Number(pull.deletions || 0),
    changedFiles: Number(pull.changed_files || 0),
    commits: Number(pull.commits || 0),
    commentsCount: Number(pull.comments || 0),
    reviewCommentsCount: Number(pull.review_comments || 0),
    createdAt: asText(pull.created_at, ''),
    updatedAt: asText(pull.updated_at, ''),
    closedAt: asText(pull.closed_at, ''),
    mergedAt: asText(pull.merged_at, ''),
  }
}

function compactPullFile(file = {}) {
  return {
    filename: asText(file.filename, ''),
    status: asText(file.status, ''),
    additions: Number(file.additions || 0),
    deletions: Number(file.deletions || 0),
    changes: Number(file.changes || 0),
    blobUrl: asText(file.blob_url, ''),
    rawUrl: asText(file.raw_url, ''),
    patchExcerpt: compactText(file.patch || '', 220),
  }
}

function compactPullReview(review = {}) {
  return {
    id: Number(review.id || 0),
    user: asText(review.user?.login, ''),
    state: asText(review.state, ''),
    bodyExcerpt: compactText(review.body || review.body_text || ''),
    htmlUrl: asText(review.html_url, ''),
    submittedAt: asText(review.submitted_at, ''),
    commitId: asText(review.commit_id, ''),
    authorAssociation: asText(review.author_association, ''),
  }
}

function decodeBase64Content(content = '') {
  const normalized = asText(content).replace(/\s/g, '')
  if (!normalized) return ''
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(normalized, 'base64').toString('utf8')
    }
  } catch {
    // Fall through to browser decoding.
  }
  try {
    if (typeof atob === 'function') {
      return decodeURIComponent(escape(atob(normalized)))
    }
  } catch {
    return ''
  }
  return ''
}

function compactContentEntry(entry = {}) {
  return {
    name: asText(entry.name, ''),
    path: asText(entry.path, ''),
    type: asText(entry.type, ''),
    size: Number(entry.size || 0),
    sha: asText(entry.sha, ''),
    htmlUrl: asText(entry.html_url, ''),
    downloadUrl: asText(entry.download_url, ''),
  }
}

function compactContentFile(file = {}, request = {}) {
  const decoded = asText(file.encoding).toLowerCase() === 'base64'
    ? decodeBase64Content(file.content)
    : asText(file.content)
  return {
    name: asText(file.name, request.path || 'README'),
    path: asText(file.path, request.path || ''),
    type: asText(file.type, 'file'),
    size: Number(file.size || decoded.length || 0),
    sha: asText(file.sha, ''),
    encoding: asText(file.encoding, ''),
    htmlUrl: asText(file.html_url, ''),
    downloadUrl: asText(file.download_url, ''),
    contentExcerpt: compactContentText(decoded),
  }
}

function compactContentResult(body, request = {}, entryLimit = DEFAULT_CONTENT_ENTRY_LIMIT) {
  const limit = Math.max(1, Math.min(Number(entryLimit) || DEFAULT_CONTENT_ENTRY_LIMIT, 50))
  if (Array.isArray(body)) {
    return {
      detail: null,
      items: body.slice(0, limit).map(compactContentEntry),
      totalItems: body.length,
      truncated: body.length > limit,
    }
  }
  if (body?.type === 'dir' && Array.isArray(body.entries)) {
    return {
      detail: null,
      items: body.entries.slice(0, limit).map(compactContentEntry),
      totalItems: body.entries.length,
      truncated: body.entries.length > limit,
    }
  }
  return {
    detail: compactContentFile(body || {}, request),
    items: [],
    totalItems: 0,
    truncated: false,
  }
}

function compactSearchRepository(repo = {}) {
  return {
    fullName: asText(repo.full_name, ''),
    name: asText(repo.name, ''),
    owner: asText(repo.owner?.login, ''),
    htmlUrl: asText(repo.html_url, ''),
    description: asText(repo.description, 'No description provided.'),
    language: asText(repo.language, ''),
    topics: normalizeArray(repo.topics).map(item => asText(item)).filter(Boolean).slice(0, 8),
    license: asText(repo.license?.spdx_id || repo.license?.name, ''),
    stars: Number(repo.stargazers_count || 0),
    forks: Number(repo.forks_count || repo.forks || 0),
    openIssues: Number(repo.open_issues_count || 0),
    defaultBranch: asText(repo.default_branch, ''),
    updatedAt: asText(repo.updated_at, ''),
    pushedAt: asText(repo.pushed_at, ''),
    archived: repo.archived === true,
    disabled: repo.disabled === true,
  }
}

function splitFullName(fullName = '') {
  const [owner, name] = asText(fullName).split('/')
  return { owner: asText(owner), name: asText(name) }
}

function repoApiParts(repo = {}) {
  const fromFullName = splitFullName(repo.fullName || repo.full_name)
  return {
    owner: asText(repo.owner?.login || repo.owner || fromFullName.owner),
    name: asText(repo.name || fromFullName.name),
  }
}

function isKnownManifestPath(path = '') {
  return /^(?:package\.json|pyproject\.toml|requirements\.txt|cargo\.toml|go\.mod|deno\.json)$/i.test(asText(path))
}

function keySourceScore(path = '') {
  const normalized = asText(path).toLowerCase()
  const priorities = [
    /^src\/index\.(?:ts|tsx|js|jsx|mjs|py)$/,
    /^src\/main\.(?:ts|tsx|js|jsx|mjs|py)$/,
    /^src\/app\.(?:ts|tsx|js|jsx|mjs|py)$/,
    /^src\/server\.(?:ts|js|mjs|py)$/,
    /^index\.(?:ts|tsx|js|jsx|mjs|py)$/,
    /^main\.(?:ts|tsx|js|jsx|mjs|py)$/,
    /^app\.(?:ts|tsx|js|jsx|mjs|py)$/,
  ]
  const index = priorities.findIndex(pattern => pattern.test(normalized))
  return index === -1 ? Number.POSITIVE_INFINITY : index
}

function chooseEntryPath(items = []) {
  const manifests = normalizeArray(items)
    .filter(item => item.type === 'file' && isKnownManifestPath(item.path || item.name))
    .sort((left, right) => (left.path || left.name).localeCompare(right.path || right.name))
  if (manifests.length) return manifests[0].path || manifests[0].name
  const sources = normalizeArray(items)
    .filter(item => item.type === 'file' && Number.isFinite(keySourceScore(item.path || item.name)))
    .sort((left, right) => keySourceScore(left.path || left.name) - keySourceScore(right.path || right.name))
  return sources[0]?.path || sources[0]?.name || ''
}

async function readSearchCandidateContent({ fetchJson, headers, signal, url, tool, pathLabel, request = {}, entryLimit }) {
  const result = await readJson(fetchJson, { url, headers, signal })
  if (!result.ok) {
    const reason = failureText(result, tool)
    return {
      ok: false,
      stage: {
        tool,
        status: 'failed',
        url,
        summary: `读取候选仓库 ${pathLabel} 失败：${reason}`,
        reason,
      },
      failure: { tool, url, reason, status: result.status },
      compacted: { detail: null, items: [], totalItems: 0, truncated: false },
    }
  }
  const compacted = compactContentResult(result.body, request, entryLimit)
  return {
    ok: true,
    stage: {
      tool,
      status: 'ok',
      url,
      summary: compacted.detail
        ? `读取候选仓库文件 ${compacted.detail.path || pathLabel} 成功。`
        : `读取候选仓库目录 ${pathLabel} 成功：${compacted.items.length}/${compacted.totalItems || compacted.items.length} 项。`,
    },
    failure: null,
    compacted,
  }
}

function searchCandidateAnalysisLine(analysis = {}, index = 0) {
  const name = analysis.fullName || `候选 ${index + 1}`
  const readme = analysis.readme?.contentExcerpt ? `README：${compactText(analysis.readme.contentExcerpt, 180)}` : 'README 未读到'
  const entry = analysis.entryFile
    ? `入口线索 ${analysis.entryFile.path || analysis.entryFile.name}：${compactText(analysis.entryFile.contentExcerpt, 160)}`
    : (analysis.entryPath ? `入口线索 ${analysis.entryPath}` : '入口线索未读到')
  const root = analysis.rootItems?.length
    ? `根目录：${analysis.rootItems.slice(0, 8).map(item => item.path || item.name).filter(Boolean).join(', ')}`
    : '根目录未读到'
  const source = analysis.sourceItems?.length
    ? `源码目录：${analysis.sourceItems.slice(0, 8).map(item => item.path || item.name).filter(Boolean).join(', ')}`
    : ''
  const failures = analysis.failures?.length
    ? `局部失败：${analysis.failures.map(item => `${item.tool} ${item.reason}`).join('；')}`
    : ''
  return [name, readme, entry, root, source, failures].filter(Boolean).join('；')
}

function lessonSearchText(analysis = {}) {
  return [
    analysis.fullName,
    analysis.description,
    analysis.language,
    ...normalizeArray(analysis.topics),
    analysis.readme?.contentExcerpt,
    analysis.entryFile?.contentExcerpt,
    ...normalizeArray(analysis.rootItems).map(item => item.path || item.name),
    ...normalizeArray(analysis.sourceItems).map(item => item.path || item.name),
  ].map(item => asText(item).toLowerCase()).filter(Boolean).join(' ')
}

function lessonSignalsForAnalysis(analysis = {}) {
  const signals = []
  if (analysis.stars) signals.push(`${analysis.stars} stars`)
  if (analysis.forks) signals.push(`${analysis.forks} forks`)
  if (analysis.language) signals.push(`语言 ${analysis.language}`)
  if (analysis.license) signals.push(`许可证 ${analysis.license}`)
  if (analysis.topics?.length) signals.push(`topics: ${analysis.topics.slice(0, 4).join(', ')}`)
  if (analysis.readme?.contentExcerpt) signals.push('README 可读')
  if (analysis.entryPath) signals.push(`入口 ${analysis.entryPath}`)
  if (analysis.sourceItems?.length) signals.push(`源码线索 ${analysis.sourceItems.length} 项`)
  if (analysis.archived) signals.push('仓库已归档')
  return signals
}

function capabilityIdeasForAnalysis(analysis = {}) {
  const text = lessonSearchText(analysis)
  const ideas = []
  if (/(?:browser|playwright|website|web automation|网页|浏览器)/i.test(text)) {
    ideas.push('浏览器操作空间：把页面观察、动作执行、失败恢复沉淀为 Vela Operator 的网页任务能力')
  }
  if (/(?:agent|agents|autonomous|task loop|action space|智能体)/i.test(text)) {
    ideas.push('Agent 执行循环：提取任务分解、动作选择、结果验证和恢复循环，服务长任务自治')
  }
  if (/(?:mcp|model context protocol|tool server|tool registry|server)/i.test(text)) {
    ideas.push('工具桥接：借鉴 MCP/server 注册、工具发现和外部工具路由，扩展 Vela 工具生态')
  }
  if (/(?:memory|context|recall|knowledge|上下文|记忆)/i.test(text)) {
    ideas.push('上下文记忆：吸收上下文注入、可追溯来源和召回质量检查的做法')
  }
  if (/(?:permission|policy|guard|security|sandbox|权限|安全)/i.test(text)) {
    ideas.push('权限与守卫：强化工具风险分类、执行边界和用户确认流程')
  }
  if (!ideas.length) {
    ideas.push('项目拆解：先从 README、manifest 和入口文件识别核心模块，再决定是否进入源码级对照')
  }
  return ideas.slice(0, 4)
}

function risksForAnalysis(analysis = {}) {
  const risks = []
  if (analysis.archived) risks.push('仓库已归档，不能直接作为长期依赖')
  if (!analysis.license) risks.push('缺少明确许可证信息，复用前需要人工确认')
  if (!analysis.readme?.contentExcerpt) risks.push('README 未读到，能力判断证据不足')
  if (!analysis.entryFile?.contentExcerpt) risks.push('入口/manifest 未读到，源码结构还需要继续确认')
  if (analysis.failures?.length) risks.push(`深读有局部失败 ${analysis.failures.length} 项`)
  return risks
}

function repoSearchLessonForAnalysis(analysis = {}, index = 0) {
  const ideas = capabilityIdeasForAnalysis(analysis)
  const signals = lessonSignalsForAnalysis(analysis)
  const risks = risksForAnalysis(analysis)
  const evidencePaths = unique([
    analysis.readme?.path,
    analysis.entryFile?.path,
    ...normalizeArray(analysis.sourceItems).slice(0, 4).map(item => item.path || item.name),
  ])
  const evidence = [
    analysis.readme?.contentExcerpt ? `README：${compactText(analysis.readme.contentExcerpt, 220)}` : '',
    analysis.entryFile?.contentExcerpt ? `${analysis.entryFile.path || analysis.entryPath}：${compactText(analysis.entryFile.contentExcerpt, 180)}` : '',
    evidencePaths.length ? `文件线索：${evidencePaths.join(', ')}` : '',
  ].filter(Boolean)
  return {
    candidate: analysis.fullName || `候选 ${index + 1}`,
    htmlUrl: asText(analysis.htmlUrl, ''),
    fit: ideas.length >= 2 && !analysis.archived ? 'high' : 'medium',
    signals,
    capabilityIdeas: ideas,
    risks,
    nextAction: analysis.entryPath
      ? `继续读取 ${analysis.fullName} 的 ${analysis.entryPath} 相关实现，提炼可迁移的接口和执行循环。`
      : `继续读取 ${analysis.fullName} 的 docs/examples/src 目录，补足实现证据。`,
    evidence,
  }
}

function synthesizeRepoSearchLessons(analyses = []) {
  return normalizeArray(analyses)
    .filter(analysis => analysis?.fullName)
    .map(repoSearchLessonForAnalysis)
}

function repoSearchLessonLine(lesson = {}, index = 0) {
  const name = lesson.candidate || `候选 ${index + 1}`
  const ideas = lesson.capabilityIdeas?.length ? `能力启发：${lesson.capabilityIdeas.join('；')}` : ''
  const next = lesson.nextAction ? `下一步：${lesson.nextAction}` : ''
  const risk = lesson.risks?.length ? `风险：${lesson.risks.join('；')}` : ''
  return [name, `fit=${lesson.fit || 'unknown'}`, ideas, next, risk].filter(Boolean).join('；')
}

function readPlanReasonForPath(path = '', lesson = {}) {
  const normalized = asText(path).toLowerCase()
  if (isKnownManifestPath(path)) return '确认依赖、运行方式和可迁移模块边界'
  if (/agent|planner|task|loop/.test(normalized)) return '确认 Agent 执行循环、任务状态和恢复策略'
  if (/browser|playwright|page|dom|web/.test(normalized)) return '确认浏览器观察、动作执行和失败恢复接口'
  if (/mcp|tool|server|registry/.test(normalized)) return '确认工具注册、工具调用和外部能力桥接方式'
  if (/memory|context|recall/.test(normalized)) return '确认上下文注入、记忆召回和来源记录方式'
  if (/permission|policy|guard|security|sandbox/.test(normalized)) return '确认权限、守卫和安全边界实现'
  if (/^src\/(?:index|main|app|server)\./.test(normalized) || /^(?:index|main|app)\./.test(normalized)) {
    return '确认项目入口、模块装配和核心执行路径'
  }
  return lesson.capabilityIdeas?.length
    ? `围绕「${lesson.capabilityIdeas[0].split('：')[0]}」继续验证源码实现`
    : '补足源码实现证据'
}

function candidateReadTargets(analysis = {}, lesson = {}) {
  const targets = []
  const pushTarget = ({ path, type = 'file', priority = 50, signal = '' } = {}) => {
    const cleanedPath = cleanGitHubPath(path)
    if (!cleanedPath || targets.some(item => item.path === cleanedPath)) return
    targets.push({
      path: cleanedPath,
      type,
      priority,
      risk: 'Read',
      reason: readPlanReasonForPath(cleanedPath, lesson),
      sourceSignal: signal,
    })
  }

  if (analysis.entryPath) {
    pushTarget({ path: analysis.entryPath, priority: 1, signal: 'entry-or-manifest' })
  }

  normalizeArray(analysis.sourceItems)
    .filter(item => item.type === 'file')
    .map(item => item.path || item.name)
    .filter(path => Number.isFinite(keySourceScore(path)) || /agent|browser|playwright|mcp|tool|server|memory|context|permission|guard|policy/i.test(path))
    .sort((left, right) => {
      const leftScore = keySourceScore(left)
      const rightScore = keySourceScore(right)
      const normalizedLeft = Number.isFinite(leftScore) ? leftScore : 999
      const normalizedRight = Number.isFinite(rightScore) ? rightScore : 999
      return normalizedLeft - normalizedRight || left.localeCompare(right)
    })
    .slice(0, 4)
    .forEach((path, index) => pushTarget({ path, priority: 10 + index, signal: 'source-match' }))

  normalizeArray(analysis.rootItems)
    .filter(item => item.type === 'dir' && /^(?:docs|examples|src|packages|apps)$/i.test(item.path || item.name))
    .slice(0, 3)
    .forEach((item, index) => pushTarget({
      path: item.path || item.name,
      type: 'dir',
      priority: 40 + index,
      signal: 'supporting-directory',
    }))

  return targets
    .sort((left, right) => left.priority - right.priority || left.path.localeCompare(right.path))
    .slice(0, 6)
}

function repoSearchReadPlanForAnalysis(analysis = {}, lesson = {}, index = 0) {
  const candidate = lesson.candidate || analysis.fullName || `候选 ${index + 1}`
  const targets = candidateReadTargets(analysis, lesson)
  return {
    candidate,
    htmlUrl: asText(analysis.htmlUrl || lesson.htmlUrl, ''),
    status: targets.length ? 'ready' : 'needs-more-discovery',
    risk: 'Read',
    targets,
    nextCommand: targets.length
      ? `继续只读读取 ${candidate} 的 ${targets.slice(0, 3).map(item => item.path).join('、')}，验证可迁移实现。`
      : `先展开 ${candidate} 的 src/docs/examples 目录，再生成源码读取计划。`,
  }
}

function synthesizeRepoSearchReadPlans(analyses = [], lessons = []) {
  return normalizeArray(analyses)
    .filter(analysis => analysis?.fullName)
    .map((analysis, index) => repoSearchReadPlanForAnalysis(analysis, normalizeArray(lessons)[index] || {}, index))
}

function repoSearchReadPlanLine(plan = {}, index = 0) {
  const name = plan.candidate || `候选 ${index + 1}`
  const targets = plan.targets?.length
    ? `目标：${plan.targets.map(item => `${item.path}(${item.reason})`).join('；')}`
    : '目标待发现'
  return [name, `status=${plan.status || 'unknown'}`, targets, plan.nextCommand].filter(Boolean).join('；')
}

function sourceReadTargetsForPlans(plans = [], analyses = [], sourceReadLimit = DEFAULT_REPO_SOURCE_READ_LIMIT) {
  const parsedLimit = Number(sourceReadLimit)
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(0, Math.min(Math.floor(parsedLimit), 12))
    : DEFAULT_REPO_SOURCE_READ_LIMIT
  if (!limit) return []
  const taken = new Set()
  const targets = []
  for (const [planIndex, plan] of normalizeArray(plans).entries()) {
    const analysis = normalizeArray(analyses)[planIndex] || {}
    const alreadyRead = new Set([
      cleanGitHubPath(analysis.readme?.path),
      cleanGitHubPath(analysis.entryPath),
      cleanGitHubPath(analysis.entryFile?.path),
    ].filter(Boolean))
    for (const target of normalizeArray(plan.targets)) {
      const path = cleanGitHubPath(target.path)
      const key = `${plan.candidate}/${path}`.toLowerCase()
      if (!path || taken.has(key) || alreadyRead.has(path)) continue
      if (target.type === 'dir' && path === 'src' && analysis.sourceItems?.length) continue
      taken.add(key)
      targets.push({ plan, target: { ...target, path }, analysis })
      if (targets.length >= limit) return targets
    }
  }
  return targets
}

function compactPlannedSourceRead({ plan = {}, target = {}, result = {}, analysis = {} } = {}) {
  const detail = result.compacted?.detail || null
  const items = normalizeArray(result.compacted?.items)
  return {
    candidate: plan.candidate || analysis.fullName || '',
    htmlUrl: asText(plan.htmlUrl || analysis.htmlUrl, ''),
    path: asText(target.path, ''),
    type: asText(target.type, detail ? 'file' : 'dir'),
    risk: 'Read',
    reason: asText(target.reason, ''),
    sourceSignal: asText(target.sourceSignal, ''),
    ok: result.ok === true,
    contentDetail: detail,
    contentItems: items,
    contentTotalItems: Number(result.compacted?.totalItems || items.length || 0),
    contentTruncated: result.compacted?.truncated === true,
    failure: result.failure || null,
  }
}

async function readPlannedSourceTargets({
  plans = [],
  analyses = [],
  fetchJson,
  headers,
  signal,
  contentEntryLimit = DEFAULT_CONTENT_ENTRY_LIMIT,
  sourceReadLimit = DEFAULT_REPO_SOURCE_READ_LIMIT,
} = {}) {
  const reads = []
  const stages = []
  const targets = sourceReadTargetsForPlans(plans, analyses, sourceReadLimit)
  for (const item of targets) {
    const { owner, name } = splitFullName(item.plan.candidate || item.analysis.fullName)
    if (!owner || !name) {
      const reason = '候选仓库缺少 owner/name，无法执行源码读取计划'
      const failure = { tool: 'github.search.planned-source.read', url: 'github://search/planned-source', reason, status: 0 }
      reads.push(compactPlannedSourceRead({
        plan: item.plan,
        target: item.target,
        analysis: item.analysis,
        result: { ok: false, failure, compacted: { detail: null, items: [], totalItems: 0, truncated: false } },
      }))
      stages.push({
        tool: 'github.search.planned-source.read',
        status: 'failed',
        url: failure.url,
        summary: reason,
        reason,
      })
      continue
    }
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${encodeGitHubPath(item.target.path)}`
    const result = await readSearchCandidateContent({
      fetchJson,
      headers,
      signal,
      url,
      tool: 'github.search.planned-source.read',
      pathLabel: item.target.path,
      request: { path: item.target.path, kind: item.target.type === 'dir' ? 'directory' : 'file' },
      entryLimit: contentEntryLimit,
    })
    stages.push(result.stage)
    reads.push(compactPlannedSourceRead({
      plan: item.plan,
      target: item.target,
      analysis: item.analysis,
      result,
    }))
  }
  return { reads, stages }
}

function repoSearchSourceReadLine(read = {}, index = 0) {
  const name = read.candidate || `候选 ${index + 1}`
  const status = read.ok ? 'ok' : 'failed'
  const detail = read.contentDetail
    ? `摘录：${compactText(read.contentDetail.contentExcerpt, 180)}`
    : (read.contentItems?.length ? `目录项：${read.contentItems.slice(0, 6).map(item => item.path || item.name).join(', ')}` : '')
  const failure = read.failure?.reason ? `失败：${read.failure.reason}` : ''
  return [name, read.path, `status=${status}`, read.reason, detail, failure].filter(Boolean).join('；')
}

function capabilityDraftName(idea = '') {
  return asText(idea).split('：')[0] || '项目拆解'
}

function localTargetsForCapabilityDraft(name = '') {
  if (/浏览器|网页/.test(name)) {
    return ['src/vela/capability-registry.js', 'src/vela/capability-adapters.js', 'src/vela/mission-runtime.js']
  }
  if (/Agent|执行循环|任务/.test(name)) {
    return ['src/vela/mission-runtime.js', 'src/vela/capability-adapters.js', 'src/test-vela-mission.js']
  }
  if (/工具|MCP|桥接/.test(name)) {
    return ['src/vela/capability-registry.js', 'src/vela/capability-adapters.js', 'src/vela/github-reader.js']
  }
  if (/上下文|记忆/.test(name)) {
    return ['src/vela/mission-runtime.js', 'src/vela/capability-adapters.js', 'src/test-vela-mission.js']
  }
  if (/权限|守卫|安全/.test(name)) {
    return ['src/vela/mission-runtime.js', 'src/vela/capability-adapters.js', 'src/test-vela-mission.js']
  }
  return ['src/vela/capability-registry.js', 'src/vela/capability-adapters.js', 'src/test-vela-mission.js']
}

function permissionBoundaryForCapabilityDraft(name = '') {
  if (/浏览器|网页/.test(name)) return '页面观察和读取保持 Read；点击、提交表单、发送消息、登录凭据必须进入 Guard 确认。'
  if (/工具|MCP|桥接/.test(name)) return '工具发现和只读读取可自动执行；写 issue、合并 PR、推送代码、访问凭证必须进入 Guard。'
  if (/权限|守卫|安全/.test(name)) return '内部分类和复核可自动执行；任何外部副作用都必须携带风险、范围、证据和用户确认。'
  return '内部规划、源码对照和 artifact 生成可自动执行；外部写入、发送、购买、删除、凭证读取必须进入 Guard。'
}

function sourceEvidenceLineForDraft(read = {}) {
  if (!read.ok) {
    return read.failure?.reason ? `${read.path}：读取失败，${read.failure.reason}` : `${read.path}：读取失败`
  }
  if (read.contentDetail?.contentExcerpt) {
    return `${read.path}：${compactText(read.contentDetail.contentExcerpt, 220)}`
  }
  if (read.contentItems?.length) {
    return `${read.path}：目录包含 ${read.contentItems.slice(0, 8).map(item => item.path || item.name).filter(Boolean).join(', ')}`
  }
  return read.path ? `${read.path}：已读取，但没有可用摘录` : ''
}

function implementationStepsForCapabilityDraft({ name = '', lesson = {}, plan = {}, sourceReads = [] } = {}) {
  const sourcePaths = unique(sourceReads.map(read => read.path).filter(Boolean))
  const localTargets = localTargetsForCapabilityDraft(name)
  const firstIdea = asText(lesson.capabilityIdeas?.[0] || name)
  const sourceStep = sourcePaths.length
    ? `对照 ${sourcePaths.slice(0, 3).join('、')} 的源码证据，提取状态机、工具接口和失败恢复分支。`
    : `先执行读取计划：${plan.nextCommand || lesson.nextAction || '补足 README、manifest 和源码入口证据。'}`
  return [
    sourceStep,
    `在 ${localTargets.slice(0, 2).join(' 和 ')} 建模「${name}」的输入、输出、风险和阶段记录。`,
    `把「${firstIdea}」落成 mission artifact、tool stage、review check 三件套，让用户首屏只看到自然结果。`,
    '补上中文命令与异步 mission 流测试，证明能力能从聊天入口直接触发。',
  ]
}

function reviewChecklistForCapabilityDraft(sourceReads = []) {
  return [
    sourceReads.length ? '有源码路径或目录证据支撑，不只停留在 README 判断。' : '源码证据不足时先保持草案状态，不进入实现。',
    '所有外部副作用都能被 risk、scope、reason 和 Guard trace 追踪。',
    '用户可见结果是自然语言和必要确认，不把内部审核清单堆在首屏。',
    '失败时给出下一步恢复动作，并在 review evidence 中保留来源。',
  ]
}

function capabilityDraftForLesson(lesson = {}, plan = {}, sourceReads = [], index = 0) {
  const name = capabilityDraftName(lesson.capabilityIdeas?.[0])
  const candidate = lesson.candidate || plan.candidate || `候选 ${index + 1}`
  const candidateReads = normalizeArray(sourceReads).filter(read => read.candidate === candidate)
  const okReads = candidateReads.filter(read => read.ok)
  const sourceEvidence = unique([
    ...normalizeArray(lesson.evidence).slice(0, 2),
    ...candidateReads.map(sourceEvidenceLineForDraft),
  ].filter(Boolean)).slice(0, 6)
  const localTargets = localTargetsForCapabilityDraft(name)
  const status = okReads.length ? 'draft-ready' : 'needs-source-evidence'
  return {
    candidate,
    htmlUrl: asText(lesson.htmlUrl || plan.htmlUrl, ''),
    title: `Vela 本地能力草案：${name}`,
    capability: name,
    status,
    sourceConfidence: okReads.length >= 2 || lesson.fit === 'high' ? 'high' : 'medium',
    sourcePaths: unique(candidateReads.map(read => read.path).filter(Boolean)),
    localTargets,
    implementationSteps: implementationStepsForCapabilityDraft({ name, lesson, plan, sourceReads: candidateReads }),
    permissionBoundary: permissionBoundaryForCapabilityDraft(name),
    reviewChecklist: reviewChecklistForCapabilityDraft(candidateReads),
    sourceEvidence,
    risks: normalizeArray(lesson.risks),
  }
}

function synthesizeRepoSearchCapabilityDrafts(lessons = [], readPlans = [], sourceReads = []) {
  return normalizeArray(lessons)
    .filter(lesson => lesson?.candidate)
    .map((lesson, index) => capabilityDraftForLesson(lesson, normalizeArray(readPlans)[index] || {}, sourceReads, index))
}

function repoSearchCapabilityDraftLine(draft = {}, index = 0) {
  const name = draft.title || `能力草案 ${index + 1}`
  const targets = draft.localTargets?.length ? `本地目标：${draft.localTargets.slice(0, 3).join('、')}` : ''
  const evidence = draft.sourcePaths?.length ? `源码：${draft.sourcePaths.slice(0, 4).join('、')}` : ''
  return [name, `status=${draft.status || 'unknown'}`, `confidence=${draft.sourceConfidence || 'unknown'}`, targets, evidence, draft.permissionBoundary].filter(Boolean).join('；')
}

async function analyzeSearchCandidate({
  repo,
  fetchJson,
  headers,
  signal,
  contentEntryLimit = DEFAULT_CONTENT_ENTRY_LIMIT,
} = {}) {
  const { owner, name } = repoApiParts(repo)
  const fullName = asText(repo.fullName, `${owner}/${name}`)
  const stages = []
  const failures = []
  const analysis = {
    fullName,
    htmlUrl: asText(repo.htmlUrl, owner && name ? `https://github.com/${owner}/${name}` : ''),
    description: asText(repo.description, ''),
    language: asText(repo.language, ''),
    topics: normalizeArray(repo.topics).map(item => asText(item)).filter(Boolean),
    license: asText(repo.license, ''),
    stars: Number(repo.stars || 0),
    forks: Number(repo.forks || 0),
    archived: repo.archived === true,
    readme: null,
    rootItems: [],
    sourceItems: [],
    entryPath: '',
    entryFile: null,
    failures,
  }
  if (!owner || !name) {
    failures.push({ tool: 'github.search.candidate.parse', reason: '候选仓库缺少 owner/name' })
    stages.push({
      tool: 'github.search.candidate.parse',
      status: 'failed',
      url: 'github://search-candidate/parse',
      summary: '候选仓库缺少 owner/name，跳过深读。',
      reason: '候选仓库缺少 owner/name',
    })
    return { analysis, stages }
  }

  const encodedOwner = encodeURIComponent(owner)
  const encodedRepo = encodeURIComponent(name)
  const repoUrl = `https://api.github.com/repos/${encodedOwner}/${encodedRepo}`
  const readmeResult = await readSearchCandidateContent({
    fetchJson,
    headers,
    signal,
    url: `${repoUrl}/readme`,
    tool: 'github.search.candidate.readme',
    pathLabel: 'README',
    request: { path: 'README', kind: 'readme' },
    entryLimit: contentEntryLimit,
  })
  stages.push(readmeResult.stage)
  if (readmeResult.ok) analysis.readme = readmeResult.compacted.detail
  else failures.push(readmeResult.failure)

  const rootResult = await readSearchCandidateContent({
    fetchJson,
    headers,
    signal,
    url: `${repoUrl}/contents`,
    tool: 'github.search.candidate.root',
    pathLabel: '/',
    request: { path: '', kind: 'directory' },
    entryLimit: contentEntryLimit,
  })
  stages.push(rootResult.stage)
  if (rootResult.ok) analysis.rootItems = rootResult.compacted.items
  else failures.push(rootResult.failure)

  const hasSrcDirectory = analysis.rootItems.some(item => item.type === 'dir' && (item.path || item.name) === 'src')
  if (hasSrcDirectory) {
    const srcResult = await readSearchCandidateContent({
      fetchJson,
      headers,
      signal,
      url: `${repoUrl}/contents/src`,
      tool: 'github.search.candidate.src',
      pathLabel: 'src',
      request: { path: 'src', kind: 'directory' },
      entryLimit: contentEntryLimit,
    })
    stages.push(srcResult.stage)
    if (srcResult.ok) analysis.sourceItems = srcResult.compacted.items
    else failures.push(srcResult.failure)
  }

  const entryPath = chooseEntryPath([...analysis.rootItems, ...analysis.sourceItems])
  analysis.entryPath = entryPath
  if (entryPath) {
    const entryResult = await readSearchCandidateContent({
      fetchJson,
      headers,
      signal,
      url: `${repoUrl}/contents/${encodeGitHubPath(entryPath)}`,
      tool: 'github.search.candidate.entry',
      pathLabel: entryPath,
      request: { path: entryPath, kind: 'file' },
      entryLimit: contentEntryLimit,
    })
    stages.push(entryResult.stage)
    if (entryResult.ok) analysis.entryFile = entryResult.compacted.detail
    else failures.push(entryResult.failure)
  }

  return { analysis, stages }
}

function repoLine(repo = {}) {
  const parts = [
    repo.description,
    repo.defaultBranch ? `默认分支 ${repo.defaultBranch}` : '',
    `${repo.stars} stars`,
    `${repo.forks} forks`,
    `${repo.openIssues} open issues`,
  ].filter(Boolean)
  return parts.join('，')
}

function issueLine(issue = {}) {
  const prefix = issue.isPullRequest ? 'PR' : 'Issue'
  const labels = issue.labels?.length ? ` [${issue.labels.join(', ')}]` : ''
  return `#${issue.number} ${issue.title}${labels}（${prefix}，${issue.state || 'unknown'}）`
}

function issueDetailLine(issue = {}) {
  const base = issueLine(issue)
  const body = issue.bodyExcerpt ? `正文摘录：${issue.bodyExcerpt}` : '没有正文摘录'
  const comments = Number.isFinite(issue.commentsCount) ? `评论数 ${issue.commentsCount}` : ''
  return [base, body, comments].filter(Boolean).join('；')
}

function commentLine(comment = {}, index = 0) {
  const author = comment.user || `评论 ${index + 1}`
  const body = comment.bodyExcerpt || '无评论正文'
  return `${author}：${body}`
}

function pullLine(pull = {}) {
  const branch = pull.base || pull.head ? `${pull.head || 'head'} -> ${pull.base || 'base'}` : ''
  const stats = `${pull.changedFiles} files, +${pull.additions}/-${pull.deletions}, ${pull.commits} commits`
  const flags = [pull.state, pull.draft ? 'draft' : '', pull.merged ? 'merged' : '', `mergeable ${pull.mergeable}`].filter(Boolean).join('，')
  return `PR #${pull.number} ${pull.title}（${[branch, stats, flags].filter(Boolean).join('；')}）`
}

function pullFileLine(file = {}, index = 0) {
  const name = file.filename || `文件 ${index + 1}`
  return `${name}（${file.status || 'changed'}，+${file.additions}/-${file.deletions}）`
}

function pullReviewLine(review = {}, index = 0) {
  const reviewer = review.user || `Review ${index + 1}`
  const body = review.bodyExcerpt ? `：${review.bodyExcerpt}` : ''
  return `${reviewer} ${review.state || 'reviewed'}${body}`
}

function contentItemLine(item = {}, index = 0) {
  const name = item.path || item.name || `条目 ${index + 1}`
  const size = item.size ? `，${item.size} bytes` : ''
  return `${item.type || 'item'} ${name}${size}`
}

function contentDetailLine(detail = {}) {
  const name = detail.path || detail.name || '仓库文件'
  const size = detail.size ? `，${detail.size} bytes` : ''
  const excerpt = detail.contentExcerpt ? `内容摘录：${detail.contentExcerpt}` : '没有可读内容摘录'
  return `${name}${size}；${excerpt}`
}

function searchRepoLine(repo = {}, index = 0) {
  const name = repo.fullName || repo.name || `候选 ${index + 1}`
  const language = repo.language ? `，${repo.language}` : ''
  const license = repo.license ? `，${repo.license}` : ''
  const topics = repo.topics?.length ? `，topics: ${repo.topics.slice(0, 4).join(', ')}` : ''
  const archived = repo.archived ? '，archived' : ''
  return `${name}（${repo.stars} stars，${repo.forks} forks${language}${license}${topics}${archived}）：${repo.description}`
}

function summarizeGitHubRead({
  repoSearchRequest = null,
  repoSearchResults = [],
  repoSearchAnalyses = [],
  repoSearchLessons = [],
  repoSearchReadPlans = [],
  repoSearchSourceReads = [],
  repoSearchCapabilityDrafts = [],
  repoSearchTotalCount = 0,
  repoSearchIncompleteResults = false,
  repo,
  issues = [],
  issueDetail = null,
  comments = [],
  pullDetail = null,
  pullFiles = [],
  pullReviews = [],
  contentRequest = null,
  contentDetail = null,
  contentItems = [],
  contentTotalItems = 0,
  contentTruncated = false,
  includeIssues = false,
  state = 'open',
  failures = [],
} = {}) {
  if (repoSearchRequest) {
    const failureReason = failures
      .filter(item => item.tool === 'github.search.repositories')
      .map(item => item.reason)
      .filter(Boolean)
      .join('；')
    if (failureReason) {
      return `GitHub 仓库搜索没有拿到可用结果。查询：${repoSearchRequest.query}。失败原因：${failureReason}。全程只读，没有 star、fork、评论、改仓库、提交或推送。`
    }
    const incomplete = repoSearchIncompleteResults ? 'GitHub 标记结果可能不完整。' : ''
    const resultSummary = repoSearchResults.length
      ? `本次列出 ${repoSearchResults.length}/${repoSearchTotalCount || repoSearchResults.length} 个候选：${repoSearchResults.map(searchRepoLine).join('；')}。`
      : '没有读到候选仓库。'
    const analysisSummary = repoSearchAnalyses.length
      ? `已深读 ${repoSearchAnalyses.length} 个候选：${repoSearchAnalyses.map(searchCandidateAnalysisLine).join('；')}。`
      : ''
    const lessonsSummary = repoSearchLessons.length
      ? `已提炼 ${repoSearchLessons.length} 条 Vela 开源吸收建议：${repoSearchLessons.map(repoSearchLessonLine).join('；')}。`
      : ''
    const readPlanSummary = repoSearchReadPlans.length
      ? `已生成 ${repoSearchReadPlans.length} 条后续源码读取计划：${repoSearchReadPlans.map(repoSearchReadPlanLine).join('；')}。`
      : ''
    const sourceReadSummary = repoSearchSourceReads.length
      ? `已按计划读取 ${repoSearchSourceReads.length} 个源码目标：${repoSearchSourceReads.map(repoSearchSourceReadLine).join('；')}。`
      : ''
    const draftSummary = repoSearchCapabilityDrafts.length
      ? `已形成 ${repoSearchCapabilityDrafts.length} 个 Vela 本地能力草案：${repoSearchCapabilityDrafts.map(repoSearchCapabilityDraftLine).join('；')}。`
      : ''
    return `已搜索 GitHub 仓库：${repoSearchRequest.query}（sort=${repoSearchRequest.sort || 'stars'}）。${resultSummary}${analysisSummary}${lessonsSummary}${readPlanSummary}${sourceReadSummary}${draftSummary}${incomplete}全程只读，没有 star、fork、评论、改仓库、提交或推送。`
  }
  if (!repo) {
    const reason = failures.map(item => item.reason || item.error).filter(Boolean).join('；')
    return `GitHub 只读执行没有拿到仓库数据。${reason ? `失败原因：${reason}` : '请提供 owner/repo 或 GitHub 仓库链接。'}`
  }
  const intro = `已读取 GitHub 仓库 ${repo.fullName}：${repoLine(repo)}。`
  if (contentRequest && !contentDetail && !contentItems.length) {
    const reason = failures
      .filter(item => /^github\.(?:contents|readme)/.test(item.tool))
      .map(item => item.reason)
      .filter(Boolean)
      .join('；')
    return `${intro}仓库内容读取没有拿到可用数据。${reason ? `失败原因：${reason}` : '请确认文件路径、目录或分支是否存在。'}全程只读，没有改文件、提交、推送、评论、合并或访问凭证。`
  }
  if (contentDetail || contentItems.length) {
    if (contentDetail) {
      return `${intro}已读取仓库文件：${contentDetailLine(contentDetail)}。全程只读，没有改文件、提交、推送、评论、合并或访问凭证。`
    }
    const pathLabel = contentRequest?.path ? `目录 ${contentRequest.path}` : '仓库根目录'
    const truncated = contentTruncated ? `；还有 ${Math.max(0, contentTotalItems - contentItems.length)} 项未展开` : ''
    return `${intro}已读取 ${pathLabel}，本次列出 ${contentItems.length}/${contentTotalItems || contentItems.length} 项${truncated}：${contentItems.map(contentItemLine).join('；')}。全程只读，没有改文件、提交、推送、评论、合并或访问凭证。`
  }
  if (pullDetail) {
    const filesSummary = pullFiles.length
      ? `已读取 ${pullFiles.length} 个改动文件：${pullFiles.map(pullFileLine).join('；')}。`
      : '没有读到改动文件列表。'
    const reviewsSummary = pullReviews.length
      ? `已读取 ${pullReviews.length} 条 PR review：${pullReviews.map(pullReviewLine).join('；')}。`
      : '没有读到 PR review。'
    const commentsSummary = comments.length
      ? `已读取 ${comments.length} 条 issue 讨论评论：${comments.map(commentLine).join('；')}。`
      : '没有读到 issue 讨论评论。'
    return `${intro}已读取 PR 详情：${pullLine(pullDetail)}。${filesSummary}${reviewsSummary}${commentsSummary}全程只读，没有写评论、改 PR、合并、推送代码或访问凭证。`
  }
  if (issueDetail) {
    const commentSummary = comments.length
      ? `已读取 ${comments.length} 条评论：${comments.map(commentLine).join('；')}。`
      : '没有读到评论内容。'
    return `${intro}已读取详情：${issueDetailLine(issueDetail)}。${commentSummary}全程只读，没有写评论、改 issue、合并 PR、推送代码或访问凭证。`
  }
  if (!includeIssues) return `${intro}本次只读取仓库元数据，没有执行写入、评论、合并、推送或状态变更。`
  const issueSummary = issues.length
    ? `已读取 ${state} issue/PR 列表，本次列出 ${issues.length} 项：${issues.map(issueLine).join('；')}。`
    : `没有读到 ${state} issue/PR 列表项。`
  return `${intro}${issueSummary}全程只读，没有写评论、改 issue、合并 PR、推送代码或访问凭证。`
}

function failureText(result = {}, label = 'GitHub request') {
  return asText(result.error || result.body?.message || result.body?.error, `${label} failed${result.status ? ` (${result.status})` : ''}`)
}

export async function readGitHubMission({
  mission = {},
  input = {},
  fetchJson,
  githubToken = '',
  token = '',
  apiVersion = DEFAULT_GITHUB_API_VERSION,
  issueLimit = DEFAULT_ISSUE_LIMIT,
  commentLimit = DEFAULT_COMMENT_LIMIT,
  pullFileLimit = DEFAULT_PR_FILE_LIMIT,
  pullReviewLimit = DEFAULT_PR_REVIEW_LIMIT,
  contentEntryLimit = DEFAULT_CONTENT_ENTRY_LIMIT,
  repoSearchLimit = DEFAULT_REPO_SEARCH_LIMIT,
  repoAnalysisLimit = DEFAULT_REPO_ANALYSIS_LIMIT,
  repoSourceReadLimit = DEFAULT_REPO_SOURCE_READ_LIMIT,
  signal,
} = {}) {
  const text = missionText(mission, input)
  const target = extractGitHubTarget(text)
  const repoSearchRequest = extractGitHubRepoSearchRequest(text)
  const stages = []
  const failures = []
  const authToken = asText(githubToken || token)
  const headers = headersForGitHub({ token: authToken, apiVersion })

  if (!target && repoSearchRequest) {
    const limit = Math.max(1, Math.min(Number(repoSearchLimit) || DEFAULT_REPO_SEARCH_LIMIT, 20))
    const searchParams = new URLSearchParams({
      q: repoSearchRequest.query,
      sort: repoSearchRequest.sort || 'stars',
      order: repoSearchRequest.order || 'desc',
      per_page: String(limit),
    })
    const searchUrl = `https://api.github.com/search/repositories?${searchParams.toString()}`
    const searchResult = await readJson(fetchJson, { url: searchUrl, headers, signal })
    let repoSearchResults = []
    let repoSearchAnalyses = []
    let repoSearchLessons = []
    let repoSearchReadPlans = []
    let repoSearchSourceReads = []
    let repoSearchCapabilityDrafts = []
    let repoSearchTotalCount = 0
    let repoSearchIncompleteResults = false
    if (searchResult.ok) {
      repoSearchResults = normalizeArray(searchResult.body?.items).map(compactSearchRepository)
      repoSearchTotalCount = Number(searchResult.body?.total_count || repoSearchResults.length || 0)
      repoSearchIncompleteResults = searchResult.body?.incomplete_results === true
      stages.push({
        tool: 'github.search.repositories',
        status: 'ok',
        url: searchUrl,
        summary: `搜索 GitHub 仓库成功：${repoSearchResults.length}/${repoSearchTotalCount || repoSearchResults.length} 个候选。`,
      })
      const numericAnalysisLimit = Number(repoAnalysisLimit)
      const requestedAnalysisLimit = Number.isFinite(numericAnalysisLimit) ? numericAnalysisLimit : DEFAULT_REPO_ANALYSIS_LIMIT
      const analysisLimit = Math.max(0, Math.min(requestedAnalysisLimit, repoSearchResults.length, 5))
      for (const repo of repoSearchResults.slice(0, analysisLimit)) {
        const candidate = await analyzeSearchCandidate({
          repo,
          fetchJson,
          headers,
          signal,
          contentEntryLimit,
        })
        repoSearchAnalyses.push(candidate.analysis)
        stages.push(...candidate.stages)
      }
      repoSearchLessons = synthesizeRepoSearchLessons(repoSearchAnalyses)
      repoSearchReadPlans = synthesizeRepoSearchReadPlans(repoSearchAnalyses, repoSearchLessons)
      if (repoSearchLessons.length) {
        stages.push({
          tool: 'github.search.lessons.synthesize',
          status: 'ok',
          url: 'github://search/lessons',
          summary: `已从 ${repoSearchLessons.length} 个候选仓库提炼 Vela 开源吸收建议。`,
        })
      }
      if (repoSearchReadPlans.length) {
        stages.push({
          tool: 'github.search.read-plan.synthesize',
          status: 'ok',
          url: 'github://search/read-plan',
          summary: `已生成 ${repoSearchReadPlans.length} 条后续源码读取计划。`,
        })
        const plannedReads = await readPlannedSourceTargets({
          plans: repoSearchReadPlans,
          analyses: repoSearchAnalyses,
          fetchJson,
          headers,
          signal,
          contentEntryLimit,
          sourceReadLimit: repoSourceReadLimit,
        })
        repoSearchSourceReads = plannedReads.reads
        stages.push(...plannedReads.stages)
      }
      repoSearchCapabilityDrafts = synthesizeRepoSearchCapabilityDrafts(repoSearchLessons, repoSearchReadPlans, repoSearchSourceReads)
      if (repoSearchCapabilityDrafts.length) {
        stages.push({
          tool: 'github.search.capability-draft.synthesize',
          status: 'ok',
          url: 'github://search/capability-drafts',
          summary: `已形成 ${repoSearchCapabilityDrafts.length} 个 Vela 本地能力草案。`,
        })
      }
    } else {
      const reason = failureText(searchResult, 'github.search.repositories')
      failures.push({ tool: 'github.search.repositories', url: searchUrl, reason, status: searchResult.status })
      stages.push({
        tool: 'github.search.repositories',
        status: 'failed',
        url: searchUrl,
        summary: `搜索 GitHub 仓库失败：${reason}`,
        reason,
      })
    }
    const summary = summarizeGitHubRead({
      repoSearchRequest,
      repoSearchResults,
      repoSearchAnalyses,
      repoSearchLessons,
      repoSearchReadPlans,
      repoSearchSourceReads,
      repoSearchCapabilityDrafts,
      repoSearchTotalCount,
      repoSearchIncompleteResults,
      failures,
    })
    const ok = !failures.some(item => item.tool === 'github.search.repositories')
    return {
      kind: 'mcp-github-read-result',
      ok,
      mode: 'github-repo-search',
      target: null,
      repo: null,
      issues: [],
      issueDetail: null,
      comments: [],
      pullDetail: null,
      pullFiles: [],
      pullReviews: [],
      contentRequest: null,
      contentDetail: null,
      contentItems: [],
      contentTotalItems: 0,
      contentTruncated: false,
      repoSearchRequest,
      repoSearchResults,
      repoSearchAnalyses,
      repoSearchLessons,
      repoSearchReadPlans,
      repoSearchSourceReads,
      repoSearchCapabilityDrafts,
      repoSearchTotalCount,
      repoSearchIncompleteResults,
      sourceTools: unique(stages.map(stage => stage.tool)),
      failures,
      stages,
      summary,
      evidence: [
        `GitHub 仓库搜索：${repoSearchRequest.query}（sort=${repoSearchRequest.sort || 'stars'}，order=${repoSearchRequest.order || 'desc'}）`,
        ...stages.map(stage => `${stage.tool} ${stage.status}：${stage.url}（${stage.reason || stage.summary}）`),
        ...repoSearchResults.map((repo, index) => `候选仓库 ${index + 1}：${searchRepoLine(repo, index)} ${repo.htmlUrl}`.trim()),
        ...repoSearchAnalyses.map((analysis, index) => `候选深读 ${index + 1}：${searchCandidateAnalysisLine(analysis, index)} ${analysis.htmlUrl}`.trim()),
        ...repoSearchLessons.map((lesson, index) => `候选吸收建议 ${index + 1}：${repoSearchLessonLine(lesson, index)} ${lesson.htmlUrl}`.trim()),
        ...repoSearchReadPlans.map((plan, index) => `候选读取计划 ${index + 1}：${repoSearchReadPlanLine(plan, index)} ${plan.htmlUrl}`.trim()),
        ...repoSearchSourceReads.map((read, index) => `候选源码证据 ${index + 1}：${repoSearchSourceReadLine(read, index)} ${read.htmlUrl}`.trim()),
        ...repoSearchCapabilityDrafts.map((draft, index) => `Vela 能力草案 ${index + 1}：${repoSearchCapabilityDraftLine(draft, index)} ${draft.htmlUrl}`.trim()),
        ...failures.map(item => `GitHub 搜索失败：${item.tool} ${item.url}（${item.reason}）`),
        '只读边界：未 star、未 fork、未写评论、未改仓库、未提交、未推送代码、未读取本地凭证。',
      ].filter(Boolean),
    }
  }

  if (!target) {
    const summary = 'GitHub 只读执行需要明确仓库，例如 owner/repo 或 https://github.com/owner/repo。'
    return {
      kind: 'mcp-github-read-result',
      ok: false,
      mode: 'github',
      repo: null,
      issues: [],
      sourceTools: ['github.target.parse'],
      failures: [{ tool: 'github.target.parse', reason: summary }],
      stages: [{
        tool: 'github.target.parse',
        status: 'failed',
        url: 'github://target-missing',
        summary,
        reason: summary,
      }],
      summary,
      evidence: [summary],
    }
  }

  const encodedOwner = encodeURIComponent(target.owner)
  const encodedRepo = encodeURIComponent(target.repo)
  const repoUrl = `https://api.github.com/repos/${encodedOwner}/${encodedRepo}`
  const repoResult = await readJson(fetchJson, { url: repoUrl, headers, signal })
  let repo = null

  if (repoResult.ok) {
    repo = compactRepo(repoResult.body, target)
    stages.push({
      tool: 'github.repo.get',
      status: 'ok',
      url: repoUrl,
      summary: `读取仓库 ${repo.fullName} 成功。`,
    })
  } else {
    const reason = failureText(repoResult, 'github.repo.get')
    failures.push({ tool: 'github.repo.get', url: repoUrl, reason, status: repoResult.status })
    stages.push({
      tool: 'github.repo.get',
      status: 'failed',
      url: repoUrl,
      summary: `读取仓库失败：${reason}`,
      reason,
    })
  }

  const includeIssues = wantsIssues(text)
  const pullNumber = target.pullNumber || extractGitHubPullNumber(text)
  const issueNumber = target.issueNumber || extractGitHubIssueNumber(text)
  const contentRequest = extractGitHubContentRequest(text)
  const state = issueStateForText(text)
  let issues = []
  let issueDetail = null
  let comments = []
  let pullDetail = null
  let pullFiles = []
  let pullReviews = []
  let contentDetail = null
  let contentItems = []
  let contentTotalItems = 0
  let contentTruncated = false

  if (repo && pullNumber) {
    const pullUrl = `${repoUrl}/pulls/${pullNumber}`
    const pullResult = await readJson(fetchJson, { url: pullUrl, headers, signal })
    if (pullResult.ok) {
      pullDetail = compactPull(pullResult.body)
      stages.push({
        tool: 'github.pull.get',
        status: 'ok',
        url: pullUrl,
        summary: `读取 PR #${pullNumber} 详情成功。`,
      })
    } else {
      const reason = failureText(pullResult, 'github.pull.get')
      failures.push({ tool: 'github.pull.get', url: pullUrl, reason, status: pullResult.status })
      stages.push({
        tool: 'github.pull.get',
        status: 'failed',
        url: pullUrl,
        summary: `读取 PR #${pullNumber} 详情失败：${reason}`,
        reason,
      })
    }

    if (pullDetail) {
      const fileLimit = Math.max(1, Math.min(Number(pullFileLimit) || DEFAULT_PR_FILE_LIMIT, 30))
      const filesUrl = `${pullUrl}/files?per_page=${fileLimit}`
      const filesResult = await readJson(fetchJson, { url: filesUrl, headers, signal })
      if (filesResult.ok) {
        pullFiles = normalizeArray(filesResult.body).map(compactPullFile)
        stages.push({
          tool: 'github.pull.files.list',
          status: 'ok',
          url: filesUrl,
          summary: `读取 PR #${pullNumber} 改动文件成功：${pullFiles.length} 个。`,
        })
      } else {
        const reason = failureText(filesResult, 'github.pull.files.list')
        failures.push({ tool: 'github.pull.files.list', url: filesUrl, reason, status: filesResult.status })
        stages.push({
          tool: 'github.pull.files.list',
          status: 'failed',
          url: filesUrl,
          summary: `读取 PR #${pullNumber} 改动文件失败：${reason}`,
          reason,
        })
      }

      const reviewLimit = Math.max(1, Math.min(Number(pullReviewLimit) || DEFAULT_PR_REVIEW_LIMIT, 20))
      const reviewsUrl = `${pullUrl}/reviews?per_page=${reviewLimit}`
      const reviewsResult = await readJson(fetchJson, { url: reviewsUrl, headers, signal })
      if (reviewsResult.ok) {
        pullReviews = normalizeArray(reviewsResult.body).map(compactPullReview)
        stages.push({
          tool: 'github.pull.reviews.list',
          status: 'ok',
          url: reviewsUrl,
          summary: `读取 PR #${pullNumber} review 成功：${pullReviews.length} 条。`,
        })
      } else {
        const reason = failureText(reviewsResult, 'github.pull.reviews.list')
        failures.push({ tool: 'github.pull.reviews.list', url: reviewsUrl, reason, status: reviewsResult.status })
        stages.push({
          tool: 'github.pull.reviews.list',
          status: 'failed',
          url: reviewsUrl,
          summary: `读取 PR #${pullNumber} review 失败：${reason}`,
          reason,
        })
      }

      const limit = Math.max(1, Math.min(Number(commentLimit) || DEFAULT_COMMENT_LIMIT, 20))
      const commentsUrl = `${repoUrl}/issues/${pullNumber}/comments?per_page=${limit}`
      const commentsResult = await readJson(fetchJson, { url: commentsUrl, headers, signal })
      if (commentsResult.ok) {
        comments = normalizeArray(commentsResult.body).map(compactComment)
        stages.push({
          tool: 'github.issue.comments.list',
          status: 'ok',
          url: commentsUrl,
          summary: `读取 PR #${pullNumber} issue 讨论评论成功：${comments.length} 条。`,
        })
      } else {
        const reason = failureText(commentsResult, 'github.issue.comments.list')
        failures.push({ tool: 'github.issue.comments.list', url: commentsUrl, reason, status: commentsResult.status })
        stages.push({
          tool: 'github.issue.comments.list',
          status: 'failed',
          url: commentsUrl,
          summary: `读取 PR #${pullNumber} issue 讨论评论失败：${reason}`,
          reason,
        })
      }
    }
  } else if (repo && issueNumber) {
    const issueUrl = `${repoUrl}/issues/${issueNumber}`
    const issueResult = await readJson(fetchJson, { url: issueUrl, headers, signal })
    if (issueResult.ok) {
      issueDetail = compactIssue(issueResult.body)
      stages.push({
        tool: 'github.issue.get',
        status: 'ok',
        url: issueUrl,
        summary: `读取 issue/PR #${issueNumber} 详情成功。`,
      })
    } else {
      const reason = failureText(issueResult, 'github.issue.get')
      failures.push({ tool: 'github.issue.get', url: issueUrl, reason, status: issueResult.status })
      stages.push({
        tool: 'github.issue.get',
        status: 'failed',
        url: issueUrl,
        summary: `读取 issue/PR #${issueNumber} 详情失败：${reason}`,
        reason,
      })
    }

    if (issueDetail) {
      const limit = Math.max(1, Math.min(Number(commentLimit) || DEFAULT_COMMENT_LIMIT, 20))
      const commentsUrl = `${issueUrl}/comments?per_page=${limit}`
      const commentsResult = await readJson(fetchJson, { url: commentsUrl, headers, signal })
      if (commentsResult.ok) {
        comments = normalizeArray(commentsResult.body).map(compactComment)
        stages.push({
          tool: 'github.issue.comments.list',
          status: 'ok',
          url: commentsUrl,
          summary: `读取 issue/PR #${issueNumber} 评论成功：${comments.length} 条。`,
        })
      } else {
        const reason = failureText(commentsResult, 'github.issue.comments.list')
        failures.push({ tool: 'github.issue.comments.list', url: commentsUrl, reason, status: commentsResult.status })
        stages.push({
          tool: 'github.issue.comments.list',
          status: 'failed',
          url: commentsUrl,
          summary: `读取 issue/PR #${issueNumber} 评论失败：${reason}`,
          reason,
        })
      }
    }
  } else if (repo && contentRequest) {
    const isReadme = contentRequest.kind === 'readme'
    const pathPart = isReadme ? 'readme' : `contents${contentRequest.path ? `/${encodeGitHubPath(contentRequest.path)}` : ''}`
    const refPart = contentRequest.ref ? `?ref=${encodeURIComponent(contentRequest.ref)}` : ''
    const contentUrl = `${repoUrl}/${pathPart}${refPart}`
    const contentResult = await readJson(fetchJson, { url: contentUrl, headers, signal })
    const tool = isReadme ? 'github.readme.get' : 'github.contents.get'
    if (contentResult.ok) {
      const compacted = compactContentResult(contentResult.body, contentRequest, contentEntryLimit)
      contentDetail = compacted.detail
      contentItems = compacted.items
      contentTotalItems = compacted.totalItems
      contentTruncated = compacted.truncated
      stages.push({
        tool,
        status: 'ok',
        url: contentUrl,
        summary: contentDetail
          ? `读取仓库文件 ${contentDetail.path || contentRequest.path || 'README'} 成功。`
          : `读取仓库目录 ${contentRequest.path || '/'} 成功：${contentItems.length}/${contentTotalItems || contentItems.length} 项。`,
      })
    } else {
      const reason = failureText(contentResult, tool)
      failures.push({ tool, url: contentUrl, reason, status: contentResult.status })
      stages.push({
        tool,
        status: 'failed',
        url: contentUrl,
        summary: `读取仓库内容 ${contentRequest.path || 'README'} 失败：${reason}`,
        reason,
      })
    }
  } else if (repo && includeIssues) {
    const limit = Math.max(1, Math.min(Number(issueLimit) || DEFAULT_ISSUE_LIMIT, 20))
    const issuesUrl = `${repoUrl}/issues?state=${encodeURIComponent(state)}&per_page=${limit}`
    const issuesResult = await readJson(fetchJson, { url: issuesUrl, headers, signal })
    if (issuesResult.ok) {
      issues = normalizeArray(issuesResult.body).map(compactIssue)
      stages.push({
        tool: 'github.issues.list',
        status: 'ok',
        url: issuesUrl,
        summary: `读取 ${state} issue/PR 列表成功：${issues.length} 项。`,
      })
    } else {
      const reason = failureText(issuesResult, 'github.issues.list')
      failures.push({ tool: 'github.issues.list', url: issuesUrl, reason, status: issuesResult.status })
      stages.push({
        tool: 'github.issues.list',
        status: 'failed',
        url: issuesUrl,
        summary: `读取 issue/PR 列表失败：${reason}`,
        reason,
      })
    }
  }

  const summary = summarizeGitHubRead({
    repo,
    issues,
    issueDetail,
    comments,
    pullDetail,
    pullFiles,
    pullReviews,
    contentRequest,
    contentDetail,
    contentItems,
    contentTotalItems,
    contentTruncated,
    includeIssues,
    state,
    failures,
  })
  const ok = !!repo
    && (!pullNumber || (!!pullDetail && !failures.some(item => /^github\.(?:pull|issue\.comments)/.test(item.tool))))
    && (!issueNumber || (!!issueDetail && !failures.some(item => item.tool === 'github.issue.comments.list')))
    && (!contentRequest || ((!!contentDetail || contentItems.length > 0) && !failures.some(item => /^github\.(?:contents|readme)/.test(item.tool))))
    && (!includeIssues || !!pullNumber || !!issueNumber || !failures.some(item => item.tool === 'github.issues.list'))
  const sourceTools = unique(stages.map(stage => stage.tool))
  return {
    kind: 'mcp-github-read-result',
    ok,
    mode: pullNumber ? 'github-pull-detail' : (issueNumber ? 'github-issue-detail' : (contentRequest ? 'github-content' : (includeIssues ? 'github-issues' : 'github-repo'))),
    target,
    repo,
    issues,
    issueDetail,
    comments,
    pullDetail,
    pullFiles,
    pullReviews,
    contentRequest,
    contentDetail,
    contentItems,
    contentTotalItems,
    contentTruncated,
    sourceTools,
    failures,
    stages,
    summary,
    evidence: [
      target ? `GitHub 目标：${target.owner}/${target.repo}（${target.source}）` : '',
      repo ? `仓库：${repo.fullName} ${repo.htmlUrl}` : '',
      ...stages.map(stage => `${stage.tool} ${stage.status}：${stage.url}（${stage.reason || stage.summary}）`),
      ...issues.map(issue => `${issueLine(issue)} ${issue.htmlUrl}`.trim()),
      issueDetail ? `${issueDetailLine(issueDetail)} ${issueDetail.htmlUrl}`.trim() : '',
      pullDetail ? `${pullLine(pullDetail)} ${pullDetail.htmlUrl}`.trim() : '',
      ...pullFiles.map((file, index) => `PR 文件 ${index + 1}：${pullFileLine(file, index)} ${file.blobUrl}`.trim()),
      ...pullReviews.map((review, index) => `PR review ${index + 1}：${pullReviewLine(review, index)} ${review.htmlUrl}`.trim()),
      contentDetail ? `仓库文件：${contentDetailLine(contentDetail)} ${contentDetail.htmlUrl}`.trim() : '',
      ...contentItems.map((item, index) => `仓库目录项 ${index + 1}：${contentItemLine(item, index)} ${item.htmlUrl}`.trim()),
      ...comments.map((comment, index) => `评论 ${index + 1}：${commentLine(comment, index)} ${comment.htmlUrl}`.trim()),
      ...failures.map(item => `GitHub 读取失败：${item.tool} ${item.url}（${item.reason}）`),
      '只读边界：未写评论、未改 issue/PR/文件、未合并 PR、未推送代码、未读取本地凭证。',
    ].filter(Boolean),
  }
}
