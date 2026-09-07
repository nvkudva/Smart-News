import { TabBar } from '@/components/TabBar';

export default function LoadingLocal() {
  return (
    <>
      <main className="shell">
        <div className="pagehead"><h1>Local</h1></div>
        <div className="feed" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="skel skel--compact" />)}
        </div>
      </main>
      <TabBar active="home" />
    </>
  );
}
