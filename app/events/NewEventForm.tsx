'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import styles from './events.module.css'

export function NewEventForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault()
    setPending(true)
    setError(null)

    const body = Object.fromEntries(new FormData(formEvent.currentTarget).entries())
    const response = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null
      setError(payload?.error?.message ?? 'The event could not be created.')
      setPending(false)
      return
    }

    const { event } = (await response.json()) as { event: { id: string } }
    router.push(`/events/${event.id}`)
    router.refresh()
  }

  if (!open) {
    return (
      <button type="button" className={styles.newToggle} onClick={() => setOpen(true)}>
        New event
      </button>
    )
  }

  return (
    <>
      <button
        type="button"
        className={`${styles.newToggle} ${styles.newToggleOpen}`}
        onClick={() => setOpen(false)}
      >
        Cancel
      </button>

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <div>
          <label className={styles.label} htmlFor="event-name">
            Event name
          </label>
          <input
            className={styles.input}
            id="event-name"
            name="name"
            type="text"
            placeholder="Arjun &amp; Priya Wedding"
            required
            autoFocus
            disabled={pending}
          />
        </div>

        <div>
          <label className={styles.label} htmlFor="event-date">
            Date
          </label>
          {/* Native date input: correct keyboard, correct locale, no dependency. */}
          <input className={styles.input} id="event-date" name="date" type="date" disabled={pending} />
        </div>

        <div className={styles.formWide}>
          <label className={styles.label} htmlFor="event-description">
            Description <span style={{ opacity: 0.6 }}>optional</span>
          </label>
          <textarea
            className={styles.textarea}
            id="event-description"
            name="description"
            rows={2}
            placeholder="Two days, Bangalore. Mehendi through reception."
            disabled={pending}
          />
        </div>

        <div className={styles.formActions}>
          <button className={styles.submit} type="submit" disabled={pending}>
            {pending ? 'Creating…' : 'Create event'}
          </button>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
      </form>
    </>
  )
}
