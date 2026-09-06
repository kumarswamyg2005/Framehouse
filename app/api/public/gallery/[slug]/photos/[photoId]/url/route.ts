import { NextResponse } from 'next/server'
import { hasGalleryAccess } from '@/lib/auth/session'
import { currentPinVersion, getPublicPhotoUrl } from '@/lib/data/gallery'
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
  const pinVersion = await currentPinVersion(slug)
  if (pinVersion === null || !(await hasGalleryAccess(slug, pinVersion))) {
    throw notFound('That gallery is not available.')
  }

  const params_ = new URL(request.url).searchParams
  const download = params_.get('download') === '1'
  const result = await getPublicPhotoUrl(slug, photoId, download)

  // A browser navigating here (the gallery's Download control) wants the file,
  // not JSON. Both branches ran the same authorization first, and the redirect
  // target is the same short-lived presigned URL the JSON would have carried.
  if (params_.get('redirect') === '1') {
    return NextResponse.redirect(result.url, { headers: { 'Cache-Control': 'no-store' } })
  }

  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
})
