import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db/prisma'
import { unauthenticated } from '@/lib/http'
import type { Actor } from './policy'
import {
  GALLERY_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  signGalleryToken,
  signSessionToken,
  verifyGalleryToken,
  verifySessionToken,
} from './jwt'

export const SESSION_COOKIE = 'fh_session'

/** One cookie per gallery, so a customer can hold links to several at once. */
export function galleryCookieName(slug: string): string {
  return `fh_gallery_${slug}`
}

const baseCookie = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
}

export async function startSession(user: {
  id: string
  email: string
  role: Actor['role']
}): Promise<void> {
  const token = await signSessionToken({ userId: user.id, email: user.email, role: user.role })
  const store = await cookies()
  store.set(SESSION_COOKIE, token, { ...baseCookie, maxAge: SESSION_TTL_SECONDS })
}

export async function endSession(): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, '', { ...baseCookie, maxAge: 0 })
}

/**
 * Resolves the current actor, or null.
 *
 * The user row is re-read on every request rather than trusted from the token.
 * A signed token is proof of a past login, not of present standing: this is
 * what makes a deleted or demoted account lose access immediately instead of
 * when its 7-day token happens to expire.
 */
export async function getActor(): Promise<Actor | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null

  const claims = await verifySessionToken(token)
  if (!claims) return null

  return prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, email: true, name: true, role: true },
  })
}

export async function requireActor(): Promise<Actor> {
  const actor = await getActor()
  if (!actor) throw unauthenticated()
  return actor
}

/* -------------------------------------------------------------------------
 * Customer gallery cookie. Separate audience, separate cookie, separate TTL.
 * ---------------------------------------------------------------------- */

export async function grantGalleryAccess(slug: string): Promise<void> {
  const token = await signGalleryToken(slug)
  const store = await cookies()
  store.set(galleryCookieName(slug), token, { ...baseCookie, maxAge: GALLERY_TTL_SECONDS })
}

export async function hasGalleryAccess(slug: string): Promise<boolean> {
  const token = (await cookies()).get(galleryCookieName(slug))?.value
  if (!token) return false
  return verifyGalleryToken(token, slug)
}

/**
 * Page-level guard. Server components cannot return a 401 envelope, so an
 * unauthenticated visitor is sent to the sign-in screen instead.
 */
export async function requirePageActor(): Promise<Actor> {
  const actor = await getActor()
  if (!actor) redirect('/login')
  return actor
}
