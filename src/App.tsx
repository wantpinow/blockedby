import { useCallback, useEffect, useState } from 'react'
import { useRoute } from './lib/router'
import { Picker } from './views/Picker'
import { ProjectGraph } from './views/ProjectGraph'

type Theme = 'light' | 'dark'

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('linear-viz-theme')
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'light' ? 'dark' : 'light'
      localStorage.setItem('linear-viz-theme', next)
      return next
    })
  }, [])
  return [theme, toggle]
}

export default function App() {
  const { route, openProject, openPicker, selectIssue } = useRoute()
  const [theme, toggleTheme] = useTheme()

  const themeButton = (
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
  )

  if (!route.ref) {
    return <Picker onOpen={openProject} themeButton={themeButton} />
  }
  return (
    <ProjectGraph
      key={route.ref}
      refId={route.ref}
      selectedIssue={route.issue}
      onSelectIssue={selectIssue}
      onBack={openPicker}
      themeButton={themeButton}
    />
  )
}
