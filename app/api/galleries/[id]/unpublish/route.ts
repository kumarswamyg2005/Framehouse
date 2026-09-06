import { NextResponse } from 'next/server'
import { requireActor } from '@/lib/auth/session'
import { unpublishGallery } from '@/lib/data/gallery'
import { handler } from '@/lib/http'

type Params = { params: Promise<{ id: string }> }

export const POST = handler(async (_request: Request, { params }: Params) => {
  const actor = await requireActor()
  const { id } = await params
  return NextResponse.json(await unpublishGallery(actor, id))
})
