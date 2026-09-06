import { NextResponse } from 'next/server'
import { requireActor } from '@/lib/auth/session'
import { removeMember } from '@/lib/data/events'
import { handler } from '@/lib/http'

type Params = { params: Promise<{ id: string; userId: string }> }

export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const actor = await requireActor()
  const { id, userId } = await params
  await removeMember(actor, id, userId)
  return NextResponse.json({ ok: true })
})
