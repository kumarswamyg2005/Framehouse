import { NextResponse } from 'next/server'
import { hasGalleryAccess } from '@/lib/auth/session'
import { getPublicGallery } from '@/lib/data/gallery'
import { handler, notFound } from '@/lib/http'

type Params = { params: Promise<{ slug: string }> }

export const GET = handler(async (_request: Request, { params }: Params) => {
  const { slug } = await params

  // No cookie is treated as "no such gallery", not "unauthorised" — the
  // existence of a gallery at this slug is itself something to withhold.
  if (!(await hasGalleryAccess(slug))) throw notFound('That gallery is not available.')

  return NextResponse.json(await getPublicGallery(slug), {
    headers: { 'Cache-Control': 'no-store' },
  })
})
