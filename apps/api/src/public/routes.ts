// Public (unauthenticated) settings endpoint.
//
// Only exposes flags that the frontend needs BEFORE the user logs in —
// today that's just safeModeEnabled, because the <SafeMode /> component
// has to activate on /login + /register too, not only inside the
// authenticated app.
//
// Keep this surface SMALL on purpose. Anything sensitive (min/max
// limits, fee percentages, business toggles) stays on /auth/me so
// it requires a session.

import type { FastifyInstance } from 'fastify'
import { getSettings } from '../settings/service.js'

export async function publicRoutes(app: FastifyInstance) {
  app.get('/settings', async (_req, reply) => {
    const s = getSettings()
    return reply.send({
      safeModeEnabled: s.safeModeEnabled,
    })
  })
}
