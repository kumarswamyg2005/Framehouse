import { NextResponse } from 'next/server'
import { requireActor } from '@/lib/auth/session'
import { presignPhotoUpload } from '@/lib/data/photos'
import { handler, parseBody } from '@/lib/http'
import { presignUploadSchema } from '@/lib/schemas'

type Params = { params: Promise<{ id: string }> }

export const POST = handler(async (request: Request, { params }: Params) => {
  const actor = await requireActor()
  const { id } = await params
  const input = await parseBody(request, presignUploadSchema)
  return NextResponse.json(await presignPhotoUpload(actor, id, input))
})
