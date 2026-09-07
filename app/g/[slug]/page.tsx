import type { Metadata } from 'next'
import { GalleryClient } from './GalleryClient'

export const dynamic = 'force-dynamic'

// A gallery link is meant to be shared privately, not indexed.
export const metadata: Metadata = {
  title: 'Gallery',
  robots: { index: false, follow: false },
}

/**
 * Every arrival here renders the PIN gate.
 *
 * The server deliberately does not look at the gallery cookie to decide what to
 * render. If it did, a person who unlocked the gallery once would walk straight
 * back into it from their history for the next two hours — which is how a
 * session behaves, and not how a PIN should. The cookie still authorises the
 * requests the unlocked page makes; it just no longer skips the gate.
 */
export default async function GalleryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <GalleryClient slug={slug} />
}
