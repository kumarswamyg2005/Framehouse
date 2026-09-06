import { Role } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { hashSecret } from '@/lib/auth/hash'
import type { Actor } from '@/lib/auth/policy'
import { buildGallerySlug, buildStorageKey, buildThumbnailKey } from '@/lib/ids'

/** Order matters: children before parents, so foreign keys never block a wipe. */
export async function resetDatabase(): Promise<void> {
  await prisma.pinAttempt.deleteMany()
  await prisma.galleryPhoto.deleteMany()
  await prisma.gallery.deleteMany()
  await prisma.photo.deleteMany()
  await prisma.eventMember.deleteMany()
  await prisma.event.deleteMany()
  await prisma.user.deleteMany()
}

let counter = 0
const unique = () => `${Date.now()}-${counter++}`

export async function makeUser(role: Role, password = 'correct-horse-battery'): Promise<Actor> {
  const user = await prisma.user.create({
    data: {
      email: `${role.toLowerCase()}-${unique()}@test.local`,
      name: `Test ${role}`,
      role,
      passwordHash: await hashSecret(password),
    },
    select: { id: true, email: true, name: true, role: true },
  })
  return user
}

export async function makeEvent(owner: Actor, members: Actor[] = []) {
  return prisma.event.create({
    data: {
      name: `Event ${unique()}`,
      ownerId: owner.id,
      members: { create: members.map((m) => ({ userId: m.id })) },
    },
  })
}

export async function makePhoto(eventId: string, uploader: Actor) {
  const storageKey = buildStorageKey(eventId, 'image/jpeg')
  return prisma.photo.create({
    data: {
      eventId,
      uploadedById: uploader.id,
      originalFilename: 'DSC_0001.JPG',
      storageKey,
      thumbnailKey: buildThumbnailKey(eventId, storageKey),
      mimeType: 'image/jpeg',
      fileSize: 2_400_000,
      width: 1800,
      height: 1200,
      status: 'READY',
    },
  })
}

export async function makeGallery(
  eventId: string,
  opts: { pin?: string; published?: boolean; photoIds?: string[] } = {}
) {
  const { pin = '482917', published = true, photoIds = [] } = opts
  return prisma.gallery.create({
    data: {
      eventId,
      slug: buildGallerySlug(),
      title: 'Test gallery',
      pinHash: await hashSecret(pin),
      isPublished: published,
      publishedAt: published ? new Date() : null,
      photos: { create: photoIds.map((photoId, position) => ({ photoId, position })) },
    },
  })
}

/** Asserts a promise rejects with a given ApiError code, and returns the error. */
export async function expectApiError(promise: Promise<unknown>, code: string) {
  try {
    await promise
  } catch (error) {
    const actual = (error as { code?: string }).code
    if (actual !== code) throw new Error(`Expected error code ${code}, got ${actual}`)
    return error
  }
  throw new Error(`Expected the call to reject with ${code}, but it resolved`)
}
