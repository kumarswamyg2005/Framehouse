import Link from 'next/link'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import { requirePageActor } from '@/lib/auth/session'
import { getEventDetail } from '@/lib/data/events'
import { orNotFound } from '@/lib/page'
import { TeamRoster } from './TeamRoster'
import styles from './event.module.css'

export const dynamic = 'force-dynamic'

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor()
  const { id } = await params

  // Throws NOT_FOUND for an event this actor may not see, which Next renders as
  // the 404 page — the same response an event id that does not exist produces.
  const { event, members, gallery } = await orNotFound(getEventDetail(actor, id))
  const isLead = actor.role === 'ADMIN'

  return (
    <div className={styles.page}>
      <WorkspaceHeader actor={actor} />

      <Link href="/events" className={styles.back}>
        ← All events
      </Link>

      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>{event.name}</h1>
          <p className={styles.meta}>
            {event.date ? dateFormat.format(event.date) : 'No date set'}
            {gallery?.isPublished ? ' · Gallery published' : isLead ? ' · Draft' : ''}
          </p>
          {event.description && <p className={styles.description}>{event.description}</p>}
        </div>
      </div>

      {isLead && <TeamRoster eventId={event.id} members={members} />}
    </div>
  )
}
