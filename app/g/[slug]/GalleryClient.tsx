'use client'

import { useCallback, useState } from 'react'
import { Gallery, type GalleryPhoto } from './Gallery'
import { PinGate } from './PinGate'

export type GalleryData = {
  title: string
  eventName: string
  credit: string
  publishedAt: string | null
  total: number
  photos: GalleryPhoto[]
  nextCursor: number | null
}

/**
 * Holds the lock.
 *
 * The PIN is asked for on every arrival at this page, not once per session.
 * A gallery link travels by message and gets opened on borrowed phones and
 * shared laptops, so "you already typed it half an hour ago" is the wrong
 * default — someone pressing Back into a browser history should meet the gate,
 * not the photographs.
 *
 * The cookie the PIN mints still exists, but its job is narrower now: it
 * authorises the requests this page makes while it is open — the photo list,
 * the next page, a full-resolution URL, a download. It is no longer a pass that
 * skips the gate.
 *
 * This is why the gallery is fetched here rather than server-rendered: the
 * server must not hand over photographs to a navigation, only to a PIN.
 */
export function GalleryClient({ slug }: { slug: string }) {
  const [data, setData] = useState<GalleryData | null>(null)

  const onUnlocked = useCallback((gallery: GalleryData) => setData(gallery), [])

  const relock = useCallback(() => setData(null), [])

  if (!data) return <PinGate slug={slug} onUnlocked={onUnlocked} />

  return (
    <Gallery
      slug={slug}
      title={data.title}
      credit={data.credit}
      eventName={data.eventName}
      publishedAt={data.publishedAt}
      total={data.total}
      photos={data.photos}
      nextCursor={data.nextCursor}
      onRelock={relock}
    />
  )
}
