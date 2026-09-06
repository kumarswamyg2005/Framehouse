import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db/prisma'
import {
  requireEventAccess,
  requireEventOwner,
  requireGalleryPhoto,
  requirePhotoAccess,
  visibleEventWhere,
  visiblePhotoWhere,
} from '@/lib/auth/policy'
import {
  expectApiError,
  makeEvent,
  makeGallery,
  makePhoto,
  makeUser,
  resetDatabase,
} from './helpers'

beforeEach(resetDatabase)

describe('event visibility', () => {
  it('scopes a member to assigned events only', async () => {
    const admin = await makeUser('ADMIN')
    const assigned = await makeUser('MEMBER')
    const outsider = await makeUser('MEMBER')

    const theirs = await makeEvent(admin, [assigned])
    await makeEvent(admin, [])

    const visible = await prisma.event.findMany({ where: visibleEventWhere(assigned) })
    expect(visible.map((e) => e.id)).toEqual([theirs.id])

    const none = await prisma.event.findMany({ where: visibleEventWhere(outsider) })
    expect(none).toHaveLength(0)
  })

  it('scopes an admin to events they own, not events owned by another admin', async () => {
    const admin = await makeUser('ADMIN')
    const otherAdmin = await makeUser('ADMIN')
    const mine = await makeEvent(admin)
    await makeEvent(otherAdmin)

    const visible = await prisma.event.findMany({ where: visibleEventWhere(admin) })
    expect(visible.map((e) => e.id)).toEqual([mine.id])
  })

  // Required behaviour 1: a member requesting an unassigned event gets 404, not
  // 403 — a 403 would confirm the event exists.
  it('returns NOT_FOUND when a member requests an event they are not assigned to', async () => {
    const admin = await makeUser('ADMIN')
    const outsider = await makeUser('MEMBER')
    const event = await makeEvent(admin)

    await expectApiError(requireEventAccess(outsider, event.id), 'NOT_FOUND')
  })

  it('lets an assigned member read the event', async () => {
    const admin = await makeUser('ADMIN')
    const member = await makeUser('MEMBER')
    const event = await makeEvent(admin, [member])

    await expect(requireEventAccess(member, event.id)).resolves.toMatchObject({ id: event.id })
  })
})

describe('owner-only actions', () => {
  // Required behaviour 2: a member who can see the event gets 403 for publish.
  it('returns FORBIDDEN when an assigned member attempts an owner action', async () => {
    const admin = await makeUser('ADMIN')
    const member = await makeUser('MEMBER')
    const event = await makeEvent(admin, [member])

    await expectApiError(requireEventOwner(member, event.id), 'FORBIDDEN')
  })

  it('returns NOT_FOUND when an unassigned member attempts an owner action', async () => {
    const admin = await makeUser('ADMIN')
    const outsider = await makeUser('MEMBER')
    const event = await makeEvent(admin)

    await expectApiError(requireEventOwner(outsider, event.id), 'NOT_FOUND')
  })

  it('returns NOT_FOUND when a different admin attempts an owner action', async () => {
    const admin = await makeUser('ADMIN')
    const otherAdmin = await makeUser('ADMIN')
    const event = await makeEvent(admin)

    await expectApiError(requireEventOwner(otherAdmin, event.id), 'NOT_FOUND')
  })

  it('allows the owning admin', async () => {
    const admin = await makeUser('ADMIN')
    const event = await makeEvent(admin)
    await expect(requireEventOwner(admin, event.id)).resolves.toMatchObject({ id: event.id })
  })
})

describe('photo visibility', () => {
  it('hides one member’s photos from another member in the same event', async () => {
    const admin = await makeUser('ADMIN')
    const nikhil = await makeUser('MEMBER')
    const sana = await makeUser('MEMBER')
    const event = await makeEvent(admin, [nikhil, sana])

    const mine = await makePhoto(event.id, nikhil)
    const theirs = await makePhoto(event.id, sana)

    const seen = await prisma.photo.findMany({ where: visiblePhotoWhere(nikhil, event.id) })
    expect(seen.map((p) => p.id)).toEqual([mine.id])

    await expectApiError(requirePhotoAccess(nikhil, theirs.id), 'NOT_FOUND')
  })

  it('shows the owning admin every photo in the event', async () => {
    const admin = await makeUser('ADMIN')
    const nikhil = await makeUser('MEMBER')
    const sana = await makeUser('MEMBER')
    const event = await makeEvent(admin, [nikhil, sana])

    await makePhoto(event.id, nikhil)
    await makePhoto(event.id, sana)

    const seen = await prisma.photo.findMany({ where: visiblePhotoWhere(admin, event.id) })
    expect(seen).toHaveLength(2)
  })

  it('denies an admin access to a photo in an event they do not own', async () => {
    const admin = await makeUser('ADMIN')
    const otherAdmin = await makeUser('ADMIN')
    const member = await makeUser('MEMBER')
    const event = await makeEvent(admin, [member])
    const photo = await makePhoto(event.id, member)

    await expectApiError(requirePhotoAccess(otherAdmin, photo.id), 'NOT_FOUND')
  })
})

describe('customer gallery path', () => {
  // Invariant 8: a real photo id from the same event, simply not selected.
  it('returns NOT_FOUND for a photo that exists but was not selected', async () => {
    const admin = await makeUser('ADMIN')
    const member = await makeUser('MEMBER')
    const event = await makeEvent(admin, [member])
    const selected = await makePhoto(event.id, member)
    const unselected = await makePhoto(event.id, member)
    const gallery = await makeGallery(event.id, { photoIds: [selected.id] })

    await expect(requireGalleryPhoto(gallery.slug, selected.id)).resolves.toMatchObject({
      id: selected.id,
    })
    await expectApiError(requireGalleryPhoto(gallery.slug, unselected.id), 'NOT_FOUND')
  })

  // Invariant 10: publication state is read live, not baked into a token.
  it('returns NOT_FOUND for a selected photo once the gallery is unpublished', async () => {
    const admin = await makeUser('ADMIN')
    const member = await makeUser('MEMBER')
    const event = await makeEvent(admin, [member])
    const photo = await makePhoto(event.id, member)
    const gallery = await makeGallery(event.id, { photoIds: [photo.id] })

    await expect(requireGalleryPhoto(gallery.slug, photo.id)).resolves.toBeTruthy()

    await prisma.gallery.update({ where: { id: gallery.id }, data: { isPublished: false } })
    await expectApiError(requireGalleryPhoto(gallery.slug, photo.id), 'NOT_FOUND')
  })

  it('returns NOT_FOUND once the selection is removed', async () => {
    const admin = await makeUser('ADMIN')
    const member = await makeUser('MEMBER')
    const event = await makeEvent(admin, [member])
    const photo = await makePhoto(event.id, member)
    const gallery = await makeGallery(event.id, { photoIds: [photo.id] })

    await prisma.galleryPhoto.deleteMany({ where: { galleryId: gallery.id } })
    await expectApiError(requireGalleryPhoto(gallery.slug, photo.id), 'NOT_FOUND')
  })

  it('respects gallery expiry', async () => {
    const admin = await makeUser('ADMIN')
    const member = await makeUser('MEMBER')
    const event = await makeEvent(admin, [member])
    const photo = await makePhoto(event.id, member)
    const gallery = await makeGallery(event.id, { photoIds: [photo.id] })

    await prisma.gallery.update({
      where: { id: gallery.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    await expectApiError(requireGalleryPhoto(gallery.slug, photo.id), 'NOT_FOUND')
  })
})
