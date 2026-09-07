'use client'

import { useRef, useState } from 'react'
import styles from './gallery.module.css'

/**
 * Six digits, auto-advancing and paste-aware.
 *
 * The message on failure is the same whether the PIN was wrong or the gallery
 * does not exist — the server returns one error for both, and this component
 * does not try to be more helpful than that.
 */
type Props = {
  slug: string
  onUnlocked: (gallery: import('./GalleryClient').GalleryData) => void
}

export function PinGate({ slug, onUnlocked }: Props) {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''))
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [shake, setShake] = useState(false)
  const boxes = useRef<(HTMLInputElement | null)[]>([])

  const pin = digits.join('')

  function fill(next: string[]) {
    setDigits(next)
    if (next.join('').length === 6) void submit(next.join(''))
  }

  function setDigit(index: number, value: string) {
    const cleaned = value.replace(/\D/g, '')

    // Pasting the whole PIN into any box fills the row.
    if (cleaned.length > 1) {
      const chars = cleaned.slice(0, 6).split('')
      const next = Array.from({ length: 6 }, (_, i) => chars[i] ?? '')
      boxes.current[Math.min(chars.length, 5)]?.focus()
      fill(next)
      return
    }

    const next = digits.map((d, i) => (i === index ? cleaned : d))
    if (cleaned) boxes.current[index + 1]?.focus()
    fill(next)
  }

  async function submit(value: string) {
    if (value.length !== 6 || pending) return
    setPending(true)
    setMessage(null)

    const response = await fetch(`/api/public/gallery/${slug}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: value }),
    })

    if (response.ok) {
      // The cookie now authorises this page's requests. Fetch the gallery with
      // it and hand it up — the server never renders photographs for a bare
      // navigation, only for a PIN that was just entered.
      const gallery = await fetch(`/api/public/gallery/${slug}`)
      if (gallery.ok) {
        onUnlocked(await gallery.json())
        return
      }
      setMessage('That gallery is no longer available.')
      setDigits(Array(6).fill(''))
      setPending(false)
      return
    }

    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null

    setMessage(payload?.error?.message ?? 'That PIN doesn’t match.')
    setDigits(Array(6).fill(''))
    setShake(true)
    setTimeout(() => setShake(false), 220)
    boxes.current[0]?.focus()
    setPending(false)
  }

  return (
    <div className="gallerySurface">
      <div className={styles.paperGrain} aria-hidden="true" />

      <div className={styles.gate}>
        <span className={`${styles.gateBrand} voiceQuiet`}>Framehouse</span>

        <div className={styles.gateMiddle}>
          <div className={styles.gateInner}>
            <div className={styles.gateMark} />
            <h1 className={`${styles.gateTitle} voiceDisplay`}>Your photographs are ready</h1>
            <p className={styles.gateNote}>
              Enter the six-digit PIN your photographer sent you.
            </p>

            <div
              className={`${styles.pinRow} ${shake ? styles.shake : ''}`}
              role="group"
              aria-label="Gallery PIN"
            >
              {digits.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => {
                    boxes.current[index] = el
                  }}
                  className={`${styles.pinBox} ${digit ? styles.pinBoxFilled : ''}`}
                  value={digit}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus={index === 0}
                  disabled={pending}
                  aria-label={`Digit ${index + 1}`}
                  onChange={(e) => setDigit(index, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !digits[index]) boxes.current[index - 1]?.focus()
                    if (e.key === 'Enter') void submit(pin)
                  }}
                />
              ))}
            </div>

            <p
              className={`${styles.gateMessage} ${pending ? styles.gateWorking : ''}`}
              role="status"
            >
              {pending ? 'Checking…' : message}
            </p>
          </div>
        </div>

        <p className={styles.gateFoot}>
          This gallery is private. The link alone does not open it.
        </p>
      </div>
    </div>
  )
}
