import { NextResponse } from 'next/server'
import { requireActor } from '@/lib/auth/session'
import { getEventDetail } from '@/lib/data/events'
import { handler } from '@/lib/http'

type Params = { params: Promise<{ id: string }> }

export const GET = handler(async (_request: Request, { params }: Params) => {
  const actor = await requireActor()
  const { id } = await params
  return NextResponse.json(await getEventDetail(actor, id))
})
