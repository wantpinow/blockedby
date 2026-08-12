export type StateType = 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'

export interface Person {
  id: string
  name: string
  avatarUrl: string | null
  initials: string
}

export interface WorkflowState {
  id: string
  name: string
  color: string
  type: StateType
  position: number
}

export interface Label {
  name: string
  color: string
}

export interface Issue {
  id: string
  identifier: string
  title: string
  url: string
  priority: number
  priorityLabel: string
  estimate: number | null
  description: string | null
  stateId: string | null
  assignee: Person | null
  labels: Label[]
  /** issue ids this issue blocks (edges out) */
  blocks: string[]
  /** issue ids blocking this issue (edges in) */
  blockedBy: string[]
  parentId: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
  canceledAt: string | null
}

export interface ProjectInfo {
  id: string
  name: string
  slugId: string
  color: string
  icon: string | null
  state: string
  progress: number
  url: string
  targetDate: string | null
  updatedAt: string
  lead: Person | null
}

export interface ProjectSnapshot {
  fetchedAt: string
  project: ProjectInfo
  states: Record<string, WorkflowState>
  issues: Issue[]
}

export interface ProjectsSnapshot {
  fetchedAt: string
  projects: ProjectInfo[]
}

declare global {
  interface Window {
    __SNAPSHOT__?: { kind: 'project'; ref: string; data: ProjectSnapshot } | {
      kind: 'projects'
      data: ProjectsSnapshot
    }
    __READY__?: number
  }
}
