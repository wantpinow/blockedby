import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Issue, ProjectSnapshot, StateType, WorkflowState } from '../types'
import { useNow, useProject } from '../lib/useData'
import { cone, layoutGraph, NODE_H, NODE_W } from '../lib/layout'
import { isActionable, isDone, startedFraction, stateOf, timeAgo, TYPE_LABEL, TYPE_ORDER } from '../lib/state'
import { StateIcon } from '../components/StateIcon'
import { PriorityIcon } from '../components/bits'
import { IssuePanel } from '../components/IssuePanel'

interface Transform {
  x: number
  y: number
  k: number
}

export function ProjectGraph({
  refId,
  selectedIssue,
  onSelectIssue,
  onBack,
  themeButton,
}: {
  refId: string
  selectedIssue: string | null
  onSelectIssue: (identifier: string | null) => void
  onBack: () => void
  themeButton: React.ReactNode
}) {
  const { data: snap, syncing, error, refresh } = useProject(refId)
  const now = useNow()
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<Set<StateType>>(new Set())
  const [hover, setHover] = useState<string | null>(null)

  const model = useMemo(() => (snap ? buildModel(snap) : null), [snap])

  // first-render readiness mark (read by the dev loop + curious humans)
  useEffect(() => {
    if (model && window.__READY__ === undefined) window.__READY__ = performance.now()
  }, [model])

  useEffect(() => {
    if (snap) document.title = `${snap.project.name} · linear-viz`
  }, [snap])

  // ---------- pan / zoom ----------
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tf, setTf] = useState<Transform>({ x: 0, y: 0, k: 1 })
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)

  const fit = useCallback(() => {
    const el = wrapRef.current
    const layout = model?.layout
    if (!el || !layout) return
    const { width: cw, height: ch } = el.getBoundingClientRect()
    const k = Math.max(Math.min(cw / layout.width, ch / layout.height, 1.08), 0.72)
    setTf({
      x: Math.max((cw - layout.width * k) / 2, 20),
      y: Math.max((ch - layout.height * k) / 2, 12),
      k,
    })
  }, [model])

  useEffect(() => {
    fit()
  }, [fit])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        setTf((t) => {
          const k = Math.min(2.5, Math.max(0.2, t.k * Math.exp(-e.deltaY * 0.01)))
          const scale = k / t.k
          return { k, x: mx - (mx - t.x) * scale, y: my - (my - t.y) * scale }
        })
      } else {
        setTf((t) => ({ ...t, x: t.x - e.deltaX, y: t.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [model])

  const zoomBy = (f: number) => {
    const el = wrapRef.current
    if (!el) return
    const { width: cw, height: ch } = el.getBoundingClientRect()
    setTf((t) => {
      const k = Math.min(2.5, Math.max(0.2, t.k * f))
      const scale = k / t.k
      return { k, x: cw / 2 - (cw / 2 - t.x) * scale, y: ch / 2 - (ch / 2 - t.y) * scale }
    })
  }

  // ---------- focus: search + type filters ----------
  const focus = useMemo(() => {
    if (!model || !snap) return null
    const q = query.trim().toLowerCase()
    if (!q && typeFilter.size === 0) return null
    const set = new Set<string>()
    for (const i of snap.issues) {
      const st = stateOf(i, snap)
      if (typeFilter.size && !typeFilter.has(st.type)) continue
      if (
        q &&
        !i.identifier.toLowerCase().includes(q) &&
        !i.title.toLowerCase().includes(q) &&
        !(i.assignee?.name.toLowerCase().includes(q) ?? false)
      ) {
        continue
      }
      set.add(i.id)
    }
    return set
  }, [model, snap, query, typeFilter])

  const hoverCone = useMemo(() => {
    if (!hover || !model) return null
    return cone(hover, model.preds, model.succs)
  }, [hover, model])

  // ---------- render ----------
  if (error && !snap) {
    return (
      <div className="page">
        <Header
          onBack={onBack}
          snap={null}
          syncing={syncing}
          refresh={refresh}
          query={query}
          setQuery={setQuery}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          themeButton={themeButton}
          error={null}
          now={now}
        />
        <div className="center-note">
          <div className="empty-title">Couldn't load this project</div>
          <div className="muted">{error}</div>
        </div>
      </div>
    )
  }

  if (!snap || !model) {
    return (
      <div className="page">
        <div className="center-note">
          <span className="sync-dot is-syncing" /> loading project…
        </div>
      </div>
    )
  }

  const { layout, byId, byIdentifier, ready, doneEdge } = model

  const nodeState = (id: string): string => {
    const parts = ['gnode']
    const issue = byId.get(id)!
    const t = stateOf(issue, snap).type
    if (isDone(t)) parts.push('is-done')
    if (hover) {
      if (id === hover) parts.push('is-hover')
      else if (hoverCone?.up.has(id) || hoverCone?.down.has(id)) parts.push('is-lit')
      else parts.push('is-dim')
    } else if (focus && !focus.has(id)) {
      parts.push('is-dim')
    }
    return parts.join(' ')
  }

  const edgeState = (from: string, to: string): string => {
    if (hover && hoverCone) {
      const upEdge = (to === hover || hoverCone.up.has(to)) && hoverCone.up.has(from)
      const downEdge = (from === hover || hoverCone.down.has(from)) && hoverCone.down.has(to)
      if (upEdge || downEdge) return 'edge is-lit'
      return 'edge is-dim'
    }
    if (focus && (!focus.has(from) || !focus.has(to))) return 'edge is-dim'
    if (doneEdge.has(`${from}→${to}`)) return 'edge is-settled'
    return 'edge'
  }

  const selected = selectedIssue ? byIdentifier.get(selectedIssue) ?? null : null

  return (
    <div className="page">
      <Header
        onBack={onBack}
        snap={snap}
        syncing={syncing}
        refresh={refresh}
        query={query}
        setQuery={setQuery}
        typeFilter={typeFilter}
        setTypeFilter={setTypeFilter}
        themeButton={themeButton}
        error={error}
        now={now}
      />

      <div
        ref={wrapRef}
        className="graph-canvas"
        onPointerDown={(e) => {
          if ((e.target as Element).closest('.gnode')) return
          drag.current = { px: e.clientX, py: e.clientY, ox: tf.x, oy: tf.y }
          ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const { px, py, ox, oy } = drag.current
          setTf((t) => ({ ...t, x: ox + e.clientX - px, y: oy + e.clientY - py }))
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={(e) => {
          if (!(e.target as Element).closest('.gnode')) fit()
        }}
      >
        <svg className="graph-svg">
          <defs>
            <clipPath id="avclip">
              <circle r="8" />
            </clipPath>
            <marker
              id="arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0.5 0.8 L7 4 L0.5 7.2" fill="none" stroke="context-stroke" strokeWidth="1.3" strokeLinecap="round" />
            </marker>
          </defs>
          <g transform={`translate(${tf.x} ${tf.y}) scale(${tf.k})`}>
            {layout.gridLabelY !== null && (
              <text className="grid-label" x={28} y={layout.gridLabelY}>
                unlinked — no blocking relations ({layout.isolatedCount})
              </text>
            )}
            {layout.edges.map((e) => (
              <path
                key={`${e.from}→${e.to}`}
                className={edgeState(e.from, e.to)}
                d={e.path}
                markerEnd="url(#arrow)"
              />
            ))}
            {layout.nodes.map((n) => {
              const issue = byId.get(n.id)
              if (!issue) return null
              const st = stateOf(issue, snap)
              const isReady = ready.has(n.id)
              const showPrio = issue.priority === 1 || issue.priority === 2
              const rightReserve = (issue.assignee ? 24 : 6) + (showPrio ? 16 : 0)
              const maxTitle = Math.floor((NODE_W - 34 - rightReserve) / 5.35)
              return (
                <g
                  key={n.id}
                  className={nodeState(n.id)}
                  transform={`translate(${n.x} ${n.y})`}
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover(null)}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey) window.open(issue.url, '_blank')
                    else onSelectIssue(issue.identifier)
                  }}
                >
                  <rect
                    className={`gnode-box${isReady ? ' is-ready' : ''}${selected?.id === n.id ? ' is-selected' : ''}`}
                    width={NODE_W}
                    height={NODE_H}
                    rx={10}
                  />
                  <svg x={10} y={16} width={16} height={16} viewBox="0 0 16 16" style={{ overflow: 'visible' }}>
                    <StateIcon state={st} fraction={startedFraction(st, snap)} size={16} />
                  </svg>
                  <text className="gnode-id mono" x={34} y={20}>
                    {issue.identifier}
                  </text>
                  {isReady && (
                    <text className="gnode-ready" x={NODE_W - (issue.assignee ? 32 : 12)} y={20} textAnchor="end">
                      ready
                    </text>
                  )}
                  <text className="gnode-title" x={34} y={36}>
                    {truncate(issue.title, maxTitle)}
                  </text>
                  {showPrio && (
                    <svg
                      x={NODE_W - (issue.assignee ? 44 : 26)}
                      y={28}
                      width={13}
                      height={13}
                      viewBox="0 0 16 16"
                      style={{ overflow: 'visible' }}
                    >
                      <PriorityIcon priority={issue.priority} size={16} />
                    </svg>
                  )}
                  {issue.assignee && (
                    <AvatarG
                      x={NODE_W - 16}
                      y={NODE_H / 2 + 5}
                      person={issue.assignee}
                    />
                  )}
                  <title>{`${issue.identifier} — ${issue.title}\n${st.name}${issue.assignee ? ` · ${issue.assignee.name}` : ''}`}</title>
                </g>
              )
            })}
          </g>
        </svg>

        <div className="zoomctl">
          <button type="button" className="seg-btn" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">−</button>
          <button type="button" className="seg-btn" onClick={fit}>fit</button>
          <button type="button" className="seg-btn" onClick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
        </div>

        <Legend snap={snap} model={model} />
      </div>

      {selected && (
        <IssuePanel
          issue={selected}
          snap={snap}
          byId={byId}
          onOpen={(identifier) => onSelectIssue(identifier)}
          onClose={() => onSelectIssue(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- header

function Header({
  onBack,
  snap,
  syncing,
  refresh,
  query,
  setQuery,
  typeFilter,
  setTypeFilter,
  themeButton,
  error,
  now,
}: {
  onBack: () => void
  snap: ProjectSnapshot | null
  syncing: boolean
  refresh: () => void
  query: string
  setQuery: (q: string) => void
  typeFilter: Set<StateType>
  setTypeFilter: (s: Set<StateType>) => void
  themeButton: React.ReactNode
  error: string | null
  now: number
}) {
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const counts = useMemo(() => {
    const m = new Map<StateType, number>()
    if (snap) {
      for (const i of snap.issues) {
        const t = stateOf(i, snap).type
        m.set(t, (m.get(t) ?? 0) + 1)
      }
    }
    return m
  }, [snap])

  const doneCount = (counts.get('completed') ?? 0) + (counts.get('canceled') ?? 0)

  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="All projects" title="All projects">
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path d="M10.5 3 L5.5 8 L10.5 13" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {snap && (
          <>
            <span className="proj-dot" style={{ background: snap.project.color }} />
            <span className="proj-name">{snap.project.name}</span>
            <span className="muted small proj-count">
              {doneCount}/{snap.issues.length} done
            </span>
          </>
        )}
        <span className="spacer" />
        <div className="typechips">
          {TYPE_ORDER.filter((t) => counts.get(t)).map((t) => {
            const on = typeFilter.has(t)
            const sample = snap
              ? Object.values(snap.states).find((s) => s.type === t)
              : null
            return (
              <button
                key={t}
                type="button"
                className={`typechip${on ? ' is-on' : ''}`}
                onClick={() => {
                  const next = new Set(typeFilter)
                  if (on) next.delete(t)
                  else next.add(t)
                  setTypeFilter(next)
                }}
                title={`${TYPE_LABEL[t]}: ${counts.get(t)}`}
              >
                {sample && <StateIcon state={sample} size={11} />}
                {TYPE_LABEL[t]}
                <span className="typechip-n">{counts.get(t)}</span>
              </button>
            )
          })}
        </div>
        <input
          ref={searchRef}
          className="filter"
          placeholder="Search…  /"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        <button
          type="button"
          className={`icon-btn sync-btn${syncing ? ' is-syncing' : ''}`}
          onClick={refresh}
          title={error ? `sync failed: ${error}` : snap ? `synced ${timeAgo(snap.fetchedAt, now)}` : 'refresh'}
          aria-label="Refresh"
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
        <span
          className={`sync-dot${syncing ? ' is-syncing' : error ? ' is-error' : ''}`}
          title={error ? `sync failed: ${error} — showing last snapshot` : snap ? `synced ${timeAgo(snap.fetchedAt, now)}` : ''}
        />
        {themeButton}
      </header>
      {snap && <ProgressStrip snap={snap} counts={counts} />}
    </>
  )
}

function ProgressStrip({
  snap,
  counts,
}: {
  snap: ProjectSnapshot
  counts: Map<StateType, number>
}) {
  const total = snap.issues.length || 1
  const colorOf = (t: StateType): string => {
    const s = Object.values(snap.states).find((x) => x.type === t)
    return s?.color ?? '#8a8f98'
  }
  return (
    <div className="progress-strip">
      {(['completed', 'started', 'unstarted', 'triage', 'backlog', 'canceled'] as StateType[])
        .filter((t) => counts.get(t))
        .map((t) => (
          <span
            key={t}
            style={{
              width: `${((counts.get(t) ?? 0) / total) * 100}%`,
              background: colorOf(t),
              opacity: t === 'backlog' || t === 'canceled' ? 0.35 : 1,
            }}
            title={`${TYPE_LABEL[t]}: ${counts.get(t)}`}
          />
        ))}
    </div>
  )
}

// ---------------------------------------------------------------- legend

function Legend({ snap, model }: { snap: ProjectSnapshot; model: Model }) {
  const types = new Map<StateType, WorkflowState>()
  for (const s of Object.values(snap.states)) {
    if (!types.has(s.type)) types.set(s.type, s)
  }
  return (
    <div className="graph-legend">
      {TYPE_ORDER.filter((t) => types.has(t)).map((t) => (
        <span key={t} className="legend-item">
          <StateIcon state={types.get(t)!} size={11} />
          {TYPE_LABEL[t]}
        </span>
      ))}
      <span className="legend-item">
        <svg width="20" height="10" viewBox="0 0 20 10">
          <rect x="0.75" y="0.75" width="18.5" height="8.5" rx="3" className="legend-ready-box" />
        </svg>
        unblocked
      </span>
      <span className="legend-item">
        <svg width="22" height="8" viewBox="0 0 22 8">
          <path d="M1 4 H16" className="edge" markerEnd="url(#arrow)" />
        </svg>
        blocks
      </span>
      {model.layout.edges.length === 0 && (
        <span className="legend-item muted">no blocking relations in this project</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- model

interface Model {
  layout: ReturnType<typeof layoutGraph>
  byId: Map<string, Issue>
  byIdentifier: Map<string, Issue>
  preds: Map<string, string[]>
  succs: Map<string, string[]>
  ready: Set<string>
  doneEdge: Set<string>
}

function buildModel(snap: ProjectSnapshot): Model {
  const byId = new Map(snap.issues.map((i) => [i.id, i]))
  const byIdentifier = new Map(snap.issues.map((i) => [i.identifier, i]))

  const edges: { from: string; to: string }[] = []
  for (const i of snap.issues) {
    for (const to of i.blocks) edges.push({ from: i.id, to })
    for (const from of i.blockedBy) edges.push({ from, to: i.id })
  }

  const num = (id: string) => {
    const i = byId.get(id)!
    const m = /(\d+)$/.exec(i.identifier)
    return m ? Number(m[1]) : 0
  }

  const layout = layoutGraph({
    ids: snap.issues.map((i) => i.id),
    edges,
    order: num,
  })

  const preds = new Map<string, string[]>(snap.issues.map((i) => [i.id, []]))
  const succs = new Map<string, string[]>(snap.issues.map((i) => [i.id, []]))
  for (const e of layout.edges) {
    preds.get(e.to)!.push(e.from)
    succs.get(e.from)!.push(e.to)
  }

  const ready = new Set(
    snap.issues.filter((i) => isActionable(i, snap, byId)).map((i) => i.id),
  )

  const doneEdge = new Set<string>()
  for (const e of layout.edges) {
    const a = stateOf(byId.get(e.from)!, snap).type
    const b = stateOf(byId.get(e.to)!, snap).type
    if (isDone(a) && isDone(b)) doneEdge.add(`${e.from}→${e.to}`)
  }

  return { layout, byId, byIdentifier, preds, succs, ready, doneEdge }
}

function AvatarG({ x, y, person }: { x: number; y: number; person: { avatarUrl: string | null; initials: string; name: string } }) {
  return (
    <g transform={`translate(${x} ${y})`} opacity="0.92">
      <circle r="8" className="gnode-avatar-bg" />
      <text className="gnode-avatar-initials" y="2.5" textAnchor="middle">
        {person.initials.slice(0, 2)}
      </text>
      {person.avatarUrl && (
        <g clipPath="url(#avclip)">
          <image href={person.avatarUrl} x="-8" y="-8" width="16" height="16" preserveAspectRatio="xMidYMid slice" />
        </g>
      )}
    </g>
  )
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s
}
