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
  photos: GalleryPhoto[]
}

export function Gallery({ slug, title, credit, photos }: Props) {
  const [open, setOpen] = useState<number | null>(null)

  // Presigned URLs last five minutes. Reload just before they lapse so a
  // gallery left open on a second screen does not decay into broken images.
  useEffect(() => {
    const timer = setTimeout(() => window.location.reload(), 4.5 * 60 * 1000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className={styles.gallerySurface}>
      <header className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.credit}>
          Photographs by {credit} · {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
        </p>
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
            aria-label={`Open ${photo.alt}`}
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

      <p className={styles.footer}>
        Tap any photo to view it full size. Your photographer can send you the originals.
      </p>

      {open !== null && photos[open] && (
        <Lightbox slug={slug} photos={photos} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
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
   * The full-resolution URL is fetched per photo rather than presigned for the
   * whole gallery up front: a 600-photo gallery would otherwise mint 600 URLs
   * on every page load, most of which are never opened.
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
        <button type="button" className={styles.lbButton} onClick={onClose} autoFocus>
          Close · esc
        </button>
      </div>

      <div className={styles.lightboxStage}>
        {error ? (
          <p className={styles.lbLoading}>That photo could not be loaded. Try again in a moment.</p>
        ) : url ? (
          <img src={url} alt={photo.alt} />
        ) : (
          <p className={styles.lbLoading}>Loading…</p>
        )}
      </div>

      <div className={styles.lightboxBottom}>
        <button
          type="button"
          className={styles.lbButton}
          onClick={() => onIndex(index - 1)}
          disabled={index === 0}
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
        >
          →
        </button>
      </div>
    </div>
  )
}
