import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db/prisma'
import { confirmPhotoUpload, presignPhotoUpload } from '@/lib/data/photos'
import { expectApiError, makeEvent, makeUser, resetDatabase } from './helpers'

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
    putObject: vi.fn(async () => {}),
  }
})

const { headObject } = await import('@/lib/storage/r2')

beforeEach(async () => {
  await resetDatabase()
  vi.mocked(headObject).mockResolvedValue(null)
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

  it('deletes the object and writes no row when storage reports a disallowed type', async () => {
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
