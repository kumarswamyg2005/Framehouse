import { NextResponse } from 'next/server'
import { requireActor } from '@/lib/auth/session'
import { createEvent, listEvents } from '@/lib/data/events'
import { handler, parseBody } from '@/lib/http'
import { createEventSchema } from '@/lib/schemas'

export const GET = handler(async () => {
  const actor = await requireActor()
  const events = await listEvents(actor)
  return NextResponse.json({
    events: events.map(({ photos, ...event }) => ({ ...event, photoCount: photos.length })),
  })
})

export const POST = handler(async (request: Request) => {
  const actor = await requireActor()
  const input = await parseBody(request, createEventSchema)
  const event = await createEvent(actor, input)
  return NextResponse.json({ event }, { status: 201 })
})
