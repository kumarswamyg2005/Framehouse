import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db/prisma'
import { signGalleryToken, verifyGalleryToken } from '@/lib/auth/jwt'
import {
  GALLERY_PAGE_SIZE,
  currentPinVersion,
  getGallery,
  getPublicGallery,
  getPublicPhotoUrl,
  publishGallery,
  saveSelection,
  unpublishGallery,
  verifyGalleryPin,
} from '@/lib/data/gallery'
import { authenticate } from '@/lib/data/accounts'
import { expectApiError, makeEvent, makePhoto, makeUser, resetDatabase } from './helpers'

vi.mock('@/lib/storage/r2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage/r2')>()
  return { ...actual, presignDownload: vi.fn(async (key: string) => `https://storage.test/${key}?signed`) }
})

const PIN = '482917'
const IP = 'hashed-ip-for-tests'

beforeEach(resetDatabase)

async function publishedGallery(selectCount = 2, total = 3) {
  const admin = await makeUser('ADMIN')
  const member = await makeUser('MEMBER')
  const event = await makeEvent(admin, [member])
  const photos = []
  for (let i = 0; i < total; i++) photos.push(await makePhoto(event.id, member))

  const selectedIds = photos.slice(0, selectCount).map((p) => p.id)
  const saved = await saveSelection(admin, event.id, { title: 'Arjun & Priya', photoIds: selectedIds })
  const published = await publishGallery(admin, saved.id, { pin: PIN })

  return { admin, member, event, photos, selectedIds, galleryId: saved.id, slug: published.slug }
}

describe('selection and publishing', () => {
  it('lets only the event owner publish', async () => {
    const { member, galleryId } = await publishedGallery()
    // The member is assigned to this event, so they get 403 rather than 404.
    await expectApiError(publishGallery(member, galleryId, { pin: '111111' }), 'FORBIDDEN')
  })

  it('lets only the event owner save a selection', async () => {
    const { member, event, photos } = await publishedGallery()
    await expectApiError(
      saveSelection(member, event.id, { title: 'Mine now', photoIds: [photos[0]!.id] }),
      'FORBIDDEN'
    )
  })

  it('never returns the PIN, and stores it only as an argon2id hash', async () => {
    const { admin, galleryId, slug } = await publishedGallery()

    const result = await publishGallery(admin, galleryId, { pin: PIN })
    expect(JSON.stringify(result)).not.toContain(PIN)
    expect(result).not.toHaveProperty('pin')
    expect(result).not.toHaveProperty('pinHash')

    const row = await prisma.gallery.findUniqueOrThrow({ where: { slug } })
    expect(row.pinHash.startsWith('$argon2id$')).toBe(true)
    expect(row.pinHash).not.toContain(PIN)

    // And it is absent from what the lead's own gallery view returns.
    const forLead = await getGallery(admin, row.eventId)
    expect(JSON.stringify(forLead)).not.toContain(PIN)
    expect(forLead).not.toHaveProperty('pinHash')
  })

  it('refuses to publish an empty selection', async () => {
    const admin = await makeUser('ADMIN')
    const event = await makeEvent(admin)
    const saved = await saveSelection(admin, event.id, { title: 'Empty', photoIds: [] })
    await expectApiError(publishGallery(admin, saved.id, { pin: PIN }), 'VALIDATION_ERROR')
  })

  it('ignores photo ids that belong to a different event', async () => {
    const admin = await makeUser('ADMIN')
    const otherAdmin = await makeUser('ADMIN')
    const mine = await makeEvent(admin)
    const theirs = await makeEvent(otherAdmin)
    const myPhoto = await makePhoto(mine.id, admin)
    const theirPhoto = await makePhoto(theirs.id, otherAdmin)

    const saved = await saveSelection(admin, mine.id, {
      title: 'Mixed',
      photoIds: [myPhoto.id, theirPhoto.id],
    })
    expect(saved.selected).toBe(1)
  })

  it('uses a 12-character slug rather than a sequential id', async () => {
    const { slug } = await publishedGallery()
    expect(slug).toHaveLength(12)
    expect(slug).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{12}$/)
  })
})

describe('PIN verification', () => {
  it('accepts the correct PIN', async () => {
    const { slug } = await publishedGallery()
    await expect(verifyGalleryPin(slug, IP, { pin: PIN })).resolves.toHaveProperty('pinVersion')
  })

  it('rejects a wrong PIN with a message that reveals nothing', async () => {
    const { slug } = await publishedGallery()
    const error = (await expectApiError(
      verifyGalleryPin(slug, IP, { pin: '000000' }),
      'UNAUTHENTICATED'
    )) as Error
    expect(error.message).toBe('That PIN doesn’t match.')
  })

  it('gives an unknown slug exactly the same error as a wrong PIN', async () => {
    const { slug } = await publishedGallery()
    const real = (await expectApiError(
      verifyGalleryPin(slug, IP, { pin: '000000' }),
      'UNAUTHENTICATED'
    )) as Error
    const fake = (await expectApiError(
      verifyGalleryPin('zzzzzzzzzzzz', IP, { pin: '000000' }),
      'UNAUTHENTICATED'
    )) as Error
    expect(fake.message).toBe(real.message)
  })

  it('rejects the correct PIN once the gallery is unpublished', async () => {
    const { admin, galleryId, slug } = await publishedGallery()
    await unpublishGallery(admin, galleryId)
    await expectApiError(verifyGalleryPin(slug, IP, { pin: PIN }), 'UNAUTHENTICATED')
  })

  // Five failures are allowed inside the window; the sixth is refused.
  it('rate-limits after five failed attempts', async () => {
    const { slug } = await publishedGallery()

    for (let attempt = 1; attempt <= 5; attempt++) {
      await expectApiError(verifyGalleryPin(slug, IP, { pin: '000000' }), 'UNAUTHENTICATED')
    }

    const limited = (await expectApiError(
      verifyGalleryPin(slug, IP, { pin: '000000' }),
      'RATE_LIMITED'
    )) as Error & { headers: Record<string, string> }
    expect(Number(limited.headers['Retry-After'])).toBeGreaterThan(0)

    // Even the correct PIN is refused while the client is locked out.
    await expectApiError(verifyGalleryPin(slug, IP, { pin: PIN }), 'RATE_LIMITED')
  })

  it('limits per IP, so one attacker cannot lock out the real client', async () => {
    const { slug } = await publishedGallery()
    for (let attempt = 1; attempt <= 5; attempt++) {
      await expectApiError(verifyGalleryPin(slug, 'attacker-ip', { pin: '000000' }), 'UNAUTHENTICATED')
    }
    await expectApiError(verifyGalleryPin(slug, 'attacker-ip', { pin: PIN }), 'RATE_LIMITED')
    await expect(verifyGalleryPin(slug, 'client-ip', { pin: PIN })).resolves.toHaveProperty('pinVersion')
  })

  it('clears the lockout when the lead republishes with a new PIN', async () => {
    const { admin, galleryId, slug } = await publishedGallery()
    for (let attempt = 1; attempt <= 5; attempt++) {
      await expectApiError(verifyGalleryPin(slug, IP, { pin: '000000' }), 'UNAUTHENTICATED')
    }
    await expectApiError(verifyGalleryPin(slug, IP, { pin: PIN }), 'RATE_LIMITED')

    await publishGallery(admin, galleryId, { pin: '135790' })
    await expect(verifyGalleryPin(slug, IP, { pin: '135790' })).resolves.toHaveProperty('pinVersion')
  })

  // Changing a leaked PIN must take effect at once, not when the customer's
  // two-hour token happens to expire.
  it('moves the PIN generation forward on every publish, stranding old sessions', async () => {
    const { admin, galleryId, slug } = await publishedGallery()

    const first = await verifyGalleryPin(slug, IP, { pin: PIN })
    expect(await currentPinVersion(slug)).toBe(first.pinVersion)

    await publishGallery(admin, galleryId, { pin: '135790' })

    const now = await currentPinVersion(slug)
    expect(now).toBeGreaterThan(first.pinVersion)
    // A token minted under the old generation no longer verifies.
    const stale = await signGalleryToken(slug, first.pinVersion)
    await expect(verifyGalleryToken(stale, slug, now!)).resolves.toBe(false)
  })

  it('moves the generation forward on unpublish too', async () => {
    const { admin, galleryId, slug } = await publishedGallery()
    const { pinVersion } = await verifyGalleryPin(slug, IP, { pin: PIN })

    await unpublishGallery(admin, galleryId)
    // Nothing published at this slug any more.
    expect(await currentPinVersion(slug)).toBeNull()

    await publishGallery(admin, galleryId, { pin: PIN })
    const after = await currentPinVersion(slug)
    expect(after).toBeGreaterThan(pinVersion)
  })

  it('records attempts for slugs that do not resolve', async () => {
    await expectApiError(verifyGalleryPin('zzzzzzzzzzzz', IP, { pin: '000000' }), 'UNAUTHENTICATED')
    expect(
      await prisma.accessAttempt.count({ where: { kind: 'GALLERY_PIN', subject: 'zzzzzzzzzzzz' } })
    ).toBe(1)
  })
})

describe('customer reads', () => {
  it('returns exactly the selected photos', async () => {
    const { slug, selectedIds } = await publishedGallery(2, 5)
    const gallery = await getPublicGallery(slug)

    expect(gallery.photos).toHaveLength(2)
    expect(gallery.photos.map((p) => p.id).sort()).toEqual([...selectedIds].sort())
  })

  it('404s a real photo id from the same event that was not selected', async () => {
    const { slug, photos, selectedIds } = await publishedGallery(2, 5)
    const unselected = photos.find((p) => !selectedIds.includes(p.id))!

    await expect(getPublicPhotoUrl(slug, selectedIds[0]!)).resolves.toHaveProperty('url')
    await expectApiError(getPublicPhotoUrl(slug, unselected.id), 'NOT_FOUND')
  })

  it('revokes access the moment the gallery is unpublished', async () => {
    const { admin, galleryId, slug, selectedIds } = await publishedGallery()

    await expect(getPublicGallery(slug)).resolves.toBeTruthy()
    await unpublishGallery(admin, galleryId)

    await expectApiError(getPublicGallery(slug), 'NOT_FOUND')
    await expectApiError(getPublicPhotoUrl(slug, selectedIds[0]!), 'NOT_FOUND')
  })

  it('revokes access when the selection is emptied', async () => {
    const { admin, event, slug, selectedIds } = await publishedGallery()
    await saveSelection(admin, event.id, { title: 'Arjun & Priya', photoIds: [] })
    await expectApiError(getPublicPhotoUrl(slug, selectedIds[0]!), 'NOT_FOUND')
  })

  it('never exposes a storage key or a raw bucket URL to the customer', async () => {
    const { slug } = await publishedGallery()
    const gallery = await getPublicGallery(slug)
    const serialised = JSON.stringify(gallery)

    expect(serialised).not.toContain('pinHash')
    for (const photo of gallery.photos) {
      expect(photo).not.toHaveProperty('storageKey')
      expect(photo.thumbnailUrl).toContain('signed')
    }
  })
})

describe('sign-in throttling', () => {
  it('locks out after ten failures for the same email and IP', async () => {
    const user = await makeUser('ADMIN', 'the-real-password')

    for (let attempt = 1; attempt <= 10; attempt++) {
      await expectApiError(
        authenticate({ email: user.email, password: 'wrong-password' }, IP),
        'UNAUTHENTICATED'
      )
    }

    // Even the correct password is refused while locked out.
    const limited = (await expectApiError(
      authenticate({ email: user.email, password: 'the-real-password' }, IP),
      'RATE_LIMITED'
    )) as Error & { headers: Record<string, string> }
    expect(Number(limited.headers['Retry-After'])).toBeGreaterThan(0)
  })

  it('limits per IP, so one attacker cannot lock a real user out', async () => {
    const user = await makeUser('ADMIN', 'the-real-password')

    for (let attempt = 1; attempt <= 10; attempt++) {
      await expectApiError(
        authenticate({ email: user.email, password: 'wrong-password' }, 'attacker-ip'),
        'UNAUTHENTICATED'
      )
    }
    await expectApiError(
      authenticate({ email: user.email, password: 'the-real-password' }, 'attacker-ip'),
      'RATE_LIMITED'
    )

    // The real user, on their own connection, is unaffected.
    await expect(
      authenticate({ email: user.email, password: 'the-real-password' }, 'their-own-ip')
    ).resolves.toMatchObject({ email: user.email })
  })

  it('counts unknown addresses too, so the limiter is not an oracle', async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      await expectApiError(
        authenticate({ email: 'nobody@nowhere.test', password: 'x'.repeat(12) }, IP),
        'UNAUTHENTICATED'
      )
    }
    await expectApiError(
      authenticate({ email: 'nobody@nowhere.test', password: 'x'.repeat(12) }, IP),
      'RATE_LIMITED'
    )
  })

  // Read-then-write under READ COMMITTED lets simultaneous requests both see
  // the same count and both proceed. The guard runs SERIALIZABLE for this.
  it('holds the ceiling under concurrent attempts', async () => {
    const user = await makeUser('ADMIN', 'the-real-password')

    const outcomes = await Promise.all(
      Array.from({ length: 16 }, () =>
        authenticate({ email: user.email, password: 'wrong-password' }, 'burst-ip')
          .then(() => 'ok')
          .catch((e: { code?: string }) => e.code ?? 'other')
      )
    )

    const allowed = outcomes.filter((o) => o === 'UNAUTHENTICATED').length
    // Ten failures are allowed; the rest must be refused rather than slipping
    // through on a stale read.
    expect(allowed).toBeLessThanOrEqual(10)
    expect(outcomes).toContain('RATE_LIMITED')
  })
})

describe('gallery pagination', () => {
  it('returns a bounded page and a cursor, and walks the whole selection', async () => {
    const admin = await makeUser('ADMIN')
    const member = await makeUser('MEMBER')
    const event = await makeEvent(admin, [member])

    const photos = []
    for (let i = 0; i < 45; i++) photos.push(await makePhoto(event.id, member))
    const ids = photos.map((p) => p.id)

    const saved = await saveSelection(admin, event.id, { title: 'Big', photoIds: ids })
    const { slug } = await publishGallery(admin, saved.id, { pin: PIN })

    const first = await getPublicGallery(slug)
    expect(first.total).toBe(45)
    expect(first.photos).toHaveLength(GALLERY_PAGE_SIZE)
    expect(first.nextCursor).not.toBeNull()

    const second = await getPublicGallery(slug, { after: first.nextCursor! })
    expect(second.photos).toHaveLength(45 - GALLERY_PAGE_SIZE)
    expect(second.nextCursor).toBeNull()

    // Every selected photo appears exactly once across the pages, in order.
    const walked = [...first.photos, ...second.photos].map((p) => p.id)
    expect(walked).toEqual(ids)
    expect(new Set(walked).size).toBe(45)
  })

  it('still refuses an unselected photo reached through a later page', async () => {
    const admin = await makeUser('ADMIN')
    const member = await makeUser('MEMBER')
    const event = await makeEvent(admin, [member])

    const selected = []
    for (let i = 0; i < 40; i++) selected.push(await makePhoto(event.id, member))
    const unselected = await makePhoto(event.id, member)

    const saved = await saveSelection(admin, event.id, {
      title: 'Big',
      photoIds: selected.map((p) => p.id),
    })
    const { slug } = await publishGallery(admin, saved.id, { pin: PIN })

    await expectApiError(getPublicPhotoUrl(slug, unselected.id), 'NOT_FOUND')
  })
})

describe('gallery cursor parsing', () => {
  // Number('') === 0, which would be read as position > 0 and silently drop the
  // first photograph, positions being zero-based.
  it('treats position 0 as the true first page', async () => {
    const admin = await makeUser('ADMIN')
    const member = await makeUser('MEMBER')
    const event = await makeEvent(admin, [member])
    const photos = []
    for (let i = 0; i < 3; i++) photos.push(await makePhoto(event.id, member))

    const saved = await saveSelection(admin, event.id, {
      title: 'Small',
      photoIds: photos.map((p) => p.id),
    })
    const { slug } = await publishGallery(admin, saved.id, { pin: PIN })

    const all = await getPublicGallery(slug)
    expect(all.photos).toHaveLength(3)
    expect(all.photos[0]!.position).toBe(0)

    // Paging after position 0 must drop exactly one photograph, not zero.
    const after0 = await getPublicGallery(slug, { after: 0 })
    expect(after0.photos.map((p) => p.position)).toEqual([1, 2])
  })
})
