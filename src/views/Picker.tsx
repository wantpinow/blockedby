import { useEffect, useMemo, useState } from 'react'
import type { ProjectInfo, TeamInfo } from '../types'
import { useMine, useNow, useProjects, useViewerState } from '../lib/useData'
import { useStored } from '../lib/useStored'
import { timeAgo } from '../lib/state'
import { isShortcode, projectIcon, useShortcodes } from '../lib/emoji'
import { Avatar } from '../components/bits'

/** what the card shows as its percentage; 100 means finished */
const pct = (p: ProjectInfo) => Math.round(p.progress * 100)

const NO_TEAM: TeamInfo = { id: 'no-team', name: 'No team', key: '·', color: null }

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
  const { viewer, settled: viewerSettled } = useViewerState()
  const now = useNow(30000)
  const [query, setQuery] = useState('')
  const [mineOnly, setMineOnly] = useStored<boolean>('blockedby-mine-only', false)
  const [hideComplete, setHideComplete] = useStored<boolean>('blockedby-hide-complete', true)
  const [collapsed, setCollapsed] = useStored<string[]>('blockedby-collapsed-teams', [])
  const { data: mine, syncing: mineSyncing, error: mineError } = useMine(viewer?.id ?? null)

  useEffect(() => {
    document.title = 'blockedBy'
    localStorage.removeItem('blockedby-me') // pre-viewer era selector state
  }, [])

  const mineSet = useMemo(
    () => (mineOnly && viewer && mine && mine.userId === viewer.id ? new Set(mine.projectIds) : null),
    [mineOnly, viewer, mine],
  )
  const mineLoading = mineOnly && viewer !== null && mineSet === null
  // With "My projects" on, hold the list back until we know which projects are
  // yours, instead of painting every project and then filtering. Falls back to
  // the full list only when the filter can't be worked out (no viewer, or the
  // lookup failed with nothing cached).
  const mineUnknown = mineOnly && mineSet === null && !(viewerSettled && viewer === null) && !mineError

  // the emoji table is its own chunk; fetch it only if some project uses a :shortcode: icon
  const shortcodes = useShortcodes(!!data?.projects.some((p) => isShortcode(p.icon)))

  const { groups, visibleCount, completeHidden } = useMemo(() => {
    const list = data?.projects ?? []
    const q = query.trim().toLowerCase()
    const matching = list.filter(
      (p) => (!q || p.name.toLowerCase().includes(q)) && (!mineSet || mineSet.has(p.id)),
    )
    const visible = hideComplete ? matching.filter((p) => pct(p) < 100) : matching
    const completeHidden = matching.length - visible.length
    const byTeam = new Map<string, { team: TeamInfo; projects: ProjectInfo[] }>()
    for (const p of visible) {
      // pre-teams cached snapshots lack the field — treat as ungrouped until revalidation lands
      for (const t of p.teams?.length ? p.teams : [NO_TEAM]) {
        const g = byTeam.get(t.id) ?? { team: t, projects: [] }
        g.projects.push(p)
        byTeam.set(t.id, g)
      }
    }
    // list arrives updatedAt-desc, so each group's first project is its freshest
    const groups = [...byTeam.values()].sort((a, b) =>
      (b.projects[0]?.updatedAt ?? '').localeCompare(a.projects[0]?.updatedAt ?? ''),
    )
    return { groups, visibleCount: visible.length, completeHidden }
  }, [data, query, mineSet, hideComplete])

  const searching = query.trim().length > 0
  const isCollapsed = (teamId: string) => !searching && collapsed.includes(teamId)
  const toggleTeam = (teamId: string) =>
    setCollapsed((prev) =>
      prev.includes(teamId) ? prev.filter((x) => x !== teamId) : [...prev, teamId],
    )

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
        {data && !mineUnknown && (
          <span className="muted small proj-count">
            {visibleCount} project{visibleCount === 1 ? '' : 's'}
          </span>
        )}
        <span className="spacer" />
        {viewer && (
          <button
            type="button"
            className={`typechip mine-chip${mineOnly ? ' is-on' : ''}`}
            onClick={() => setMineOnly((v) => !v)}
            title={`Only projects with issues assigned to ${viewer.name}`}
          >
            <Avatar person={viewer} size={14} />
            My projects
            {mineLoading || (mineOnly && mineSyncing) ? (
              <span className="mini-spinner" aria-label="loading" />
            ) : (
              mineOnly && mineSet && <span className="typechip-n">{visibleCount}</span>
            )}
          </button>
        )}
        <button
          type="button"
          className={`typechip${hideComplete ? ' is-on' : ''}`}
          onClick={() => setHideComplete((v) => !v)}
          title={
            hideComplete
              ? `Hiding ${completeHidden} project${completeHidden === 1 ? '' : 's'} at 100%. Click to show them.`
              : 'Hide projects at 100%'
          }
        >
          Hide 100%
          {hideComplete && completeHidden > 0 && !mineUnknown && <span className="typechip-n">{completeHidden}</span>}
        </button>
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
          title={error ? `sync failed: ${error} — showing cached` : data ? `synced ${timeAgo(data.fetchedAt, now)}` : 'refresh'}
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
          {!syncing && <span className={`sync-badge${error ? ' is-error' : ''}`} />}
        </button>
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
        {data && mineUnknown && <div className="center-note is-delayed">finding your projects…</div>}
        {!mineUnknown && groups.map(({ team, projects }) => (
          <section key={team.id} className="team-sec">
            <button
              type="button"
              className="team-head"
              onClick={() => toggleTeam(team.id)}
              aria-expanded={!isCollapsed(team.id)}
            >
              <svg
                className={`team-chevron${isCollapsed(team.id) ? '' : ' is-open'}`}
                viewBox="0 0 16 16"
                width="11"
                height="11"
              >
                <path
                  d="M5.5 3.5 L10.5 8 L5.5 12.5"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="team-dot" style={{ background: team.color ?? 'var(--text-3)' }} />
              <span className="team-name">{team.name}</span>
              <span className="mono team-key">{team.key}</span>
              <span className="team-count">{projects.length}</span>
              {isCollapsed(team.id) && <span className="team-hidden muted small">hidden</span>}
            </button>
            {!isCollapsed(team.id) && (
              <div className="cards">
                {projects.map((p) => (
                  <Card key={`${team.id}:${p.id}`} p={p} now={now} shortcodes={shortcodes} onOpen={() => onOpen(p.slugId)} />
                ))}
              </div>
            )}
          </section>
        ))}
        {data && !mineUnknown && visibleCount === 0 && (
          <div className="empty">
            {mineSet
              ? `No projects with issues assigned to ${viewer?.name}${searching ? ' match the search' : ''}.`
              : 'No projects match.'}
            {completeHidden > 0 && (
              <>
                {' '}
                <button type="button" className="link-btn" onClick={() => setHideComplete(false)}>
                  Show {completeHidden} at 100%
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Card({
  p,
  now,
  shortcodes,
  onOpen,
}: {
  p: ProjectInfo
  now: number
  shortcodes: Record<string, string> | null
  onOpen: () => void
}) {
  const glyph = projectIcon(p.icon, shortcodes)
  return (
    <button type="button" className="card" onClick={onOpen}>
      <div className="card-top">
        <span className="proj-dot" style={{ background: p.color }} />
        <span className="card-name">
          {glyph && <span className="card-icon">{glyph}</span>}
          {p.name}
        </span>
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
        <span className="muted">{pct(p)}%</span>
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
