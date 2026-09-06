'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'
import styles from './AuthForm.module.css'

type Mode = 'login' | 'register'

const COPY = {
  login: {
    tagline:
      'Your events, your team’s uploads, and the galleries you have delivered — all behind this form.',
    panelTitle: 'Welcome back',
    panelNote: 'Use the email your lead added you with.',
    submit: 'Sign in',
    pending: 'Signing in…',
    endpoint: '/api/auth/login',
    footer: { lead: 'Leading a team for the first time?', href: '/register', link: 'Create a workspace' },
  },
  register: {
    tagline:
      'Set up a workspace, add the people shooting with you, and start delivering galleries.',
    panelTitle: 'Create a workspace',
    panelNote: 'This makes you the lead. You can add your team straight afterwards.',
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
    <>
      <div className="grain" aria-hidden="true" />

      <main className={styles.shell}>
        <div className={styles.rail}>
          <Link href="/" className={styles.home}>
            ← Framehouse
          </Link>
          <h1 className={styles.wordmark}>
            {mode === 'login' ? 'Sign in' : 'Create a workspace'}
          </h1>
          <p className={styles.tagline}>{copy.tagline}</p>

          {/* Empty frames — nothing is shown until someone is authorized. */}
          <div className={styles.strip} aria-hidden="true">
            {Array.from({ length: 18 }, (_, i) => (
              <div
                key={i}
                className={`${styles.stripFrame} ${
                  [3, 9, 14].includes(i) ? styles.stripFrameMarked : ''
                }`}
                style={{ animationDelay: `${100 + i * 30}ms` }}
              />
            ))}
          </div>
        </div>

        <form className={styles.panel} onSubmit={onSubmit} noValidate>
          <h2 className={styles.panelTitle}>{copy.panelTitle}</h2>
          <p className={styles.panelNote}>{copy.panelNote}</p>

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
                placeholder="Meera Raghavan"
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
              placeholder="you@studio.com"
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

          <p className={styles.footer}>
            {copy.footer.lead} <Link href={copy.footer.href}>{copy.footer.link}</Link>
          </p>
        </form>
      </main>
    </>
  )
}
