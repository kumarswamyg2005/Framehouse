import type { Actor } from '@/lib/auth/policy'
import { requireEventAccess, requireEventOwner, visibleEventWhere } from '@/lib/auth/policy'
import { hashSecret } from '@/lib/auth/hash'
import { prisma } from '@/lib/db/prisma'
import { ApiError, forbidden } from '@/lib/http'
import type { addMemberSchema, createEventSchema } from '@/lib/schemas'
import type { z } from 'zod'

/**
 * Every function here takes the actor first and hands it to policy.ts before it
 * touches a row. Route handlers and server components both call these, so there
 * is exactly one implementation of "which events can this person see" rather
 * than one per entry point.
 */

export async function listEvents(actor: Actor) {
  return prisma.event.findMany({
    where: visibleEventWhere(actor),
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      name: true,
      description: true,
      date: true,
      createdAt: true,
      owner: { select: { id: true, name: true } },
      gallery: { select: { slug: true, isPublished: true } },
      _count: { select: { members: true } },
      // A member's photo count must reflect only their own frames, so the
      // filter is applied in the aggregate rather than after the fact.
      photos: {
        where: actor.role === 'ADMIN' ? {} : { uploadedById: actor.id },
        select: { id: true },
      },
    },
  })
}

export async function createEvent(actor: Actor, input: z.infer<typeof createEventSchema>) {
  if (actor.role !== 'ADMIN') throw forbidden('Only a lead can create an event.')

  return prisma.event.create({
    data: {
      name: input.name,
      description: input.description || null,
      date: input.date ? new Date(input.date) : null,
      ownerId: actor.id,
    },
    select: { id: true, name: true, description: true, date: true, createdAt: true },
  })
}

/** Detail view. Members are only listed to the lead — a member sees the roster
 *  count, not the roster. */
export async function getEventDetail(actor: Actor, eventId: string) {
  const event = await requireEventAccess(actor, eventId)

  const members =
    actor.role === 'ADMIN'
      ? await prisma.eventMember.findMany({
          where: { eventId },
          orderBy: { addedAt: 'asc' },
          select: {
            addedAt: true,
            user: { select: { id: true, name: true, email: true } },
            // Per-member frame counts drive the review header.
          },
        })
      : []

  const gallery = await prisma.gallery.findUnique({
    where: { eventId },
    select: { id: true, slug: true, title: true, isPublished: true, publishedAt: true },
  })

  return { event, members, gallery }
}

/** Generated server-side and shown to the lead exactly once, at creation. */
function temporaryPassword(): string {
  return `fh-${crypto.randomUUID().replaceAll('-', '').slice(0, 14)}`
}

/**
 * Adds a team member by email. If no account exists the lead is creating one on
 * their behalf, so we mint it with a temporary password and return that
 * password a single time — it is never retrievable afterwards.
 */
export async function addMember(actor: Actor, eventId: string, input: z.infer<typeof addMemberSchema>) {
  await requireEventOwner(actor, eventId)

  let user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, name: true, email: true, role: true },
  })

  let temporary: string | null = null

  if (!user) {
    temporary = temporaryPassword()
    user = await prisma.user.create({
      data: {
        email: input.email,
        name: input.name?.trim() || input.email.split('@')[0] || 'Team member',
        role: 'MEMBER',
        passwordHash: await hashSecret(temporary),
      },
      select: { id: true, name: true, email: true, role: true },
    })
  }

  if (user.id === actor.id) {
    throw new ApiError('VALIDATION_ERROR', 'You already lead this event.')
  }

  const existing = await prisma.eventMember.findUnique({
    where: { eventId_userId: { eventId, userId: user.id } },
    select: { id: true },
  })
  if (existing) {
    throw new ApiError('CONFLICT', `${user.name} is already on this event.`)
  }

  await prisma.eventMember.create({ data: { eventId, userId: user.id } })

  return { user, temporaryPassword: temporary }
}

/**
 * Removing a member revokes their access to the event immediately — the next
 * request they make is scoped by visibleEventWhere and will not match. Their
 * already-uploaded photos stay with the event, which is why Photo.uploadedBy is
 * onDelete: Restrict rather than Cascade.
 */
export async function removeMember(actor: Actor, eventId: string, userId: string) {
  await requireEventOwner(actor, eventId)

  const removed = await prisma.eventMember.deleteMany({ where: { eventId, userId } })
  if (removed.count === 0) throw new ApiError('NOT_FOUND', 'That person is not on this event.')
}
