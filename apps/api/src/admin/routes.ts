import type { FastifyInstance } from 'fastify'
import { dashboardRoutes } from './dashboard/routes.js'
import { userAdminRoutes } from './users/routes.js'

// All routes in this module sit behind requireAdmin, so the JWT must be valid
// AND the user.role must be ADMIN (live-checked against the DB per request).
//
// More routes (users, deposits, withdrawals admin, KYC, etc.) will land in
// follow-up phases, each registered here as a sub-prefix.

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', (app as any).requireAdmin)

  // Gate sanity check — used by the frontend AdminGuard.
  app.get('/ping', async (req) => ({
    ok:        true,
    userId:    (req as any).user?.sub ?? null,
    timestamp: new Date().toISOString(),
  }))

  await app.register(dashboardRoutes, { prefix: '/dashboard' })
  await app.register(userAdminRoutes, { prefix: '/users' })
}
