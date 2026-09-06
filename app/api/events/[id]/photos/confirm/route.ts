import { NextResponse } from 'next/server'
import { requireActor } from '@/lib/auth/session'
import { confirmPhotoUpload } from '@/lib/data/photos'
import { handler, parseBody } from '@/lib/http'
import { confirmUploadSchema } from '@/lib/schemas'

type Params = { params: Promise<{ id: string }> }

export const POST = handler(async (request: Request, { params }: Params) => {
  const actor = await requireActor()
  const { id } = await params
  const input = await parseBody(request, confirmUploadSchema)
  const photo = await confirmPhotoUpload(actor, id, input)
  return NextResponse.json({ photo: { id: photo.id, filename: photo.originalFilename } }, { status: 201 })
})
