'use client';

import './globals.css';

// Replaces the root layout entirely, so the wash and the html/body shell have
// to be restated here rather than inherited.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <div className="wash" aria-hidden><i /><i /><i /></div>
        <main className="shell" style={{ maxWidth: 560, paddingTop: 64 }}>
          <div className="pagehead">
            <h1>Something broke</h1>
            <p>smartnews could not start this page.</p>
          </div>
          <div className="panel">
            <div className="label">Error</div>
            <p>Reloading usually clears it. The feed itself is rebuilt every fifteen minutes.</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn" type="button" onClick={reset}>Reload</button>
              <a className="btn" href="/" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>Back to the feed</a>
            </div>
            {error.digest && <div className="kicker" style={{ fontSize: 11.5 }}>Reference {error.digest}</div>}
          </div>
        </main>
      </body>
    </html>
  );
}
