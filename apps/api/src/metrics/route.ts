// Fase M3 — /metrics endpoint for Prometheus scraping.
//
// Auth model: if METRICS_TOKEN env is set, the endpoint requires
// ?token=X (matching Prometheus scrape_config params). If unset
// (local dev), endpoint is open. We don't put the token in a header
// because Prometheus's scrape_config doesn't have first-class header
// support without extra config — query param is simplest.

import type { FastifyInstance } from 'fastify'
import { metricsRegistry } from './registry.js'

export async function metricsRoute(app: FastifyInstance): Promise<void> {
  const requiredToken = process.env.METRICS_TOKEN

  app.get('/metrics', async (req, reply) => {
    if (requiredToken) {
      const provided = (req.query as { token?: string } | undefined)?.token
      if (provided !== requiredToken) {
        return reply.status(401).send({ error: 'UNAUTHORIZED' })
      }
    }
    reply.header('Content-Type', metricsRegistry.contentType)
    return reply.send(await metricsRegistry.metrics())
  })
}
