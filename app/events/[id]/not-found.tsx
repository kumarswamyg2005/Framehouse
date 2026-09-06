import Link from 'next/link'
import styles from '@/components/NotFound.module.css'

export const metadata = { title: 'Not found · Framehouse' }

/**
 * The workspace 404. Reached when a signed-in person opens an event that does
 * not exist OR one they are not on — deliberately the same page for both, so it
 * never confirms that an event they cannot see is real.
 */
export default function EventNotFound() {
  return (
    <>
      <div className="grain" aria-hidden="true" />
      <main className={styles.shell}>
        <div className={styles.inner}>
          <div className={styles.mark} />
          <h1 className={`${styles.title} voiceQuiet`}>This event is not on your list</h1>
          <p className={styles.body}>
            It may have been removed, or you may not be on its team. Ask the lead to add you if you
            should be shooting it.
          </p>
          <Link href="/events" className={styles.action}>
            Back to your events <span aria-hidden="true">→</span>
          </Link>
        </div>
      </main>
    </>
  )
}
