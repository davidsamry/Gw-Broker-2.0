import type { FastifyInstance } from 'fastify'

// Phase 0 of the Admin Panel build-out. Every route in this module sits
// behind requireAdmin, so the JWT must be valid AND the user.role must be
// ADMIN (live-checked against the DB on every request).
//
// More routes (users, deposits, withdrawals admin, KYC, etc.) will land in
// follow-up phases, each in its own file under apps/api/src/admin/.

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', (app as any).requireAdmin)

  // Sanity-check endpoint. Used by the frontend AdminGuard to confirm the
  // current user actually has admin access before rendering /admin pages.
  app.get('/ping', async (req) => ({
    ok:        true,
    userId:    (req as any).user?.sub ?? null,
    timestamp: new Date().toISOString(),
  }))
}
