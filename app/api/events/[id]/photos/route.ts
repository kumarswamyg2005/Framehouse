import { NextResponse } from 'next/server'
import { requireActor } from '@/lib/auth/session'
import { listPhotos } from '@/lib/data/photos'
import { handler } from '@/lib/http'
import { listPhotosSchema } from '@/lib/schemas'

type Params = { params: Promise<{ id: string }> }

export const GET = handler(async (request: Request, { params }: Params) => {
  const actor = await requireActor()
  const { id } = await params
  const url = new URL(request.url)
  const input = listPhotosSchema.parse({
    cursor: url.searchParams.get('cursor') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  })
  return NextResponse.json(await listPhotos(actor, id, input))
})
