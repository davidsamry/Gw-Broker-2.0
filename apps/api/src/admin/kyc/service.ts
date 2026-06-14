import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma.js'
import { sendEmailAsync } from '../../email/service.js'

// KYC admin operations — list/filter/approve/reject submissions. Raw SQL so
// we don't depend on the regenerated Prisma client (kycSubmission model is
// new and the client may be stale on Windows due to the DLL lock pattern).

export interface KycRow {
  id:               string
  userId:           string
  userName:         string
  userEmail:        string
  realBalance:      string
  documentFrontUrl: string
  documentBackUrl:  string
  selfieUrl:        string
  status:           'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'
  reason:           string | null
  submittedAt:      Date
  reviewedAt:       Date | null
  reviewedBy:       string | null
}

export interface ListKycParams {
  page?:     number
  pageSize?: number
  search?:   string
  status?:   'ALL' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'
}

export interface ListKycResponse {
  submissions:  KycRow[]
  total:        number
  page:         number
  pageSize:     number
  pendingCount: number   // global SUBMITTED count, regardless of filters
}

function decimalToString(x: any): string {
  if (x == null) return '0'
  if (typeof x === 'string') return x
  if (typeof x.toString === 'function') return x.toString()
  return String(x)
}

export async function listKycSubmissions(params: ListKycParams): Promise<ListKycResponse> {
  const page     = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(5, params.pageSize ?? 20))
  const offset   = (page - 1) * pageSize

  const where: Prisma.Sql[] = []
  if (params.search) {
    const q = `%${params.search.trim()}%`
    where.push(Prisma.sql`(u.email ILIKE ${q} OR u.name ILIKE ${q})`)
  }
  if (params.status && params.status !== 'ALL') {
    where.push(Prisma.sql`k.status = ${params.status}::"KycStatus"`)
  } else {
    // Default: hide PENDING-but-unsubmitted (none exist anyway, but defensive)
    where.push(Prisma.sql`k.status <> 'PENDING'::"KycStatus"`)
  }
  const whereSql = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty

  const [rows, countRows, pendingRows] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT
        k.id, k."userId",
        u.name  AS "userName",
        u.email AS "userEmail",
        COALESCE(a.balance, 0) AS "realBalance",
        k."documentFrontUrl", k."documentBackUrl", k."selfieUrl",
        k.status::text AS status,
        k.reason, k."submittedAt", k."reviewedAt", k."reviewedBy"
      FROM kyc_submissions k
      INNER JOIN users    u ON u.id = k."userId"
      LEFT  JOIN accounts a ON a."userId" = u.id AND a.type = 'REAL'::"AccountType"
      ${whereSql}
      ORDER BY
        CASE WHEN k.status = 'SUBMITTED'::"KycStatus" THEN 0 ELSE 1 END,
        k."submittedAt" DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total
      FROM kyc_submissions k
      INNER JOIN users u ON u.id = k."userId"
      ${whereSql}
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM kyc_submissions
      WHERE status = 'SUBMITTED'::"KycStatus"
    `,
  ])

  return {
    submissions: rows.map((r) => ({ ...r, realBalance: decimalToString(r.realBalance) })),
    total:        Number(countRows[0]?.total ?? 0),
    page,
    pageSize,
    pendingCount: Number(pendingRows[0]?.count ?? 0),
  }
}

/** Approve a submission: flip KycSubmission + User.kycStatus to APPROVED.
 *  Ao aprovar, LIMPA as imagens (base64) das colunas documentFront/Back/Selfie
 *  — o admin arquiva os documentos externamente, então não precisamos guardar
 *  os ~2-3MB de base64 no Postgres (evita inchar o banco/backups). O registro
 *  da aprovação (status, reviewedAt/By, submittedAt) permanece p/ auditoria.
 *  Colunas são NOT NULL → setamos '' (não NULL). */
export async function approveKyc(adminId: string, submissionId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.$executeRaw`
      UPDATE kyc_submissions
      SET status = 'APPROVED'::"KycStatus",
          reason = NULL,
          "reviewedAt" = NOW(),
          "reviewedBy" = ${adminId},
          "documentFrontUrl" = '',
          "documentBackUrl"  = '',
          "selfieUrl"        = ''
      WHERE id = ${submissionId}
        AND status = 'SUBMITTED'::"KycStatus"
    `
    if (updated === 0) throw new Error('NOT_PENDING')

    await tx.$executeRaw`
      UPDATE users SET "kycStatus" = 'APPROVED'::"KycStatus"
      WHERE id = (SELECT "userId" FROM kyc_submissions WHERE id = ${submissionId})
    `
    return true
  })

  await notifyKycResult(submissionId, 'APPROVED')
  return result
}

/**
 * Reverse an already-APPROVED submission back to REJECTED. Used when an
 * admin discovers, after the fact, that a doc shouldn't have been let
 * through (e.g. fraud signals surface later). Strict transition guard —
 * only APPROVED can be reverted; PENDING/SUBMITTED/REJECTED stay where
 * they are and return NOT_APPROVED so the UI can show "already revised
 * differently, refresh".
 *
 * Side effects mirror rejectKyc: User.kycStatus drops to REJECTED → the
 * withdrawal gate immediately blocks the user the next time they hit
 * POST /withdrawals, and the rejection email fires so they know why.
 */
export async function revertKycToRejected(adminId: string, submissionId: string, reason: string) {
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.$executeRaw`
      UPDATE kyc_submissions
      SET status = 'REJECTED'::"KycStatus",
          reason = ${reason},
          "reviewedAt" = NOW(),
          "reviewedBy" = ${adminId}
      WHERE id = ${submissionId}
        AND status = 'APPROVED'::"KycStatus"
    `
    if (updated === 0) throw new Error('NOT_APPROVED')

    await tx.$executeRaw`
      UPDATE users SET "kycStatus" = 'REJECTED'::"KycStatus"
      WHERE id = (SELECT "userId" FROM kyc_submissions WHERE id = ${submissionId})
    `
    return true
  })

  await notifyKycResult(submissionId, 'REJECTED', reason)
  return result
}

/** Reject a submission with a required reason. */
export async function rejectKyc(adminId: string, submissionId: string, reason: string) {
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.$executeRaw`
      UPDATE kyc_submissions
      SET status = 'REJECTED'::"KycStatus",
          reason = ${reason},
          "reviewedAt" = NOW(),
          "reviewedBy" = ${adminId}
      WHERE id = ${submissionId}
        AND status = 'SUBMITTED'::"KycStatus"
    `
    if (updated === 0) throw new Error('NOT_PENDING')

    await tx.$executeRaw`
      UPDATE users SET "kycStatus" = 'REJECTED'::"KycStatus"
      WHERE id = (SELECT "userId" FROM kyc_submissions WHERE id = ${submissionId})
    `
    return true
  })

  await notifyKycResult(submissionId, 'REJECTED', reason)
  return result
}

// Helper: fires KYC_APPROVED or KYC_REJECTED to the submission's owner.
// Async + fire-and-forget — email failure never affects admin's action.
async function notifyKycResult(submissionId: string, outcome: 'APPROVED' | 'REJECTED', reason?: string): Promise<void> {
  try {
    const info = await prisma.$queryRaw<Array<{ email: string; name: string }>>`
      SELECT u.email, u.name
      FROM kyc_submissions k
      JOIN users u ON u.id = k."userId"
      WHERE k.id = ${submissionId}
      LIMIT 1
    `
    const row = info[0]
    if (!row) return
    sendEmailAsync({
      templateKey: outcome === 'APPROVED' ? 'KYC_APPROVED' : 'KYC_REJECTED',
      to:          row.email,
      vars:        { name: row.name, reason: reason ?? '' },
    })
  } catch (err) {
    console.error(`[admin/kyc] notify ${outcome} email lookup failed`, err)
  }
}
