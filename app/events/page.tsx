import Link from 'next/link'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import { requirePageActor } from '@/lib/auth/session'
import { listEvents } from '@/lib/data/events'
import { NewEventForm } from './NewEventForm'
import styles from './events.module.css'

export const metadata = { title: 'Events · Framehouse' }
export const dynamic = 'force-dynamic'

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

export default async function EventsPage() {
  const actor = await requirePageActor()
  const events = await listEvents(actor)
  const isLead = actor.role === 'ADMIN'

  return (
    <>
      {/* Film grain: see the note in app/globals.css. */}
      <div className="grain" aria-hidden="true" />

      <div className={styles.page}>
        <WorkspaceHeader actor={actor} />

        <div className={styles.head}>
          <div>
            <h1 className={styles.title}>Events</h1>
            <p className={styles.subtitle}>
              {isLead
                ? 'Events you lead. Add your team, review their frames, publish a gallery.'
                : 'Events you have been assigned to.'}
            </p>
          </div>
          {isLead && <NewEventForm />}
        </div>

        {events.length === 0 ? (
          <p className={styles.empty}>
            {isLead
              ? 'No events yet. Create one, add the people shooting it, and their uploads will land here.'
              : 'Nothing assigned to you yet. Your lead will add you to an event when the shoot is set up.'}
          </p>
        ) : (
          <ul className={styles.list}>
            {events.map((event) => (
              <li key={event.id} className={styles.row}>
                <Link href={`/events/${event.id}`} className={styles.rowLink}>
                  <div>
                    <div className={styles.eventName}>{event.name}</div>
                    <p className={styles.eventMeta}>
                      {event.date ? dateFormat.format(event.date) : 'No date set'}
                      {' · '}
                      {event.photos.length} {event.photos.length === 1 ? 'frame' : 'frames'}
                      {isLead && ` · ${event._count.members} on the team`}
                    </p>
                  </div>
                  <div className={styles.rowRight}>
                    {event.gallery?.isPublished ? (
                      <span className={styles.published}>Gallery published</span>
                    ) : isLead ? (
                      <span>Not published</span>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
