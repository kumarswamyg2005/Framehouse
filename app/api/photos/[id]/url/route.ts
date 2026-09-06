import { NextResponse } from 'next/server'
import { requireActor } from '@/lib/auth/session'
import { photoUrl } from '@/lib/data/photos'
import { handler } from '@/lib/http'

type Params = { params: Promise<{ id: string }> }

// Presigned, 5-minute TTL, minted only after requirePhotoAccess. The response is
// marked no-store so the URL is not retained by a shared cache.
export const GET = handler(async (request: Request, { params }: Params) => {
  const actor = await requireActor()
  const { id } = await params
  const download = new URL(request.url).searchParams.get('download') === '1'
  return NextResponse.json(await photoUrl(actor, id, download), {
    headers: { 'Cache-Control': 'no-store' },
  })
})
