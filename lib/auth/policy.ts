import type { Event, Photo, Prisma, Role } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { forbidden, notFound } from '@/lib/http'

/* ===========================================================================
 * SECURITY INVARIANTS
 *
 * These hold for every request. If a change breaks one of them, the change is
 * wrong — not the invariant. Each is enforced in code, and each has a test.
 *
 *  1. No photo bytes are ever served from a public URL. Every image is
 *     delivered by a presigned GET with a 5-minute TTL, minted only after an
 *     authorization check in this file. The R2 bucket has no public access.
 *
 *  2. Uploads go direct browser -> R2 via presigned PUT. The presign endpoint
 *     validates event membership, MIME type (jpeg/png/webp only) and a 25 MB
 *     size cap BEFORE minting. The server confirms the object exists with
 *     HeadObject before writing the DB row, so a failed upload leaves no
 *     orphaned metadata.
 *
 *  3. Object keys are events/{eventId}/{uuid}.{ext} — never the user's
 *     filename. The original filename is stored as metadata only.
 *
 *  4. The gallery PIN is hashed with argon2id. It is never stored in plaintext,
 *     never logged, and never returned by any API.
 *
 *  5. PIN verification is rate-limited: 5 attempts per gallery per IP per
 *     15 minutes, then 429 with Retry-After. Attempts live in the PinAttempt
 *     table, keyed by slug, so no Redis is required and unknown slugs are
 *     counted too.
 *
 *  6. A successful PIN entry mints a separate short-lived gallery JWT (scoped
 *     to one slug, 2 hours) in its own cookie. Its `aud` claim differs from a
 *     session token's, so it grants zero access to any authenticated API.
 *
 *  7. Every data-fetching function takes the actor and scopes the query at the
 *     database level. There is no "fetch, then filter in the component".
 *     Authorization lives in this file, not scattered through handlers.
 *
 *  8. Unpublished photos and unselected photos are unreachable through the
 *     customer path, even with a valid gallery token and a known photo id.
 *
 *  9. The gallery URL slug is a 12-character nanoid, not a sequential id.
 *
 * 10. Deleting a selection or unpublishing a gallery immediately revokes
 *     customer access — the check is on current database state, not on
 *     anything baked into the token.
 * ===========================================================================
 *
 * 403 vs 404
 * ----------
 * An actor who can already see a resource but may not perform the action gets
 * 403. An actor who is not entitled to know the resource exists gets 404 —
 * never 403, because a 403 confirms existence. Concretely: a member assigned to
 * an event who tries to publish it gets 403; a member who is not assigned gets
 * 404 for the same request.
 */

export type Actor = {
  id: string
  email: string
  name: string
  role: Role
}

export function isAdmin(actor: Actor): boolean {
  return actor.role === 'ADMIN'
}

/* --------------------------------------------------------------------------
 * Events
 * ----------------------------------------------------------------------- */

/**
 * The only definition of "events this actor may see". Admins see the events
 * they own; members see the events they are assigned to. Every event query in
 * the app spreads this into its `where` clause rather than filtering later.
 */
export function visibleEventWhere(actor: Actor): Prisma.EventWhereInput {
  return isAdmin(actor)
    ? { ownerId: actor.id }
    : { members: { some: { userId: actor.id } } }
}

/** Throws 404 — not 403 — when the actor may not see the event at all. */
export async function requireEventAccess(actor: Actor, eventId: string): Promise<Event> {
  const event = await prisma.event.findFirst({
    where: { id: eventId, ...visibleEventWhere(actor) },
  })
  if (!event) throw notFound('That event does not exist.')
  return event
}

/**
 * Owner-only actions: adding members, selecting photos, publishing.
 *
 * The two failure modes are deliberately different. A member who is assigned to
 * the event already knows it exists, so telling them 403 leaks nothing. Anyone
 * else gets the same 404 they would get for an event id that does not exist.
 */
export async function requireEventOwner(actor: Actor, eventId: string): Promise<Event> {
  if (!isAdmin(actor)) {
    const assigned = await prisma.event.findFirst({
      where: { id: eventId, members: { some: { userId: actor.id } } },
      select: { id: true },
    })
    if (!assigned) throw notFound('That event does not exist.')
    throw forbidden('Only the event lead can do that.')
  }

  const event = await prisma.event.findFirst({ where: { id: eventId, ownerId: actor.id } })
  if (!event) throw notFound('That event does not exist.')
  return event
}

/* --------------------------------------------------------------------------
 * Photos
 * ----------------------------------------------------------------------- */

/**
 * Photos an actor may see within one event. Admins review everything uploaded
 * to their event; a member sees only their own frames, even when two members
 * are shooting the same wedding.
 *
 * Callers must have passed requireEventAccess first — this narrows within an
 * event, it does not grant access to one.
 */
export function visiblePhotoWhere(actor: Actor, eventId: string): Prisma.PhotoWhereInput {
  return isAdmin(actor) ? { eventId } : { eventId, uploadedById: actor.id }
}

/**
 * Resolves a single photo by id under the actor's scope, in one query. Used by
 * the presigned-URL and delete paths. A photo the actor may not see is
 * indistinguishable from one that does not exist.
 */
export async function requirePhotoAccess(actor: Actor, photoId: string): Promise<Photo> {
  const where: Prisma.PhotoWhereInput = isAdmin(actor)
    ? { id: photoId, event: { ownerId: actor.id } }
    : { id: photoId, uploadedById: actor.id, event: { members: { some: { userId: actor.id } } } }

  const photo = await prisma.photo.findFirst({ where })
  if (!photo) throw notFound('That photo does not exist.')
  return photo
}

/* --------------------------------------------------------------------------
 * Customer gallery path
 *
 * Nothing below takes an Actor. A gallery token is not an identity — it is
 * proof that someone typed the right PIN for one slug, and it buys access to
 * exactly the photos currently selected in that gallery while it is published.
 * ----------------------------------------------------------------------- */

/**
 * The single source of truth for "is this gallery open to customers right now".
 * Publication state is read live, so unpublishing revokes access immediately
 * even for a customer holding an unexpired gallery cookie (invariant 10).
 */
export function publishedGalleryWhere(slug: string): Prisma.GalleryWhereInput {
  return {
    slug,
    isPublished: true,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  }
}

/**
 * Resolves one photo through the customer path. The join through GalleryPhoto
 * is what makes invariant 8 true: a photo id that exists, belongs to the same
 * event, and is simply not selected does not match this query.
 */
export async function requireGalleryPhoto(slug: string, photoId: string): Promise<Photo> {
  const photo = await prisma.photo.findFirst({
    where: {
      id: photoId,
      galleryLinks: { some: { gallery: publishedGalleryWhere(slug) } },
    },
  })
  if (!photo) throw notFound('That photo is not part of this gallery.')
  return photo
}
