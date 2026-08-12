export const NODE_W = 190
export const NODE_H = 48
const GAP_X = 68
const GAP_Y = 22
const MARGIN = 28
const GRID_GAP_X = 20
const GRID_GAP_Y = 16
const GRID_SECTION_GAP = 88

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

export interface Layout {
  nodes: GNode[]
  edges: GEdge[]
  width: number
  height: number
  /** y of the "unlinked issues" section label, if any isolated nodes exist */
  gridLabelY: number | null
  isolatedCount: number
}

export interface LayoutInput {
  ids: string[]
  edges: { from: string; to: string }[]
  /** stable ordering hint for columns and the isolated grid */
  order: (id: string) => string | number
}

/**
 * Layered DAG (left → right by longest-path depth, barycenter sweeps for
 * crossing reduction, columns vertically centered) for every node touched by
 * an edge; nodes with no relations flow into a tidy grid below the DAG.
 */
export function layoutGraph({ ids, edges: rawEdges, order }: LayoutInput): Layout {
  const idSet = new Set(ids)
  const seen = new Set<string>()
  const edgePairs = rawEdges.filter((e) => {
    if (!idSet.has(e.from) || !idSet.has(e.to) || e.from === e.to) return false
    const k = `${e.from}→${e.to}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

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

  // ---- depth = longest path from any root (Kahn) ----
  const indeg = new Map(connected.map((id) => [id, preds.get(id)!.length]))
  const depth = new Map<string, number>()
  const queue = connected.filter((id) => indeg.get(id) === 0)
  queue.forEach((id) => depth.set(id, 0))
  const work = [...queue]
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
  for (const id of connected) if (!depth.has(id)) depth.set(id, maxPlaced + 1)

  // ---- columns + barycenter sweeps ----
  const cols = new Map<number, string[]>()
  for (const id of connected) {
    const d = depth.get(id)!
    ;(cols.get(d) ?? cols.set(d, []).get(d)!).push(id)
  }
  const colKeys = [...cols.keys()].sort((a, b) => a - b)
  for (const k of colKeys) cols.get(k)!.sort(cmpBy(order))

  const rowOf = new Map<string, number>()
  const reindex = () => {
    for (const k of colKeys) cols.get(k)!.forEach((id, i) => rowOf.set(id, i))
  }
  reindex()
  const sortCol = (k: number, neighbors: Map<string, string[]>) => {
    const col = cols.get(k)!
    const keyed = col.map((id) => {
      const ns = neighbors.get(id)!.map((n) => rowOf.get(n) ?? 0)
      const bary = ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : rowOf.get(id)!
      return { id, bary }
    })
    keyed.sort((a, b) => a.bary - b.bary || cmpBy(order)(a.id, b.id))
    cols.set(
      k,
      keyed.map((x) => x.id),
    )
  }
  for (let sweep = 0; sweep < 4; sweep++) {
    if (sweep % 2 === 0) {
      for (const k of colKeys.slice(1)) {
        sortCol(k, preds)
        reindex()
      }
    } else {
      for (const k of [...colKeys].reverse().slice(1)) {
        sortCol(k, succs)
        reindex()
      }
    }
  }

  // ---- coordinates ----
  const maxRows = Math.max(1, ...colKeys.map((k) => cols.get(k)!.length))
  const dagHeight = connected.length
    ? MARGIN * 2 + maxRows * NODE_H + (maxRows - 1) * GAP_Y
    : MARGIN
  const pos = new Map<string, GNode>()
  colKeys.forEach((k, ci) => {
    const col = cols.get(k)!
    const colH = col.length * NODE_H + (col.length - 1) * GAP_Y
    const y0 = MARGIN + (dagHeight - MARGIN * 2 - colH) / 2
    col.forEach((id, ri) => {
      pos.set(id, { id, x: MARGIN + ci * (NODE_W + GAP_X), y: y0 + ri * (NODE_H + GAP_Y) })
    })
  })
  const dagWidth = connected.length
    ? MARGIN * 2 + colKeys.length * NODE_W + (colKeys.length - 1) * GAP_X
    : MARGIN

  // ---- isolated grid below the DAG ----
  let gridLabelY: number | null = null
  let height = dagHeight
  let width = dagWidth
  if (isolated.length) {
    const per = connected.length
      ? Math.max(3, Math.round((dagWidth - MARGIN * 2 + GAP_X) / (NODE_W + GRID_GAP_X)))
      : Math.max(2, Math.min(8, Math.ceil(Math.sqrt(isolated.length * 2.4))))
    const y0 = connected.length ? dagHeight + GRID_SECTION_GAP - 34 : MARGIN + 18
    gridLabelY = y0 - 14
    isolated.forEach((id, i) => {
      const c = i % per
      const r = Math.floor(i / per)
      pos.set(id, {
        id,
        x: MARGIN + c * (NODE_W + GRID_GAP_X),
        y: y0 + r * (NODE_H + GRID_GAP_Y),
      })
    })
    const rows = Math.ceil(isolated.length / per)
    height = y0 + rows * (NODE_H + GRID_GAP_Y) - GRID_GAP_Y + MARGIN
    width = Math.max(
      width,
      MARGIN * 2 + Math.min(per, isolated.length) * (NODE_W + GRID_GAP_X) - GRID_GAP_X,
    )
  }

  const edges: GEdge[] = edgePairs.map((e) => {
    const a = pos.get(e.from)!
    const b = pos.get(e.to)!
    const x1 = a.x + NODE_W
    const y1 = a.y + NODE_H / 2
    const x2 = b.x
    const y2 = b.y + NODE_H / 2
    const c = Math.max(30, Math.abs(x2 - x1) / 2)
    return {
      from: e.from,
      to: e.to,
      path: `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`,
    }
  })

  return {
    nodes: [...pos.values()],
    edges,
    width,
    height,
    gridLabelY,
    isolatedCount: isolated.length,
  }
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
