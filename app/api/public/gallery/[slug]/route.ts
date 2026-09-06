import { NextResponse } from 'next/server'
import { hasGalleryAccess } from '@/lib/auth/session'
import { currentPinVersion, getPublicGallery } from '@/lib/data/gallery'
import { ApiError, handler, notFound } from '@/lib/http'

type Params = { params: Promise<{ slug: string }> }

export const GET = handler(async (request: Request, { params }: Params) => {
  const { slug } = await params

  // No cookie is treated as "no such gallery", not "unauthorised" — the
  // existence of a gallery at this slug is itself something to withhold.
  const pinVersion = await currentPinVersion(slug)
  if (pinVersion === null || !(await hasGalleryAccess(slug, pinVersion))) {
    throw notFound('That gallery is not available.')
  }

  // Strict, because Number('') is 0 and Number(' ') is 0 — either would be
  // read as `position > 0` and silently drop the first photograph, positions
  // being zero-based. '0x10' and '-5' would slip through Number.isInteger too.
  const rawAfter = new URL(request.url).searchParams.get('after')
  let after: number | undefined
  if (rawAfter !== null) {
    if (!/^\d{1,9}$/.test(rawAfter)) {
      throw new ApiError('VALIDATION_ERROR', 'That page reference is not valid.')
    }
    after = Number(rawAfter)
  }

  return NextResponse.json(await getPublicGallery(slug, { after }), {
    headers: { 'Cache-Control': 'no-store' },
  })
})
