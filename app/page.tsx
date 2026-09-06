import Link from 'next/link'
import { getActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import styles from './landing.module.css'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Framehouse — shoot, cull, and deliver event photography',
  description:
    'A photo-sharing platform for event and wedding photography teams. Team members upload, the lead selects, the client opens a PIN-protected gallery.',
}

/**
 * There is not a single photograph on this page, and that is the point.
 *
 * Every image in this application is delivered by a presigned URL minted after
 * an authorization check that names who is asking. Nobody has been authorized
 * here yet, so there is nothing to show — putting a hero image on the entry
 * page would have meant carving an exception into the first invariant. The
 * photographs start one screen in, once you are someone.
 */

const DEMO_STEPS = [
  {
    who: 'Meera',
    role: 'Lead',
    what: (
      <>
        Creates the event and adds the people shooting it. Adding someone by email{' '}
        <strong>creates their account</strong> with a one-time temporary password if they do not
        already have one.
      </>
    ),
  },
  {
    who: 'Nikhil and Sana',
    role: 'Team',
    what: (
      <>
        Each uploads their own frames. They are on the same wedding and{' '}
        <strong>cannot see each other&rsquo;s photographs</strong> — the scoping is a SQL clause, not
        a hidden button. Neither can publish.
      </>
    ),
  },
  {
    who: 'Meera',
    role: 'Lead',
    what: (
      <>
        Reviews everything on one contact sheet, marks the selects with{' '}
        <strong>click, space, or shift+click</strong> for a range, then publishes them behind a
        six-digit PIN and gets a link.
      </>
    ),
  },
  {
    who: 'The couple',
    role: 'Client',
    what: (
      <>
        Opens the link with <strong>no account at all</strong>, types the PIN, and sees exactly the
        frames that were selected. An unselected photograph from the same event is unreachable, even
        with its id.
      </>
    ),
  },
]

/**
 * The demo block only renders when the seed data is present — it is keyed to the
 * seeded admin account. A real deployment without SEED_ADMIN_EMAIL set shows
 * nothing here, so this page never advertises a genuine client's gallery slug.
 */
async function demoGallery() {
  const seededAdmin = process.env.SEED_ADMIN_EMAIL
  if (!seededAdmin) return null

  return prisma.gallery.findFirst({
    where: { isPublished: true, event: { owner: { email: seededAdmin } } },
    select: { slug: true, title: true, _count: { select: { photos: true } } },
  })
}

export default async function Home() {
  const [actor, gallery] = await Promise.all([getActor(), demoGallery()])
  const repoUrl = process.env.NEXT_PUBLIC_REPO_URL

  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <span className={styles.wordmark}>Framehouse</span>
        <Link className={styles.barLink} href={actor ? '/events' : '/login'}>
          {actor ? `Signed in as ${actor.name}` : 'Sign in'}
        </Link>
      </header>

      <section className={styles.hero}>
        <h1 className={styles.title}>
          Shoot together. Cull on one sheet. Hand the client a link.
        </h1>
        <p className={styles.lede}>
          Framehouse is a photo-sharing platform for event and wedding photography teams. Everyone
          on the shoot uploads to the same event and sees only their own frames. The lead reviews
          all of it on a contact sheet, picks the selects, and publishes them to a PIN-protected
          gallery the client opens without ever making an account.
        </p>
        <div className={styles.actions}>
          <Link className={styles.solid} href={actor ? '/events' : '/login'}>
            {actor ? 'Go to your events' : 'Sign in to the demo'}
          </Link>
          {gallery && (
            <Link className={styles.ghost} href={`/g/${gallery.slug}`}>
              Open a client gallery
            </Link>
          )}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>How a shoot moves through it</h2>
        <p className={styles.sectionNote}>
          Three roles, one direction of travel. Every step below is enforced in the database, not in
          the interface.
        </p>
        <ol className={styles.steps}>
          {DEMO_STEPS.map((step, index) => (
            <li className={styles.step} key={index}>
              <span className={styles.stepWho}>
                {step.who}
                <span className={styles.stepRole}>{step.role}</span>
              </span>
              <p className={styles.stepWhat}>{step.what}</p>
            </li>
          ))}
        </ol>
      </section>

      {gallery && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Try it</h2>
          <p className={styles.sectionNote}>
            This deployment is seeded with a fictional wedding. Sign in as any of these to see how
            differently the same event looks from each side.
          </p>

          <div className={styles.demo}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Sign in as</th>
                  <th>Email</th>
                  <th>Password</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className={styles.who}>The lead</td>
                  <td className={styles.value}>admin@demo.test</td>
                  <td className={styles.value}>demo-admin-pass-2026</td>
                </tr>
                <tr>
                  <td className={styles.who}>A team member</td>
                  <td className={styles.value}>nikhil@demo.test</td>
                  <td className={styles.value}>demo-member-pass-2026</td>
                </tr>
                <tr>
                  <td className={styles.who}>A second member</td>
                  <td className={styles.value}>sana@demo.test</td>
                  <td className={styles.value}>demo-member-pass-2026</td>
                </tr>
                <tr>
                  <td className={styles.who}>Assigned to nothing</td>
                  <td className={styles.value}>idle@demo.test</td>
                  <td className={styles.value}>demo-member-pass-2026</td>
                </tr>
                <tr>
                  <td className={styles.who}>The client</td>
                  <td colSpan={2}>
                    <Link className={styles.demoLink} href={`/g/${gallery.slug}`}>
                      {gallery.title}
                    </Link>{' '}
                    — PIN <span className={styles.value}>482917</span>
                  </td>
                </tr>
              </tbody>
            </table>

            <p className={styles.demoFoot}>
              Worth trying: sign in as <span className={styles.value}>nikhil@demo.test</span> and
              count the frames, then as the lead and count them again — the lead sees everyone&rsquo;s,
              Nikhil sees only his. Sign in as{' '}
              <span className={styles.value}>idle@demo.test</span> and the event list is empty,
              because that account is assigned to nothing. Enter the wrong PIN six times and the
              gallery locks you out for fifteen minutes.
            </p>
          </div>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>How it is built</h2>
        <p className={styles.sectionNote}>
          Next.js 15 on the App Router, TypeScript in strict mode, PostgreSQL through Prisma, and a
          private Cloudflare R2 bucket. Authentication is a custom JWT path rather than a library,
          because the point was to be able to account for every line of it.
        </p>

        <div className={styles.facts}>
          <div className={styles.fact}>
            <h3 className={styles.factTitle}>No photograph has a public URL</h3>
            <p className={styles.factBody}>
              Every image is a presigned link that lives five minutes and is issued only after an
              authorization check. The bucket has no public access policy and no custom domain.
            </p>
          </div>
          <div className={styles.fact}>
            <h3 className={styles.factTitle}>Uploads never pass through the server</h3>
            <p className={styles.factBody}>
              The browser uploads straight to storage with a presigned PUT. The API validates
              membership, type and size first, then confirms the object really landed before it
              writes a single row.
            </p>
          </div>
          <div className={styles.fact}>
            <h3 className={styles.factTitle}>404, not 403</h3>
            <p className={styles.factBody}>
              A 403 confirms a thing exists. Anything you are not entitled to know about returns the
              same 404 as an id that was never real.
            </p>
          </div>
          <div className={styles.fact}>
            <h3 className={styles.factTitle}>One place decides access</h3>
            <p className={styles.factBody}>
              Every query takes the actor and spreads a scope from a single policy module. Nothing
              fetches broadly and filters afterwards.
            </p>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        Built for the TrizenAI full-stack internship challenge. The architecture notes, the six
        decision records and an honest list of what I would fix next are in the repository
        {repoUrl ? (
          <>
            {' '}
            <a href={repoUrl} target="_blank" rel="noreferrer">
              README
            </a>
            .
          </>
        ) : (
          ' README.'
        )}
      </footer>
    </div>
  )
}
