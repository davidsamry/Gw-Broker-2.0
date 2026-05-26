import type { FastifyInstance } from 'fastify'
import { dashboardRoutes } from './dashboard/routes.js'
import { userAdminRoutes } from './users/routes.js'
import { operationsAdminRoutes } from './operations/routes.js'
import { kycAdminRoutes } from './kyc/routes.js'
import { depositsAdminRoutes } from './deposits/routes.js'
import { withdrawalsAdminRoutes } from './withdrawals/routes.js'
import { ticketsAdminRoutes } from './tickets/routes.js'
import { assetsAdminRoutes } from './assets/routes.js'
import { otcAdminRoutes } from './otc/routes.js'
import { bonusesAdminRoutes } from './bonuses/routes.js'
import { manipulationAdminRoutes } from './manipulation/routes.js'
import { emailAdminRoutes } from './emails/routes.js'

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

  await app.register(dashboardRoutes,        { prefix: '/dashboard'   })
  await app.register(userAdminRoutes,        { prefix: '/users'       })
  await app.register(operationsAdminRoutes,  { prefix: '/operations'  })
  await app.register(kycAdminRoutes,         { prefix: '/kyc'         })
  await app.register(depositsAdminRoutes,    { prefix: '/deposits'    })
  await app.register(withdrawalsAdminRoutes, { prefix: '/withdrawals' })
  await app.register(ticketsAdminRoutes,     { prefix: '/tickets'     })
  await app.register(assetsAdminRoutes,      { prefix: '/assets'      })
  await app.register(otcAdminRoutes,         { prefix: '/otc'         })
  await app.register(bonusesAdminRoutes,     { prefix: '/bonuses'     })
  await app.register(manipulationAdminRoutes,{ prefix: '/manipulation'})
  await app.register(emailAdminRoutes,       { prefix: '/emails'      })
}
