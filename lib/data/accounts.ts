import { hashSecret, verifySecret } from '@/lib/auth/hash'
import type { Actor } from '@/lib/auth/policy'
import { prisma } from '@/lib/db/prisma'
import { ApiError } from '@/lib/http'
import { guardAttempt, hashSubject } from '@/lib/rate-limit'
import type { loginSchema, registerSchema } from '@/lib/schemas'
import type { z } from 'zod'

/**
 * Account creation and sign-in.
 *
 * These are the only data functions that do not take an Actor, because they are
 * what produces one. Everything else in lib/data starts from an actor and hands
 * it to lib/auth/policy.ts.
 */

// A precomputed hash of a value nobody will ever submit. When the email is
// unknown we verify against this instead of returning early, so a missing
// account costs the same wall-clock time as a wrong password and the endpoint
// cannot be used to enumerate who has an account.
const DECOY_HASH = hashSecret(crypto.randomUUID())

/**
 * Self-serve registration creates an ADMIN — a photography lead setting up
 * their workspace. Team members never register; the lead creates them from
 * inside an event, which is the only way a MEMBER row comes into existence.
 */
export async function registerLead(input: z.infer<typeof registerSchema>): Promise<Actor> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  })
  if (existing) {
    throw new ApiError('CONFLICT', 'An account with that email already exists. Sign in instead.')
  }

  return prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      role: 'ADMIN',
      passwordHash: await hashSecret(input.password),
    },
    select: { id: true, name: true, email: true, role: true },
  })
}

/**
 * Throttled per (email, IP). argon2id already makes each guess expensive, but
 * nothing stopped sustained credential stuffing against a known address.
 *
 * The email is salted-hashed before it reaches the attempts table, so throttling
 * state cannot be read back as a list of who has an account here. Unknown
 * addresses are counted exactly like known ones — otherwise the limiter's own
 * behaviour would reveal which emails are real.
 */
export async function authenticate(
  input: z.infer<typeof loginSchema>,
  ipHash: string
): Promise<Actor> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, name: true, email: true, role: true, passwordHash: true },
  })

  const matches = user
    ? await verifySecret(user.passwordHash, input.password)
    : await verifySecret(await DECOY_HASH, input.password)

  // After the comparison, so a locked-out request costs the same time as a
  // wrong password and cannot be distinguished by timing.
  await guardAttempt('LOGIN', hashSubject(input.email), ipHash, matches)

  if (!user || !matches) {
    // Deliberately identical for both failure modes.
    throw new ApiError('UNAUTHENTICATED', 'That email and password don\u2019t match.')
  }

  const { passwordHash: _passwordHash, ...actor } = user
  return actor
}

/**
 * The published demo gallery, or null. Keyed to the seeded admin account so a
 * real deployment without seed data advertises nothing.
 */
export async function demoGallery() {
  const seededAdmin = process.env.SEED_ADMIN_EMAIL
  if (!seededAdmin) return null

  return prisma.gallery.findFirst({
    where: { isPublished: true, event: { owner: { email: seededAdmin } } },
    select: { slug: true, title: true, _count: { select: { photos: true } } },
  })
}
