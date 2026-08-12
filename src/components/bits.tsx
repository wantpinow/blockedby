import { useState } from 'react'
import type { Issue, Person, ProjectSnapshot } from '../types'
import { stateOf, startedFraction } from '../lib/state'
import { StateIcon } from './StateIcon'

/** HTML avatar with initials fallback */
export function Avatar({ person, size = 18 }: { person: Person; size?: number }) {
  const [broken, setBroken] = useState(false)
  const showImg = person.avatarUrl && !broken
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      title={person.name}
    >
      {person.initials}
      {showImg && (
        <img src={person.avatarUrl!} alt={person.name} onError={() => setBroken(true)} />
      )}
    </span>
  )
}

/** Linear-style priority glyph: urgent box or 1–3 signal bars */
export function PriorityIcon({ priority, size = 14 }: { priority: number; size?: number }) {
  if (!priority) return null
  if (priority === 1) {
    return (
      <svg viewBox="0 0 16 16" width={size} height={size} className="prio prio-urgent" aria-label="Urgent">
        <rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill="currentColor" />
        <path d="M8 4.5v4.2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="8" cy="11.4" r="1" fill="#fff" />
      </svg>
    )
  }
  const bars = priority === 2 ? 3 : priority === 3 ? 2 : 1
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className="prio" aria-label={`Priority ${priority}`}>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={2 + i * 4.4}
          y={10.5 - i * 3.4}
          width="3"
          height={3.5 + i * 3.4}
          rx="1"
          fill="currentColor"
          opacity={i < bars ? 1 : 0.28}
        />
      ))}
    </svg>
  )
}

/** small interactive issue reference — identifier + live state icon */
export function IssueChip({
  issue,
  snap,
  onOpen,
  muted = false,
}: {
  issue: Issue
  snap: ProjectSnapshot
  onOpen: (identifier: string) => void
  muted?: boolean
}) {
  const st = stateOf(issue, snap)
  return (
    <button
      type="button"
      className={`chip chip-issue${muted ? ' is-muted' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(issue.identifier)
      }}
      title={`${issue.identifier} — ${issue.title}`}
    >
      <StateIcon state={st} fraction={startedFraction(st, snap)} size={11} />
      <span className="mono">{issue.identifier}</span>
    </button>
  )
}
