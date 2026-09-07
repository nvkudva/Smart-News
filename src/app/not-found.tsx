import Link from 'next/link';
import { TabBar } from '@/components/TabBar';

const link = { alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', textDecoration: 'none' };

export default function NotFound() {
  return (
    <>
      <main className="shell">
        <div className="pagehead">
          <h1>Not here</h1>
          <p>That page or story is not in the feed.</p>
        </div>
        <div className="panel">
          <div className="label">404</div>
          <p>Stories drop out of the feed once their coverage stops updating, so a link
            from a while back may already have gone.</p>
          <Link className="btn" href="/" style={link}>Back to the feed</Link>
        </div>
      </main>
      <TabBar />
    </>
  );
}
