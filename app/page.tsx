import Link from 'next/link'
import { getActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import styles from './landing.module.css'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Framehouse — shoot, cull, and deliver event photography',
  description:
    'A photo-sharing platform for event and wedding photography teams. The team uploads, the lead selects, the client opens a PIN-protected gallery.',
}

/**
 * There is not a single photograph on this page, and that became the design.
 *
 * Every image in this application is delivered by a presigned URL minted after
 * an authorization check that names who is asking. Nobody has been authorized
 * here, so a hero image would have meant carving an exception into the first
 * invariant. Instead the hero renders the thing a contact sheet is *before* it
 * is printed — the structure, the gutters, the frame numbers, and nothing in
 * them. The photographs start one screen in, once you are someone.
 */

const HERO_FRAMES = 30
const MARKED_FRAMES = new Set([1, 4, 8, 13, 14, 19, 22, 27])

const STEPS = [
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
        Each uploads their own frames, straight from the browser to storage. They are on the same
        wedding and <strong>cannot see each other&rsquo;s photographs</strong> — that scoping is a
        SQL clause, not a hidden button. Neither can publish.
      </>
    ),
  },
  {
    who: 'Meera',
    role: 'Lead',
    what: (
      <>
        Reviews all of it on one contact sheet and marks the selects with{' '}
        <strong>click, space, or shift+click</strong> for a range — then publishes them behind a
        six-digit PIN and gets a link.
      </>
    ),
  },
  {
    who: 'Arjun and Priya',
    role: 'Client',
    what: (
      <>
        Open the link with <strong>no account at all</strong>, type the PIN, and see exactly the
        frames that were chosen. An unselected photograph from the same event is unreachable, even
        with its id in hand.
      </>
    ),
  },
]

const FACTS = [
  {
    title: 'No photograph has a public URL',
    body: 'Every image is a presigned link that lives five minutes and is issued only after an authorization check. The bucket has no public access policy and no custom domain.',
  },
  {
    title: 'Uploads never pass through the server',
    body: 'The browser uploads straight to storage with a presigned PUT. The API validates membership, type and size before it signs anything, then confirms the object really landed before writing a row.',
  },
  {
    title: '404, never 403',
    body: 'A 403 confirms a thing exists. Anything you are not entitled to know about returns the same 404 as an id that was never real — and it is the query scope that makes those identical.',
  },
  {
    title: 'One place decides access',
    body: 'Every query takes the actor and spreads a scope from a single policy module. Nothing in this codebase fetches broadly and filters afterwards.',
  },
]

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
    <>
      <div className="grain" aria-hidden="true" />

      <div className={styles.page}>
        <div className={styles.shell}>
          <header className={styles.bar}>
            <span className={styles.wordmark}>Framehouse</span>
            <nav className={styles.barRight}>
              <a className={styles.barLink} href="#how">
                How it works
              </a>
              {gallery && (
                <a className={styles.barLink} href="#try">
                  Demo logins
                </a>
              )}
              <Link className={styles.barLink} href={actor ? '/events' : '/login'}>
                {actor ? 'Your events' : 'Sign in'}
              </Link>
            </nav>
          </header>

          <section className={styles.hero}>
            <div className={styles.heroContent}>
              <p className={styles.eyebrow}>
                <span className={styles.eyebrowRule} />
                For event and wedding teams
              </p>
              <h1 className={styles.title}>
                Shoot together. Cull on one sheet.{' '}
                <span className={styles.titleDim}>Hand over a link.</span>
              </h1>
              <p className={styles.lede}>
                Everyone on the shoot uploads to the same event and sees only their own frames. The
                lead reviews all of it in one place, picks the selects, and publishes them to a
                PIN-protected gallery the client opens without ever making an account.
              </p>
              <div className={styles.actions}>
                <Link className={styles.solid} href={actor ? '/events' : '/login'}>
                  {actor ? 'Go to your events' : 'Sign in to the demo'}
                  <span className={styles.arrow}>→</span>
                </Link>
                {gallery && (
                  <Link className={styles.ghost} href={`/g/${gallery.slug}`}>
                    Open a client gallery
                    <span className={styles.arrow}>→</span>
                  </Link>
                )}
              </div>
            </div>

            {/* Empty frames. See the note at the top of this file. */}
            <div className={styles.sheetWrap} aria-hidden="true">
              <div className={styles.sheet}>
                {Array.from({ length: HERO_FRAMES }, (_, i) => (
                  <div className={styles.cell} key={i}>
                    <div
                      className={`${styles.frame} ${
                        MARKED_FRAMES.has(i) ? styles.frameMarked : ''
                      }`}
                      // Staggered so the sheet comes up like a print in a tray
                      // rather than switching on all at once.
                      style={{ animationDelay: `${120 + i * 26}ms` }}
                    />
                    <span className={styles.frameNo}>{String(i + 1).padStart(3, '0')}</span>
                  </div>
                ))}
              </div>
              <p className={styles.sheetCaption}>
                <span>Contact sheet · {HERO_FRAMES} frames</span>
                <span className={styles.sheetCaptionMark}>{MARKED_FRAMES.size} selected</span>
              </p>
            </div>
          </section>

          <section className={styles.section} id="how">
            <div className={`${styles.sectionHead} reveal`}>
              <p className={styles.sectionLabel}>The workflow</p>
              <div>
                <h2 className={styles.sectionTitle}>How a shoot moves through it</h2>
                <p className={styles.sectionNote}>
                  Three roles, one direction of travel. Every rule below is enforced in the
                  database, not in the interface — which is why you cannot get around one by
                  guessing a URL.
                </p>
              </div>
            </div>

            <ol className={styles.steps}>
              {STEPS.map((step, index) => (
                <li className={`${styles.step} reveal`} key={index}>
                  <div className={styles.stepIndex}>
                    <span className={styles.stepNumeral}>{index + 1}</span>
                    <span className={styles.stepWho}>
                      {step.who}
                      <span className={styles.stepRole}>{step.role}</span>
                    </span>
                  </div>
                  <p className={styles.stepWhat}>{step.what}</p>
                </li>
              ))}
            </ol>
          </section>

          {gallery && (
            <section className={styles.section} id="try">
              <div className={`${styles.sectionHead} reveal`}>
                <p className={styles.sectionLabel}>Demo access</p>
                <div>
                  <h2 className={styles.sectionTitle}>Sign in as any of them</h2>
                  <p className={styles.sectionNote}>
                    This deployment is seeded with a fictional wedding — {gallery._count.photos}{' '}
                    photographs selected out of thirty. The same event looks completely different
                    depending on who is looking at it.
                  </p>
                </div>
              </div>

              <div className={`${styles.demo} reveal`}>
                <div className={styles.demoHead}>
                  <span className={styles.demoHeadTitle}>Demo credentials</span>
                  <span>Seeded data. Nothing here is a real person.</span>
                </div>

                <div className={styles.rows}>
                  <div className={styles.row}>
                    <span className={styles.rowWho}>
                      The lead
                      <span className={styles.rowNote}>Sees all 30 frames, can publish</span>
                    </span>
                    <span className={`${styles.value} ${styles.valueStrong}`}>admin@demo.test</span>
                    <span className={styles.value}>demo-admin-pass-2026</span>
                  </div>

                  <div className={styles.row}>
                    <span className={styles.rowWho}>
                      A team member
                      <span className={styles.rowNote}>Sees only the frames he uploaded</span>
                    </span>
                    <span className={`${styles.value} ${styles.valueStrong}`}>nikhil@demo.test</span>
                    <span className={styles.value}>demo-member-pass-2026</span>
                  </div>

                  <div className={styles.row}>
                    <span className={styles.rowWho}>
                      A second member
                      <span className={styles.rowNote}>Same event, a different half of it</span>
                    </span>
                    <span className={`${styles.value} ${styles.valueStrong}`}>sana@demo.test</span>
                    <span className={styles.value}>demo-member-pass-2026</span>
                  </div>

                  <div className={styles.row}>
                    <span className={styles.rowWho}>
                      Assigned to nothing
                      <span className={styles.rowNote}>Signs in to an empty list</span>
                    </span>
                    <span className={`${styles.value} ${styles.valueStrong}`}>idle@demo.test</span>
                    <span className={styles.value}>demo-member-pass-2026</span>
                  </div>

                  <div className={`${styles.row} ${styles.galleryRow}`}>
                    <span className={styles.rowWho}>
                      The client
                      <span className={styles.rowNote}>No account, link and PIN only</span>
                    </span>
                    <span className={styles.value}>
                      <Link className={styles.galleryLink} href={`/g/${gallery.slug}`}>
                        {gallery.title}
                      </Link>
                      {'  ·  PIN '}
                      <span className={styles.valueStrong}>482917</span>
                    </span>
                  </div>
                </div>

                <p className={styles.demoFoot}>
                  Worth doing in this order: sign in as Nikhil and count the frames, then as the
                  lead and count them again — the lead sees everyone&rsquo;s, Nikhil sees only his.
                  Sign in as <span className={styles.value}>idle@demo.test</span> and the event list
                  is empty, because that account is assigned to nothing. Then open the gallery and
                  enter the wrong PIN six times: the sixth is refused for fifteen minutes, and the
                  message never tells you whether the gallery was real.
                </p>
              </div>
            </section>
          )}

          <section className={styles.section}>
            <div className={`${styles.sectionHead} reveal`}>
              <p className={styles.sectionLabel}>Engineering</p>
              <div>
                <h2 className={styles.sectionTitle}>Built so the photographs stay private</h2>
                <p className={styles.sectionNote}>
                  Next.js 15 on the App Router, TypeScript in strict mode, PostgreSQL through
                  Prisma, and a private Cloudflare R2 bucket. Authentication is a custom JWT path
                  rather than a library, because the point was to be able to account for every line
                  of it.
                </p>
              </div>
            </div>

            <div className={styles.facts}>
              {FACTS.map((fact, index) => (
                <div className={`${styles.fact} reveal`} key={fact.title}>
                  <span className={styles.factIndex}>{String(index + 1).padStart(2, '0')}</span>
                  <h3 className={styles.factTitle}>{fact.title}</h3>
                  <p className={styles.factBody}>{fact.body}</p>
                </div>
              ))}
            </div>
          </section>

          <footer className={styles.footer}>
            <p className={styles.sectionLabel}>Colophon</p>
            <p className={styles.footerNote}>
              Built for the TrizenAI full-stack internship challenge. Set in Instrument Serif and
              Inter, with Roboto Mono reserved for frame numbers. The architecture notes, six
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
            </p>
          </footer>
        </div>
      </div>
    </>
  )
}
