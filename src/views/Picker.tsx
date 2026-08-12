import { useEffect, useMemo, useState } from 'react'
import type { ProjectInfo } from '../types'
import { useNow, useProjects } from '../lib/useData'
import { timeAgo } from '../lib/state'
import { Avatar } from '../components/bits'

export function Picker({
  onOpen,
  themeButton,
  accountButton,
}: {
  onOpen: (ref: string) => void
  themeButton: React.ReactNode
  accountButton: React.ReactNode
}) {
  const { data, syncing, error, refresh } = useProjects()
  const now = useNow(30000)
  const [query, setQuery] = useState('')

  useEffect(() => {
    document.title = 'blockedBy'
  }, [])

  const projects = useMemo(() => {
    const list = data?.projects ?? []
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((p) => p.name.toLowerCase().includes(q))
  }, [data, query])

  return (
    <div className="page">
      <header className="topbar">
        <span className="brand-mark">
          <svg viewBox="0 0 32 32" width="15" height="15">
            <circle cx="9" cy="22" r="3.4" fill="currentColor" />
            <circle cx="16" cy="10" r="3.4" fill="currentColor" />
            <circle cx="24" cy="19" r="3.4" fill="currentColor" />
            <path d="M11 18.5 L14 13.5 M18.5 12 L21.5 16.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
        <span className="proj-name">blockedBy</span>
        <span className="muted small proj-count">
          {projects.length} project{projects.length === 1 ? '' : 's'}
        </span>
        <span className="spacer" />
        <input
          className="filter"
          placeholder="Search projects…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          autoFocus
        />
        <button
          type="button"
          className={`icon-btn sync-btn${syncing ? ' is-syncing' : ''}`}
          onClick={refresh}
          aria-label="Refresh"
          title={error ? `sync failed: ${error}` : data ? `synced ${timeAgo(data.fetchedAt, now)}` : 'refresh'}
        >
          <svg viewBox="0 0 16 16" width="13" height="13">
            <path
              d="M13.2 6.5 A5.5 5.5 0 1 0 13.5 9.5 M13.2 2.8 v3.7 h-3.7"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <span className={`sync-dot${syncing ? ' is-syncing' : error ? ' is-error' : ''}`} />
        {accountButton}
        {themeButton}
      </header>

      <div className="picker">
        {!data && !error && <div className="center-note">loading projects…</div>}
        {error && !data && (
          <div className="center-note">
            <div className="empty-title">Couldn't reach Linear</div>
            <div className="muted">{error}</div>
          </div>
        )}
        <div className="cards">
          {projects.map((p) => (
            <Card key={p.id} p={p} now={now} onOpen={() => onOpen(p.slugId)} />
          ))}
        </div>
        {data && projects.length === 0 && <div className="empty">No projects match.</div>}
      </div>
    </div>
  )
}

function Card({ p, now, onOpen }: { p: ProjectInfo; now: number; onOpen: () => void }) {
  return (
    <button type="button" className="card" onClick={onOpen}>
      <div className="card-top">
        <span className="proj-dot" style={{ background: p.color }} />
        <span className="card-name">{p.name}</span>
        {p.lead && <Avatar person={p.lead} size={18} />}
      </div>
      <div className="card-bar">
        <div
          className="card-bar-fill"
          style={{ width: `${Math.round(p.progress * 100)}%`, background: p.color }}
        />
      </div>
      <div className="card-meta">
        <span className={`proj-state is-${p.state}`}>{p.state}</span>
        <span className="muted">{Math.round(p.progress * 100)}%</span>
        <span className="spacer" />
        {p.targetDate && (
          <span className="muted" title="target date">
            → {new Date(p.targetDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        )}
        <span className="muted">{timeAgo(p.updatedAt, now)}</span>
      </div>
    </button>
  )
}
