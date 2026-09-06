import { SignJWT, jwtVerify } from 'jose'
import type { Role } from '@prisma/client'
import { env } from '@/lib/env'

/**
 * Two token families, deliberately kept apart by the `aud` claim.
 *
 *   session  — an authenticated workspace user, 7 days.
 *   gallery  — a customer who typed the right PIN, 2 hours, scoped to one slug.
 *
 * Verification always pins the expected audience, so a gallery token presented
 * to an authenticated endpoint fails signature-independent validation and a
 * session token cannot be replayed as gallery access. This is invariant 6.
 */

const ISSUER = 'framehouse'
const AUD_SESSION = 'framehouse:session'
const AUD_GALLERY = 'framehouse:gallery'

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
export const GALLERY_TTL_SECONDS = 2 * 60 * 60

let key: Uint8Array | null = null
function secret(): Uint8Array {
  if (!key) key = new TextEncoder().encode(env().JWT_SECRET)
  return key
}

export type SessionClaims = {
  userId: string
  email: string
  role: Role
}

export async function signSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ email: claims.email, role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUD_SESSION)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret())
}

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: AUD_SESSION,
    })
    if (!payload.sub || typeof payload.email !== 'string' || typeof payload.role !== 'string') {
      return null
    }
    return { userId: payload.sub, email: payload.email, role: payload.role as Role }
  } catch {
    return null
  }
}

/** Scoped to exactly one gallery slug. Grants nothing else, anywhere. */
export async function signGalleryToken(slug: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(slug)
    .setIssuer(ISSUER)
    .setAudience(AUD_GALLERY)
    .setIssuedAt()
    .setExpirationTime(`${GALLERY_TTL_SECONDS}s`)
    .sign(secret())
}

/**
 * The slug is checked here rather than by the caller, so there is no way to
 * verify a gallery token without also saying which gallery it must be for.
 */
export async function verifyGalleryToken(token: string, expectedSlug: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: AUD_GALLERY,
    })
    return payload.sub === expectedSlug
  } catch {
    return false
  }
}
