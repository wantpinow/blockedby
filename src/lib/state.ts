import type { Issue, ProjectSnapshot, StateType, WorkflowState } from '../types'

export const TYPE_LABEL: Record<StateType, string> = {
  triage: 'Triage',
  backlog: 'Backlog',
  unstarted: 'Todo',
  started: 'In progress',
  completed: 'Done',
  canceled: 'Canceled',
  duplicate: 'Duplicate',
}

/** display order for filters / progress strip */
export const TYPE_ORDER: StateType[] = [
  'triage',
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
  'duplicate',
]

const FALLBACK_STATE: WorkflowState = {
  id: '?',
  name: 'Unknown',
  color: '#8a8f98',
  type: 'unstarted',
  position: 0,
}

export function stateOf(issue: Issue, snap: ProjectSnapshot): WorkflowState {
  return (issue.stateId && snap.states[issue.stateId]) || FALLBACK_STATE
}

/** closed for good: finished, dropped, or folded into another issue */
export function isDone(t: StateType): boolean {
  return t === 'completed' || t === 'canceled' || t === 'duplicate'
}

/**
 * Fill fraction for `started` states: rank them by position so e.g.
 * In Progress → ½ and In Review → ¾, matching Linear's visual language.
 */
export function startedFraction(state: WorkflowState, snap: ProjectSnapshot): number {
  const started = Object.values(snap.states)
    .filter((s) => s.type === 'started')
    .sort((a, b) => a.position - b.position)
  const idx = started.findIndex((s) => s.id === state.id)
  if (idx === -1 || started.length === 0) return 0.5
  return (idx + 1) / (started.length + 1)
}

/** unblocked and not yet started — the "you could pick this up now" set */
export function isActionable(issue: Issue, snap: ProjectSnapshot, byId: Map<string, Issue>): boolean {
  const t = stateOf(issue, snap).type
  if (t !== 'backlog' && t !== 'unstarted' && t !== 'triage') return false
  return issue.blockedBy.every((b) => {
    const blocker = byId.get(b)
    return !blocker || isDone(stateOf(blocker, snap).type)
  })
}

export function timeAgo(then: string | number, now: number): string {
  const t = typeof then === 'string' ? new Date(then).getTime() : then
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
