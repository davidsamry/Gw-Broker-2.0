import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  getMetaPixelSettings, updateMetaPixelSettings, maskToken,
} from '../../meta/settings.js'

// GET response shape — token is masked + boolean `hasToken` so the UI
// can hint "token configured" without ever transmitting the secret.
function shapeResponse(cfg: Awaited<ReturnType<typeof getMetaPixelSettings>>) {
  return {
    enabled:       cfg.enabled,
    pixelId:       cfg.pixelId       ?? '',
    hasToken:      !!cfg.pixelToken && cfg.pixelToken !== '',
    tokenPreview:  maskToken(cfg.pixelToken),
    testEventCode: cfg.testEventCode ?? '',
    updatedAt:     cfg.updatedAt,
  }
}

// PATCH body — everything optional so admin can edit a single field
// without re-typing the rest. pixelToken is OMITTED on a "keep current"
// edit; sent as empty string to clear it explicitly.
const patchBody = z.object({
  enabled:       z.boolean().optional(),
  pixelId:       z.string().trim().max(64).optional()
                  .refine((v) => v === undefined || v === '' || /^\d+$/.test(v),
                          'Pixel ID deve conter apenas dígitos.'),
  pixelToken:    z.string().trim().max(2048).optional(),
  testEventCode: z.string().trim().max(64).optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), {
  message: 'Forneça pelo menos um campo para atualizar.',
})

export async function metaAdminRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => {
    const cfg = await getMetaPixelSettings()
    return reply.send(shapeResponse(cfg))
  })

  app.patch('/', async (req, reply) => {
    const parsed = patchBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }

    // If the admin is enabling the integration, validate the inputs the
    // sender will need so they don't ship a half-broken config.
    if (parsed.data.enabled === true) {
      const cfg     = await getMetaPixelSettings()
      const newId   = parsed.data.pixelId    ?? cfg.pixelId    ?? ''
      const newTok  = parsed.data.pixelToken ?? cfg.pixelToken ?? ''
      if (!newId.trim())  return reply.status(400).send({ error: 'PIXEL_ID_REQUIRED' })
      if (!newTok.trim()) return reply.status(400).send({ error: 'PIXEL_TOKEN_REQUIRED' })
    }

    // Convert empty string → null only for the textual fields that can
    // legitimately be cleared. pixelToken empty string = "clear token".
    const updated = await updateMetaPixelSettings({
      enabled:       parsed.data.enabled,
      pixelId:       parsed.data.pixelId       === '' ? null : parsed.data.pixelId,
      pixelToken:    parsed.data.pixelToken    === '' ? null : parsed.data.pixelToken,
      testEventCode: parsed.data.testEventCode === '' ? null : parsed.data.testEventCode,
    })
    return reply.send(shapeResponse(updated))
  })
}
