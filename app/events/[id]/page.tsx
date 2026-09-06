import Link from 'next/link'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import { requirePageActor } from '@/lib/auth/session'
import { getGallery } from '@/lib/data/gallery'
import { getEventDetail } from '@/lib/data/events'
import { listPhotos } from '@/lib/data/photos'
import { orNotFound } from '@/lib/page'
import { TeamRoster } from './TeamRoster'
import { Workspace } from './Workspace'
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

  // Throws NOT_FOUND for an event this actor may not see, which renders the 404
  // page — the same response an event id that does not exist produces.
  const { event, members } = await orNotFound(getEventDetail(actor, id))
  const isLead = actor.role === 'ADMIN'

  // Both of these are actor-scoped at the database level: a member's first page
  // contains only their own frames, and getGallery is owner-only.
  const [firstPage, gallery] = await Promise.all([
    listPhotos(actor, id, { limit: 60 }),
    isLead ? getGallery(actor, id) : Promise.resolve(null),
  ])

  return (
    <>
      {/* Film grain: see the note in app/globals.css. */}
      <div className="grain" aria-hidden="true" />

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
              {isLead && (gallery?.isPublished ? ' · Gallery published' : ' · Draft')}
            </p>
            {event.description && <p className={styles.description}>{event.description}</p>}
          </div>
        </div>

        <Workspace
          eventId={event.id}
          eventName={event.name}
          isLead={isLead}
          appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ''}
          initialPhotos={firstPage.photos}
          initialCursor={firstPage.nextCursor}
          initialGallery={
            gallery
              ? {
                  id: gallery.id,
                  slug: gallery.slug,
                  title: gallery.title,
                  isPublished: gallery.isPublished,
                }
              : null
          }
          initialSelectedIds={gallery?.selectedIds ?? []}
        />

        {isLead && <TeamRoster eventId={event.id} members={members} />}
      </div>
    </>
  )
}
