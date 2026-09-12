import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const [health, setHealth] = useState('checking…')

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((j) => setHealth(JSON.stringify(j, null, 2)))
      .catch((e) => setHealth(String(e)))
  }, [])

  return (
    <main style={{ fontFamily: 'ui-monospace, monospace', padding: '2rem' }}>
      <h1>Smart News — Vite shell</h1>
      <pre>{health}</pre>
    </main>
  )
}
