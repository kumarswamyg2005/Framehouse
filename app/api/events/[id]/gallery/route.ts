import { NextResponse } from 'next/server'
import { requireActor } from '@/lib/auth/session'
import { getGallery, saveSelection } from '@/lib/data/gallery'
import { handler, parseBody } from '@/lib/http'
import { saveSelectionSchema } from '@/lib/schemas'

type Params = { params: Promise<{ id: string }> }

export const GET = handler(async (_request: Request, { params }: Params) => {
  const actor = await requireActor()
  const { id } = await params
  return NextResponse.json({ gallery: await getGallery(actor, id) })
})

export const POST = handler(async (request: Request, { params }: Params) => {
  const actor = await requireActor()
  const { id } = await params
  const input = await parseBody(request, saveSelectionSchema)
  return NextResponse.json({ gallery: await saveSelection(actor, id, input) })
})
