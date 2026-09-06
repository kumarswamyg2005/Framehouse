import { NextResponse } from 'next/server'
import { requireActor } from '@/lib/auth/session'
import { deletePhoto } from '@/lib/data/photos'
import { handler } from '@/lib/http'

type Params = { params: Promise<{ id: string }> }

export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const actor = await requireActor()
  const { id } = await params
  await deletePhoto(actor, id)
  return NextResponse.json({ ok: true })
})
