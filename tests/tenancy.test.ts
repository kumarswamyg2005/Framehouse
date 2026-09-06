import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db/prisma'
import { requireEventAccess, requireEventOwner, requirePhotoAccess } from '@/lib/auth/policy'
import { addMember, getEventDetail, listEvents, removeMember } from '@/lib/data/events'
import {
  getGallery,
  publishGallery,
  saveSelection,
  unpublishGallery,
  verifyGalleryPin,
} from '@/lib/data/gallery'
import { deletePhoto, listPhotos, photoUrl, presignPhotoUpload } from '@/lib/data/photos'
import { expectApiError, makeEvent, makePhoto, makeUser, resetDatabase } from './helpers'

vi.mock('@/lib/storage/r2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage/r2')>()
  return {
    ...actual,
    presignDownload: vi.fn(async (key: string) => `https://storage.test/${key}?signed`),
    presignUpload: vi.fn(async (key: string) => `https://storage.test/${key}?signed`),
    deleteObjects: vi.fn(async () => {}),
  }
})

/**
 * Tenant isolation between two leads.
 *
 * Both are ADMIN. The role is not what separates them — ownership is. A lead who
 * knows every id belonging to another lead's event must still be unable to read
 * it, change it, publish it, or set its PIN, and must not be able to tell that
 * any of it exists.
 *
 * Every case below asserts NOT_FOUND rather than FORBIDDEN, deliberately: a 403
 * would confirm the resource is real.
 */

const PIN = '482917'

async function twoStudios() {
  const alice = await makeUser('ADMIN')
  const bob = await makeUser('ADMIN')
  const aliceMember = await makeUser('MEMBER')

  const aliceEvent = await makeEvent(alice, [aliceMember])
  const alicePhoto = await makePhoto(aliceEvent.id, aliceMember)

  const saved = await saveSelection(alice, aliceEvent.id, {
    title: 'Alice Gallery',
    photoIds: [alicePhoto.id],
  })
  const published = await publishGallery(alice, saved.id, { pin: PIN })

  return { alice, bob, aliceMember, aliceEvent, alicePhoto, gallery: saved, slug: published.slug }
}

beforeEach(resetDatabase)

describe('a second lead cannot reach another lead’s event', () => {
  it('cannot see it in their own list', async () => {
    const { bob } = await twoStudios()
    expect(await listEvents(bob)).toHaveLength(0)
  })

  it('cannot read it by id', async () => {
    const { bob, aliceEvent } = await twoStudios()
    await expectApiError(requireEventAccess(bob, aliceEvent.id), 'NOT_FOUND')
    await expectApiError(getEventDetail(bob, aliceEvent.id), 'NOT_FOUND')
  })

  it('cannot claim owner rights over it', async () => {
    const { bob, aliceEvent } = await twoStudios()
    await expectApiError(requireEventOwner(bob, aliceEvent.id), 'NOT_FOUND')
  })

  it('cannot list or open its photos', async () => {
    const { bob, aliceEvent, alicePhoto } = await twoStudios()
    await expectApiError(listPhotos(bob, aliceEvent.id, { limit: 60 }), 'NOT_FOUND')
    await expectApiError(requirePhotoAccess(bob, alicePhoto.id), 'NOT_FOUND')
    await expectApiError(photoUrl(bob, alicePhoto.id), 'NOT_FOUND')
  })

  it('cannot delete its photos', async () => {
    const { bob, alicePhoto } = await twoStudios()
    await expectApiError(deletePhoto(bob, alicePhoto.id), 'NOT_FOUND')
    // Still there.
    expect(await prisma.photo.findUnique({ where: { id: alicePhoto.id } })).not.toBeNull()
  })

  it('cannot upload into it', async () => {
    const { bob, aliceEvent } = await twoStudios()
    await expectApiError(
      presignPhotoUpload(bob, aliceEvent.id, {
        filename: 'x.jpg',
        mimeType: 'image/jpeg',
        fileSize: 1024,
      }),
      'NOT_FOUND'
    )
  })

  it('cannot add or remove its team members', async () => {
    const { bob, aliceEvent, aliceMember } = await twoStudios()
    await expectApiError(addMember(bob, aliceEvent.id, { email: 'x@y.test' }), 'NOT_FOUND')
    await expectApiError(removeMember(bob, aliceEvent.id, aliceMember.id), 'NOT_FOUND')
    // The roster is untouched.
    expect(await prisma.eventMember.count({ where: { eventId: aliceEvent.id } })).toBe(1)
  })
})

describe('a second lead cannot touch another lead’s gallery or its PIN', () => {
  it('cannot read the gallery', async () => {
    const { bob, aliceEvent } = await twoStudios()
    await expectApiError(getGallery(bob, aliceEvent.id), 'NOT_FOUND')
  })

  it('cannot change the selection', async () => {
    const { bob, aliceEvent, alicePhoto } = await twoStudios()
    await expectApiError(
      saveSelection(bob, aliceEvent.id, { title: 'Hijacked', photoIds: [alicePhoto.id] }),
      'NOT_FOUND'
    )
  })

  // The question this file exists to answer.
  it('cannot set the PIN', async () => {
    const { bob, gallery, slug } = await twoStudios()

    await expectApiError(publishGallery(bob, gallery.id, { pin: '999999' }), 'NOT_FOUND')

    // The owner's PIN still works and the attacker's does not.
    await expect(verifyGalleryPin(slug, 'ip-a', { pin: PIN })).resolves.toHaveProperty('pinVersion')
    await expectApiError(verifyGalleryPin(slug, 'ip-b', { pin: '999999' }), 'UNAUTHENTICATED')
  })

  it('cannot unpublish it', async () => {
    const { bob, gallery, slug } = await twoStudios()
    await expectApiError(unpublishGallery(bob, gallery.id), 'NOT_FOUND')
    expect(await prisma.gallery.findUniqueOrThrow({ where: { slug } })).toMatchObject({
      isPublished: true,
    })
  })

  it('cannot rename it', async () => {
    const { bob, aliceEvent, slug } = await twoStudios()
    await expectApiError(
      saveSelection(bob, aliceEvent.id, { title: 'Bob Studios', photoIds: [] }),
      'NOT_FOUND'
    )
    expect(await prisma.gallery.findUniqueOrThrow({ where: { slug } })).toMatchObject({
      title: 'Alice Gallery',
    })
  })
})

describe('a member of one event is not a member of another', () => {
  it('cannot reach a second lead’s event either', async () => {
    const { bob, aliceMember } = await twoStudios()
    const bobEvent = await makeEvent(bob)

    await expectApiError(requireEventAccess(aliceMember, bobEvent.id), 'NOT_FOUND')
    await expectApiError(requireEventOwner(aliceMember, bobEvent.id), 'NOT_FOUND')
  })

  it('is scoped to the events they are actually on', async () => {
    const { alice, aliceMember, aliceEvent } = await twoStudios()
    await makeEvent(alice) // a second event of Alice's, without this member

    const visible = await listEvents(aliceMember)
    expect(visible.map((e) => e.id)).toEqual([aliceEvent.id])
  })
})

describe('the entry page never advertises a real gallery', () => {
  const env = { ...process.env }
  afterEach(() => {
    process.env = { ...env }
  })

  it('shows nothing when DEMO_MODE is unset, even with seed variables present', async () => {
    const { demoGallery } = await import('@/lib/data/accounts')
    const { alice } = await twoStudios()

    // Exactly the shape of the footgun this guards: a real deployment that
    // seeded once and never removed the seed variables.
    process.env.SEED_ADMIN_EMAIL = alice.email
    delete process.env.DEMO_MODE

    expect(await demoGallery()).toBeNull()
  })

  it('shows nothing when DEMO_MODE is anything other than the string "true"', async () => {
    const { demoGallery } = await import('@/lib/data/accounts')
    const { alice } = await twoStudios()
    process.env.SEED_ADMIN_EMAIL = alice.email

    for (const value of ['1', 'yes', 'TRUE', 'on', '']) {
      process.env.DEMO_MODE = value
      expect(await demoGallery()).toBeNull()
    }
  })

  it('shows the gallery only when the switch is on and the data is seeded', async () => {
    const { demoGallery } = await import('@/lib/data/accounts')
    const { alice, slug } = await twoStudios()

    process.env.DEMO_MODE = 'true'
    process.env.SEED_ADMIN_EMAIL = alice.email
    expect(await demoGallery()).toMatchObject({ slug })

    // Same switch, but the account it names does not own anything published.
    process.env.SEED_ADMIN_EMAIL = 'someone-else@nowhere.test'
    expect(await demoGallery()).toBeNull()
  })
})
