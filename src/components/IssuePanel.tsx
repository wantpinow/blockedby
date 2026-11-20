import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { Issue, ProjectSnapshot } from '../types'
import { stateOf, startedFraction, timeAgo, isActionable, isDone } from '../lib/state'
import { useNow } from '../lib/useData'
import { buildAgentPrompt } from '../lib/agentPrompt'
import { kvGet } from '../lib/idb'
import type { Viewer } from '../lib/linear'
import { StateIcon } from './StateIcon'
import { Avatar, IssueChip, PriorityIcon } from './bits'

const Markdown = lazy(() => import('./MarkdownImpl'))

export function IssuePanel({
  issue,
  snap,
  byId,
  onOpen,
  onClose,
}: {
  issue: Issue
  snap: ProjectSnapshot
  byId: Map<string, Issue>
  onOpen: (identifier: string) => void
  onClose: () => void
}) {
  const now = useNow()
  const st = stateOf(issue, snap)
  const [copied, setCopied] = useState(false)
  const [viewerName, setViewerName] = useState<string | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    kvGet<Viewer>('viewer').then((v) => setViewerName(v?.name ?? null))
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copyPrompt = async () => {
    const text = buildAgentPrompt(issue, snap, { byId, viewerName })
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 1600)
  }

  const blockers = issue.blockedBy.map((id) => byId.get(id)).filter(Boolean) as Issue[]
  const blocking = issue.blocks.map((id) => byId.get(id)).filter(Boolean) as Issue[]
  const ready = isActionable(issue, snap, byId)

  return (
    <>
      <div className="panel-backdrop" onClick={onClose} />
      <aside className="panel" role="dialog" aria-label={issue.identifier}>
        <header className="panel-head">
          <div className="panel-head-row">
            <span className="mono panel-id">{issue.identifier}</span>
            {ready && <span className="chip chip-ready">ready</span>}
            <span className="spacer" />
            <button
              type="button"
              className={`agent-btn${copied ? ' is-copied' : ''}`}
              onClick={copyPrompt}
              title="Copy a ready-to-paste kickoff prompt for a coding agent — branch strategy, stacking, and dependency flags derived from this graph"
            >
              {copied ? (
                <>
                  <svg viewBox="0 0 16 16" width="11" height="11">
                    <path
                      d="M3.5 8.5 L6.5 11.5 L12.5 4.5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg viewBox="0 0 16 16" width="11" height="11">
                    <path
                      d="M2.5 3.5 L6 7 L2.5 10.5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M8 11.5 H13.5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                  Agent prompt
                </>
              )}
            </button>
            <a className="linear-btn" href={issue.url} target="_blank" rel="noreferrer">
              Open in Linear
              <svg viewBox="0 0 16 16" width="11" height="11">
                <path
                  d="M6 3.5h6.5V10M12.5 3.5L4 12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 16 16" width="14" height="14">
                <path
                  d="M4 4 L12 12 M12 4 L4 12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <h2 className="panel-title">{issue.title}</h2>

          <div className="panel-meta">
            <span className="meta-item">
              <StateIcon state={st} fraction={startedFraction(st, snap)} size={14} />
              {st.name}
            </span>
            {issue.assignee && (
              <span className="meta-item">
                <Avatar person={issue.assignee} size={16} />
                {issue.assignee.name}
              </span>
            )}
            {issue.priority > 0 && (
              <span className="meta-item">
                <PriorityIcon priority={issue.priority} size={13} />
                {issue.priorityLabel}
              </span>
            )}
            {issue.estimate != null && (
              <span className="meta-item muted">{issue.estimate} pts</span>
            )}
            <span className="spacer" />
            <span className="muted small">updated {timeAgo(issue.updatedAt, now)}</span>
          </div>

          {issue.labels.length > 0 && (
            <div className="panel-labels">
              {issue.labels.map((l) => (
                <span key={l.name} className="chip chip-label">
                  <span className="label-dot" style={{ background: l.color }} />
                  {l.name}
                </span>
              ))}
            </div>
          )}

          {(blockers.length > 0 || blocking.length > 0) && (
            <div className="panel-deps">
              {blockers.length > 0 && (
                <div className="dep-row">
                  <span className="dep-label">blocked by</span>
                  {blockers.map((b) => (
                    <IssueChip
                      key={b.id}
                      issue={b}
                      snap={snap}
                      onOpen={onOpen}
                      muted={isDone(stateOf(b, snap).type)}
                    />
                  ))}
                </div>
              )}
              {blocking.length > 0 && (
                <div className="dep-row">
                  <span className="dep-label">blocks</span>
                  {blocking.map((b) => (
                    <IssueChip key={b.id} issue={b} snap={snap} onOpen={onOpen} />
                  ))}
                </div>
              )}
            </div>
          )}
        </header>

        <div className="panel-body">
          {issue.description ? (
            <Suspense fallback={<div className="muted small">rendering…</div>}>
              <Markdown text={issue.description} />
            </Suspense>
          ) : (
            <div className="empty">No description.</div>
          )}
        </div>
      </aside>
    </>
  )
}
