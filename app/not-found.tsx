import Link from 'next/link'
import styles from '@/components/NotFound.module.css'

export const metadata = { title: 'Not found · Framehouse' }

/**
 * The public 404. It sits on the darkroom surface because everything that can
 * reach it — a mistyped URL, a dead gallery link — is on the public side of the
 * app. The workspace has its own at app/events/[id]/not-found.tsx, so a lead
 * who opens a stale event link stays in the room they were already in.
 */
export default function NotFound() {
  return (
    <div className="darkroomSurface">
      <div className="grain" aria-hidden="true" />
      <main className={styles.shell}>
        <div className={styles.inner}>
          <div className={styles.mark} />
          <h1 className={`${styles.title} voiceDisplay`}>Nothing at this address</h1>
          <p className={styles.body}>
            This page does not exist. If you were sent a gallery link, check it against the message
            it came in — the last few characters are easy to lose when a link wraps.
          </p>
          <Link href="/" className={styles.action}>
            Go to the start <span aria-hidden="true">→</span>
          </Link>
        </div>
      </main>
    </div>
  )
}
