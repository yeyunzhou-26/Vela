const DEFAULT_GITHUB_API_VERSION = '2022-11-28'
const DEFAULT_ISSUE_LIMIT = 5
const DEFAULT_COMMENT_LIMIT = 5
const DEFAULT_PR_FILE_LIMIT = 12
const DEFAULT_PR_REVIEW_LIMIT = 5
const DEFAULT_CONTENT_ENTRY_LIMIT = 20
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

function summarizeGitHubRead({
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
  signal,
} = {}) {
  const text = missionText(mission, input)
  const target = extractGitHubTarget(text)
  const stages = []
  const failures = []

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

  const authToken = asText(githubToken || token)
  const headers = headersForGitHub({ token: authToken, apiVersion })
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
