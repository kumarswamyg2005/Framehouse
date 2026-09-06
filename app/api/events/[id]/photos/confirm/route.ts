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

  // Enough for the contact sheet to render the new frame immediately. There is
  // no thumbnail yet — finalisation runs after this response — so the sheet
  // shows a placeholder and polls this id until it resolves.
  return NextResponse.json(
    {
      photo: {
        id: photo.id,
        filename: photo.originalFilename,
        width: photo.width,
        height: photo.height,
        uploadedBy: { id: actor.id, name: actor.name },
        pending: photo.status === 'PENDING',
        thumbnailUrl: null,
      },
    },
    { status: 201 }
  )
})
