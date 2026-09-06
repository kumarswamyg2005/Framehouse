'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import styles from './WorkspaceHeader.module.css'

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  return (
    <button
      type="button"
      className={className ?? styles.signOut}
      disabled={pending}
      onClick={async () => {
        setPending(true)
        await fetch('/api/auth/logout', { method: 'POST' })
        router.replace('/login')
        router.refresh()
      }}
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
