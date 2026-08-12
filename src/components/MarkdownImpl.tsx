import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** loaded lazily — keeps react-markdown out of the initial bundle */
export default function MarkdownImpl({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          input: ({ checked }) => (
            <span className={`md-check${checked ? ' is-checked' : ''}`} aria-hidden>
              {checked ? (
                <svg viewBox="0 0 16 16" width="13" height="13">
                  <rect x="1" y="1" width="14" height="14" rx="4" fill="var(--accent)" />
                  <path
                    d="M4.7 8.3 L7 10.5 L11.3 5.7"
                    fill="none"
                    stroke="var(--surface)"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" width="13" height="13">
                  <rect
                    x="1.5"
                    y="1.5"
                    width="13"
                    height="13"
                    rx="4"
                    fill="none"
                    stroke="var(--border-strong)"
                    strokeWidth="1.4"
                  />
                </svg>
              )}
            </span>
          ),
          table: ({ children }) => (
            <div className="md-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
