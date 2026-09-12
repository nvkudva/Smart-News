export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/api/health') {
      const started = Date.now()
      try {
        const tables = await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        ).all<{ name: string }>()
        return Response.json({
          ok: true,
          d1: {
            bound: true,
            tableCount: tables.results.length,
            tables: tables.results.map((r) => r.name),
            ms: Date.now() - started,
          },
        })
      } catch (err) {
        return Response.json(
          { ok: false, d1: { bound: false, error: String(err) } },
          { status: 500 },
        )
      }
    }

    return new Response('Not found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
