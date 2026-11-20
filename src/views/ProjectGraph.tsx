import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Issue, ProjectSnapshot, StateType, WorkflowState } from '../types'
import { useNow, useProject } from '../lib/useData'
import { cone, layoutGraph, MILESTONE_HUES, NODE_H, NODE_W, transitiveReduction, type LaneSpec } from '../lib/layout'
import { isActionable, isDone, startedFraction, stateOf, timeAgo, TYPE_LABEL, TYPE_ORDER } from '../lib/state'
import { useStored } from '../lib/useStored'
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
  accountButton,
}: {
  refId: string
  selectedIssue: string | null
  onSelectIssue: (identifier: string | null) => void
  onBack: () => void
  themeButton: React.ReactNode
  accountButton: React.ReactNode
}) {
  const { data: snap, syncing, error, refresh } = useProject(refId)
  const now = useNow()
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<Set<StateType>>(new Set())
  const [hover, setHover] = useState<string | null>(null)
  const [hideDone, setHideDone] = useStored('hideDone', true)
  const [lanesOn, setLanesOn] = useStored('milestoneLanes', true)
  const [bundle, setBundle] = useStored('bundleArrows', true)
  const view: ViewOpts = { hideDone, lanesOn, bundle }
  const setView = (v: Partial<ViewOpts>) => {
    if (v.hideDone !== undefined) setHideDone(v.hideDone)
    if (v.lanesOn !== undefined) setLanesOn(v.lanesOn)
    if (v.bundle !== undefined) setBundle(v.bundle)
  }

  const model = useMemo(
    () => (snap ? buildModel(snap, { hideDone, lanesOn, bundle }) : null),
    [snap, hideDone, lanesOn, bundle],
  )

  // first-render readiness mark (read by the dev loop + curious humans)
  useEffect(() => {
    if (model && window.__READY__ === undefined) window.__READY__ = performance.now()
  }, [model])

  useEffect(() => {
    if (snap) document.title = `${snap.project.name} · blockedBy`
  }, [snap])

  // ---------- pan / zoom ----------
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tf, setTf] = useState<Transform>({ x: 0, y: 0, k: 1 })
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)

  const fit = useCallback(() => {
    const el = wrapRef.current
    const layout = model?.layout
    if (!el || !layout) return
    const { width: cw, height: rawH } = el.getBoundingClientRect()
    const ch = rawH - 84 // keep the bottom lane clear of the legend
    const k = Math.max(Math.min(cw / layout.width, ch / layout.height, 1.08), 0.4)
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
          accountButton={accountButton}
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

  const { layout, byId, byIdentifier, ready, hubs, outCount, doneBlockers, hueOf } = model

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

  const selected = selectedIssue ? byIdentifier.get(selectedIssue) ?? null : null

  // The board shows nothing: no issues at all, everything closed and hidden, or
  // a search / status filter that matches no visible card. The empty state then
  // stands in for the whole board (no milestone bands, no dimmed cards).
  const shown = new Set(layout.nodes.map((n) => n.id))
  const emptyKind: EmptyKind | null =
    snap.issues.length === 0
      ? 'no-issues'
      : shown.size === 0
        ? 'all-closed'
        : focus && ![...focus].some((id) => shown.has(id))
          ? 'no-matches'
          : null
  const hiddenMatches = focus ? [...focus].filter((id) => !shown.has(id)).length : 0

  /** class for an arrow, or null when it stays hidden (a hub's arrows show on hover/select) */
  const edgeState = (from: string, to: string): string | null => {
    const base = `edge ${edgeKind(byId.get(from)!, snap)}`
    if (hover && hoverCone) {
      const upEdge = (to === hover || hoverCone.up.has(to)) && hoverCone.up.has(from)
      const downEdge = (from === hover || hoverCone.down.has(from)) && hoverCone.down.has(to)
      if (upEdge || downEdge) return `${base} is-lit`
      if (hubs.has(from)) return null
      return `${base} is-dim`
    }
    if (hubs.has(from) && selected?.id !== from && selected?.id !== to) return null
    if (focus && (!focus.has(from) || !focus.has(to))) return `${base} is-dim`
    return base
  }

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
        accountButton={accountButton}
        error={error}
        now={now}
      />

      <div
        ref={wrapRef}
        className="graph-canvas"
        onPointerDown={(e) => {
          // panning captures the pointer, which would swallow clicks on cards and overlay controls
          if ((e.target as Element).closest('.gnode, .graph-legend, .zoomctl, .graph-empty-card')) return
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
          if (!(e.target as Element).closest('.gnode, .graph-legend, .zoomctl, .graph-empty-card')) fit()
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
          <g transform={`translate(${tf.x} ${tf.y}) scale(${tf.k})`} display={emptyKind ? 'none' : undefined}>
            {layout.lanes.map((l, i) => (
              <g
                key={l.key}
                className={`lane${l.collapsed ? ' is-collapsed' : ''}${i % 2 ? ' is-odd' : ''}${l.hue !== null ? ' is-hued' : ''}`}
                style={l.hue !== null ? ({ '--lane-h': l.hue } as React.CSSProperties) : undefined}
              >
                {l.label !== null && (
                  <>
                    <rect className="lane-band" x={8} y={l.y} width={layout.width - 16} height={l.height} rx={12} />
                    <text className="lane-label" x={22} y={l.y + (l.collapsed ? 20 : 21)}>
                      {l.label}
                      {l.note && <tspan className="lane-note" dx={8}>{l.note}</tspan>}
                    </text>
                  </>
                )}
                {l.isolatedLabelY !== null && (
                  <text className="grid-label" x={28} y={l.isolatedLabelY}>
                    no blocking relations
                  </text>
                )}
              </g>
            ))}
            {layout.edges.map((e) => {
              const cls = edgeState(e.from, e.to)
              if (!cls) return null
              return (
                <path
                  key={`${e.from}→${e.to}`}
                  className={cls}
                  style={{ '--edge-c': byId.get(e.from) && stateOf(byId.get(e.from)!, snap).color } as React.CSSProperties}
                  d={e.path}
                  markerEnd="url(#arrow)"
                />
              )
            })}
            {layout.nodes.map((n) => {
              const issue = byId.get(n.id)
              if (!issue) return null
              const st = stateOf(issue, snap)
              const isReady = ready.has(n.id)
              const hue = hueOf.get(n.id)
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
                    className={`gnode-box${isReady ? ' is-ready' : ''}${selected?.id === n.id ? ' is-selected' : ''}${hue !== undefined ? ' is-tinted' : ''}`}
                    style={hue !== undefined ? ({ '--lane-h': hue } as React.CSSProperties) : undefined}
                    width={NODE_W}
                    height={NODE_H}
                    rx={10}
                  />
                  {hue !== undefined && (
                    <rect
                      className="gnode-stripe"
                      style={{ '--lane-h': hue } as React.CSSProperties}
                      x={3.5}
                      y={9}
                      width={3}
                      height={NODE_H - 18}
                      rx={1.5}
                    />
                  )}
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
                  {hubs.has(n.id) && (
                    <g className="hub-badge" transform={`translate(${NODE_W + 5} ${NODE_H / 2 - 8})`}>
                      <rect width={56} height={16} rx={8} />
                      <text x={28} y={11} textAnchor="middle">
                        blocks {outCount.get(n.id)}
                      </text>
                    </g>
                  )}
                  <title>{`${issue.identifier} — ${issue.title}\n${st.name}${issue.assignee ? ` · ${issue.assignee.name}` : ''}${
                    doneBlockers.get(n.id) ? `\n${doneBlockers.get(n.id)} blocker(s) done, hidden` : ''
                  }${hubs.has(n.id) ? `\nblocks ${outCount.get(n.id)}: hover or select to show the arrows` : ''}`}</title>
                </g>
              )
            })}
          </g>
        </svg>

        {emptyKind === 'no-issues' && <EmptyBoard kind="no-issues" />}
        {emptyKind === 'all-closed' && (
          <EmptyBoard
            kind="all-closed"
            count={snap.issues.length}
            action={{ label: 'Show closed issues', run: () => setHideDone(false) }}
          />
        )}
        {emptyKind === 'no-matches' && (
          <EmptyBoard
            kind="no-matches"
            query={query.trim()}
            count={hiddenMatches}
            action={{
              label: 'Clear filters',
              run: () => {
                setQuery('')
                setTypeFilter(new Set())
              },
            }}
            secondary={
              hiddenMatches > 0 ? { label: `Show ${hiddenMatches} closed`, run: () => setHideDone(false) } : undefined
            }
          />
        )}

        {!emptyKind && (
          <div className="zoomctl">
            <button type="button" className="seg-btn" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">−</button>
            <button type="button" className="seg-btn" onClick={fit}>fit</button>
            <button type="button" className="seg-btn" onClick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
          </div>
        )}

        <Legend snap={snap} model={model} view={view} setView={setView} empty={emptyKind !== null} />
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
  accountButton,
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
  accountButton: React.ReactNode
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

  const doneCount = [...counts].reduce((n, [t, c]) => n + (isDone(t) ? c : 0), 0)

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
          {!syncing && <span className={`sync-badge${error ? ' is-error' : ''}`} />}
        </button>
        {accountButton}
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
      {(['completed', 'started', 'unstarted', 'triage', 'backlog', 'canceled', 'duplicate'] as StateType[])
        .filter((t) => counts.get(t))
        .map((t) => (
          <span
            key={t}
            style={{
              width: `${((counts.get(t) ?? 0) / total) * 100}%`,
              background: colorOf(t),
              opacity: t === 'backlog' || t === 'canceled' || t === 'duplicate' ? 0.35 : 1,
            }}
            title={`${TYPE_LABEL[t]}: ${counts.get(t)}`}
          />
        ))}
    </div>
  )
}

// ---------------------------------------------------------------- legend

function Legend({
  snap,
  model,
  view,
  setView,
  empty,
}: {
  snap: ProjectSnapshot
  model: Model
  view: ViewOpts
  setView: (v: Partial<ViewOpts>) => void
  /** the board is showing its empty state */
  empty: boolean
}) {
  const { hideDone, lanesOn, bundle } = view
  const hasMilestones = model.milestoneKey.length > 0
  const types = new Map<StateType, WorkflowState>()
  for (const s of Object.values(snap.states)) {
    if (!types.has(s.type)) types.set(s.type, s)
  }
  const started = Object.values(snap.states)
    .filter((s) => s.type === 'started')
    .sort((a, b) => a.position - b.position)[0]
  const arrow = (kind: string, color?: string) => (
    <svg width="22" height="8" viewBox="0 0 22 8">
      <path d="M1 4 H16" className={`edge ${kind}`} style={{ '--edge-c': color } as React.CSSProperties} markerEnd="url(#arrow)" />
    </svg>
  )
  return (
    <div className="graph-legend">
      <div className="legend-controls">
        <Toggle
          on={hideDone}
          onClick={() => setView({ hideDone: !hideDone })}
          title={hideDone ? 'Show done and canceled issues' : 'Hide done and canceled issues'}
        >
          hide done{hideDone && model.hiddenCount ? ` (${model.hiddenCount})` : ''}
        </Toggle>
        {hasMilestones && (
          <Toggle
            on={lanesOn}
            onClick={() => setView({ lanesOn: !lanesOn })}
            title={lanesOn ? 'Show one graph, cards colored by milestone' : 'Group issues into a band per milestone'}
          >
            group by milestone
          </Toggle>
        )}
        {hasMilestones && lanesOn && (
          <Toggle
            on={bundle}
            onClick={() => setView({ bundle: !bundle })}
            title="Run arrows between milestones as tidy cables along the gaps"
          >
            bundle arrows
          </Toggle>
        )}
      </div>
      {/* an empty board keeps only the switches: the key explains nothing on screen */}
      {!empty && (
      <>
      {hasMilestones && !lanesOn && (
        <div className="legend-milestones">
          {model.milestoneKey.map((m) => (
            <span key={m.name} className="legend-item" title={m.name}>
              <span className="legend-swatch" style={{ '--lane-h': m.hue } as React.CSSProperties} />
              {m.name.length > 22 ? `${m.name.slice(0, 21)}…` : m.name}
            </span>
          ))}
        </div>
      )}
      {TYPE_ORDER.filter((t) => types.has(t) && !(hideDone && isDone(t))).map((t) => (
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
      {started && (
        <span className="legend-item">
          {arrow('is-active', started.color)}
          blocker in progress
        </span>
      )}
      <span className="legend-item">
        {arrow('is-waiting')}
        blocker not started
      </span>
      {!hideDone && (
        <span className="legend-item">
          {arrow('is-satisfied')}
          blocker done
        </span>
      )}
      {model.shortcutCount > 0 && (
        <span className="legend-item muted" title="A→C is not drawn when A→B→C already shows it">
          {model.shortcutCount} shortcut {model.shortcutCount === 1 ? 'arrow' : 'arrows'} folded
        </span>
      )}
      {model.layout.edges.length === 0 && (
        <span className="legend-item muted">no blocking relations{hideDone ? ' between open issues' : ' in this project'}</span>
      )}
      </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- empty board

type EmptyKind = 'no-issues' | 'all-closed' | 'no-matches'

interface EmptyAction {
  label: string
  run: () => void
}

function EmptyBoard({
  kind,
  count = 0,
  query = '',
  action,
  secondary,
}: {
  kind: EmptyKind
  count?: number
  query?: string
  action?: EmptyAction
  secondary?: EmptyAction
}) {
  const copy: Record<EmptyKind, { title: string; body: string }> = {
    'no-issues': {
      title: 'No issues yet',
      body: 'This project has no issues in Linear. Add some there and they’ll show up here on the next sync.',
    },
    'all-closed': {
      title: 'Nothing left open',
      body: `All ${count} issue${count === 1 ? ' is' : 's are'} done, canceled or marked duplicate.`,
    },
    'no-matches': {
      title: 'No cards match',
      body: `${query ? `Nothing open matches “${query}” with these filters.` : 'Nothing open matches these filters.'}${
        count ? ` ${count} closed issue${count === 1 ? ' does' : 's do'}.` : ''
      }`,
    },
  }
  const { title, body } = copy[kind]
  return (
    <div className={`graph-empty is-${kind}`}>
      <div className="graph-empty-card">
        <EmptyArt kind={kind} />
        <div className="graph-empty-title">{title}</div>
        <div className="graph-empty-body">{body}</div>
        {(action || secondary) && (
          <div className="graph-empty-actions">
            {action && (
              <button type="button" className="empty-btn is-primary" onClick={action.run}>
                {action.label}
              </button>
            )}
            {secondary && (
              <button type="button" className="empty-btn" onClick={secondary.run}>
                {secondary.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** a tiny board in the app's own language: two cards feeding a third, plus a badge */
function EmptyArt({ kind }: { kind: EmptyKind }) {
  const ghost = kind === 'no-issues'
  const card = (x: number, y: number, done: boolean, i: number) => (
    <g key={i} transform={`translate(${x} ${y})`}>
      <rect className={`ea-card${ghost ? ' is-ghost' : ''}`} width={58} height={24} rx={6} />
      {!ghost && (
        <>
          <circle className={done ? 'ea-dot is-done' : 'ea-dot'} cx={10} cy={12} r={3.6} />
          {done && <path className="ea-tick" d="M8.4 12.1 L9.6 13.3 L11.7 10.9" />}
        </>
      )}
      <rect className="ea-line" x={19} y={7.5} width={24} height={3.2} rx={1.6} />
      <rect className="ea-line is-faint" x={19} y={13.8} width={31} height={2.6} rx={1.3} />
    </g>
  )
  return (
    <svg className="empty-art" viewBox="0 0 176 92" width={176} height={92} aria-hidden="true">
      <path className="ea-edge" d="M66 26 C 86 26, 90 46, 110 46" />
      <path className="ea-edge" d="M66 66 C 86 66, 90 46, 110 46" />
      {card(8, 14, kind === 'all-closed', 0)}
      {card(8, 54, kind === 'all-closed', 1)}
      {card(110, 34, kind === 'all-closed', 2)}
      <g className={`ea-badge is-${kind}`} transform="translate(160 24)">
        <circle r={12} />
        {kind === 'all-closed' && <path d="M-4.6 0.3 L-1.4 3.4 L4.8 -3.4" />}
        {kind === 'no-matches' && (
          <>
            <circle className="ea-lens" cx={-1.4} cy={-1.4} r={4.2} />
            <path d="M1.8 1.8 L5 5" />
          </>
        )}
        {kind === 'no-issues' && <path d="M0 -5 V5 M-5 0 H5" />}
      </g>
    </svg>
  )
}

function Toggle({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`toggle${on ? ' is-on' : ''}`} onClick={onClick} title={title}>
      <span className="toggle-track">
        <span className="toggle-knob" />
      </span>
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- model

interface ViewOpts {
  hideDone: boolean
  /** a band per milestone; off = one graph with cards colored by milestone */
  lanesOn: boolean
  /** arrows between milestone bands run as cables */
  bundle: boolean
}

interface Model {
  layout: ReturnType<typeof layoutGraph>
  byId: Map<string, Issue>
  byIdentifier: Map<string, Issue>
  preds: Map<string, string[]>
  succs: Map<string, string[]>
  ready: Set<string>
  /** issues with so many arrows out that they show as a badge until hovered */
  hubs: Set<string>
  outCount: Map<string, number>
  /** per visible issue: how many of its blockers are done and hidden */
  doneBlockers: Map<string, number>
  hiddenCount: number
  shortcutCount: number
  /** card tint per issue, only when milestones are shown without lanes */
  hueOf: Map<string, number>
  /** milestones with their hue, in Linear's order */
  milestoneKey: { name: string; hue: number }[]
}

const HUB_MIN = 6
const NO_MILESTONE = '__none'

/** arrow class by the blocker's status: is it still in the way, and is anyone on it? */
function edgeKind(blocker: Issue, snap: ProjectSnapshot): string {
  const t = stateOf(blocker, snap).type
  if (isDone(t)) return 'is-satisfied'
  return t === 'started' ? 'is-active' : 'is-waiting'
}

function buildModel(snap: ProjectSnapshot, { hideDone, lanesOn, bundle }: ViewOpts): Model {
  const byId = new Map(snap.issues.map((i) => [i.id, i]))
  const byIdentifier = new Map(snap.issues.map((i) => [i.identifier, i]))
  const done = (id: string) => isDone(stateOf(byId.get(id)!, snap).type)

  const visible = snap.issues.filter((i) => !hideDone || !done(i.id)).map((i) => i.id)
  const shown = new Set(visible)

  const all: { from: string; to: string }[] = []
  for (const i of snap.issues) {
    for (const to of i.blocks) all.push({ from: i.id, to })
    for (const from of i.blockedBy) all.push({ from, to: i.id })
  }
  const visEdges = [...new Map(all.filter((e) => shown.has(e.from) && shown.has(e.to)).map((e) => [`${e.from}→${e.to}`, e])).values()]
  const edges = transitiveReduction(visEdges)

  const num = (id: string) => {
    const i = byId.get(id)!
    const m = /(\d+)$/.exec(i.identifier)
    return m ? Number(m[1]) : 0
  }

  // ---- lanes: one per milestone in Linear's order, then issues with none ----
  const milestones = snap.milestones ?? []
  const msIds = new Set(milestones.map((m) => m.id))
  const hueById = new Map(milestones.map((m, i) => [m.id, MILESTONE_HUES[i % MILESTONE_HUES.length]]))
  const milestoneKey = milestones.map((m) => ({ name: m.name, hue: hueById.get(m.id)! }))
  const laneOf = (id: string) => {
    const m = byId.get(id)!.milestoneId
    return m && msIds.has(m) ? m : NO_MILESTONE
  }
  const hueOf = new Map<string, number>()
  if (!lanesOn) {
    for (const id of visible) {
      const h = hueById.get(laneOf(id))
      if (h !== undefined) hueOf.set(id, h)
    }
  }
  let lanes: LaneSpec[] | undefined
  if (milestones.length && lanesOn) {
    lanes = [...milestones, { id: NO_MILESTONE, name: 'No milestone' }].flatMap((m) => {
      const issues = snap.issues.filter((i) => laneOf(i.id) === m.id)
      if (!issues.length) return []
      const types = issues.map((i) => stateOf(i, snap).type)
      const completed = types.filter((t) => t === 'completed').length
      const canceled = types.filter((t) => t === 'canceled').length
      const duplicate = types.filter((t) => t === 'duplicate').length
      const open = issues.length - completed - canceled - duplicate
      const closed = [
        completed && `${completed} done`,
        canceled && `${canceled} canceled`,
        duplicate && `${duplicate} duplicate`,
      ]
        .filter(Boolean)
        .join(', ')
      const note = open
        ? `${open} open${closed ? ` · ${closed}${hideDone ? ' (hidden)' : ''}` : ''}`
        : `nothing open · ${closed}`
      return [{ key: m.id, label: m.name, note, collapsed: hideDone && open === 0, hue: hueById.get(m.id) ?? null }]
    })
  }

  const layout = layoutGraph({ ids: visible, edges, order: num, laneOf: lanes && laneOf, lanes, bundle })

  const preds = new Map<string, string[]>(snap.issues.map((i) => [i.id, []]))
  const succs = new Map<string, string[]>(snap.issues.map((i) => [i.id, []]))
  for (const e of layout.edges) {
    preds.get(e.to)!.push(e.from)
    succs.get(e.from)!.push(e.to)
  }

  const ready = new Set(
    snap.issues.filter((i) => isActionable(i, snap, byId)).map((i) => i.id),
  )

  const outCount = new Map([...succs].map(([id, s]) => [id, s.length]))
  const hubs = new Set([...outCount].filter(([, n]) => n >= HUB_MIN).map(([id]) => id))

  const doneBlockers = new Map<string, number>()
  if (hideDone) {
    for (const id of visible) {
      const n = byId.get(id)!.blockedBy.filter((b) => byId.has(b) && done(b)).length
      if (n) doneBlockers.set(id, n)
    }
  }

  return {
    layout,
    byId,
    byIdentifier,
    preds,
    succs,
    ready,
    hubs,
    outCount,
    doneBlockers,
    hiddenCount: snap.issues.length - visible.length,
    shortcutCount: visEdges.length - edges.length,
    hueOf,
    milestoneKey,
  }
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
