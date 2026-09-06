'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import styles from './event.module.css'

type Member = {
  addedAt: string | Date
  user: { id: string; name: string; email: string }
}

type CreatedCredential = { email: string; password: string }

export function TeamRoster({ eventId, members }: { eventId: string; members: Member[] }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [credential, setCredential] = useState<CreatedCredential | null>(null)

  async function addMember(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault()
    const form = formEvent.currentTarget
    setPending(true)
    setError(null)
    setCredential(null)

    const response = await fetch(`/api/events/${eventId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
    })

    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string }
      user?: { email: string }
      temporaryPassword?: string | null
    } | null

    if (!response.ok) {
      setError(payload?.error?.message ?? 'That person could not be added.')
      setPending(false)
      return
    }

    // Only present when this call created the account. Shown once; there is no
    // way to read it back afterwards.
    if (payload?.temporaryPassword && payload.user) {
      setCredential({ email: payload.user.email, password: payload.temporaryPassword })
    }

    form.reset()
    setPending(false)
    router.refresh()
  }

  async function removeMember(userId: string) {
    setRemoving(userId)
    setError(null)
    const response = await fetch(`/api/events/${eventId}/members/${userId}`, { method: 'DELETE' })
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null
      setError(payload?.error?.message ?? 'That person could not be removed.')
    }
    setRemoving(null)
    router.refresh()
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Team</h2>
      <p className={styles.sectionNote}>
        Everyone here can upload to this event and see their own frames. They cannot see each
        other&rsquo;s uploads, and they cannot publish.
      </p>

      {members.length > 0 && (
        <ul className={styles.roster}>
          {members.map(({ user }) => (
            <li key={user.id} className={styles.rosterRow}>
              <span>
                <span className={styles.rosterName}>{user.name}</span>
                <span className={styles.rosterEmail}>{user.email}</span>
              </span>
              <button
                type="button"
                className="btnBare"
                disabled={removing === user.id}
                onClick={() => removeMember(user.id)}
              >
                {removing === user.id ? 'Removing…' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className={styles.addRow} onSubmit={addMember} noValidate>
        <div className={styles.addField}>
          <label className="label" htmlFor="member-email">
            Email
          </label>
          <input
            className="input"
            id="member-email"
            name="email"
            type="email"
            placeholder="nikhil@studio.com"
            required
            disabled={pending}
          />
        </div>
        <div className={styles.addField}>
          <label className="label" htmlFor="member-name">
            Name <span className="labelHint">if new</span>
          </label>
          <input
            className="input"
            id="member-name"
            name="name"
            type="text"
            placeholder="Nikhil Shetty"
            disabled={pending}
          />
        </div>
        <button className="btn btnPrimary" type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add to event'}
        </button>
      </form>

      {error && (
        <p className="errorNote" role="alert">
          {error}
        </p>
      )}

      {credential && (
        <div className={styles.credential} role="status">
          <p className={styles.credentialTitle}>Account created for {credential.email}</p>
          <p className={styles.credentialBody}>
            Temporary password: <span className={styles.credentialValue}>{credential.password}</span>
            <br />
            Send it to them now — this is the only time it is shown.
          </p>
        </div>
      )}
    </section>
  )
}
