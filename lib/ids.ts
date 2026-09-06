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
