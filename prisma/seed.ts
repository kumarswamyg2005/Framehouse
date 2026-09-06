/**
 * Seeds the demo workspace described in the challenge brief: one admin, two team
 * members, the "Arjun & Priya Wedding" event, 30 photos split between the two
 * members, and a published gallery containing 12 of them.
 *
 * Real image bytes are fetched and written to R2 so the demo exercises the
 * genuine delivery path — presigned GET on a private bucket — rather than
 * pointing at storage keys that do not exist.
 *
 * Run: npm run db:seed
 */
import { PrismaClient, Role } from '@prisma/client'
import sharp from 'sharp'
import { hashSecret } from '../lib/auth/hash'
import { buildGallerySlug, buildStorageKey, buildThumbnailKey } from '../lib/ids'
import { putObject } from '../lib/storage/r2'

const prisma = new PrismaClient()

const PHOTO_COUNT = 30
const SELECTED_COUNT = 12

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`)
  return value
}

/** Deterministic stand-in imagery, so re-seeding produces the same gallery. */
async function fetchSourceImage(index: number): Promise<Uint8Array> {
  const portrait = index % 4 === 0
  const [w, h] = portrait ? [1200, 1800] : [1800, 1200]
  const res = await fetch(`https://picsum.photos/seed/framehouse-${index}/${w}/${h}`)
  if (!res.ok) throw new Error(`Could not fetch sample image ${index}: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@demo.test'
  const adminPassword = required('SEED_ADMIN_PASSWORD')
  const memberPassword = required('SEED_MEMBER_PASSWORD')
  const galleryPin = required('SEED_GALLERY_PIN')

  if (!/^\d{6}$/.test(galleryPin)) throw new Error('SEED_GALLERY_PIN must be exactly 6 digits.')

  console.log('Clearing existing data…')
  // Ordered by dependency; cascades would cover most of this, but being explicit
  // keeps the seed readable and safe to run against a partially-migrated schema.
  await prisma.accessAttempt.deleteMany()
  await prisma.galleryPhoto.deleteMany()
  await prisma.gallery.deleteMany()
  await prisma.photo.deleteMany()
  await prisma.eventMember.deleteMany()
  await prisma.event.deleteMany()
  await prisma.user.deleteMany()

  console.log('Creating users…')
  const admin = await prisma.user.create({
    data: {
      email: adminEmail,
      name: 'Meera Raghavan',
      role: Role.ADMIN,
      passwordHash: await hashSecret(adminPassword),
    },
  })

  const memberHash = await hashSecret(memberPassword)
  const [nikhil, sana] = await Promise.all([
    prisma.user.create({
      data: {
        email: 'nikhil@demo.test',
        name: 'Nikhil Shetty',
        role: Role.MEMBER,
        passwordHash: memberHash,
      },
    }),
    prisma.user.create({
      data: {
        email: 'sana@demo.test',
        name: 'Sana Qureshi',
        role: Role.MEMBER,
        passwordHash: memberHash,
      },
    }),
  ])

  // A third member assigned to nothing — proves "member sees only assigned
  // events" is enforced by data, not by an empty list that happens to look right.
  const unassigned = await prisma.user.create({
    data: {
      email: 'idle@demo.test',
      name: 'Rohit Menon',
      role: Role.MEMBER,
      passwordHash: memberHash,
    },
  })

  console.log('Creating event…')
  const event = await prisma.event.create({
    data: {
      name: 'Arjun & Priya Wedding',
      description: 'Two days, Bangalore. Mehendi through reception.',
      date: new Date('2026-08-22T00:00:00.000Z'),
      ownerId: admin.id,
      members: { create: [{ userId: nikhil.id }, { userId: sana.id }] },
    },
  })

  console.log(`Uploading ${PHOTO_COUNT} photos to R2…`)
  const photoIds: string[] = []
  for (let i = 0; i < PHOTO_COUNT; i++) {
    const source = await fetchSourceImage(i)
    const meta = await sharp(source).metadata()
    const thumbnail = await sharp(source).resize({ width: 480 }).webp({ quality: 78 }).toBuffer()

    const storageKey = buildStorageKey(event.id, 'image/jpeg')
    const thumbnailKey = buildThumbnailKey(event.id, storageKey)
    await putObject(storageKey, source, 'image/jpeg')
    await putObject(thumbnailKey, new Uint8Array(thumbnail), 'image/webp')

    const photo = await prisma.photo.create({
      data: {
        eventId: event.id,
        uploadedById: i % 2 === 0 ? nikhil.id : sana.id,
        originalFilename: `DSC_${String(1000 + i * 7).padStart(4, '0')}.JPG`,
        storageKey,
        thumbnailKey,
        mimeType: 'image/jpeg',
        fileSize: source.byteLength,
        width: meta.width ?? null,
        height: meta.height ?? null,
        status: 'READY',
      },
    })
    photoIds.push(photo.id)
    process.stdout.write(`\r  ${i + 1}/${PHOTO_COUNT}`)
  }
  process.stdout.write('\n')

  console.log('Publishing gallery…')
  const slug = buildGallerySlug()
  await prisma.gallery.create({
    data: {
      eventId: event.id,
      slug,
      title: 'Arjun & Priya',
      pinHash: await hashSecret(galleryPin),
      isPublished: true,
      publishedAt: new Date(),
      photos: {
        create: photoIds.slice(0, SELECTED_COUNT).map((photoId, position) => ({ photoId, position })),
      },
    },
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  console.log(`
Seed complete.

  Admin      ${admin.email}
  Members    ${nikhil.email}, ${sana.email}
  Unassigned ${unassigned.email}
  Gallery    ${appUrl}/g/${slug}

Passwords and the gallery PIN are the values you set in .env — they are hashed
here and never printed.
`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
