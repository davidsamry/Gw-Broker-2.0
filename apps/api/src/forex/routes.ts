// Forex public REST endpoints. F1 only ships `/symbols` and `/status` —
// `/candles` and `/ticker/:asset` arrive in F5 once the aggregator is
// wired (no point exposing endpoints that return empty data).

import type { FastifyInstance } from 'fastify'
import { prisma } from '../prisma.js'
import { getForexRuntimeState } from './runtime/boot.js'

export async function forexRoutes(app: FastifyInstance) {
  // Public catalog — used by the frontend to show forex assets in the
  // asset selector. Read-only; no auth required (matches /market/assets).
  app.get('/symbols', async (_req, reply) => {
    try {
      const rows = await prisma.$queryRaw<Array<{
        id: string; symbol: string; name: string;
        digits: number; pipSize: string;
        displayOrder: number;
      }>>`
        SELECT id, symbol, name, digits, "pipSize"::text AS "pipSize", "displayOrder"
        FROM forex_assets
        WHERE enabled = TRUE
        ORDER BY "displayOrder" ASC, symbol ASC
      `
      return reply.send({
        symbols: rows.map(r => ({
          id:           r.id,
          symbol:       r.symbol,
          name:         r.name,
          digits:       r.digits,
          pipSize:      Number(r.pipSize),
          displayOrder: r.displayOrder,
        })),
      })
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // Runtime/provider status — surfaced to the admin panel in F7. Public
  // (no PII) so an operator can hit it directly during incident response.
  app.get('/status', async (_req, reply) => {
    const s = getForexRuntimeState()
    return reply.send({
      bootedAt:      s.bootedAt,
      status:        s.status,
      providerAlive: s.provider !== null,
      providerName:  s.provider?.name ?? null,
      assets:        s.assets.length,
      debugInfo:     s.provider?.getDebugInfo() ?? null,
    })
  })
}
