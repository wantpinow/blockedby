/**
 * Browser-side Linear client. Talks straight to api.linear.app (their API
 * serves CORS for exactly this), transforms responses into lean snapshots,
 * and keeps them in IndexedDB so revisits paint instantly while fresh data
 * revalidates in the background.
 */
import { kvGet, kvSet } from './idb'
import * as vault from './vault'
import type {
  MineSnapshot,
  Person,
  ProjectSnapshot,
  ProjectsSnapshot,
  WorkflowState,
} from '../types'

const LINEAR_URL = 'https://api.linear.app/graphql'

export class AuthError extends Error {}

let token: string | null = null
let authErrorHandler: (() => void) | null = null

export function setAuthErrorHandler(fn: () => void): void {
  authErrorHandler = fn
}

/** load the stored key into memory; false = no key, show the welcome screen */
export async function initToken(): Promise<boolean> {
  token = await vault.loadToken()
  return token !== null
}

/** validate + adopt a freshly pasted key */
export async function adoptToken(key: string): Promise<void> {
  token = key
  await vault.saveToken(key)
}

export async function forgetToken(): Promise<void> {
  token = null
  await vault.clearToken()
}

// ---------------------------------------------------------------- graphql

interface GqlError {
  message?: string
  extensions?: { type?: string; code?: string }
}

async function gql<T>(query: string, variables: Record<string, unknown>, keyOverride?: string): Promise<T> {
  const auth = keyOverride ?? token
  if (!auth) {
    authErrorHandler?.()
    throw new AuthError('no API key')
  }
  let res: Response
  try {
    res = await fetch(LINEAR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ query, variables }),
    })
  } catch {
    throw new Error('network unreachable')
  }
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: GqlError[] } | null
  const authFailed =
    res.status === 401 ||
    body?.errors?.some((e) =>
      /authentication/i.test(`${e.extensions?.type ?? ''} ${e.extensions?.code ?? ''} ${e.message ?? ''}`),
    )
  if (authFailed) {
    if (!keyOverride) authErrorHandler?.()
    throw new AuthError('Linear rejected the API key')
  }
  if (!res.ok || !body?.data || body.errors?.length) {
    throw new Error(body?.errors?.[0]?.message ?? `Linear API error (HTTP ${res.status})`)
  }
  return body.data
}

// ---------------------------------------------------------------- queries

const PROJECT_FIELDS = `
  id name slugId color icon state progress url targetDate startedAt completedAt updatedAt
  lead { id name displayName avatarUrl initials }
  teams(first: 6) { nodes { id name key color } }
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

const VIEWER = `query { viewer { id name displayName email avatarUrl initials organization { name } } }`

const MINE = `
  query Mine($userId: ID, $after: String) {
    issues(
      first: 250
      after: $after
      orderBy: updatedAt
      filter: { assignee: { id: { eq: $userId } } }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes { project { id } }
    }
  }
`

export interface Viewer {
  id: string
  name: string
  email: string
  org: string
  avatarUrl: string | null
  initials: string
}

function viewerOf(d: any): Viewer {
  return {
    id: d.viewer.id,
    name: d.viewer.displayName || d.viewer.name,
    email: d.viewer.email,
    org: d.viewer.organization.name,
    avatarUrl: d.viewer.avatarUrl ?? null,
    initials: (d.viewer.initials ?? String(d.viewer.displayName || '?').slice(0, 2)).toUpperCase(),
  }
}

/** used by the welcome screen — checks a pasted key before storing it */
export async function validateKey(key: string): Promise<Viewer> {
  return viewerOf(await gql<any>(VIEWER, {}, key))
}

/** who the stored key belongs to — refreshed on boot, cached in IDB */
export async function fetchViewer(): Promise<Viewer> {
  const v = viewerOf(await gql<any>(VIEWER, {}))
  await kvSet('viewer', v)
  return v
}

// ---------------------------------------------------------------- helpers

/* eslint-disable @typescript-eslint/no-explicit-any */
function person(u: any): Person | null {
  if (!u) return null
  return {
    id: u.id,
    name: u.displayName || u.name,
    avatarUrl: u.avatarUrl ?? null,
    initials: u.initials ?? String(u.displayName || u.name || '?').slice(0, 2).toUpperCase(),
  }
}

function projectInfo(p: any) {
  return {
    id: p.id as string,
    name: p.name as string,
    slugId: p.slugId as string,
    color: p.color as string,
    icon: (p.icon ?? null) as string | null,
    state: p.state as string,
    progress: (p.progress ?? 0) as number,
    url: p.url as string,
    targetDate: (p.targetDate ?? null) as string | null,
    updatedAt: p.updatedAt as string,
    lead: person(p.lead),
    teams: ((p.teams?.nodes ?? []) as any[]).map((t) => ({
      id: t.id as string,
      name: t.name as string,
      key: t.key as string,
      color: (t.color ?? null) as string | null,
    })),
  }
}

async function aliases(): Promise<Record<string, string>> {
  return (await kvGet<Record<string, string>>('aliases')) ?? {}
}

async function addAlias(ref: string, id: string): Promise<void> {
  const a = await aliases()
  if (a[ref] !== id) {
    a[ref] = id
    await kvSet('aliases', a)
  }
}

// ---------------------------------------------------------------- fetchers

export async function fetchProjects(): Promise<ProjectsSnapshot> {
  const projects: any[] = []
  let after: string | null = null
  for (let page = 0; page < 3; page++) {
    const d: any = await gql(PROJECTS_LIST, { after })
    projects.push(...d.projects.nodes)
    if (!d.projects.pageInfo.hasNextPage) break
    after = d.projects.pageInfo.endCursor
  }
  const snapshot: ProjectsSnapshot = {
    fetchedAt: new Date().toISOString(),
    projects: projects.map(projectInfo),
  }
  await kvSet('projects', snapshot)
  for (const p of snapshot.projects) await addAlias(p.slugId, p.id)
  return snapshot
}

/**
 * Accepts a project UUID, a slugId, a full slug ("my-project-abc123"), a
 * pasted Linear URL, or a name fragment; returns the canonical project id.
 */
export async function resolveRef(ref: string): Promise<string> {
  let r = decodeURIComponent(String(ref ?? '')).trim()
  if (!r) throw new Error('no project reference')

  const urlMatch = /linear\.app\/[^/]+\/project\/([^/?#]+)/.exec(r)
  if (urlMatch) r = urlMatch[1]

  const slugMatch = /-([0-9a-f]{8,})$/.exec(r)
  const candidates = [r]
  if (slugMatch) candidates.unshift(slugMatch[1])

  const known = await aliases()
  for (const c of candidates) {
    if (known[c]) return known[c]
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) return c
  }

  for (const c of candidates) {
    if (/^[0-9a-f]{6,}$/i.test(c)) {
      try {
        const d = await gql<{ project: { id: string } }>(
          `query R($id: String!) { project(id: $id) { id } }`,
          { id: c },
        )
        await addAlias(c, d.project.id)
        return d.project.id
      } catch (e) {
        if (e instanceof AuthError) throw e
        /* fall through to name search */
      }
    }
  }

  let list = await kvGet<ProjectsSnapshot>('projects')
  if (!list) list = await fetchProjects()
  const q = r.toLowerCase()
  const matches = list.projects.filter(
    (p) => p.name.toLowerCase().includes(q) || p.slugId.startsWith(q),
  )
  if (matches.length === 1) {
    await addAlias(r, matches[0].id)
    return matches[0].id
  }
  throw new Error(
    matches.length === 0
      ? `no project matches "${r}"`
      : `"${r}" is ambiguous: ${matches.map((m) => m.name).join(', ')}`,
  )
}

export async function fetchProject(ref: string): Promise<ProjectSnapshot> {
  const id = await resolveRef(ref)
  const issues: any[] = []
  let meta: any = null
  let after: string | null = null
  for (let page = 0; page < 10; page++) {
    const d: any = await gql(ISSUE_PAGE, { id, after })
    meta = d.project
    issues.push(...d.project.issues.nodes)
    if (!d.project.issues.pageInfo.hasNextPage) break
    after = d.project.issues.pageInfo.endCursor
  }

  const inProject = new Set(issues.map((i) => i.id))
  const states: Record<string, WorkflowState> = {}
  const transformed = issues.map((i) => {
    if (i.state) states[i.state.id] = i.state
    const blocks = new Set<string>(
      i.relations.nodes
        .filter((x: any) => x.type === 'blocks' && x.relatedIssue && inProject.has(x.relatedIssue.id))
        .map((x: any) => x.relatedIssue.id as string),
    )
    return {
      id: i.id as string,
      identifier: i.identifier as string,
      title: i.title as string,
      url: i.url as string,
      priority: (i.priority ?? 0) as number,
      priorityLabel: i.priorityLabel as string,
      estimate: (i.estimate ?? null) as number | null,
      description: (i.description ?? null) as string | null,
      stateId: (i.state?.id ?? null) as string | null,
      assignee: person(i.assignee),
      labels: i.labels.nodes.map((l: any) => ({ name: l.name as string, color: l.color as string })),
      blocks: [...blocks],
      blockedBy: i.inverseRelations.nodes
        .filter((x: any) => x.type === 'blocks' && x.issue && inProject.has(x.issue.id))
        .map((x: any) => x.issue.id as string),
      parentId: (i.parent?.id ?? null) as string | null,
      createdAt: i.createdAt as string,
      updatedAt: i.updatedAt as string,
      startedAt: (i.startedAt ?? null) as string | null,
      completedAt: (i.completedAt ?? null) as string | null,
      canceledAt: (i.canceledAt ?? null) as string | null,
    }
  })

  const snapshot: ProjectSnapshot = {
    fetchedAt: new Date().toISOString(),
    project: projectInfo(meta),
    states,
    issues: transformed,
  }
  await kvSet(`project-${meta.id}`, snapshot)
  await addAlias(meta.slugId, meta.id)
  if (ref !== meta.id && ref !== meta.slugId) await addAlias(ref, meta.id)
  return snapshot
}

/** projects containing issues assigned to this user (3 pages of recent assignments) */
export async function fetchMine(userId: string): Promise<MineSnapshot> {
  const ids = new Set<string>()
  let after: string | null = null
  for (let page = 0; page < 3; page++) {
    const d: any = await gql(MINE, { userId, after })
    for (const n of d.issues.nodes) if (n.project?.id) ids.add(n.project.id)
    if (!d.issues.pageInfo.hasNextPage) break
    after = d.issues.pageInfo.endCursor
  }
  const snapshot: MineSnapshot = {
    fetchedAt: new Date().toISOString(),
    userId,
    projectIds: [...ids],
  }
  await kvSet(`mine-${userId}`, snapshot)
  return snapshot
}

// ---------------------------------------------------------------- cache

export async function cachedMine(userId: string): Promise<MineSnapshot | null> {
  return (await kvGet<MineSnapshot>(`mine-${userId}`)) ?? null
}

export async function cachedProject(ref: string): Promise<ProjectSnapshot | null> {
  const known = await aliases()
  const id = known[ref] ?? ref
  return (await kvGet<ProjectSnapshot>(`project-${id}`)) ?? null
}

export async function cachedProjects(): Promise<ProjectsSnapshot | null> {
  return (await kvGet<ProjectsSnapshot>('projects')) ?? null
}
