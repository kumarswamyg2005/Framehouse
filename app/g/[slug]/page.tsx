import type { Metadata } from 'next'
import { hasGalleryAccess } from '@/lib/auth/session'
import { currentPinVersion, getPublicGallery } from '@/lib/data/gallery'
import { Gallery } from './Gallery'
import { PinGate } from './PinGate'

export const dynamic = 'force-dynamic'

// A gallery link is meant to be shared privately, not indexed.
export const metadata: Metadata = {
  title: 'Gallery',
  robots: { index: false, follow: false },
}

export default async function GalleryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  /**
   * The gate is rendered for every visitor without a valid cookie — including
   * ones whose slug does not exist. Nothing on this page reveals whether the
   * gallery is real until the correct PIN is entered, so the URL cannot be used
   * to enumerate galleries.
   */
  const pinVersion = await currentPinVersion(slug)
  if (pinVersion === null || !(await hasGalleryAccess(slug, pinVersion))) {
    return <PinGate slug={slug} />
  }

  // Re-read live, so unpublishing revokes an already-issued cookie.
  let gallery
  try {
    gallery = await getPublicGallery(slug)
  } catch {
    return <PinGate slug={slug} />
  }

  return (
    <Gallery
      slug={slug}
      title={gallery.title}
      credit={gallery.credit}
      eventName={gallery.eventName}
      publishedAt={gallery.publishedAt ? gallery.publishedAt.toISOString() : null}
      total={gallery.total}
      photos={gallery.photos}
      nextCursor={gallery.nextCursor}
    />
  )
}
