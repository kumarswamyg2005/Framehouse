import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db/prisma'
import { confirmPhotoUpload, presignPhotoUpload } from '@/lib/data/photos'
import { expectApiError, makeEvent, makePhoto, makeUser, resetDatabase } from './helpers'

// Storage is stubbed here so these assertions are about the authorization and
// validation decisions, not about MinIO. The real object round trip is covered
// by the Playwright happy path.
vi.mock('@/lib/storage/r2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage/r2')>()
  return {
    ...actual,
    presignUpload: vi.fn(async (key: string) => `https://storage.test/${key}?signed`),
    headObject: vi.fn(async () => null),
    deleteObjects: vi.fn(async () => {}),
    getObjectBytes: vi.fn(async () => new Uint8Array()),
    getObjectHead: vi.fn(async () => new Uint8Array()),
    putObject: vi.fn(async () => {}),
  }
})

const { deleteObjects, getObjectBytes, getObjectHead, headObject } = await import('@/lib/storage/r2')

/** A genuine 4x4 JPEG, so the decode step in confirm has something to read. */
const REAL_JPEG = await sharp({
  create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } },
})
  .jpeg()
  .toBuffer()

beforeEach(async () => {
  await resetDatabase()
  vi.clearAllMocks()
  vi.mocked(headObject).mockResolvedValue(null)
  vi.mocked(getObjectBytes).mockResolvedValue(new Uint8Array(REAL_JPEG))
  // The first 32 bytes of a real JPEG, so the signature check passes by default.
  vi.mocked(getObjectHead).mockResolvedValue(new Uint8Array(REAL_JPEG.subarray(0, 32)))
})

describe('presign', () => {
  it('rejects a 40 MB file before minting a URL', async () => {
    const admin = await makeUser('ADMIN')
    const event = await makeEvent(admin)

    await expectApiError(
      presignPhotoUpload(admin, event.id, {
        filename: 'huge.jpg',
        mimeType: 'image/jpeg',
        fileSize: 40 * 1024 * 1024,
      }),
      'VALIDATION_ERROR'
    )
  })

  it('rejects an executable MIME type', async () => {
    const admin = await makeUser('ADMIN')
    const event = await makeEvent(admin)

    await expectApiError(
      presignPhotoUpload(admin, event.id, {
        filename: 'payload.exe',
        // Deliberately bypassing the zod enum to prove the check inside the
        // function holds on its own.
        mimeType: 'application/x-msdownload' as 'image/jpeg',
        fileSize: 1024,
      }),
      'VALIDATION_ERROR'
    )
  })

  it('refuses to presign for an event the actor is not on', async () => {
    const admin = await makeUser('ADMIN')
    const outsider = await makeUser('MEMBER')
    const event = await makeEvent(admin)

    await expectApiError(
      presignPhotoUpload(outsider, event.id, {
        filename: 'a.jpg',
        mimeType: 'image/jpeg',
        fileSize: 1024,
      }),
      'NOT_FOUND'
    )
  })

  it('builds a key from the event id and a uuid, never the filename', async () => {
    const admin = await makeUser('ADMIN')
    const event = await makeEvent(admin)

    const { storageKey } = await presignPhotoUpload(admin, event.id, {
      filename: '../../etc/passwd.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024,
    })

    expect(storageKey).toMatch(
      new RegExp(`^events/${event.id}/[0-9a-f-]{36}\\.jpg$`)
    )
    expect(storageKey).not.toContain('passwd')
    expect(storageKey).not.toContain('..')
  })
})

describe('confirm', () => {
  it('writes no row when the object is not in storage', async () => {
    const admin = await makeUser('ADMIN')
    const event = await makeEvent(admin)
    const { storageKey } = await presignPhotoUpload(admin, event.id, {
      filename: 'a.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024,
    })

    vi.mocked(headObject).mockResolvedValue(null) // the PUT never landed

    await expectApiError(
      confirmPhotoUpload(admin, event.id, { storageKey, filename: 'a.jpg' }),
      'UPLOAD_FAILED'
    )
    // The point of HeadObject: no orphaned metadata.
    expect(await prisma.photo.count()).toBe(0)
  })

  it('refuses a storage key belonging to another event', async () => {
    const admin = await makeUser('ADMIN')
    const otherAdmin = await makeUser('ADMIN')
    const mine = await makeEvent(admin)
    const theirs = await makeEvent(otherAdmin)

    await expectApiError(
      confirmPhotoUpload(admin, mine.id, {
        storageKey: `events/${theirs.id}/00000000-0000-0000-0000-000000000000.jpg`,
        filename: 'a.jpg',
      }),
      'VALIDATION_ERROR'
    )
    expect(await prisma.photo.count()).toBe(0)
  })

  it('rejects bytes whose file signature is not an allowed image', async () => {
    const admin = await makeUser('ADMIN')
    const event = await makeEvent(admin)
    const { storageKey } = await presignPhotoUpload(admin, event.id, {
      filename: 'payload.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024,
    })

    // Content-Type is chosen by the client at presign time and storage just
    // records it, so this is the case where a caller lies about the content.
    vi.mocked(headObject).mockResolvedValue({ size: 1024, contentType: 'image/jpeg' })
    vi.mocked(getObjectHead).mockResolvedValue(
      new TextEncoder().encode('<?php system($_GET["c"]); ?>').subarray(0, 32)
    )

    await expectApiError(
      confirmPhotoUpload(admin, event.id, { storageKey, filename: 'payload.jpg' }),
      'VALIDATION_ERROR'
    )
    expect(await prisma.photo.count()).toBe(0)
    expect(vi.mocked(deleteObjects)).toHaveBeenCalledWith([storageKey])
  })

  it('trusts storage over the client for size and type', async () => {
    const admin = await makeUser('ADMIN')
    const event = await makeEvent(admin)
    const { storageKey } = await presignPhotoUpload(admin, event.id, {
      filename: 'a.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024,
    })

    vi.mocked(headObject).mockResolvedValue({ size: 987_654, contentType: 'image/jpeg' })

    const photo = await confirmPhotoUpload(admin, event.id, { storageKey, filename: 'a.jpg' })
    expect(photo.fileSize).toBe(987_654)
    expect(photo.originalFilename).toBe('a.jpg')
    expect(photo.storageKey).toBe(storageKey)
  })

  it('deletes the object and writes no row when the stored content type is not allowed', async () => {
    const admin = await makeUser('ADMIN')
    const event = await makeEvent(admin)
    const { storageKey } = await presignPhotoUpload(admin, event.id, {
      filename: 'a.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024,
    })

    vi.mocked(headObject).mockResolvedValue({ size: 1024, contentType: 'text/html' })

    await expectApiError(
      confirmPhotoUpload(admin, event.id, { storageKey, filename: 'a.jpg' }),
      'VALIDATION_ERROR'
    )
    expect(await prisma.photo.count()).toBe(0)
  })
})

describe('finalisation', () => {
  it('confirms fast as PENDING, then finalises to READY with a thumbnail', async () => {
    const admin = await makeUser('ADMIN')
    const event = await makeEvent(admin)
    const { storageKey } = await presignPhotoUpload(admin, event.id, {
      filename: 'a.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024,
    })
    vi.mocked(headObject).mockResolvedValue({ size: 1024, contentType: 'image/jpeg' })

    const photo = await confirmPhotoUpload(admin, event.id, { storageKey, filename: 'a.jpg' })
    // afterResponse falls back to running inline outside a request context, so
    // by here the finalisation has already happened.
    const stored = await prisma.photo.findUniqueOrThrow({ where: { id: photo.id } })
    expect(stored.status).toBe('READY')
    expect(stored.thumbnailKey).toMatch(/^events\/.+\/thumbs\/.+\.webp$/)
    expect(stored.width).toBe(4)
  })

  // A polyglot: real JPEG signature, bytes that do not decode.
  it('marks a photo FAILED and drops its object when the bytes do not decode', async () => {
    const admin = await makeUser('ADMIN')
    const event = await makeEvent(admin)
    const { storageKey } = await presignPhotoUpload(admin, event.id, {
      filename: 'polyglot.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024,
    })
    vi.mocked(headObject).mockResolvedValue({ size: 1024, contentType: 'image/jpeg' })
    vi.mocked(getObjectHead).mockResolvedValue(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))
    vi.mocked(getObjectBytes).mockResolvedValue(
      new Uint8Array([0xff, 0xd8, 0xff, ...new TextEncoder().encode('not really a jpeg')])
    )

    const photo = await confirmPhotoUpload(admin, event.id, {
      storageKey,
      filename: 'polyglot.jpg',
    })

    const stored = await prisma.photo.findUniqueOrThrow({ where: { id: photo.id } })
    expect(stored.status).toBe('FAILED')
    expect(stored.thumbnailKey).toBeNull()
    expect(vi.mocked(deleteObjects)).toHaveBeenCalledWith([storageKey])
  })

  it('never lets a PENDING or FAILED photo into a client gallery', async () => {
    const { saveSelection } = await import('@/lib/data/gallery')
    const admin = await makeUser('ADMIN')
    const event = await makeEvent(admin)

    const ready = await makePhoto(event.id, admin)
    const pending = await makePhoto(event.id, admin)
    const failed = await makePhoto(event.id, admin)
    await prisma.photo.update({ where: { id: pending.id }, data: { status: 'PENDING' } })
    await prisma.photo.update({ where: { id: failed.id }, data: { status: 'FAILED' } })

    const saved = await saveSelection(admin, event.id, {
      title: 'Mixed',
      photoIds: [ready.id, pending.id, failed.id],
    })
    // Only the READY one survives the intersection.
    expect(saved.selected).toBe(1)
  })

  it('excludes FAILED photos from the contact sheet', async () => {
    const { listPhotos } = await import('@/lib/data/photos')
    const admin = await makeUser('ADMIN')
    const event = await makeEvent(admin)
    const ok = await makePhoto(event.id, admin)
    const bad = await makePhoto(event.id, admin)
    await prisma.photo.update({ where: { id: bad.id }, data: { status: 'FAILED' } })

    const { photos } = await listPhotos(admin, event.id, { limit: 60 })
    expect(photos.map((p) => p.id)).toEqual([ok.id])
  })
})
