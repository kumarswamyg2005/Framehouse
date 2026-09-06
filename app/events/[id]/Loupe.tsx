'use client'

import { useEffect, useState } from 'react'
import { useCloseOnBack } from '@/components/useCloseOnBack'
import type { SheetPhoto } from './ContactSheet'
import styles from './loupe.module.css'

type Props = {
  photos: SheetPhoto[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
  onDelete: (id: string) => void
  deleting: string | null
}

/**
 * Full-resolution view of one frame. The original is fetched through
 * /api/photos/:id/url, which authorizes first and then mints a five-minute
 * presigned GET — the sheet's thumbnails are never upscaled to stand in for it.
 */
export function Loupe({ photos, index, onIndex, onClose, onDelete, deleting }: Props) {
  const photo = photos[index]
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!photo) return
    let cancelled = false
    setUrl(null)
    setError(null)

    fetch(`/api/photos/${photo.id}/url`)
      .then(async (response) => {
        if (!response.ok) throw new Error('That photo could not be loaded.')
        return response.json() as Promise<{ url: string }>
      })
      .then((data) => {
        if (!cancelled) setUrl(data.url)
      })
      .catch(() => {
        if (!cancelled) setError('That photo could not be loaded.')
      })

    return () => {
      cancelled = true
    }
  }, [photo])

  // Back closes the loupe rather than leaving the contact sheet.
  useCloseOnBack(onClose)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight' && index < photos.length - 1) onIndex(index + 1)
      if (event.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, onClose, onIndex, photos.length])

  if (!photo) return null

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label={photo.filename}>
      <div className={styles.top}>
        <span className={styles.filename}>{photo.filename}</span>
        <button type="button" className={styles.close} onClick={onClose} autoFocus>
          Close · esc
        </button>
      </div>

      <div className={styles.stage}>
        {error ? (
          <p className={styles.loading}>{error}</p>
        ) : url ? (
          <img src={url} alt={photo.filename} />
        ) : (
          <p className={styles.loading}>Loading the full frame…</p>
        )}
      </div>

      <div className={styles.bottom}>
        <button
          type="button"
          className={styles.nav}
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
          className={styles.nav}
          onClick={() => onIndex(index + 1)}
          disabled={index === photos.length - 1}
        >
          →
        </button>
        <button
          type="button"
          className={styles.danger}
          disabled={deleting === photo.id}
          onClick={() => onDelete(photo.id)}
        >
          {deleting === photo.id ? 'Deleting…' : 'Delete frame'}
        </button>
      </div>
    </div>
  )
}
