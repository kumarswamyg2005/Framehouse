import sharp from 'sharp'
import type { Photo } from '@prisma/client'
import type { z } from 'zod'
import type { Actor } from '@/lib/auth/policy'
import { requireEventAccess, requirePhotoAccess, visiblePhotoWhere } from '@/lib/auth/policy'
import { prisma } from '@/lib/db/prisma'
import { ApiError } from '@/lib/http'
import { ALLOWED_MIME, buildStorageKey, buildThumbnailKey, isAllowedMime } from '@/lib/ids'
import type { confirmUploadSchema, listPhotosSchema, presignUploadSchema } from '@/lib/schemas'
import { MAX_UPLOAD_BYTES } from '@/lib/schemas'
import {
  deleteObjects,
  getObjectBytes,
  headObject,
  presignDownload,
  presignUpload,
  putObject,
} from '@/lib/storage/r2'

const THUMBNAIL_WIDTH = 480

/**
 * Step 1 of the upload. Membership, MIME type and size are all checked here,
 * before any URL is minted — an unauthorised or oversized request never gets a
 * credential to storage at all.
 *
 * The returned key is generated server-side from the event id and a UUID. The
 * client cannot choose where its bytes land.
 */
export async function presignPhotoUpload(
  actor: Actor,
  eventId: string,
  input: z.infer<typeof presignUploadSchema>
) {
  await requireEventAccess(actor, eventId)

  // Re-checked here rather than trusted from the schema alone, because this is
  // the function that hands out the credential.
  if (!isAllowedMime(input.mimeType)) {
    throw new ApiError('VALIDATION_ERROR', 'Only JPEG, PNG and WebP images can be uploaded.')
  }
  if (input.fileSize > MAX_UPLOAD_BYTES) {
    throw new ApiError('VALIDATION_ERROR', 'That file is larger than 25 MB.')
  }

  const storageKey = buildStorageKey(eventId, input.mimeType)
  const uploadUrl = await presignUpload(storageKey, input.mimeType, input.fileSize)

  return { uploadUrl, storageKey }
}

/**
 * Step 2. Called after the browser's PUT succeeds.
 *
 * Nothing the client says about the object is trusted: HeadObject reports the
 * real size and content type, and the row is written from those. If the object
 * is not there — the PUT failed, or the call is a fabrication — no row is
 * created and the caller gets UPLOAD_FAILED.
 */
export async function confirmPhotoUpload(
  actor: Actor,
  eventId: string,
  input: z.infer<typeof confirmUploadSchema>
): Promise<Photo> {
  await requireEventAccess(actor, eventId)

  // The key must be one this endpoint could have minted for this event. Without
  // this, a member could confirm a key belonging to a different event and mount
  // its bytes under a Photo row they own.
  if (!isKeyForEvent(input.storageKey, eventId)) {
    throw new ApiError('VALIDATION_ERROR', 'That upload does not belong to this event.')
  }

  const facts = await headObject(input.storageKey)
  if (!facts) {
    throw new ApiError('UPLOAD_FAILED', 'That upload did not finish. Try it again.')
  }

  if (!facts.contentType || !isAllowedMime(facts.contentType)) {
    // Something landed that is not an image we accept. Do not keep it.
    await deleteObjects([input.storageKey])
    throw new ApiError('VALIDATION_ERROR', 'Only JPEG, PNG and WebP images can be uploaded.')
  }

  if (facts.size > MAX_UPLOAD_BYTES) {
    await deleteObjects([input.storageKey])
    throw new ApiError('VALIDATION_ERROR', 'That file is larger than 25 MB.')
  }

  const derived = await deriveThumbnail(eventId, input.storageKey, facts.contentType)

  return prisma.photo.create({
    data: {
      eventId,
      uploadedById: actor.id,
      originalFilename: input.filename,
      storageKey: input.storageKey,
      thumbnailKey: derived.thumbnailKey,
      mimeType: facts.contentType,
      fileSize: facts.size,
      width: derived.width,
      height: derived.height,
      status: 'READY',
    },
  })
}

/**
 * Thumbnails are generated once, at write time, so that browsing a 1,250-frame
 * contact sheet costs 1,250 small reads rather than 1,250 full-resolution ones.
 * The trade-off is written up in docs/DECISIONS.md.
 *
 * A failure here is not fatal: the original is safely stored, so the row is
 * still written and the grid falls back to the full image for that one frame.
 */
async function deriveThumbnail(eventId: string, storageKey: string, mimeType: string) {
  try {
    const original = await getObjectBytes(storageKey)
    const image = sharp(original, { failOn: 'none' })
    const meta = await image.metadata()

    const thumbnail = await image
      .rotate() // honour EXIF orientation before resizing
      .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer()

    const thumbnailKey = buildThumbnailKey(eventId, storageKey)
    await putObject(thumbnailKey, new Uint8Array(thumbnail), 'image/webp')

    // sharp reports pre-rotation dimensions; swap them for sideways EXIF.
    const sideways = meta.orientation != null && meta.orientation >= 5
    const width = sideways ? meta.height : meta.width
    const height = sideways ? meta.width : meta.height

    return { thumbnailKey, width: width ?? null, height: height ?? null }
  } catch (error) {
    console.error('[photos] thumbnail generation failed', { storageKey, mimeType, error })
    return { thumbnailKey: null, width: null, height: null }
  }
}

/** events/{eventId}/{uuid}.{ext}, with an extension we actually issue. */
function isKeyForEvent(key: string, eventId: string): boolean {
  const extensions = Object.values(ALLOWED_MIME).join('|')
  const pattern = new RegExp(
    `^events/${escapeRegex(eventId)}/[0-9a-f-]{36}\\.(${extensions})$`
  )
  return pattern.test(key)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Cursor pagination rather than offset: a contact sheet is appended to while it
 * is being scrolled, and OFFSET would silently skip or repeat frames as rows
 * shift underneath it.
 */
export async function listPhotos(
  actor: Actor,
  eventId: string,
  input: z.infer<typeof listPhotosSchema>
) {
  await requireEventAccess(actor, eventId)

  const rows = await prisma.photo.findMany({
    where: visiblePhotoWhere(actor, eventId),
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      originalFilename: true,
      thumbnailKey: true,
      storageKey: true,
      width: true,
      height: true,
      createdAt: true,
      uploadedBy: { select: { id: true, name: true } },
    },
  })

  const hasMore = rows.length > input.limit
  const page = hasMore ? rows.slice(0, input.limit) : rows

  // One presigned URL per frame, minted after the scoping above — never a
  // public URL, and never a URL for a photo outside this actor's scope.
  const photos = await Promise.all(
    page.map(async (photo) => ({
      id: photo.id,
      filename: photo.originalFilename,
      width: photo.width,
      height: photo.height,
      uploadedBy: photo.uploadedBy,
      createdAt: photo.createdAt,
      thumbnailUrl: await presignDownload(photo.thumbnailKey ?? photo.storageKey),
    }))
  )

  return { photos, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null }
}

/** Full-resolution URL for the lightbox. Authorization first, then the URL. */
export async function photoUrl(actor: Actor, photoId: string, download = false) {
  const photo = await requirePhotoAccess(actor, photoId)
  return {
    url: await presignDownload(photo.storageKey, download ? photo.originalFilename : undefined),
    filename: photo.originalFilename,
  }
}

/**
 * Deleting a photo removes its objects too. Storage is deleted after the row so
 * a failure mid-way leaves an unreferenced object (cheap, sweepable) rather than
 * a row pointing at bytes that are gone (a broken frame in the grid).
 */
export async function deletePhoto(actor: Actor, photoId: string): Promise<void> {
  const photo = await requirePhotoAccess(actor, photoId)

  await prisma.photo.delete({ where: { id: photo.id } })
  await deleteObjects([photo.storageKey, photo.thumbnailKey ?? ''])
}
