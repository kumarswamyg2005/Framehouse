import { describe, expect, it } from 'vitest'
import { hashSecret, verifySecret } from '@/lib/auth/hash'
import {
  signGalleryToken,
  signSessionToken,
  verifyGalleryToken,
  verifySessionToken,
} from '@/lib/auth/jwt'

describe('argon2id hashing', () => {
  it('produces an argon2id PHC string and verifies the original secret', async () => {
    const hash = await hashSecret('correct-horse-battery-staple')

    expect(hash.startsWith('$argon2id$')).toBe(true)
    expect(hash).not.toContain('correct-horse-battery-staple')
    await expect(verifySecret(hash, 'correct-horse-battery-staple')).resolves.toBe(true)
  })

  it('rejects a wrong secret', async () => {
    const hash = await hashSecret('correct-horse-battery-staple')
    await expect(verifySecret(hash, 'Correct-horse-battery-staple')).resolves.toBe(false)
    await expect(verifySecret(hash, '')).resolves.toBe(false)
  })

  it('salts, so the same input hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashSecret('same-input'), hashSecret('same-input')])
    expect(a).not.toEqual(b)
  })

  it('returns false rather than throwing on a corrupt stored hash', async () => {
    await expect(verifySecret('not-a-hash', 'anything')).resolves.toBe(false)
  })
})

describe('token audience separation', () => {
  it('round-trips a session token', async () => {
    const token = await signSessionToken({
      userId: 'user_1',
      email: 'a@test.local',
      role: 'ADMIN',
    })
    await expect(verifySessionToken(token)).resolves.toEqual({
      userId: 'user_1',
      email: 'a@test.local',
      role: 'ADMIN',
    })
  })

  // Invariant 6: a gallery token must buy nothing on the authenticated API.
  it('refuses a gallery token where a session token is expected', async () => {
    const galleryToken = await signGalleryToken('abc123def456', 0)
    await expect(verifySessionToken(galleryToken)).resolves.toBeNull()
  })

  it('refuses a session token where a gallery token is expected', async () => {
    const sessionToken = await signSessionToken({
      userId: 'user_1',
      email: 'a@test.local',
      role: 'ADMIN',
    })
    await expect(verifyGalleryToken(sessionToken, 'abc123def456', 0)).resolves.toBe(false)
  })

  it('scopes a gallery token to a single slug', async () => {
    const token = await signGalleryToken('abc123def456', 0)
    await expect(verifyGalleryToken(token, 'abc123def456', 0)).resolves.toBe(true)
    await expect(verifyGalleryToken(token, 'zzz999yyy888', 0)).resolves.toBe(false)
  })

  // Changing the PIN bumps Gallery.pinVersion, which must strand every token
  // issued under the old one rather than leaving it live until it expires.
  it('stops verifying once the PIN generation moves on', async () => {
    const token = await signGalleryToken('abc123def456', 3)
    await expect(verifyGalleryToken(token, 'abc123def456', 3)).resolves.toBe(true)
    await expect(verifyGalleryToken(token, 'abc123def456', 4)).resolves.toBe(false)
    await expect(verifyGalleryToken(token, 'abc123def456', 0)).resolves.toBe(false)
  })

  it('rejects a tampered token', async () => {
    const token = await signSessionToken({ userId: 'u', email: 'a@b.c', role: 'MEMBER' })
    const [header, payload, signature] = token.split('.')
    const forged = [header, btoa('{"sub":"attacker","role":"ADMIN"}'), signature].join('.')
    await expect(verifySessionToken(forged)).resolves.toBeNull()
  })
})

describe('secrets never reach a response body', () => {
  it('omits passwordHash from every actor-facing read', async () => {
    const { getEventDetail, listEvents } = await import('@/lib/data/events')
    const { makeEvent, makeUser, resetDatabase } = await import('./helpers')

    await resetDatabase()
    const admin = await makeUser('ADMIN', 'a-real-password-here')
    const member = await makeUser('MEMBER', 'a-real-password-here')
    const event = await makeEvent(admin, [member])

    for (const payload of [
      await listEvents(admin),
      await listEvents(member),
      await getEventDetail(admin, event.id),
      await getEventDetail(member, event.id),
    ]) {
      const serialised = JSON.stringify(payload)
      expect(serialised).not.toContain('passwordHash')
      expect(serialised).not.toContain('a-real-password-here')
      expect(serialised).not.toContain('$argon2id$')
    }
  })

  it('keeps the actor shape free of a password field', async () => {
    const { getActorFieldsForTest } = await import('./helpers')
    expect(getActorFieldsForTest()).toEqual(['id', 'email', 'name', 'role'])
  })
})
