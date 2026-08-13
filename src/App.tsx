import { useCallback, useEffect, useRef, useState } from 'react'
import { useRoute } from './lib/router'
import { forgetToken, initToken, setAuthErrorHandler } from './lib/linear'
import { useViewer } from './lib/useData'
import { kvClear } from './lib/idb'
import { Avatar } from './components/bits'
import { Picker } from './views/Picker'
import { ProjectGraph } from './views/ProjectGraph'
import { Welcome } from './views/Welcome'

type Theme = 'light' | 'dark'

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('blockedby-theme') ?? localStorage.getItem('linear-viz-theme')
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'light' ? 'dark' : 'light'
      localStorage.setItem('blockedby-theme', next)
      return next
    })
  }, [])
  return [theme, toggle]
}

type Auth =
  | { kind: 'checking' }
  | { kind: 'locked'; notice?: string }
  | { kind: 'ready' }

export default function App() {
  const { route, openProject, openPicker, selectIssue } = useRoute()
  const [theme, toggleTheme] = useTheme()
  const [auth, setAuth] = useState<Auth>({ kind: 'checking' })

  useEffect(() => {
    setAuthErrorHandler(() =>
      setAuth({
        kind: 'locked',
        notice: 'Linear rejected the stored key — it may have been revoked. Paste a fresh one.',
      }),
    )
    initToken().then((has) => setAuth(has ? { kind: 'ready' } : { kind: 'locked' }))
  }, [])

  const themeButton = (
    <>
      <a
        className="icon-btn"
        href="https://github.com/wantpinow/blockedby"
        target="_blank"
        rel="noreferrer"
        aria-label="GitHub repository"
        title="GitHub"
      >
        <svg viewBox="0 0 16 16" width="13.5" height="13.5" aria-hidden>
          <path
            fill="currentColor"
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
          />
        </svg>
      </a>
      <button type="button" className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme">
      {theme === 'light' ? (
        <svg viewBox="0 0 16 16" width="13" height="13">
          <path
            d="M13.5 9.5 A 6 6 0 1 1 6.5 2.5 A 5 5 0 0 0 13.5 9.5 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" width="13" height="13">
          <circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M8 1.2v1.8M8 13v1.8M1.2 8h1.8M13 8h1.8M3.2 3.2l1.3 1.3M11.5 11.5l1.3 1.3M12.8 3.2l-1.3 1.3M4.5 11.5l-1.3 1.3"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      )}
      </button>
    </>
  )

  if (auth.kind === 'checking') return null

  if (auth.kind === 'locked') {
    return (
      <Welcome
        notice={auth.notice}
        themeButton={themeButton}
        onDone={() => setAuth({ kind: 'ready' })}
      />
    )
  }

  const accountButton = (
    <AccountMenu
      onSignOut={async () => {
        await forgetToken()
        await kvClear()
        setAuth({ kind: 'locked' })
      }}
    />
  )

  if (!route.ref) {
    return <Picker onOpen={openProject} themeButton={themeButton} accountButton={accountButton} />
  }
  return (
    <ProjectGraph
      key={route.ref}
      refId={route.ref}
      selectedIssue={route.issue}
      onSelectIssue={selectIssue}
      onBack={openPicker}
      themeButton={themeButton}
      accountButton={accountButton}
    />
  )
}

function AccountMenu({ onSignOut }: { onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const viewer = useViewer()
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="acct" ref={wrapRef}>
      <button
        type="button"
        className={`me-btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label="Account"
        title={viewer ? `${viewer.name} · ${viewer.org}` : 'Account'}
      >
        {viewer ? (
          <Avatar person={viewer} size={20} />
        ) : (
          <svg viewBox="0 0 16 16" width="13" height="13">
            <path
              d="M10.3 5.7 a2.7 2.7 0 1 0 -3.8 3.8 L2.6 13.4 l0 0 M5 11 l1.4 1.4 M6.9 9.1 l1.4 1.4"
              stroke="currentColor"
              strokeWidth="1.4"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="10.6" cy="5.4" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        )}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head menu-id-row">
            {viewer && <Avatar person={viewer} size={26} />}
            <div>
              <div className="menu-name">{viewer?.name ?? 'Connected'}</div>
              <div className="menu-sub">
                {viewer ? `${viewer.email} · ${viewer.org}` : 'Linear API key active'}
              </div>
            </div>
          </div>
          <button type="button" className="menu-item is-danger" onClick={onSignOut} role="menuitem">
            Remove key & local data
          </button>
        </div>
      )}
    </div>
  )
}
