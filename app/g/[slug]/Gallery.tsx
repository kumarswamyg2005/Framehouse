'use client'

import { useEffect, useState } from 'react'
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
  photos: GalleryPhoto[]
}

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

export function Gallery({ slug, title, credit, eventName, publishedAt, photos }: Props) {
  const [open, setOpen] = useState<number | null>(null)

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
              <span className={styles.metaValue}>{photos.length}</span>
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
              onClick={() => setOpen(index)}
              aria-label={`Open ${photo.alt}, frame ${index + 1} of ${photos.length}`}
            >
              <img
                src={photo.thumbnailUrl}
                alt={photo.alt}
                loading={index < 6 ? 'eager' : 'lazy'}
                decoding="async"
                width={photo.width ?? undefined}
                height={photo.height ?? undefined}
              />
            </button>
          ))}
        </div>

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
          onClose={() => setOpen(null)}
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
  const [error, setError] = useState(false)

  /**
   * The full-resolution URL is fetched per photograph rather than presigned for
   * the whole gallery up front: a 600-photo gallery would otherwise mint 600
   * URLs on every page load, most of which are never opened.
   */
  useEffect(() => {
    let cancelled = false
    setUrl(null)
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
        ) : url ? (
          <img src={url} alt={photo.alt} />
        ) : (
          <div className={styles.lbSkeleton} role="status" aria-label="Loading the photograph" />
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
