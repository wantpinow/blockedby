/** Linear's workflow state types; `duplicate` is its own type, closed like `canceled` */
export type StateType = 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled' | 'duplicate'

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
  /** project milestone this issue sits in (absent on snapshots cached before milestones) */
  milestoneId?: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
  canceledAt: string | null
}

export interface TeamInfo {
  id: string
  name: string
  key: string
  color: string | null
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
  teams: TeamInfo[]
}

/** project ids containing issues assigned to a given user */
export interface MineSnapshot {
  fetchedAt: string
  userId: string
  projectIds: string[]
}

export interface Milestone {
  id: string
  name: string
  sortOrder: number
}

export interface ProjectSnapshot {
  fetchedAt: string
  project: ProjectInfo
  states: Record<string, WorkflowState>
  issues: Issue[]
  /** in Linear's order (absent on snapshots cached before milestones) */
  milestones?: Milestone[]
}

export interface ProjectsSnapshot {
  fetchedAt: string
  projects: ProjectInfo[]
}

declare global {
  interface Window {
    __READY__?: number
  }
}
