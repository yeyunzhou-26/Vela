const DEFAULT_GITHUB_API_VERSION = '2022-11-28'
const DEFAULT_ISSUE_LIMIT = 5

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

function hasGitHubContext(text = '') {
  return /(?:github|repo|repository|仓库|issue|issues|议题|pull request|pr\b|拉取请求)/i.test(text)
}

export function extractGitHubTarget(value = '') {
  const text = asText(value)
  if (!text) return null

  const urlMatch = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([a-z0-9_.-]+)\/([a-z0-9_.-]+)(?:\.git)?(?:[/?#][^\s，。；、）)]*)?/i)
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: cleanRepoName(urlMatch[2]),
      source: 'github-url',
    }
  }

  if (!hasGitHubContext(text)) return null
  const slugMatch = text.match(/\b([a-z0-9][a-z0-9-]{0,38})\/([a-z0-9._-]+)(?:\.git)?\b/i)
  if (!slugMatch) return null
  return {
    owner: slugMatch[1],
    repo: cleanRepoName(slugMatch[2]),
    source: 'owner-repo',
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
  return {
    ok: true,
    status: Number(value.status) || 200,
    url,
    body: value.body ?? value.data ?? value,
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
    updatedAt: asText(issue.updated_at, ''),
    isPullRequest: !!issue.pull_request,
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

function summarizeGitHubRead({ repo, issues = [], includeIssues = false, state = 'open', failures = [] } = {}) {
  if (!repo) {
    const reason = failures.map(item => item.reason || item.error).filter(Boolean).join('；')
    return `GitHub 只读执行没有拿到仓库数据。${reason ? `失败原因：${reason}` : '请提供 owner/repo 或 GitHub 仓库链接。'}`
  }
  const intro = `已读取 GitHub 仓库 ${repo.fullName}：${repoLine(repo)}。`
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
  const state = issueStateForText(text)
  let issues = []

  if (repo && includeIssues) {
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

  const summary = summarizeGitHubRead({ repo, issues, includeIssues, state, failures })
  const ok = !!repo && (!includeIssues || !failures.some(item => item.tool === 'github.issues.list'))
  const sourceTools = unique(stages.map(stage => stage.tool))
  return {
    kind: 'mcp-github-read-result',
    ok,
    mode: includeIssues ? 'github-issues' : 'github-repo',
    target,
    repo,
    issues,
    sourceTools,
    failures,
    stages,
    summary,
    evidence: [
      target ? `GitHub 目标：${target.owner}/${target.repo}（${target.source}）` : '',
      repo ? `仓库：${repo.fullName} ${repo.htmlUrl}` : '',
      ...stages.map(stage => `${stage.tool} ${stage.status}：${stage.url}（${stage.reason || stage.summary}）`),
      ...issues.map(issue => `${issueLine(issue)} ${issue.htmlUrl}`.trim()),
      ...failures.map(item => `GitHub 读取失败：${item.tool} ${item.url}（${item.reason}）`),
      '只读边界：未写评论、未改 issue、未合并 PR、未推送代码、未读取本地凭证。',
    ].filter(Boolean),
  }
}
