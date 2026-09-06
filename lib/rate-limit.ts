import { createHash } from 'node:crypto'
import type { AttemptKind } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { env } from '@/lib/env'
import { rateLimited } from '@/lib/http'

/**
 * Throttling for the two unauthenticated entry points: the gallery PIN and
 * sign-in. Backed by the AccessAttempt table.
 *
 * Postgres rather than Redis: the volume is a handful of rows per subject, the
 * app already holds a database connection, and one fewer piece of
 * infrastructure is one fewer thing to provision, pay for and explain.
 */

type Policy = { windowMs: number; maxFailures: number }

const POLICY: Record<AttemptKind, Policy> = {
  // Six digits is a million possibilities. Five tries per quarter hour makes
  // exhausting them take roughly six years per IP.
  GALLERY_PIN: { windowMs: 15 * 60 * 1000, maxFailures: 5 },
  // Looser, because a real person mistyping their own password should not be
  // locked out as readily as someone guessing a stranger's PIN. argon2id
  // already makes each guess expensive.
  LOGIN: { windowMs: 15 * 60 * 1000, maxFailures: 10 },
}

/**
 * Subjects are hashed with a server-side salt before storage, so the table can
 * answer "has this client failed too often" without holding an email address or
 * an IP that would identify someone if the database leaked.
 */
export function hashIp(ip: string): string {
  return createHash('sha256').update(`${env().IP_HASH_SALT}:ip:${ip}`).digest('hex')
}

export function hashSubject(value: string): string {
  return createHash('sha256').update(`${env().IP_HASH_SALT}:subject:${value}`).digest('hex')
}

/**
 * Trusts x-forwarded-for only because this runs behind Vercel's proxy, which
 * overwrites the header. Anywhere the app is exposed directly, this value is
 * caller-controlled and the limiter would need the socket address instead.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || request.headers.get('x-real-ip') || 'unknown'
}

/**
 * Counts recent failures and records this attempt, atomically.
 *
 * A plain read-then-write lets two simultaneous requests both observe four
 * failures and both proceed, so the real ceiling drifts above the configured
 * one. The fix is a Postgres advisory lock keyed on the subject: it serialises
 * requests for the *same* email or gallery and nothing else, so unrelated
 * traffic never contends, and unlike SERIALIZABLE it cannot abort — there is no
 * retry loop to get wrong, and no chance of failing open on a throttle.
 *
 * The lock is transaction-scoped, so it is released on commit or rollback
 * whatever happens.
 */
async function countAndRecord(
  kind: AttemptKind,
  subject: string,
  ipHash: string
): Promise<{ failures: number; oldest: Date | null; attemptId: string }> {
  const { windowMs, maxFailures } = POLICY[kind]
  const lockKey = `${kind}:${subject}:${ipHash}`

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`

    const since = new Date(Date.now() - windowMs)
    const failures = await tx.accessAttempt.findMany({
      where: { kind, subject, ipHash, succeeded: false, attemptedAt: { gte: since } },
      orderBy: { attemptedAt: 'asc' },
      select: { attemptedAt: true },
      take: maxFailures,
    })

    // Recorded as a failure; the caller promotes it if the secret checks out.
    const attempt = await tx.accessAttempt.create({
      data: { kind, subject, ipHash, succeeded: false },
      select: { id: true },
    })

    return {
      failures: failures.length,
      oldest: failures[0]?.attemptedAt ?? null,
      attemptId: attempt.id,
    }
  })
}

function refuse(kind: AttemptKind, oldest: Date): never {
  const { windowMs } = POLICY[kind]
  const retryAfterSeconds = Math.max(1, Math.ceil((oldest.getTime() + windowMs - Date.now()) / 1000))
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60))
  throw rateLimited(
    `Too many attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
    retryAfterSeconds
  )
}

/**
 * Claims one attempt against the allowance, before any expensive work happens.
 *
 * The attempt is written as a failure up front and the count is read in the same
 * locked transaction, so the check and the record cannot be separated by a
 * concurrent request. The caller does the costly comparison afterwards and calls
 * `markAttemptSucceeded` if it worked — only failures count toward the limit, so
 * a successful sign-in leaves nothing behind.
 *
 * Ordering matters: this used to run *after* the argon2id comparison, which
 * meant a locked-out client still forced a 19 MB hash on every request. The
 * limiter has to shed load on the expensive path, not behind it. Returning fast
 * here leaks nothing, because a 429 announces the lockout explicitly anyway.
 */
export async function claimAttempt(
  kind: AttemptKind,
  subject: string,
  ipHash: string
): Promise<{ attemptId: string }> {
  const { failures, oldest, attemptId } = await countAndRecord(kind, subject, ipHash)
  if (failures >= POLICY[kind].maxFailures && oldest) refuse(kind, oldest)
  return { attemptId }
}

/** Turns a claimed attempt into a success, so it stops counting. */
export async function markAttemptSucceeded(attemptId: string): Promise<void> {
  await prisma.accessAttempt.update({ where: { id: attemptId }, data: { succeeded: true } })
}

/** Clears the record for one subject — used when a lead sets a new gallery PIN. */
export async function clearAttempts(kind: AttemptKind, subject: string): Promise<void> {
  await prisma.accessAttempt.deleteMany({ where: { kind, subject } })
}

/**
 * Drops rows older than the longest window. Nothing calls this on a schedule
 * yet; it is here so a cron route or a scheduled job is a one-liner rather than
 * a refactor. Recorded in the README as a known limitation.
 */
export async function pruneAttempts(): Promise<number> {
  const longest = Math.max(...Object.values(POLICY).map((p) => p.windowMs))
  const { count } = await prisma.accessAttempt.deleteMany({
    where: { attemptedAt: { lt: new Date(Date.now() - longest) } },
  })
  return count
}
