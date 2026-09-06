import sharp from 'sharp'
import type { Photo } from '@prisma/client'
import type { z } from 'zod'
import type { Actor } from '@/lib/auth/policy'
import { requireEventAccess, requirePhotoAccess, visiblePhotoWhere } from '@/lib/auth/policy'
import { prisma } from '@/lib/db/prisma'
import { afterResponse } from '@/lib/after'
import { ApiError } from '@/lib/http'
import { ALLOWED_MIME, buildStorageKey, buildThumbnailKey, isAllowedMime, sniffMime } from '@/lib/ids'
import type { confirmUploadSchema, listPhotosSchema, presignUploadSchema } from '@/lib/schemas'
import { MAX_UPLOAD_BYTES } from '@/lib/schemas'
import {
  deleteObjects,
  getObjectBytes,
  getObjectHead,
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
 * Nothing the client says about the object is trusted. HeadObject reports the
 * real size, and a 32-byte ranged read reports what the bytes actually are —
 * Content-Type is only whatever the client asked to sign. If the object is not
 * there, no row is created and the caller gets UPLOAD_FAILED.
 *
 * Decoding and resizing happen after the response is sent, so a photographer
 * pushing four hundred frames from a venue does not queue four hundred requests
 * each holding a function open while sharp works.
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

  if (facts.size > MAX_UPLOAD_BYTES) {
    await deleteObjects([input.storageKey])
    throw new ApiError('VALIDATION_ERROR', 'That file is larger than 25 MB.')
  }

  // Two independent checks, because they fail differently.
  //
  // The stored Content-Type is bound into the presigned PUT signature, so a
  // client cannot store arbitrary values — but checking it here means a change
  // that ever loosened presigning could not silently let one through.
  if (!facts.contentType || !isAllowedMime(facts.contentType)) {
    await deleteObjects([input.storageKey])
    throw new ApiError('VALIDATION_ERROR', 'Only JPEG, PNG and WebP images can be uploaded.')
  }

  // And the header is still only a label. The first 32 bytes of the object say
  // what the file actually is.
  const head = await getObjectHead(input.storageKey, 32)
  const sniffed = head && sniffMime(head)
  if (!sniffed) {
    await deleteObjects([input.storageKey])
    throw new ApiError('VALIDATION_ERROR', 'That file is not a JPEG, PNG or WebP image.')
  }

  const photo = await prisma.photo.create({
    data: {
      eventId,
      uploadedById: actor.id,
      originalFilename: input.filename,
      storageKey: input.storageKey,
      mimeType: sniffed,
      fileSize: facts.size,
      // PENDING until a thumbnail exists. Nothing in this state can be selected
      // for a gallery or shown to a client.
      status: 'PENDING',
    },
  })

  // The row is already durable, so a crash in here leaves a PENDING photo to
  // retry rather than losing the upload.
  await afterResponse(() => finalisePhoto(photo.id))

  return photo
}

/**
 * Decodes the original, writes a 480px thumbnail, and moves the row to READY.
 *
 * This is the real content check. A file that begins with a JPEG signature but
 * does not decode is deleted and its row marked FAILED, so it never reaches a
 * contact sheet or a client gallery. Safe to run twice.
 */
export async function finalisePhoto(photoId: string): Promise<void> {
  const photo = await prisma.photo.findUnique({
    where: { id: photoId },
    select: { id: true, eventId: true, storageKey: true, status: true },
  })
  if (!photo || photo.status === 'READY') return

  try {
    const original = await getObjectBytes(photo.storageKey)
    const image = sharp(original, { failOn: 'error' })
    const meta = await image.metadata()
    if (!meta.format || !meta.width || !meta.height) throw new Error('not a decodable image')

    const thumbnail = await image
      .rotate() // honour EXIF orientation before resizing
      .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer()

    const thumbnailKey = buildThumbnailKey(photo.eventId, photo.storageKey)
    await putObject(thumbnailKey, new Uint8Array(thumbnail), 'image/webp')

    // sharp reports pre-rotation dimensions; swap them for sideways EXIF.
    const sideways = meta.orientation != null && meta.orientation >= 5
    await prisma.photo.update({
      where: { id: photo.id },
      data: {
        thumbnailKey,
        width: (sideways ? meta.height : meta.width) ?? null,
        height: (sideways ? meta.width : meta.height) ?? null,
        status: 'READY',
      },
    })
  } catch (error) {
    console.error('[photos] could not finalise', { photoId, error })
    // Not a usable image. Drop the bytes and mark the row, so the uploader sees
    // a failure instead of a frame stuck on PENDING forever.
    await deleteObjects([photo.storageKey]).catch(() => {})
    await prisma.photo.update({ where: { id: photo.id }, data: { status: 'FAILED' } })
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
    // FAILED rows are bytes that never decoded; their objects are already gone.
    where: { ...visiblePhotoWhere(actor, eventId), status: { not: 'FAILED' } },
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
      status: true,
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
      pending: photo.status === 'PENDING',
      // A PENDING frame has no thumbnail yet; the sheet renders a placeholder
      // rather than presigning the full-resolution original for a grid cell.
      thumbnailUrl: photo.thumbnailKey ? await presignDownload(photo.thumbnailKey) : null,
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
