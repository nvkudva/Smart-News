'use client';

import Link from 'next/link';
import { TabBar } from '@/components/TabBar';

const row = { display: 'flex', gap: 10, flexWrap: 'wrap' as const };
const link = { display: 'inline-flex', alignItems: 'center', textDecoration: 'none' };

// Reached mostly when D1 is unreachable or answers 5xx: every route reads it
// over the network at request time. Retry re-renders the segment on the server,
// which is the only thing that can actually clear the failure.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <main className="shell">
        <div className="pagehead">
          <h1>That did not load</h1>
          <p>The news store did not answer.</p>
        </div>
        <div className="panel">
          <div className="label">Error</div>
          <p>Nothing is lost — the feed is rebuilt every fifteen minutes. Try again, or head back to today.</p>
          <div style={row}>
            <button className="btn" type="button" onClick={reset}>Try again</button>
            <Link className="btn" href="/" style={link}>Back to the feed</Link>
          </div>
          {error.digest && (
            <div className="kicker" style={{ fontSize: 11.5 }}>Reference {error.digest}</div>
          )}
        </div>
      </main>
      <TabBar />
    </>
  );
}
