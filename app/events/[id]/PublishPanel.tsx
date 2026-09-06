'use client'

import { useRef, useState } from 'react'
import styles from './publish.module.css'

export type GalleryState = {
  id: string
  slug: string
  title: string
  isPublished: boolean
} | null

type Props = {
  eventName: string
  gallery: GalleryState
  selectedCount: number
  appUrl: string
  onChanged: (gallery: NonNullable<GalleryState>) => void
  onClose: () => void
  onToast: (message: string) => void
}

/**
 * Setting the PIN and publishing. The PIN is posted once and hashed on arrival;
 * it is never returned by any endpoint, so this panel cannot show it again
 * afterwards — the copy says so rather than pretending otherwise.
 */
export function PublishPanel({
  eventName,
  gallery,
  selectedCount,
  appUrl,
  onChanged,
  onClose,
  onToast,
}: Props) {
  const [title, setTitle] = useState(gallery?.title ?? eventName)
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const boxes = useRef<(HTMLInputElement | null)[]>([])

  const pin = digits.join('')
  const shareUrl = gallery ? `${appUrl}/g/${gallery.slug}` : ''

  function setDigit(index: number, value: string) {
    // Paste-aware: dropping six digits into any box fills the row.
    const cleaned = value.replace(/\D/g, '')
    if (cleaned.length > 1) {
      const next = cleaned.slice(0, 6).split('')
      setDigits(Array.from({ length: 6 }, (_, i) => next[i] ?? ''))
      boxes.current[Math.min(next.length, 5)]?.focus()
      return
    }
    setDigits((prev) => prev.map((d, i) => (i === index ? cleaned : d)))
    if (cleaned) boxes.current[index + 1]?.focus()
  }

  async function publish() {
    if (!gallery) return
    setPending(true)
    setError(null)

    const response = await fetch(`/api/galleries/${gallery.id}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    })

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null
      setError(payload?.error?.message ?? 'The gallery could not be published.')
      setPending(false)
      return
    }

    const { slug } = (await response.json()) as { slug: string }
    onChanged({ ...gallery, slug, title, isPublished: true })
    setDigits(Array(6).fill(''))
    setPending(false)
    onToast('Published')
  }

  async function unpublish() {
    if (!gallery) return
    setPending(true)
    const response = await fetch(`/api/galleries/${gallery.id}/unpublish`, { method: 'POST' })
    if (response.ok) {
      onChanged({ ...gallery, isPublished: false })
      onToast('Unpublished. The link no longer opens.')
    }
    setPending(false)
  }

  if (gallery?.isPublished) {
    return (
      <div className={styles.panel}>
        <h2 className={styles.panelTitle}>{gallery.title}</h2>
        <p className={styles.panelNote}>
          Published with {selectedCount} {selectedCount === 1 ? 'photo' : 'photos'}. Send the client
          the link and the PIN separately.
        </p>

        <p className={styles.linkLabel}>Gallery link</p>
        <div className={styles.link}>
          <span className={styles.linkValue}>{shareUrl}</span>
          <button
            type="button"
            className={styles.ghost}
            onClick={() => {
              void navigator.clipboard?.writeText(shareUrl)
              onToast('Link copied')
            }}
          >
            Copy
          </button>
          <a className={styles.ghost} href={shareUrl} target="_blank" rel="noreferrer">
            Open
          </a>
        </div>

        <p className={styles.pinNote}>
          The PIN is stored as a one-way hash and cannot be shown again. Publish once more to set a
          new one.
        </p>

        <div className={styles.row} style={{ marginTop: 22 }}>
          <button type="button" className={styles.ghost} onClick={unpublish} disabled={pending}>
            {pending ? 'Working…' : 'Unpublish'}
          </button>
          <button type="button" className={styles.ghost} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>Publish to a client gallery</h2>
      <p className={styles.panelNote}>
        Publish {selectedCount} {selectedCount === 1 ? 'photo' : 'photos'} to a client gallery? You
        can unpublish anytime.
      </p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="gallery-title">
          Gallery title
        </label>
        <input
          className={styles.input}
          id="gallery-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <span className={styles.label} id="pin-label">
          Access PIN — six digits
        </span>
        <div className={styles.pinRow} role="group" aria-labelledby="pin-label">
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(el) => {
                boxes.current[index] = el
              }}
              className={styles.pinBox}
              value={digit}
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              aria-label={`PIN digit ${index + 1}`}
              disabled={pending}
              onChange={(e) => setDigit(index, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !digits[index]) boxes.current[index - 1]?.focus()
              }}
            />
          ))}
        </div>
      </div>

      <div className={styles.row}>
        <button
          type="button"
          className={styles.solid}
          onClick={publish}
          disabled={pending || pin.length !== 6 || selectedCount === 0 || !title.trim()}
        >
          {pending ? 'Publishing…' : 'Publish'}
        </button>
        <button type="button" className={styles.ghost} onClick={onClose} disabled={pending}>
          Cancel
        </button>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
