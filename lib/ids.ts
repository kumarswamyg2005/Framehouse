import { customAlphabet } from 'nanoid'

/**
 * Every identifier that appears in a URL or an object key is generated here, and
 * every one of them is opaque: no sequential ids, no user-controlled filenames.
 * A leaked or guessed id must not reveal how many others exist, or let a
 * stranger walk to the next one.
 */

export const ALLOWED_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

export type AllowedMime = keyof typeof ALLOWED_MIME

export function isAllowedMime(mime: string): mime is AllowedMime {
  return mime in ALLOWED_MIME
}

/** events/{eventId}/{uuid}.{ext} — the original filename never reaches R2. */
export function buildStorageKey(eventId: string, mime: AllowedMime): string {
  return `events/${eventId}/${crypto.randomUUID()}.${ALLOWED_MIME[mime]}`
}

/** Thumbnails sit beside the originals under a /thumbs/ prefix, always webp. */
export function buildThumbnailKey(eventId: string, storageKey: string): string {
  const name = storageKey.split('/').pop() ?? crypto.randomUUID()
  const stem = name.replace(/\.[^.]+$/, '')
  return `events/${eventId}/thumbs/${stem}.webp`
}

// No look-alike characters: a client reads this slug off a message and types it.
const slugAlphabet = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 12)

export function buildGallerySlug(): string {
  return slugAlphabet()
}

/**
 * File signature sniffing.
 *
 * `Content-Type` is chosen by the client at presign time and storage simply
 * records it, so it is a claim rather than evidence. Reading the first bytes of
 * the object is the cheapest check that the claim is true, and it runs on a
 * 32-byte ranged read rather than the whole file.
 *
 * This does not prove the file is a *valid* image — only that it starts like
 * one. Full decoding happens when the thumbnail is generated, and a file that
 * fails there is deleted and its row marked FAILED.
 */
export function sniffMime(head: Uint8Array): AllowedMime | null {
  const startsWith = (...bytes: number[]) => bytes.every((b, i) => head[i] === b)

  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'

  // RIFF....WEBP
  if (startsWith(0x52, 0x49, 0x46, 0x46)) {
    const tag = String.fromCharCode(...head.slice(8, 12))
    if (tag === 'WEBP') return 'image/webp'
  }

  return null
}
