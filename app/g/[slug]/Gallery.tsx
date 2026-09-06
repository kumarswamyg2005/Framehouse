'use client'

import { useEffect, useRef, useState } from 'react'
import { useCloseOnBack } from '@/components/useCloseOnBack'
import { withViewTransition } from '@/components/useViewTransition'
import styles from './gallery.module.css'

export type GalleryPhoto = {
  id: string
  position: number
  alt: string
  width: number | null
  height: number | null
  thumbnailUrl: string
}

type Props = {
  slug: string
  title: string
  credit: string
  eventName: string
  publishedAt: string | null
  total: number
  photos: GalleryPhoto[]
  nextCursor: number | null
}

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

export function Gallery({
  slug,
  title,
  credit,
  eventName,
  publishedAt,
  total,
  photos: firstPage,
  nextCursor: firstCursor,
}: Props) {
  const [open, setOpen] = useState<number | null>(null)
  // Which thumbnails have decoded, so each can fade up on arrival rather than
  // the grid popping in raggedly.
  const [loaded, setLoaded] = useState<Set<string>>(new Set())
  // The grid's <img> elements, so the shared transition name can be handed to
  // and taken back from the exact frame being opened.
  const thumbs = useRef<Map<string, HTMLImageElement>>(new Map())

  const openAt = (index: number) => {
    const el = thumbs.current.get(photos[index]!.id)
    if (el) el.style.viewTransitionName = 'photo-hero'
    withViewTransition(
      () => setOpen(index),
      // The overlay now owns the name; the grid must let go of it before the
      // second snapshot, or the browser sees a duplicate and aborts.
      () => {
        if (el) el.style.viewTransitionName = ''
      }
    )
  }

  const closeLightbox = () => {
    const current = open === null ? undefined : photos[open]
    const el = current ? thumbs.current.get(current.id) : undefined
    withViewTransition(
      () => setOpen(null),
      () => {
        if (el) el.style.viewTransitionName = 'photo-hero'
      },
      () => {
        if (el) el.style.viewTransitionName = ''
      }
    )
  }
  const [photos, setPhotos] = useState(firstPage)
  const [cursor, setCursor] = useState(firstCursor)
  const [error, setError] = useState(false)
  const sentinel = useRef<HTMLDivElement | null>(null)
  // A ref, not state: the observer must not be rebuilt when this flips, or a
  // still-intersecting sentinel would immediately fire again.
  const loading = useRef(false)

  /**
   * Loads the next page as the end of the sheet comes into view. A client
   * scrolling a wedding gallery should not have to find and press a button, and
   * IntersectionObserver costs nothing when there is nothing left to fetch.
   */
  useEffect(() => {
    const node = sentinel.current
    if (!node || cursor === null) return

    const observer = new IntersectionObserver(
      async ([entry]) => {
        if (!entry?.isIntersecting || loading.current) return
        loading.current = true
        try {
          const response = await fetch(
            `/api/public/gallery/${slug}?after=${encodeURIComponent(String(cursor))}`
          )
          if (!response.ok) {
            // Stop. Leaving the cursor as it was would re-arm the observer
            // against a sentinel that is still on screen and retry forever —
            // which is exactly what happens when the two-hour gallery token
            // expires with the tab left open.
            setError(true)
            setCursor(null)
            return
          }
          const data = (await response.json()) as {
            photos: GalleryPhoto[]
            nextCursor: number | null
          }
          setPhotos((prev) => [...prev, ...data.photos])
          setCursor(data.nextCursor)
        } catch {
          setError(true)
          setCursor(null)
        } finally {
          loading.current = false
        }
      },
      // Start fetching before the sentinel is actually on screen.
      { rootMargin: '800px 0px' }
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [cursor, slug])

  // Presigned URLs last five minutes. Reload just before they lapse so a gallery
  // left open on a second screen does not decay into broken images.
  useEffect(() => {
    const timer = setTimeout(() => window.location.reload(), 4.5 * 60 * 1000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="gallerySurface">
      <div className={styles.paperGrain} aria-hidden="true" />

      <div className={styles.content}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <p className={styles.kicker}>
              <span className={styles.kickerRule} />
              Your gallery
            </p>
            <h1 className={`${styles.title} voiceDisplay`}>{title}</h1>
          </div>

          <div className={styles.meta}>
            <div className={styles.metaRow}>
              <span className={styles.metaKey}>Photographs by</span>
              <span className={styles.metaValue}>{credit}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaKey}>Event</span>
              <span className={styles.metaValue}>{eventName}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaKey}>Frames</span>
              <span className={styles.metaValue}>{total}</span>
            </div>
            {publishedAt && (
              <div className={styles.metaRow}>
                <span className={styles.metaKey}>Delivered</span>
                <span className={styles.metaValue}>{dateFormat.format(new Date(publishedAt))}</span>
              </div>
            )}
          </div>
        </header>

        <div className={styles.sheet}>
          {photos.map((photo, index) => (
            <button
              key={photo.id}
              type="button"
              className={styles.figure}
              // 20ms stagger, capped so the last frame of a large gallery is not
              // held back by seconds of accumulated delay.
              style={{ animationDelay: `${Math.min(index, 24) * 20}ms` }}
              onClick={() => openAt(index)}
              aria-label={`Open ${photo.alt}, frame ${index + 1} of ${total}`}
            >
              <img
                src={photo.thumbnailUrl}
                alt={photo.alt}
                loading={index < 6 ? 'eager' : 'lazy'}
                decoding="async"
                width={photo.width ?? undefined}
                height={photo.height ?? undefined}
                className={`photoFade ${loaded.has(photo.id) ? 'photoFadeIn' : ''}`}
                onLoad={() => setLoaded((prev) => new Set(prev).add(photo.id))}
                ref={(el) => {
                  if (el) thumbs.current.set(photo.id, el)
                  else thumbs.current.delete(photo.id)
                }}
              />
            </button>
          ))}
        </div>

        {/* Sits below the sheet; crossing into view pulls the next page. */}
        <div ref={sentinel} aria-hidden="true" />

        {error ? (
          <p className={styles.more} role="status">
            The rest of this gallery could not be loaded.{' '}
            <button
              type="button"
              className={styles.retry}
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </p>
        ) : (
          cursor !== null && (
            <p className={styles.more} role="status">
              Loading {total - photos.length} more…
            </p>
          )
        )}

        <footer className={styles.footer}>
          <span>Tap any photograph to view it full size.</span>
          <span>Framehouse</span>
        </footer>
      </div>

      {open !== null && photos[open] && (
        <Lightbox
          slug={slug}
          photos={photos}
          index={open}
          onIndex={setOpen}
          onClose={closeLightbox}
        />
      )}
    </div>
  )
}

function Lightbox({
  slug,
  photos,
  index,
  onIndex,
  onClose,
}: {
  slug: string
  photos: GalleryPhoto[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
}) {
  const photo = photos[index]!
  const [url, setUrl] = useState<string | null>(null)
  const [fullLoaded, setFullLoaded] = useState(false)
  const [error, setError] = useState(false)

  /**
   * The full-resolution URL is fetched per photograph rather than presigned for
   * the whole gallery up front: a 600-photo gallery would otherwise mint 600
   * URLs on every page load, most of which are never opened.
   */
  useEffect(() => {
    let cancelled = false
    setUrl(null)
    setFullLoaded(false)
    setError(false)

    fetch(`/api/public/gallery/${slug}/photos/${photo.id}/url`)
      .then((response) => {
        if (!response.ok) throw new Error('unavailable')
        return response.json() as Promise<{ url: string }>
      })
      .then((data) => {
        if (!cancelled) setUrl(data.url)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })

    return () => {
      cancelled = true
    }
  }, [photo.id, slug])

  // Prefetch the neighbours so arrow-key browsing does not flash a skeleton
  // between every frame.
  useEffect(() => {
    for (const neighbour of [photos[index + 1], photos[index - 1]]) {
      if (neighbour) void fetch(`/api/public/gallery/${slug}/photos/${neighbour.id}/url`)
    }
  }, [index, photos, slug])

  // Back closes the lightbox rather than leaving the gallery.
  useCloseOnBack(onClose)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight' && index < photos.length - 1) onIndex(index + 1)
      if (event.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [index, onClose, onIndex, photos.length])

  return (
    <div className={styles.lightbox} role="dialog" aria-modal="true" aria-label={photo.alt}>
      <div className={styles.lightboxTop}>
        <span className={styles.lightboxName}>{photo.alt}</span>
        <button type="button" className={styles.lbButton} onClick={onClose} autoFocus>
          Close <span aria-hidden="true">esc</span>
        </button>
      </div>

      <div className={styles.lightboxStage}>
        {error ? (
          <p className={styles.lbLoading}>That photograph could not be loaded. Try again shortly.</p>
        ) : (
          <>
            {/*
              The thumbnail is already decoded and in cache, so it appears
              instantly and gives the view transition something real to morph
              into. The full-resolution file fades over it when it arrives —
              which is why there is no skeleton here any more.
            */}
            <img
              key={`${photo.id}-preview`}
              src={photo.thumbnailUrl}
              alt=""
              aria-hidden="true"
              className={`${styles.lightboxImage} ${fullLoaded ? styles.lightboxPreviewGone : ''}`}
              style={{ viewTransitionName: 'photo-hero' }}
            />
            {url && (
              <img
                key={`${photo.id}-full`}
                src={url}
                alt={photo.alt}
                className={`${styles.lightboxImage} ${styles.lightboxFull} photoFade ${
                  fullLoaded ? 'photoFadeIn' : ''
                }`}
                onLoad={() => setFullLoaded(true)}
              />
            )}
          </>
        )}
      </div>

      <div className={styles.lightboxBottom}>
        <button
          type="button"
          className={styles.lbButton}
          onClick={() => onIndex(index - 1)}
          disabled={index === 0}
          aria-label="Previous photograph"
        >
          ←
        </button>
        <span className={styles.counter}>
          {String(index + 1).padStart(3, '0')} / {String(photos.length).padStart(3, '0')}
        </span>
        <button
          type="button"
          className={styles.lbButton}
          onClick={() => onIndex(index + 1)}
          disabled={index === photos.length - 1}
          aria-label="Next photograph"
        >
          →
        </button>
        {/* A download is another authorization check away, not a direct link to
            the bucket — the endpoint re-verifies the gallery cookie and the
            selection before it signs anything. */}
        <a
          className={styles.lbButton}
          href={`/api/public/gallery/${slug}/photos/${photo.id}/url?download=1&redirect=1`}
          rel="noreferrer"
        >
          Download
        </a>
      </div>
    </div>
  )
}
