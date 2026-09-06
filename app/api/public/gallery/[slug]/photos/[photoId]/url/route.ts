import { NextResponse } from 'next/server'
import { hasGalleryAccess } from '@/lib/auth/session'
import { getPublicPhotoUrl } from '@/lib/data/gallery'
import { handler, notFound } from '@/lib/http'

type Params = { params: Promise<{ slug: string; photoId: string }> }

/**
 * Full-resolution URL for one photo in the customer lightbox.
 *
 * Both checks matter: the cookie proves the PIN was entered for this slug, and
 * getPublicPhotoUrl proves the photo is currently selected in that published
 * gallery. A real photo id from the same event that was not selected fails the
 * second check and 404s.
 */
export const GET = handler(async (request: Request, { params }: Params) => {
  const { slug, photoId } = await params
  if (!(await hasGalleryAccess(slug))) throw notFound('That gallery is not available.')

  const download = new URL(request.url).searchParams.get('download') === '1'
  return NextResponse.json(await getPublicPhotoUrl(slug, photoId, download), {
    headers: { 'Cache-Control': 'no-store' },
  })
})
