import { useEffect, useRef, useState } from 'react'
import { adoptToken, validateKey } from '../lib/linear'
import { kvSet } from '../lib/idb'

export function Welcome({
  notice,
  onDone,
  themeButton,
}: {
  notice?: string
  onDone: () => void
  themeButton: React.ReactNode
}) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.title = 'linear-viz'
    inputRef.current?.focus()
  }, [])

  const submit = async () => {
    const k = key.trim()
    if (!k || busy) return
    setBusy(true)
    setError(null)
    try {
      const viewer = await validateKey(k)
      await adoptToken(k)
      await kvSet('viewer', viewer)
      onDone()
    } catch (e) {
      setError(
        e instanceof Error && /rejected/i.test(e.message)
          ? "Linear didn't accept that key. Check it and try again."
          : `Couldn't reach Linear — ${e instanceof Error ? e.message : 'unknown error'}.`,
      )
      setBusy(false)
    }
  }

  return (
    <div className="welcome">
      <div className="welcome-theme">{themeButton}</div>

      <div className="welcome-body">
        <div className="welcome-mark" aria-hidden>
          <svg viewBox="0 0 48 48" width="46" height="46">
            <path className="wm-edge" d="M15 32.5 L20.5 17.5" pathLength="1" />
            <path className="wm-edge wm-edge-2" d="M26 15.5 L33 26.5" pathLength="1" />
            <circle className="wm-node" cx="13" cy="37" r="4.4" />
            <circle className="wm-node wm-n2" cx="23" cy="12" r="4.4" />
            <circle className="wm-node wm-n3" cx="35.5" cy="31" r="4.4" />
          </svg>
        </div>

        <h1 className="welcome-title">linear-viz</h1>
        <p className="welcome-sub">
          Your Linear projects as live dependency graphs —
          <br />
          laid out by what blocks what.
        </p>

        {notice && <div className="welcome-notice">{notice}</div>}

        <form
          className="keycard"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label className="keycard-label" htmlFor="apikey">
            Personal API key
          </label>
          <div className="keycard-row">
            <input
              id="apikey"
              ref={inputRef}
              className="keyinput mono"
              type="password"
              placeholder="lin_api_…"
              value={key}
              onChange={(e) => {
                setKey(e.target.value)
                setError(null)
              }}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="btn-primary" disabled={!key.trim() || busy}>
              {busy ? <span className="btn-spinner" aria-label="Checking" /> : 'Connect'}
            </button>
          </div>
          {error && <div className="keycard-error">{error}</div>}
          <p className="keycard-note">
            Stored encrypted in this browser only. Requests go straight from here to{' '}
            <span className="mono">api.linear.app</span> — there's no server and the key never
            leaves your machine.
          </p>
        </form>

        <a
          className="welcome-link"
          href="https://linear.app/settings/api"
          target="_blank"
          rel="noreferrer"
        >
          Create a key in Linear → Settings → API
          <svg viewBox="0 0 16 16" width="10" height="10">
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
      </div>

      <div className="welcome-foot muted small">
        hover an issue to trace its cones · dashed green = unblocked · ⌘-click opens Linear
      </div>
    </div>
  )
}
