'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'
import styles from './AuthForm.module.css'

type Mode = 'login' | 'register'

const COPY = {
  login: {
    tagline: 'Sign in to your workspace.',
    submit: 'Sign in',
    pending: 'Signing in…',
    endpoint: '/api/auth/login',
    footer: { lead: 'Leading a team for the first time?', href: '/register', link: 'Create a workspace' },
  },
  register: {
    tagline: 'Create a workspace for your team.',
    submit: 'Create workspace',
    pending: 'Creating…',
    endpoint: '/api/auth/register',
    footer: { lead: 'Already have a workspace?', href: '/login', link: 'Sign in' },
  },
} as const

export function AuthForm({ mode }: { mode: Mode }) {
  const copy = COPY[mode]
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault()
    setPending(true)
    setError(null)

    const form = new FormData(formEvent.currentTarget)
    const body = Object.fromEntries(form.entries())

    try {
      const response = await fetch(copy.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null
        setError(payload?.error?.message ?? 'That didn’t work. Try again.')
        setPending(false)
        return
      }

      // refresh() so server components re-read the freshly set session cookie.
      router.replace('/events')
      router.refresh()
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
      setPending(false)
    }
  }

  return (
    <main className={styles.shell}>
      <div className={styles.column}>
        <h1 className={styles.wordmark}>Framehouse</h1>
        <p className={styles.tagline}>{copy.tagline}</p>

        <hr className={styles.rule} />

        <form onSubmit={onSubmit} noValidate>
          {mode === 'register' && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="name">
                Your name
              </label>
              <input
                className={styles.input}
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                required
                disabled={pending}
                aria-invalid={error ? true : undefined}
              />
            </div>
          )}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">
              Email
            </label>
            <input
              className={styles.input}
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus={mode === 'login'}
              required
              disabled={pending}
              aria-invalid={error ? true : undefined}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="password">
              Password
            </label>
            <input
              className={styles.input}
              id="password"
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              disabled={pending}
              aria-invalid={error ? true : undefined}
              aria-describedby={mode === 'register' ? 'password-hint' : undefined}
            />
            {mode === 'register' && (
              <p className={styles.hint} id="password-hint">
                At least 10 characters.
              </p>
            )}
          </div>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <button className={styles.submit} type="submit" disabled={pending}>
            {pending ? copy.pending : copy.submit}
          </button>
        </form>

        <p className={styles.footer}>
          {copy.footer.lead} <Link href={copy.footer.href}>{copy.footer.link}</Link>
        </p>
      </div>
    </main>
  )
}
