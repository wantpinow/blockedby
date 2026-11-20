import type { WorkflowState } from '../types'

/** pie-slice path from 12 o'clock, fraction f of a full turn */
function pie(cx: number, cy: number, r: number, f: number): string {
  const a = -Math.PI / 2 + Math.min(0.9999, f) * Math.PI * 2
  const x = cx + r * Math.cos(a)
  const y = cy + r * Math.sin(a)
  const large = f > 0.5 ? 1 : 0
  return `M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 ${large} 1 ${x} ${y} Z`
}

/**
 * Linear's visual language, colored by the workspace's own state colors:
 * backlog = dashed ring · todo = ring · started = ring + pie fill ·
 * done = filled check · canceled / duplicate = filled ×
 */
export function StateIcon({
  state,
  fraction = 0.5,
  size = 14,
}: {
  state: WorkflowState
  fraction?: number
  size?: number
}) {
  const s = { width: size, height: size, flex: 'none' as const, color: state.color }
  let inner: React.ReactNode
  switch (state.type) {
    case 'backlog':
    case 'triage':
      inner = (
        <circle
          cx="8"
          cy="8"
          r="5.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeDasharray="1.6 2.1"
          strokeLinecap="round"
        />
      )
      break
    case 'unstarted':
      inner = <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      break
    case 'started':
      inner = (
        <>
          <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d={pie(8, 8, 3.2, fraction)} fill="currentColor" />
        </>
      )
      break
    case 'completed':
      inner = (
        <>
          <circle cx="8" cy="8" r="6.4" fill="currentColor" />
          <path
            d="M5.1 8.3 L7.2 10.3 L11 5.9"
            fill="none"
            stroke="var(--surface)"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )
      break
    case 'canceled':
    case 'duplicate':
      inner = (
        <>
          <circle cx="8" cy="8" r="6.4" fill="currentColor" />
          <path
            d="M5.6 5.6 L10.4 10.4 M10.4 5.6 L5.6 10.4"
            stroke="var(--surface)"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </>
      )
      break
  }
  return (
    <svg viewBox="0 0 16 16" style={s} role="img" aria-label={state.name}>
      {inner}
    </svg>
  )
}
