export const NODE_W = 190
export const NODE_H = 48
const GAP_X = 68
const GAP_Y = 22
const PITCH = NODE_H + GAP_Y
const MARGIN = 28
const LANE_HEAD = 34
const LANE_PAD = 16
const LANE_GAP = 10
const COLLAPSED_H = 32
const ISO_HEAD = 26

export interface GNode {
  id: string
  x: number
  y: number
}

export interface GEdge {
  from: string
  to: string
  path: string
}

export interface LaneSpec {
  key: string
  /** null = no header (the project has no milestones) */
  label: string | null
  note?: string
  /** draw as a thin bar with no issues (everything in it is hidden) */
  collapsed?: boolean
  /** pastel hue for the band; null = neutral */
  hue?: number | null
}

export interface LaneBox {
  key: string
  label: string | null
  note?: string
  hue: number | null
  collapsed: boolean
  y: number
  height: number
  /** y of the "no blocking relations" label inside this lane, if it has both kinds */
  isolatedLabelY: number | null
}

export interface Layout {
  nodes: GNode[]
  edges: GEdge[]
  lanes: LaneBox[]
  width: number
  height: number
}

export interface LayoutInput {
  ids: string[]
  edges: { from: string; to: string }[]
  /** stable ordering hint for columns and the isolated grid */
  order: (id: string) => string | number
  /** which lane an id sits in; defaults to one unlabeled lane */
  laneOf?: (id: string) => string
  lanes?: LaneSpec[]
  /**
   * Route arrows between lanes as cables: out of the source into the gutter
   * beside it, along a channel between lanes, down the gutter beside the
   * target. Cables sharing a gutter or channel run side by side.
   */
  bundle?: boolean
}

/** height of the gap between lanes when a cable trunk runs along it */
const CHANNEL = 14
/** half the distance between a gutter's down trunk and its up trunk */
const TRUNK_SPLIT = 3

const SINGLE: LaneSpec[] = [{ key: '', label: null }]

/**
 * Layered DAG in horizontal lanes. Columns are global (longest-path depth,
 * left → right) so arrows always point right, even between lanes; each lane
 * stacks its issues on a shared row grid. Issues with no relations fill a grid
 * at the bottom of their lane. Arrows that skip columns are routed along a
 * free row or the gap between rows, so they never pass behind a card.
 */
export function layoutGraph({ ids, edges: rawEdges, order, laneOf, lanes: laneSpecs, bundle }: LayoutInput): Layout {
  const specs = laneSpecs?.length ? laneSpecs : SINGLE
  const laneKey = laneOf ?? (() => specs[0].key)
  const laneIdx = new Map(specs.map((s, i) => [s.key, i]))
  const laneOfId = (id: string) => laneIdx.get(laneKey(id)) ?? specs.length - 1

  const idSet = new Set(ids)
  const edgePairs = dedupe(rawEdges).filter((e) => idSet.has(e.from) && idSet.has(e.to))

  const linked = new Set<string>()
  for (const e of edgePairs) {
    linked.add(e.from)
    linked.add(e.to)
  }
  const connected = ids.filter((id) => linked.has(id))
  const isolated = ids.filter((id) => !linked.has(id)).sort(cmpBy(order))

  const preds = new Map<string, string[]>(connected.map((id) => [id, []]))
  const succs = new Map<string, string[]>(connected.map((id) => [id, []]))
  for (const e of edgePairs) {
    preds.get(e.to)!.push(e.from)
    succs.get(e.from)!.push(e.to)
  }

  // ---- depth = longest path from any root (Kahn), compressed to columns ----
  const depth = longestPath(connected, preds, succs)
  const depthKeys = [...new Set(depth.values())].sort((a, b) => a - b)
  const colOfDepth = new Map(depthKeys.map((d, i) => [d, i]))
  const col = new Map(connected.map((id) => [id, colOfDepth.get(depth.get(id)!)!]))
  const nCols = Math.max(1, depthKeys.length)

  // ---- groups: one ordered list per (lane, column) ----
  const groups: string[][][] = specs.map(() => Array.from({ length: nCols }, () => []))
  for (const id of [...connected].sort(cmpBy(order))) groups[laneOfId(id)][col.get(id)!].push(id)

  // barycenter sweeps; rank folds the lane in so cross-lane neighbors pull
  // a node toward the lane edge they sit beyond
  const rank = new Map<string, number>()
  const rerank = () =>
    groups.forEach((lane, li) => lane.forEach((g) => g.forEach((id, ri) => rank.set(id, li * 1000 + ri))))
  rerank()
  const sortColumn = (c: number, nbrs: Map<string, string[]>) => {
    for (const lane of groups) {
      lane[c] = lane[c]
        .map((id) => {
          const ns = nbrs.get(id)!.map((n) => rank.get(n)!)
          return { id, bary: ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : rank.get(id)! }
        })
        .sort((a, b) => a.bary - b.bary || cmpBy(order)(a.id, b.id))
        .map((x) => x.id)
    }
    rerank()
  }
  for (let sweep = 0; sweep < 6; sweep++) {
    if (sweep % 2 === 0) for (let c = 1; c < nCols; c++) sortColumn(c, preds)
    else for (let c = nCols - 2; c >= 0; c--) sortColumn(c, succs)
  }

  // ---- cables: arrows between lanes, and the channel each one runs along ----
  // Cables share trunks: one per gutter per direction, one per channel. They
  // join and leave a trunk instead of crossing each other.
  const cables = new Set<string>()
  /** channel key `${lane}:above|below` → the cables that run along it */
  const channels = new Map<string, string[]>()
  const chanOf = new Map<string, string>()
  if (bundle && specs.length > 1) {
    for (const e of edgePairs) {
      const ls = laneOfId(e.from)
      const lt = laneOfId(e.to)
      if (ls === lt) continue
      cables.add(key(e))
      if (col.get(e.to)! - 1 <= col.get(e.from)!) continue // neighbouring columns: one run down the shared gutter
      const ch = `${lt}:${ls < lt ? 'above' : 'below'}`
      chanOf.set(key(e), ch)
      ;(channels.get(ch) ?? channels.set(ch, []).get(ch)!).push(key(e))
    }
  }
  /** channel key → trunk y */
  const chanY = new Map<string, number>()

  // ---- coordinates ----
  const colX = (c: number) => MARGIN + c * (NODE_W + GAP_X)
  const isoPer = Math.max(4, nCols)
  const pos = new Map<string, GNode>()
  /** every row slot on the grid, for routing: y of its top, and which columns hold a card */
  const rows: { y: number; used: Set<number> }[] = []
  /** y of the gap below/above rows, also free for routing */
  const gaps: number[] = []
  const laneBoxes: LaneBox[] = []
  let cursor = MARGIN - (specs[0].label ? 6 : 0)

  specs.forEach((spec, li) => {
    const laneGroups = groups[li]
    const laneIso = isolated.filter((id) => laneOfId(id) === li)
    const hasNodes = laneGroups.some((g) => g.length) || laneIso.length > 0
    if (spec.collapsed) {
      laneBoxes.push({ ...box(spec), collapsed: true, y: cursor, height: COLLAPSED_H, isolatedLabelY: null })
      cursor += COLLAPSED_H + LANE_GAP
      return
    }
    if (!hasNodes) return

    // channel above this lane carries cables coming down into it
    if (channels.has(`${li}:above`)) {
      chanY.set(`${li}:above`, cursor + CHANNEL / 2)
      cursor += CHANNEL
    }

    const top = cursor
    let y = top + (spec.label ? LANE_HEAD : 0)
    const dagRows = Math.max(0, ...laneGroups.map((g) => g.length))
    const firstRow = rows.length
    for (let r = 0; r < dagRows; r++) rows.push({ y: y + r * PITCH, used: new Set() })
    laneGroups.forEach((g, c) => {
      const offset = Math.floor((dagRows - g.length) / 2)
      g.forEach((id, i) => {
        const row = rows[firstRow + offset + i]
        row.used.add(c)
        pos.set(id, { id, x: colX(c), y: row.y })
      })
    })
    for (let r = 0; r <= dagRows; r++) if (dagRows) gaps.push(y + r * PITCH - GAP_Y / 2)
    y += dagRows ? dagRows * PITCH - GAP_Y : 0

    let isolatedLabelY: number | null = null
    if (laneIso.length) {
      if (dagRows) {
        isolatedLabelY = y + ISO_HEAD - 8
        y += ISO_HEAD + 6
      }
      const isoRows = Math.ceil(laneIso.length / isoPer)
      for (let r = 0; r < isoRows; r++) {
        const row = { y: y + r * PITCH, used: new Set<number>() }
        rows.push(row)
        laneIso.slice(r * isoPer, (r + 1) * isoPer).forEach((id, c) => {
          row.used.add(c)
          pos.set(id, { id, x: colX(c), y: row.y })
        })
      }
      y += isoRows * PITCH - GAP_Y
    }

    const height = y - top + LANE_PAD
    laneBoxes.push({ ...box(spec), collapsed: false, y: top, height, isolatedLabelY })
    cursor = top + height

    // channel below this lane carries cables coming up into it
    if (channels.has(`${li}:below`)) {
      chanY.set(`${li}:below`, cursor + CHANNEL / 2)
      cursor += CHANNEL
    }
    cursor += LANE_GAP
  })

  const usedCols = Math.max(nCols, isolated.length ? Math.min(isoPer, isolated.length) : 0)
  const width = MARGIN * 2 + usedCols * NODE_W + (usedCols - 1) * GAP_X
  const height = Math.max(cursor - LANE_GAP + MARGIN - LANE_PAD, MARGIN * 2)

  // ---- edges ----
  const portY = ports(edgePairs, pos)
  const tracks = new Map<number, [number, number][]>()
  const end = (e: { from: string; to: string }) => ({
    y1: pos.get(e.from)!.y + NODE_H / 2 + portY.out.get(key(e))!,
    y2: pos.get(e.to)!.y + NODE_H / 2 + portY.in.get(key(e))!,
  })

  // a gutter (right of column g) holds two trunks: cables heading down on the
  // left, cables heading up on the right
  const trunkX = (g: number, down: boolean) => colX(g) + NODE_W + GAP_X / 2 + (down ? -TRUNK_SPLIT : TRUNK_SPLIT)

  const edges: GEdge[] = edgePairs.map((e) => {
    const k = key(e)
    if (cables.has(k)) {
      const { y1, y2 } = end(e)
      const x1 = pos.get(e.from)!.x + NODE_W
      const x2 = pos.get(e.to)!.x
      const g1 = col.get(e.from)!
      const g2 = col.get(e.to)! - 1
      const ch = chanOf.get(k)
      const down = y2 > y1
      let pts: [number, number][]
      if (ch === undefined) {
        const gx = trunkX(g1, down)
        pts = [[x1, y1], [gx, y1], [gx, y2], [x2, y2]]
      } else {
        const cy = chanY.get(ch)!
        const ax = trunkX(g1, cy > y1)
        const bx = trunkX(g2, y2 > cy)
        pts = [[x1, y1], [ax, y1], [ax, cy], [bx, cy], [bx, y2], [x2, y2]]
      }
      return { ...e, path: roundedPath(pts) }
    }
    const a = pos.get(e.from)!
    const b = pos.get(e.to)!
    const x1 = a.x + NODE_W
    const y1 = a.y + NODE_H / 2 + portY.out.get(key(e))!
    const x2 = b.x
    const y2 = b.y + NODE_H / 2 + portY.in.get(key(e))!
    const c1 = col.get(e.from)!
    const c2 = col.get(e.to)!
    if (c2 - c1 <= 1) {
      const c = Math.max(30, Math.abs(x2 - x1) / 2)
      return { ...e, path: `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}` }
    }
    const t = pickTrack(c1, c2, y1, y2, rows, gaps, tracks)
    const xa = colX(c1 + 1)
    const xb = colX(c2 - 1) + NODE_W
    const h = GAP_X / 2
    return {
      ...e,
      path: `M ${x1} ${y1} C ${x1 + h} ${y1}, ${xa - h} ${t}, ${xa} ${t} H ${xb} C ${xb + h} ${t}, ${x2 - h} ${y2}, ${x2} ${y2}`,
    }
  })

  return { nodes: [...pos.values()], edges, lanes: laneBoxes, width, height }
}

/**
 * Drop A→C when A reaches C another way (A→B→…→C). The graph keeps the same
 * "what waits on what", with fewer arrows.
 */
export function transitiveReduction<E extends { from: string; to: string }>(input: E[]): E[] {
  const edges = dedupe(input)
  const succ = new Map<string, string[]>()
  for (const e of edges) (succ.get(e.from) ?? succ.set(e.from, []).get(e.from)!).push(e.to)
  const reachesAvoiding = (from: string, to: string): boolean => {
    const stack = (succ.get(from) ?? []).filter((n) => n !== to)
    const seen = new Set<string>([from])
    while (stack.length) {
      const cur = stack.pop()!
      if (cur === to) return true
      if (seen.has(cur)) continue
      seen.add(cur)
      stack.push(...(succ.get(cur) ?? []))
    }
    return false
  }
  return edges.filter((e) => !reachesAvoiding(e.from, e.to))
}

/** ancestors (up) + descendants (down) along block edges, for hover cones */
export function cone(
  id: string,
  preds: Map<string, string[]>,
  succs: Map<string, string[]>,
): { up: Set<string>; down: Set<string> } {
  const up = new Set<string>()
  const down = new Set<string>()
  const walk = (cur: string, dir: Map<string, string[]>, acc: Set<string>) => {
    for (const n of dir.get(cur) ?? []) {
      if (!acc.has(n)) {
        acc.add(n)
        walk(n, dir, acc)
      }
    }
  }
  walk(id, preds, up)
  walk(id, succs, down)
  return { up, down }
}

// ---------------------------------------------------------------- helpers

function box(spec: LaneSpec) {
  return { key: spec.key, label: spec.label, note: spec.note, hue: spec.hue ?? null }
}

/** pastel hues handed out to milestones in order */
export const MILESTONE_HUES = [212, 152, 28, 268, 340, 48, 186, 8, 96, 240]

/** M → L … with each corner rounded, for orthogonal cable runs */
function roundedPath(raw: [number, number][], r = 7): string {
  const pts = raw.filter((p, i) => i === 0 || p[0] !== raw[i - 1][0] || p[1] !== raw[i - 1][1])
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1]
    const [x, y] = pts[i]
    const [nx, ny] = pts[i + 1]
    const l1 = Math.hypot(x - px, y - py)
    const l2 = Math.hypot(nx - x, ny - y)
    const rr = Math.min(r, l1 / 2, l2 / 2)
    if (rr < 0.5) {
      d += ` L ${x} ${y}`
      continue
    }
    d += ` L ${x + ((px - x) / l1) * rr} ${y + ((py - y) / l1) * rr} Q ${x} ${y} ${x + ((nx - x) / l2) * rr} ${y + ((ny - y) / l2) * rr}`
  }
  const last = pts[pts.length - 1]
  return `${d} L ${last[0]} ${last[1]}`
}

function key(e: { from: string; to: string }) {
  return `${e.from}→${e.to}`
}

function dedupe<E extends { from: string; to: string }>(edges: E[]): E[] {
  const seen = new Set<string>()
  return edges.filter((e) => {
    if (e.from === e.to || seen.has(key(e))) return false
    seen.add(key(e))
    return true
  })
}

function longestPath(ids: string[], preds: Map<string, string[]>, succs: Map<string, string[]>) {
  const indeg = new Map(ids.map((id) => [id, preds.get(id)!.length]))
  const depth = new Map<string, number>()
  const work = ids.filter((id) => indeg.get(id) === 0)
  work.forEach((id) => depth.set(id, 0))
  while (work.length) {
    const id = work.shift()!
    for (const nxt of succs.get(id)!) {
      depth.set(nxt, Math.max(depth.get(nxt) ?? 0, depth.get(id)! + 1))
      indeg.set(nxt, indeg.get(nxt)! - 1)
      if (indeg.get(nxt) === 0) work.push(nxt)
    }
  }
  // cycle fallback: park anything unplaced one column past the frontier
  const maxPlaced = Math.max(0, ...depth.values())
  for (const id of ids) if (!depth.has(id)) depth.set(id, maxPlaced + 1)
  return depth
}

/** spread a node's arrows along its side, ordered by where the other end sits */
function ports(edges: { from: string; to: string }[], pos: Map<string, GNode>) {
  const out = new Map<string, number>()
  const inn = new Map<string, number>()
  const spread = (list: { k: string; y: number }[], into: Map<string, number>) => {
    list.sort((a, b) => a.y - b.y)
    const step = Math.min(6, 26 / Math.max(1, list.length - 1))
    list.forEach((x, i) => into.set(x.k, (i - (list.length - 1) / 2) * step))
  }
  const byFrom = new Map<string, { k: string; y: number }[]>()
  const byTo = new Map<string, { k: string; y: number }[]>()
  for (const e of edges) {
    ;(byFrom.get(e.from) ?? byFrom.set(e.from, []).get(e.from)!).push({ k: key(e), y: pos.get(e.to)!.y })
    ;(byTo.get(e.to) ?? byTo.set(e.to, []).get(e.to)!).push({ k: key(e), y: pos.get(e.from)!.y })
  }
  byFrom.forEach((l) => spread(l, out))
  byTo.forEach((l) => spread(l, inn))
  return { out, in: inn }
}

/**
 * A horizontal track an arrow can run along through columns c1+1 … c2-1
 * without crossing a card: an empty row, or the gap between rows. Prefers the
 * track closest to both ends; arrows sharing a track are nudged apart.
 */
function pickTrack(
  c1: number,
  c2: number,
  y1: number,
  y2: number,
  rows: { y: number; used: Set<number> }[],
  gaps: number[],
  taken: Map<number, [number, number][]>,
): number {
  const candidates: { y: number; cost: number; room: number }[] = []
  for (const r of rows) {
    let free = true
    for (let c = c1 + 1; c < c2 && free; c++) if (r.used.has(c)) free = false
    if (free) candidates.push({ y: r.y + NODE_H / 2, cost: 0, room: 8 })
  }
  for (const g of gaps) candidates.push({ y: g, cost: 10, room: 4 })
  let best = candidates[0] ?? { y: (y1 + y2) / 2, cost: 0, room: 4 }
  let bestScore = Infinity
  for (const t of candidates) {
    const score = Math.abs(t.y - y1) + Math.abs(t.y - y2) + t.cost
    if (score < bestScore) {
      bestScore = score
      best = t
    }
  }
  const used = taken.get(best.y) ?? taken.set(best.y, []).get(best.y)!
  const overlaps = used.filter(([a, b]) => a < c2 && c1 < b).length
  used.push([c1, c2])
  const n = Math.ceil(overlaps / 2) * (overlaps % 2 ? 1 : -1)
  return best.y + n * best.room
}

function cmpBy(order: (id: string) => string | number) {
  return (a: string, b: string) => {
    const oa = order(a)
    const ob = order(b)
    if (oa < ob) return -1
    if (oa > ob) return 1
    return 0
  }
}
