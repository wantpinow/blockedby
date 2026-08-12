/**
 * linear-viz API core — shared by the production server (server.mjs) and the
 * vite dev plugin. Talks to Linear's GraphQL API, transforms responses into
 * lean snapshots, and keeps a disk cache (~/.cache/linear-viz) so pages can
 * paint instantly from the last known state while fresh data loads behind.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const APP_ROOT = path.resolve(here, '..')
export const CACHE_DIR = path.join(os.homedir(), '.cache', 'linear-viz')
export const VERSION = '0.1.0'

const LINEAR_URL = 'https://api.linear.app/graphql'

// ---------------------------------------------------------------- token

function parseDotEnv(file) {
  try {
    const out = {}
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    return out
  } catch {
    return {}
  }
}

let cachedToken = null
export function loadToken() {
  if (cachedToken) return cachedToken
  const fromEnv = process.env.LINEAR_API_KEY
  const fromFile = parseDotEnv(path.join(APP_ROOT, '.env')).LINEAR_API_KEY
  cachedToken = (fromEnv || fromFile || '').trim()
  if (!cachedToken) {
    throw new Error(`LINEAR_API_KEY not set — expected it in ${path.join(APP_ROOT, '.env')}`)
  }
  return cachedToken
}

// ---------------------------------------------------------------- graphql

async function gql(query, variables = {}) {
  const res = await fetch(LINEAR_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: loadToken(),
    },
    body: JSON.stringify({ query, variables }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body || body.errors) {
    const msg = body?.errors?.[0]?.message ?? `HTTP ${res.status}`
    const err = new Error(`Linear API: ${msg}`)
    err.status = res.status === 200 ? 400 : res.status
    throw err
  }
  return body.data
}

// ---------------------------------------------------------------- cache

function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
}

function cachePath(name) {
  return path.join(CACHE_DIR, `${name}.json`)
}

function readCache(name) {
  try {
    return JSON.parse(fs.readFileSync(cachePath(name), 'utf8'))
  } catch {
    return null
  }
}

function writeCache(name, data) {
  ensureCacheDir()
  const tmp = cachePath(`.${name}.tmp`)
  fs.writeFileSync(tmp, JSON.stringify(data))
  fs.renameSync(tmp, cachePath(name))
}

function readAliases() {
  return readCache('aliases') ?? {}
}

function addAlias(ref, id) {
  const a = readAliases()
  if (a[ref] !== id) {
    a[ref] = id
    writeCache('aliases', a)
  }
}

// ---------------------------------------------------------------- queries

const PROJECT_FIELDS = `
  id name slugId color icon state progress url targetDate startedAt completedAt updatedAt
  lead { id name displayName avatarUrl initials }
`

const ISSUE_PAGE = `
  query ProjectIssues($id: String!, $after: String) {
    project(id: $id) {
      ${PROJECT_FIELDS}
      issues(first: 50, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id identifier title url priority priorityLabel estimate description
          createdAt updatedAt startedAt completedAt canceledAt
          state { id name color type position }
          assignee { id name displayName avatarUrl initials }
          labels(first: 12) { nodes { id name color } }
          relations(first: 25) { nodes { type relatedIssue { id } } }
          inverseRelations(first: 25) { nodes { type issue { id } } }
          parent { id }
        }
      }
    }
  }
`

const PROJECTS_LIST = `
  query Projects($after: String) {
    projects(first: 100, after: $after, orderBy: updatedAt) {
      pageInfo { hasNextPage endCursor }
      nodes { ${PROJECT_FIELDS} }
    }
  }
`

// ---------------------------------------------------------------- fetchers

export async function fetchProjects() {
  const projects = []
  let after = null
  for (let page = 0; page < 3; page++) {
    const d = await gql(PROJECTS_LIST, { after })
    projects.push(...d.projects.nodes)
    if (!d.projects.pageInfo.hasNextPage) break
    after = d.projects.pageInfo.endCursor
  }
  const snapshot = {
    fetchedAt: new Date().toISOString(),
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      slugId: p.slugId,
      color: p.color,
      icon: p.icon,
      state: p.state,
      progress: p.progress ?? 0,
      url: p.url,
      targetDate: p.targetDate,
      updatedAt: p.updatedAt,
      lead: person(p.lead),
    })),
  }
  writeCache('projects', snapshot)
  for (const p of snapshot.projects) addAlias(p.slugId, p.id)
  return snapshot
}

function person(u) {
  if (!u) return null
  return {
    id: u.id,
    name: u.displayName || u.name,
    avatarUrl: u.avatarUrl ?? null,
    initials: u.initials ?? (u.displayName || u.name || '?').slice(0, 2).toUpperCase(),
  }
}

/**
 * Accepts a project UUID, a slugId (trailing hex of the project URL), a full
 * project slug ("my-project-abc123"), a pasted Linear URL, or a name fragment.
 * Returns the canonical project id or throws with candidates listed.
 */
export async function resolveRef(ref) {
  let r = decodeURIComponent(String(ref ?? '')).trim()
  if (!r) throw Object.assign(new Error('no project ref given'), { status: 400 })

  // pasted URL → path segment after /project/
  const urlMatch = /linear\.app\/[^/]+\/project\/([^/?#]+)/.exec(r)
  if (urlMatch) r = urlMatch[1]

  // full slug → trailing hex id
  const slugMatch = /-([0-9a-f]{8,})$/.exec(r)
  const candidates = [r]
  if (slugMatch) candidates.unshift(slugMatch[1])

  const aliases = readAliases()
  for (const c of candidates) {
    if (aliases[c]) return aliases[c]
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) return c
  }

  // try direct lookup (Linear accepts UUID or slugId here)
  for (const c of candidates) {
    if (/^[0-9a-f]{6,}$/i.test(c)) {
      try {
        const d = await gql(`query R($id: String!) { project(id: $id) { id slugId } }`, { id: c })
        addAlias(c, d.project.id)
        return d.project.id
      } catch {
        /* fall through to name search */
      }
    }
  }

  // name search against the (possibly cached) project list
  let list = readCache('projects')
  if (!list) list = await fetchProjects()
  const q = r.toLowerCase()
  const matches = list.projects.filter(
    (p) => p.name.toLowerCase().includes(q) || p.slugId.startsWith(q),
  )
  if (matches.length === 1) {
    addAlias(r, matches[0].id)
    return matches[0].id
  }
  const err = new Error(
    matches.length === 0
      ? `no project matches "${r}"`
      : `"${r}" is ambiguous: ${matches.map((m) => m.name).join(', ')}`,
  )
  err.status = 404
  throw err
}

export async function fetchProject(id) {
  const issues = []
  let projectMeta = null
  let after = null
  for (let page = 0; page < 10; page++) {
    const d = await gql(ISSUE_PAGE, { id, after })
    projectMeta = d.project
    issues.push(...d.project.issues.nodes)
    if (!d.project.issues.pageInfo.hasNextPage) break
    after = d.project.issues.pageInfo.endCursor
  }

  const inProject = new Set(issues.map((i) => i.id))
  const states = {}
  const transformed = issues.map((i) => {
    if (i.state) states[i.state.id] = i.state
    // "A blocks B": relations where type=blocks (this issue → relatedIssue),
    // plus inverseRelations type=blocks (other issue → this one).
    const blocks = new Set(
      i.relations.nodes
        .filter((x) => x.type === 'blocks' && x.relatedIssue && inProject.has(x.relatedIssue.id))
        .map((x) => x.relatedIssue.id),
    )
    return {
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      url: i.url,
      priority: i.priority ?? 0,
      priorityLabel: i.priorityLabel,
      estimate: i.estimate ?? null,
      description: i.description ?? null,
      stateId: i.state?.id ?? null,
      assignee: person(i.assignee),
      labels: i.labels.nodes.map((l) => ({ name: l.name, color: l.color })),
      blocks: [...blocks],
      blockedBy: i.inverseRelations.nodes
        .filter((x) => x.type === 'blocks' && x.issue && inProject.has(x.issue.id))
        .map((x) => x.issue.id),
      parentId: i.parent?.id ?? null,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
      startedAt: i.startedAt,
      completedAt: i.completedAt,
      canceledAt: i.canceledAt,
    }
  })

  const snapshot = {
    fetchedAt: new Date().toISOString(),
    project: {
      id: projectMeta.id,
      name: projectMeta.name,
      slugId: projectMeta.slugId,
      color: projectMeta.color,
      icon: projectMeta.icon,
      state: projectMeta.state,
      progress: projectMeta.progress ?? 0,
      url: projectMeta.url,
      targetDate: projectMeta.targetDate,
      updatedAt: projectMeta.updatedAt,
      lead: person(projectMeta.lead),
    },
    states,
    issues: transformed,
  }
  writeCache(`project-${projectMeta.id}`, snapshot)
  addAlias(projectMeta.slugId, projectMeta.id)
  return snapshot
}

export function cachedProject(ref) {
  const aliases = readAliases()
  const id = aliases[ref] ?? ref
  return readCache(`project-${id}`)
}

export function cachedProjects() {
  return readCache('projects')
}

// ---------------------------------------------------------------- handler

function sendJson(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(body)
}

/** connect-style handler covering /api/* — used by server.mjs and vite dev */
export function createApiHandler({ onShutdown } = {}) {
  return async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://local')
    const p = url.pathname
    try {
      if (p === '/api/health') {
        return sendJson(res, 200, { ok: true, app: 'linear-viz', version: VERSION })
      }
      if (p === '/api/projects') {
        if (url.searchParams.get('fresh') === '1') {
          return sendJson(res, 200, await fetchProjects())
        }
        const cached = cachedProjects()
        if (cached) return sendJson(res, 200, cached)
        return sendJson(res, 200, await fetchProjects())
      }
      const m = /^\/api\/project\/([^/]+)$/.exec(p)
      if (m) {
        const id = await resolveRef(m[1])
        if (url.searchParams.get('fresh') === '1') {
          return sendJson(res, 200, await fetchProject(id))
        }
        const cached = cachedProject(id)
        if (cached) return sendJson(res, 200, cached)
        return sendJson(res, 200, await fetchProject(id))
      }
      if (p === '/api/shutdown' && req.method === 'POST') {
        sendJson(res, 200, { ok: true })
        if (onShutdown) setTimeout(onShutdown, 50)
        return
      }
      if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' })
      return next()
    } catch (err) {
      return sendJson(res, err.status ?? 500, { error: String(err.message ?? err) })
    }
  }
}
