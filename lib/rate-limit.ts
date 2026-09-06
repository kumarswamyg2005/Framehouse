import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db/prisma'
import { env } from '@/lib/env'
import { rateLimited } from '@/lib/http'

/**
 * PIN attempt throttling, backed by the PinAttempt table.
 *
 * Postgres rather than Redis: the volume is a handful of rows per gallery, the
 * app already has a database connection, and one fewer piece of infrastructure
 * is one fewer thing to provision, pay for, and explain. The trade-off — this
 * would not hold up as a general-purpose limiter at high traffic — is recorded
 * in the README under known limitations.
 */

const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 5

/**
 * IPs are hashed with a server-side salt before storage. The table can answer
 * "has this client failed five times" without ever holding an address that
 * would identify a visitor if the database leaked.
 */
export function hashIp(ip: string): string {
  return createHash('sha256').update(`${env().IP_HASH_SALT}:${ip}`).digest('hex')
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
 * Throws RATE_LIMITED once five failures are on record inside the window.
 * Called before the PIN is checked, so a locked-out client cannot keep testing
 * candidates and cannot learn anything from the timing of the response.
 */
export async function assertPinAttemptAllowed(slug: string, ipHash: string): Promise<void> {
  const since = new Date(Date.now() - WINDOW_MS)

  const failures = await prisma.pinAttempt.findMany({
    where: { gallerySlug: slug, ipHash, succeeded: false, attemptedAt: { gte: since } },
    orderBy: { attemptedAt: 'asc' },
    select: { attemptedAt: true },
    take: MAX_FAILURES,
  })

  if (failures.length < MAX_FAILURES) return

  // The window rolls: the lock lifts when the oldest failure ages out.
  const oldest = failures[0]!.attemptedAt.getTime()
  const retryAfterSeconds = Math.max(1, Math.ceil((oldest + WINDOW_MS - Date.now()) / 1000))
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60))

  throw rateLimited(
    `Too many attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
    retryAfterSeconds
  )
}

export async function recordPinAttempt(
  slug: string,
  ipHash: string,
  succeeded: boolean
): Promise<void> {
  await prisma.pinAttempt.create({ data: { gallerySlug: slug, ipHash, succeeded } })
}
