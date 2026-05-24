import { z } from 'zod'

// Image attachment as data URL — same approach KYC uses (no object storage).
// ~7MB cap on the encoded string ≈ ~5MB raw image, safe for screenshots.
export const ticketAttachmentSchema = z.string()
  .regex(/^data:image\/(jpeg|jpg|png|webp|gif);base64,/, 'Apenas imagens JPEG/PNG/WEBP/GIF.')
  .max(7_000_000, 'Imagem muito grande (máx ~5MB).')

// Server bodyLimit covers the worst case (image + a bit of text + JSON envelope).
export const TICKET_BODY_LIMIT = 8 * 1024 * 1024 // 8MB

export const createTicketSchema = z.object({
  subject:       z.string().trim().min(3, 'Assunto muito curto.').max(200, 'Assunto muito longo.'),
  body:          z.string().trim().min(1, 'Mensagem é obrigatória.').max(5000, 'Mensagem muito longa.'),
  attachmentUrl: ticketAttachmentSchema.optional(),
})

// Replies must carry text OR image (or both) — refuse empty.
export const replyTicketSchema = z.object({
  body:          z.string().trim().max(5000).optional(),
  attachmentUrl: ticketAttachmentSchema.optional(),
}).refine(
  (v) => (v.body && v.body.length > 0) || (v.attachmentUrl && v.attachmentUrl.length > 0),
  { message: 'Envie um texto ou uma imagem.' },
)

export type CreateTicketInput = z.infer<typeof createTicketSchema>
export type ReplyTicketInput  = z.infer<typeof replyTicketSchema>
