import Link from 'next/link'
import type { Actor } from '@/lib/auth/policy'
import { SignOutButton } from './SignOutButton'
import styles from './WorkspaceHeader.module.css'

export function WorkspaceHeader({ actor }: { actor: Actor }) {
  return (
    <header className={styles.bar}>
      <Link href="/events" className={`${styles.wordmark} voiceQuiet`}>
        Framehouse
      </Link>
      <div className={styles.right}>
        <span className={styles.who}>
          {actor.name} <span className={styles.role}>· {actor.role === 'ADMIN' ? 'Lead' : 'Team'}</span>
        </span>
        <SignOutButton />
      </div>
    </header>
  )
}
