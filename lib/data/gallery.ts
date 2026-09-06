import { Prisma } from '@prisma/client'
import type { z } from 'zod'
import type { Actor } from '@/lib/auth/policy'
import { publishedGalleryWhere, requireEventOwner, requireGalleryPhoto } from '@/lib/auth/policy'
import { hashSecret, verifySecret } from '@/lib/auth/hash'
import { prisma } from '@/lib/db/prisma'
import { ApiError, notFound } from '@/lib/http'
import { buildGallerySlug } from '@/lib/ids'
import { assertPinAttemptAllowed, recordPinAttempt } from '@/lib/rate-limit'
import type { publishSchema, saveSelectionSchema, verifyPinSchema } from '@/lib/schemas'
import { presignDownload } from '@/lib/storage/r2'

/**
 * Saves the lead's selection. Creating the gallery row and choosing the photos
 * are the same operation: a gallery with no selection is not a meaningful state
 * for a lead to be in, and publishing is a separate, explicit step.
 *
 * Selected ids are intersected with the photos that actually belong to this
 * event, so a crafted request cannot pull a photo from somewhere else into a
 * gallery.
 */
export async function saveSelection(
  actor: Actor,
  eventId: string,
  input: z.infer<typeof saveSelectionSchema>
) {
  await requireEventOwner(actor, eventId)

  const owned = await prisma.photo.findMany({
    where: { eventId, id: { in: input.photoIds } },
    select: { id: true },
  })
  const ownedIds = new Set(owned.map((p) => p.id))
  const ordered = input.photoIds.filter((id) => ownedIds.has(id))

  // The gallery row is resolved OUTSIDE the transaction, and the placeholder PIN
  // hash is only computed when one is actually being created.
  //
  // This used to be a single upsert. JavaScript builds the `create` payload
  // eagerly, so `await hashSecret(...)` — argon2id, 19 MB and tens of
  // milliseconds — ran on every autosave, including the overwhelming majority
  // where the gallery already existed, and it ran while holding a transaction
  // open. Selection autosave fires on a 700 ms debounce as a lead works through
  // a sheet, so that was the hot path.
  const gallery = await resolveGallery(eventId, input.title)

  // Only the selection itself needs to be atomic: a client must never see a
  // half-replaced gallery.
  await prisma.$transaction([
    prisma.galleryPhoto.deleteMany({ where: { galleryId: gallery.id } }),
    prisma.galleryPhoto.createMany({
      data: ordered.map((photoId, position) => ({ galleryId: gallery.id, photoId, position })),
    }),
  ])

  return { id: gallery.id, slug: gallery.slug, title: gallery.title, selected: ordered.length }
}

type GalleryStub = { id: string; slug: string; title: string }

const gallerySelect = { id: true, slug: true, title: true } as const

async function resolveGallery(eventId: string, title: string): Promise<GalleryStub> {
  const existing = await prisma.gallery.findUnique({ where: { eventId }, select: gallerySelect })

  if (existing) {
    if (existing.title === title) return existing
    return prisma.gallery.update({
      where: { id: existing.id },
      data: { title },
      select: gallerySelect,
    })
  }

  try {
    return await prisma.gallery.create({
      data: {
        eventId,
        slug: buildGallerySlug(),
        title,
        // A placeholder that the six-digit PIN schema can never produce, so an
        // unpublished gallery cannot be opened by guessing.
        pinHash: await hashSecret(crypto.randomUUID()),
      },
      select: gallerySelect,
    })
  } catch (error) {
    // Two autosaves can race on the first ever selection. Gallery.eventId is
    // unique, so one loses; re-read rather than failing the lead's click.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await prisma.gallery.findUnique({ where: { eventId }, select: gallerySelect })
      if (raced) return raced
    }
    throw error
  }
}

/** Resolves a gallery through its event's ownership. Never by id alone. */
async function requireOwnedGallery(actor: Actor, galleryId: string) {
  const gallery = await prisma.gallery.findUnique({
    where: { id: galleryId },
    select: { id: true, eventId: true, slug: true, title: true },
  })
  if (!gallery) throw notFound('That gallery does not exist.')

  // Throws 404 for a stranger, 403 for an assigned member — invariant in
  // policy.ts. This is what makes a member's publish attempt a 403.
  await requireEventOwner(actor, gallery.eventId)
  return gallery
}

/**
 * Publishing sets the PIN and opens the gallery. The PIN is hashed with the
 * same argon2id parameters as an account password, is never stored or logged in
 * plaintext, and is not echoed back — the response carries the slug only.
 */
export async function publishGallery(
  actor: Actor,
  galleryId: string,
  input: z.infer<typeof publishSchema>
) {
  const gallery = await requireOwnedGallery(actor, galleryId)

  const selected = await prisma.galleryPhoto.count({ where: { galleryId: gallery.id } })
  if (selected === 0) {
    throw new ApiError('VALIDATION_ERROR', 'Select at least one photo before publishing.')
  }

  const updated = await prisma.gallery.update({
    where: { id: gallery.id },
    data: {
      pinHash: await hashSecret(input.pin),
      isPublished: true,
      publishedAt: new Date(),
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      // Invalidates every customer session issued under the previous PIN.
      pinVersion: { increment: 1 },
    },
    select: { slug: true, publishedAt: true, expiresAt: true },
  })

  // Previous failures must not count against a client after the PIN changes.
  await prisma.pinAttempt.deleteMany({ where: { gallerySlug: gallery.slug } })

  return { slug: updated.slug, publishedAt: updated.publishedAt, selected }
}

/**
 * Unpublishing takes effect on the next request. Customer access is decided by
 * reading isPublished live, so an already-issued gallery cookie stops working
 * immediately rather than at its two-hour expiry (invariant 10).
 */
export async function unpublishGallery(actor: Actor, galleryId: string) {
  const gallery = await requireOwnedGallery(actor, galleryId)
  await prisma.gallery.update({
    where: { id: gallery.id },
    data: { isPublished: false, publishedAt: null, pinVersion: { increment: 1 } },
  })
  return { slug: gallery.slug }
}

/** The lead's view of the gallery: never includes pinHash. */
export async function getGallery(actor: Actor, eventId: string) {
  await requireEventOwner(actor, eventId)

  const gallery = await prisma.gallery.findUnique({
    where: { eventId },
    select: {
      id: true,
      slug: true,
      title: true,
      isPublished: true,
      publishedAt: true,
      expiresAt: true,
      pinVersion: true,
      photos: { select: { photoId: true }, orderBy: { position: 'asc' } },
    },
  })
  if (!gallery) return null

  return {
    id: gallery.id,
    slug: gallery.slug,
    title: gallery.title,
    isPublished: gallery.isPublished,
    publishedAt: gallery.publishedAt,
    expiresAt: gallery.expiresAt,
    selectedIds: gallery.photos.map((p) => p.photoId),
  }
}

/* =========================================================================
 * Customer path
 * ====================================================================== */

// Verified against when the slug does not resolve, so a wrong PIN for a real
// gallery and any PIN for an imaginary one cost the same time and return the
// same message.
const DECOY_PIN_HASH = hashSecret(crypto.randomUUID())

/**
 * Rate-limited PIN check. Returns true on success; the caller mints the gallery
 * cookie. Every outcome except the rate limit produces the same error, so this
 * endpoint cannot be used to discover which slugs exist.
 */
export async function verifyGalleryPin(
  slug: string,
  ipHash: string,
  input: z.infer<typeof verifyPinSchema>
): Promise<{ pinVersion: number }> {
  await assertPinAttemptAllowed(slug, ipHash)

  const gallery = await prisma.gallery.findFirst({
    where: publishedGalleryWhere(slug),
    select: { pinHash: true, pinVersion: true },
  })

  const matches = gallery
    ? await verifySecret(gallery.pinHash, input.pin)
    : await verifySecret(await DECOY_PIN_HASH, input.pin)

  await recordPinAttempt(slug, ipHash, matches)

  if (!matches || !gallery) {
    throw new ApiError('UNAUTHENTICATED', 'That PIN doesn’t match.')
  }

  return { pinVersion: gallery.pinVersion }
}

/**
 * The current PIN generation for a published gallery, or null if there is no
 * open gallery at this slug. Routes read this before checking the cookie, so a
 * token minted under an older PIN stops verifying immediately.
 */
export async function currentPinVersion(slug: string): Promise<number | null> {
  const gallery = await prisma.gallery.findFirst({
    where: publishedGalleryWhere(slug),
    select: { pinVersion: true },
  })
  return gallery?.pinVersion ?? null
}

/**
 * The customer's view. Reached only with a valid gallery cookie for this slug,
 * and it re-reads publication state, so unpublishing revokes access at once.
 *
 * The join through GalleryPhoto is the whole of invariant 8: photos that exist
 * in the event but were not selected are not in this result and have no URL.
 */
export async function getPublicGallery(slug: string) {
  const gallery = await prisma.gallery.findFirst({
    where: publishedGalleryWhere(slug),
    select: {
      title: true,
      publishedAt: true,
      event: { select: { name: true, owner: { select: { name: true } } } },
      photos: {
        orderBy: { position: 'asc' },
        select: {
          position: true,
          photo: {
            select: {
              id: true,
              originalFilename: true,
              storageKey: true,
              thumbnailKey: true,
              width: true,
              height: true,
            },
          },
        },
      },
    },
  })
  if (!gallery) throw notFound('That gallery is not available.')

  const photos = await Promise.all(
    gallery.photos.map(async ({ photo, position }) => ({
      id: photo.id,
      position,
      alt: photo.originalFilename,
      width: photo.width,
      height: photo.height,
      thumbnailUrl: await presignDownload(photo.thumbnailKey ?? photo.storageKey),
    }))
  )

  return {
    title: gallery.title,
    eventName: gallery.event.name,
    credit: gallery.event.owner.name,
    publishedAt: gallery.publishedAt,
    photos,
  }
}

/** Full-resolution URL for the customer lightbox, scoped to the gallery. */
export async function getPublicPhotoUrl(slug: string, photoId: string, download = false) {
  const photo = await requireGalleryPhoto(slug, photoId)
  return {
    url: await presignDownload(photo.storageKey, download ? photo.originalFilename : undefined),
    filename: photo.originalFilename,
  }
}
