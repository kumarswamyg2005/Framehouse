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
  // A published gallery shows its link, not a PIN field. Changing the PIN is an
  // explicit step, because it signs every client currently viewing back out.
  const [changingPin, setChangingPin] = useState(false)
  const [copied, setCopied] = useState<'link' | 'message' | null>(null)
  /**
   * The PIN that was just typed, held in memory only for this panel session.
   *
   * It exists so the lead can copy a ready-to-send message immediately after
   * publishing. It is never stored, never re-fetched, and gone on reload — the
   * row only ever holds an argon2id hash.
   */
  const [justSetPin, setJustSetPin] = useState<string | null>(null)
  const boxes = useRef<(HTMLInputElement | null)[]>([])

  function copy(what: 'link' | 'message', text: string, toast: string) {
    void navigator.clipboard?.writeText(text)
    setCopied(what)
    setTimeout(() => setCopied(null), 2000)
    onToast(toast)
  }

  const alreadyPublished = gallery?.isPublished === true

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
    setJustSetPin(pin)
    setDigits(Array(6).fill(''))
    setPending(false)
    setChangingPin(false)
    onToast(alreadyPublished ? 'New PIN set' : 'Published')
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

  if (alreadyPublished && !changingPin) {
    return (
      <div className={styles.panel}>
        <h2 className={`${styles.panelTitle} voiceQuiet`}>{gallery.title}</h2>
        <p className={styles.panelNote}>
          Published with {selectedCount} {selectedCount === 1 ? 'photo' : 'photos'}. Send the client
          the link and the PIN separately.
        </p>

        <p className={styles.linkLabel}>Gallery link — send this to your client</p>
        <div className={styles.link}>
          {/* Click anywhere on it to select the whole URL, for anyone who would
              rather drag-select than press a button. */}
          <span
            className={styles.linkValue}
            onClick={(event) => {
              const range = document.createRange()
              range.selectNodeContents(event.currentTarget)
              const selection = window.getSelection()
              selection?.removeAllRanges()
              selection?.addRange(range)
            }}
          >
            {shareUrl}
          </span>
          <button
            type="button"
            className={`btn ${copied === 'link' ? 'btnPrimary' : 'btnQuiet'}`}
            onClick={() => copy('link', shareUrl, 'Link copied')}
          >
            {copied === 'link' ? 'Copied' : 'Copy link'}
          </button>
          <a className="btn btnQuiet" href={shareUrl} target="_blank" rel="noreferrer">
            Open
          </a>
        </div>

        {justSetPin && (
          <div className={styles.messageBlock}>
            <p className={styles.linkLabel}>Ready to send</p>
            <p className={styles.messagePreview}>
              {`Your photographs from ${gallery.title} are ready.\n\n${shareUrl}\nPIN: ${justSetPin}`}
            </p>
            <div className={styles.row}>
              <button
                type="button"
                className={`btn ${copied === 'message' ? 'btnPrimary' : 'btnQuiet'}`}
                onClick={() =>
                  copy(
                    'message',
                    `Your photographs from ${gallery.title} are ready.\n\n${shareUrl}\nPIN: ${justSetPin}`,
                    'Message copied'
                  )
                }
              >
                {copied === 'message' ? 'Copied' : 'Copy message with PIN'}
              </button>
            </div>
            <p className={styles.messageNote}>
              Shown once, while you are still on this screen. The PIN is stored as a one-way hash,
              so it cannot be retrieved later — and for a real client, send the link and the PIN by
              different routes.
            </p>
          </div>
        )}

        <p className={styles.pinNote}>
          The PIN is stored as a one-way hash, so it cannot be shown again. Setting a new one signs
          out anyone currently viewing the gallery.
        </p>

        <div className={styles.row} style={{ marginTop: 22 }}>
          <button
            type="button"
            className="btn btnQuiet"
            onClick={() => {
              setDigits(Array(6).fill(''))
              setError(null)
              setChangingPin(true)
            }}
            disabled={pending}
          >
            Set a new PIN
          </button>
          <button type="button" className="btn btnQuiet" onClick={unpublish} disabled={pending}>
            {pending ? 'Working…' : 'Unpublish'}
          </button>
          <button type="button" className="btn btnQuiet" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.panel}>
      <h2 className={`${styles.panelTitle} voiceQuiet`}>
        {changingPin ? 'Set a new PIN' : 'Publish to a client gallery'}
      </h2>
      <p className={styles.panelNote}>
        {changingPin
          ? 'The link stays the same. Anyone currently viewing the gallery will be asked for the new PIN.'
          : `Publish ${selectedCount} ${selectedCount === 1 ? 'photo' : 'photos'} to a client gallery? You can unpublish anytime.`}
      </p>

      {!changingPin && (
        <div className={styles.field}>
          <label className="label" htmlFor="gallery-title">
            Gallery title
          </label>
          <input
            className="input"
            id="gallery-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={pending}
          />
        </div>
      )}

      <div className={styles.field}>
        <span className="label" id="pin-label">
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
          className="btn btnPrimary"
          onClick={publish}
          disabled={pending || pin.length !== 6 || selectedCount === 0 || !title.trim()}
        >
          {pending ? 'Saving…' : changingPin ? 'Set new PIN' : 'Publish'}
        </button>
        <button
          type="button"
          className="btn btnQuiet"
          onClick={() => (changingPin ? setChangingPin(false) : onClose())}
          disabled={pending}
        >
          Cancel
        </button>
      </div>

      {error && (
        <p className="errorNote" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
