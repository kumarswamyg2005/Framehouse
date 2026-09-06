# Framehouse

A photo-sharing platform for event and wedding photography teams. A lead creates
an event and adds the people shooting it; each of them uploads their frames and
sees only their own; the lead reviews everything on a contact sheet, marks the
selects, and publishes them to a PIN-protected gallery the client opens from a
link without ever making an account.

The thing that shaped most of the decisions here is that photographs are private
by default. Not one image in this application is reachable from a public URL —
every thumbnail and every full-resolution original is delivered through a
presigned link with a five-minute life, minted only after an authorization check
that names who is asking. The storage bucket has no public access policy and no
custom domain bound to it, so there is no second way in.

Built for the TrizenAI full-stack internship challenge.

---

## Live demo

| | |
|---|---|
| **Application** | _fill in after deployment_ |
| **Repository** | _fill in_ |

**Demo credentials**

| Role | Email | Password |
|---|---|---|
| Lead / Admin | `admin@demo.test` | `demo-admin-pass-2026` |
| Team member | `nikhil@demo.test` | `demo-member-pass-2026` |
| Team member | `sana@demo.test` | `demo-member-pass-2026` |
| Member on no events | `idle@demo.test` | `demo-member-pass-2026` |

**Client gallery** — `<app-url>/g/<slug>` with PIN `482917`. The seed prints the
slug when it runs.

`idle@demo.test` exists so the scoping rules are demonstrable rather than
vacuously true: sign in as them and the event list is empty, because they are
assigned to nothing.

---

## The entry page

Opening the deployed URL lands on a page that explains what the product is, walks
the shoot through all three roles, and lists the demo credentials — so an
evaluator can get in without reading this file first.

It has no photographs on it, deliberately. Every image in this application is a
presigned URL minted after an authorization check that names who is asking, and
nobody has been authorized on the entry page. A hero image would have meant
carving an exception into the first invariant, so the page is typographic and the
photographs start one screen in.

The demo credentials block renders only when `DEMO_MODE="true"` **and** the
seeded admin account owns a published gallery. Both the intent and the data have
to line up; a production deployment fails the first condition on its own.

That switch is deliberately separate from the `SEED_*` variables rather than
inferred from them. Seed variables are meant to be removed after seeding, which
is a manual step, and treating their presence as consent would have meant that
forgetting one published a real client's gallery link on the front page. Safety
should not depend on remembering to tidy up.

The card in the hero shows the *shape* of a delivery — title, link, and six
masked digits — and never the PIN itself, because the note beside it says a
client receives the link and the PIN separately. Printing both together would
have contradicted the one sentence explaining the feature.

## What each role can do

**Lead (admin).** Registers, creates events, adds team members by email — the
account is created for them with a one-time temporary password if they do not
have one. Reviews every frame uploaded to their event, selects a subset,
publishes it behind a six-digit PIN, and gets a shareable link. Can unpublish at
any time, which revokes client access on the next request.

**Team member.** Signs in, sees only the events they are assigned to, uploads
photos, and sees only their own uploads — including on an event two members are
shooting together. Cannot publish, cannot see or delete anyone else's frames,
and cannot see an event they are not on.

**Client.** No account. Opens the link, enters the PIN, browses the published
photos in a lightbox. Sees exactly the frames that were selected, and nothing
else in the event.

---

## Stack, and why

| Choice | Why this one |
|---|---|
| **Next.js 15, App Router** | Server Components let authorization run where the data is fetched rather than in a client that has already received the rows. One deployable unit for UI and API — appropriate at this size, and it keeps the auth path short enough to read in one sitting. |
| **TypeScript, `strict` + `noUncheckedIndexedAccess`** | The extra flag matters here: array indexing returns `T \| undefined`, which caught real gaps in the keyboard navigation and PIN input code. |
| **PostgreSQL on Neon** | The data is relational — events own photos, memberships are a join table, gallery selection is a join table with ordering. Neon's free tier gives a real managed Postgres with branching, and serverless drivers that suit Vercel's connection model. |
| **Prisma** | Typed queries mean an actor-scoped `where` fragment is checked at compile time, so `visibleEventWhere(actor)` cannot silently drift from the schema. Its migration files give the repo a reviewable SQL history. |
| **Cloudflare R2 via the S3 SDK** | S3-compatible, so the storage layer is standard and portable, but with no egress fees — the whole product is bulk image delivery, and egress is what makes that expensive elsewhere. Because it is S3-compatible, local development runs against MinIO through the same code. |
| **Custom JWT auth (`jose`) + argon2id** | Deliberately not NextAuth. The auth path is about 150 lines and I can account for every one of them — token audiences, cookie flags, the decoy hash on login. For a challenge graded on security, a dependency I could only describe from its docs would be worse than code I wrote. |
| **argon2id via `@node-rs/argon2`** | Memory-hard, the current OWASP recommendation, and used for both account passwords and gallery PINs. Native bindings, so hashing does not block the event loop the way a pure-JS implementation would. |
| **zod** | Every route handler parses its input through a schema. No handler reads `request.json()` and indexes into the result. |
| **sharp** | Thumbnails at write time. It also does double duty as content verification — bytes that do not decode as an image are rejected and deleted. |
| **Vitest + Playwright** | Vitest for the authorization and validation logic against a real Postgres; Playwright for one end-to-end pass through the actual workflow in a browser. |
| **Plain CSS Modules** | No Tailwind, no component library. The design is specific (see `DESIGN.md`) and writing it directly was less work than overriding someone else's defaults. |

---

## Architecture

```mermaid
flowchart TB
    subgraph Browser
        WS["Workspace (dark)<br/>lead + team member"]
        GAL["Client gallery (light)<br/>no account"]
    end

    subgraph Vercel["Vercel — Next.js 15"]
        RSC["Server Components<br/>render with actor-scoped data"]
        API["Route handlers<br/>zod on every input"]
        POLICY["lib/auth/policy.ts<br/>every authorization decision"]
    end

    NEON[("Neon Postgres<br/>users, events, photos,<br/>galleries, PIN attempts")]
    R2[("Cloudflare R2<br/>PRIVATE bucket")]

    WS -->|"session cookie<br/>httpOnly, SameSite=Lax"| RSC
    WS --> API
    GAL -->|"gallery cookie<br/>scoped to one slug, 2h"| API

    RSC --> POLICY
    API --> POLICY
    POLICY --> NEON

    API -->|"mints presigned PUT<br/>only after authz"| R2
    WS -.->|"direct upload<br/>never through the API"| R2
    API -->|"mints presigned GET<br/>5 minute TTL"| R2
    WS -.->|"image bytes"| R2
    GAL -.->|"image bytes"| R2
```

Two things this diagram is trying to make obvious. Image bytes (dotted) never
pass through the application server — it only ever hands out short-lived,
signed permission to talk to storage directly. And both the rendering path and
the API path funnel through the same policy module, so there is one definition
of who can see what rather than one per entry point.

### The upload sequence

```mermaid
sequenceDiagram
    participant B as Browser
    participant A as API
    participant DB as Postgres
    participant S as R2

    B->>A: POST presign {filename, mimeType, fileSize}
    A->>A: membership + MIME allowlist + 25 MB cap
    A->>B: {uploadUrl, storageKey}
    Note over A,B: key is events/{eventId}/{uuid}.{ext}<br/>never the user's filename

    B->>S: PUT bytes (direct, with progress)
    S->>B: 200

    B->>A: POST confirm {storageKey, filename}
    A->>S: HeadObject
    S->>A: real size + content type
    A->>S: GET original, decode, resize to 480w webp
    A->>S: PUT thumbnail
    A->>DB: INSERT Photo
    A->>B: 201
```

No database row exists until `HeadObject` proves the object is really there. An
upload that dies at any point before `confirm` leaves an unreferenced object in
storage — cheap and sweepable — rather than a row pointing at bytes that never
arrived.

---

## Data model

```mermaid
erDiagram
    User ||--o{ Event : "owns"
    User ||--o{ EventMember : "assigned via"
    User ||--o{ Photo : "uploaded"
    Event ||--o{ EventMember : "roster"
    Event ||--o{ Photo : "contains"
    Event ||--o| Gallery : "has one"
    Gallery ||--o{ GalleryPhoto : "selection"
    Photo ||--o{ GalleryPhoto : "selected in"

    User {
        string id PK
        string email UK
        string passwordHash "argon2id"
        string name
        enum role "ADMIN | MEMBER"
        datetime createdAt
    }
    Event {
        string id PK
        string name
        string description "nullable"
        datetime date "nullable"
        string ownerId FK
        datetime createdAt
    }
    EventMember {
        string id PK
        string eventId FK
        string userId FK
        datetime addedAt
    }
    Photo {
        string id PK
        string eventId FK
        string uploadedById FK
        string originalFilename "metadata only"
        string storageKey UK "events/{eventId}/{uuid}.{ext}"
        string thumbnailKey "nullable"
        string mimeType
        int fileSize
        int width "nullable"
        int height "nullable"
        enum status "PENDING | READY | FAILED"
        datetime createdAt
    }
    Gallery {
        string id PK
        string eventId FK,UK
        string slug UK "12-char nanoid"
        string title
        string pinHash "argon2id"
        boolean isPublished
        datetime publishedAt "nullable"
        datetime expiresAt "nullable"
    }
    GalleryPhoto {
        string galleryId PK,FK
        string photoId PK,FK
        int position
    }
    PinAttempt {
        string id PK
        string gallerySlug "not a FK, by design"
        string ipHash "sha256(salt + ip)"
        datetime attemptedAt
        boolean succeeded
    }
```

Two notes on shape:

`PinAttempt.gallerySlug` is deliberately **not** a foreign key. Attempts against
slugs that do not resolve still have to be counted — otherwise the rate limiter
itself would tell an attacker which galleries exist.

`Photo.uploadedBy` is `onDelete: Restrict` while everything else cascades. A
member's frames may already be published to a client; removing the person should
not remove the wedding photographs.

---

## Security model

Ten invariants hold for every request. They are written out in full at the top
of [`lib/auth/policy.ts`](lib/auth/policy.ts), and each one has a test.

**Nothing is public.** Every image is a presigned GET with a 300-second TTL,
minted after an authorization check. The bucket has no public access policy.
A URL copied out of a browser's network tab is dead within five minutes.

**Uploads never touch the API.** The browser PUTs straight to storage using a
presigned URL, and the presign endpoint validates event membership, the MIME
allowlist (`image/jpeg`, `image/png`, `image/webp`) and a 25 MB cap *before* it
signs anything. The `Content-Type` a client asks to sign is not evidence of
anything, so `confirm` decodes the bytes with sharp — a file that does not
decode as an image is deleted and the upload refused.

**Object keys are opaque.** `events/{eventId}/{uuid}.{ext}`, built server-side.
The user's filename is stored as a metadata column and never reaches storage,
so path traversal and overwrite-by-name are not reachable states.

**Authorization is in one file.** Every data function takes the actor and
spreads a policy-provided `where` fragment into its query. There is no "fetch
then filter in the component" anywhere in the codebase — a member's photo list
is narrowed in SQL, not in React.

**404, not 403, for anything you shouldn't know exists.** A 403 confirms a
resource is real. A member assigned to an event who tries to publish it gets
403, because they can already see it. A member who is not assigned gets 404 for
the same request — identical to a genuinely nonexistent id.

**Two token families that cannot be confused.** Session tokens and gallery
tokens differ in their `aud` claim and are verified against a pinned audience,
so a gallery cookie fails verification outright at an authenticated endpoint
rather than relying on some later check to catch it. The gallery token is scoped
to a single slug for two hours.

**Sessions are re-validated, not just verified.** The user row is re-read on
every request. A signed token proves a past login, not present standing, so a
deleted or demoted account loses access immediately instead of at token expiry.

**Both unauthenticated entry points are throttled.** The gallery PIN allows five
failures per gallery per IP per fifteen minutes; sign-in allows ten per email
per IP. Both then return 429 with `Retry-After`. Counting and recording happen
under a Postgres advisory lock keyed on the subject, so simultaneous requests
cannot both read the same count and both slip through — and unlike a
`SERIALIZABLE` transaction there is no abort to retry and therefore no way to
fail open. Subjects and IPs are salted-hashed before they are written down, so
the throttle table cannot be read back as a list of who has an account.

**Neither endpoint leaks existence.** An unknown email is verified against a
decoy hash rather than returning early, so a missing account costs the same
wall-clock time as a wrong password — and unknown emails are throttled exactly
like known ones, so the limiter's own behaviour does not become an oracle. The
same is true of gallery slugs that do not resolve.

**Uploaded bytes are checked, not just their label.** `Content-Type` is bound
into the presigned PUT signature, but it is still only a claim, so `confirm`
reads the first 32 bytes of the stored object and matches the file signature
against the JPEG, PNG and WebP magic numbers. Full decoding happens during
finalisation; anything that does not decode has its object deleted and its row
marked `FAILED`, and neither a `PENDING` nor a `FAILED` photo can be selected
into a gallery.

**Revocation is a live read.** Unpublishing a gallery or clearing its selection
takes effect on the client's next request. Nothing about publication state is
baked into the token.

**Changing a PIN strands the old sessions.** `Gallery.pinVersion` increments on
every publish and on unpublish, and the gallery JWT carries that number. A token
minted under the previous PIN stops verifying immediately — otherwise a
photographer changing a leaked PIN would leave whoever had it with up to two
hours of access.

**Response headers.** A Content-Security-Policy that names the storage origin
explicitly for `img-src` and `connect-src` and nothing else, plus `nosniff`,
`X-Frame-Options: DENY`, `frame-ancestors 'none'` (a PIN-protected gallery
should not be embeddable), `strict-origin-when-cross-origin`, HSTS, and
`Cache-Control: no-store` on every API response so presigned URLs never reach a
shared cache.

---

## Running it locally

You need Node 20+ and Docker.

```bash
git clone <repo> && cd framehouse
npm ci
cp .env.example .env          # then fill it in — see the table below
npm run setup                 # docker compose up, migrate, create buckets, seed
npm run dev
```

`npm run setup` starts Postgres and MinIO in Docker, applies the migrations,
creates the buckets, and seeds the demo workspace — an admin, three members, the
"Arjun & Priya Wedding" event with 30 photographs, and a published gallery of 12.
It prints the gallery URL when it finishes.

MinIO stands in for R2 locally. It speaks the same S3 API, so nothing below
`lib/storage/r2.ts` changes between the two; moving to R2 is a change of
environment variables. The MinIO console is at http://localhost:9001.

For local development you can copy these straight into `.env`:

```
DATABASE_URL="postgresql://framehouse:framehouse@localhost:5433/framehouse"
DIRECT_URL="postgresql://framehouse:framehouse@localhost:5433/framehouse"
JWT_SECRET="<openssl rand -base64 48>"
IP_HASH_SALT="<openssl rand -base64 24>"
R2_ACCOUNT_ID="local"
R2_ACCESS_KEY_ID="framehouse"
R2_SECRET_ACCESS_KEY="framehouse-dev-secret"
R2_BUCKET="framehouse-dev"
R2_ENDPOINT="http://localhost:9000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
SEED_ADMIN_EMAIL="admin@demo.test"
SEED_ADMIN_PASSWORD="demo-admin-pass-2026"
SEED_MEMBER_PASSWORD="demo-member-pass-2026"
SEED_GALLERY_PIN="482917"
```

### Environment variables

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. On Neon, the **pooled** URL. |
| `DIRECT_URL` | yes on Neon | Unpooled URL. Prisma migrations need a direct connection. |
| `JWT_SECRET` | yes | HMAC key for both token families. 32 characters minimum; `openssl rand -base64 48`. Rotating it signs everyone out. |
| `IP_HASH_SALT` | yes | Salt for hashing client IPs in `PinAttempt`. 16 characters minimum. |
| `R2_ACCOUNT_ID` | yes | Cloudflare account id. Used to derive the endpoint when `R2_ENDPOINT` is unset. |
| `R2_ACCESS_KEY_ID` | yes | R2 API token key id. |
| `R2_SECRET_ACCESS_KEY` | yes | R2 API token secret. |
| `R2_BUCKET` | yes | Bucket name. Must be private. |
| `R2_ENDPOINT` | no | Overrides the derived endpoint. Set to `http://localhost:9000` for MinIO. |
| `NEXT_PUBLIC_APP_URL` | yes | Absolute origin, no trailing slash. Used to build shareable gallery links. |
| `NEXT_PUBLIC_REPO_URL` | no | Linked from the entry page footer. |
| `DEMO_MODE` | no | `"true"` makes the entry page show demo credentials and link the seeded gallery. **Leave unset on any deployment with real clients.** |
| `SEED_ADMIN_EMAIL` | seed only | Defaults to `admin@demo.test`. |
| `SEED_ADMIN_PASSWORD` | seed only | Never set in production. |
| `SEED_MEMBER_PASSWORD` | seed only | Never set in production. |
| `SEED_GALLERY_PIN` | seed only | Six digits. Never set in production. |

### Commands

| | |
|---|---|
| `npm run dev` | Development server |
| `npm run setup` | Docker, migrate, buckets, seed — one command from a clean clone |
| `npm test` | Vitest integration suite against the test database |
| `npm run test:e2e` | Playwright end-to-end pass (builds and starts the app) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Create a migration from a schema change |
| `npm run db:deploy` | Apply committed migrations |
| `npm run db:seed` | Reseed the demo workspace |
| `npm run preflight` | Check env, database and storage before a deploy — including that the bucket refuses an unsigned read |

---

## Tests

```bash
npm test          # 67 integration tests
npm run test:e2e  # 1 end-to-end pass through the whole workflow
```

The integration suite runs against a real Postgres database, not mocks, because
most of what is being tested *is* a query — an authorization rule expressed as a
`where` clause is only correct if the database agrees.

What it covers:

- A member cannot list or open an event they are not assigned to → `404`.
- A member cannot see another member's photos on a shared event.
- A member attempting an owner action gets `403`; a stranger gets `404`.
- Presign refuses a 40 MB file and a non-image MIME type before signing.
- Confirm writes no row when the object is absent, when the key belongs to
  another event, or when the bytes do not decode as an image.
- Wrong PIN fails; the sixth attempt is rate-limited with `Retry-After`; the
  limit is per IP; republishing clears it.
- Changing the PIN moves the gallery's PIN generation forward, so a token issued
  under the old one no longer verifies.
- Sign-in locks out after ten failures, per email and per IP, and unknown
  addresses are counted the same as known ones.
- Sixteen simultaneous sign-in attempts do not exceed the configured ceiling.
- The customer gallery pages, and walking every page yields each selected photo
  exactly once, in order.
- `confirm` returns a `PENDING` row; finalisation produces a thumbnail and
  `READY`, or deletes the object and marks `FAILED` when the bytes do not
  decode. Neither state can reach a gallery.
- A correct PIN returns exactly the selected photos, and an unselected photo id
  from the same event returns `404`.
- Unpublishing, or emptying the selection, revokes an already-issued cookie.
- argon2id verifies, salts, and fails closed on a corrupt hash.
- Session and gallery tokens cannot be substituted for one another.
- No password hash appears in any actor-facing payload.

The Playwright test drives the brief's workflow in a real browser with nothing
stubbed: the lead registers, creates an event, adds a member, the member signs
in with their temporary password and uploads real JPEGs through the presigned
PUT path, the lead selects and publishes, and a third browser context with no
session opens the link, gets the wrong-PIN message, then enters the right one
and sees exactly the selected count.

---

## Deployment

**Database — Neon.** Create a project, copy the pooled connection string into
`DATABASE_URL` and the direct one into `DIRECT_URL`. Migrations run on build via
`prisma migrate deploy`.

**Storage — Cloudflare R2.** Create a bucket. Leave public access disabled and
do not attach a custom domain — the application never needs one, and attaching
one would undo the first invariant. Create an API token scoped to Object Read &
Write for that bucket. Then add a CORS policy so the browser can PUT directly:

```json
[
  {
    "AllowedOrigins": ["https://your-app.vercel.app"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

**Application — Vercel.** Import the repository, set every variable from the
table above, and deploy. `npm run build` runs `prisma generate` first.

**Full runbook, including the CORS policy, the seeding step and a smoke-test
checklist: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).**

Before and after deploying, run `npm run preflight`. It verifies the
environment, that the database is reachable and migrated, and that an unsigned
read of a stored object is refused — the invariant everything else rests on.

---

## Known limitations

These are real, and I would fix them roughly in this order.

**1. Thumbnail generation runs after the response, not in a queue.** `confirm`
now returns as soon as the row is written, and the decode and resize happen in
Next's `after()` — so the request is fast and a burst of uploads no longer means
a burst of requests each held open while sharp works. But the work still happens
inside the same serverless invocation, so total compute is unchanged and a
single instance can still be saturated. A real queue with a separate worker is
the next step; the `PhotoStatus` enum and `finalisePhoto()` are already shaped
for it, so it is a change of trigger rather than a rewrite.

**2. Attempt rows are never pruned.** `pruneAttempts()` exists and is correct,
but nothing calls it on a schedule. On a busy deployment `AccessAttempt` grows
without bound. A Vercel cron hitting a route that calls it is about ten lines; I
did not add the route because it needs a shared secret and a cron config that
would be dead weight in a demo.

**3. Presigned URLs expire while a gallery is still open.** Five minutes is a
deliberately tight TTL, and the client-side answer is currently a page reload
just before they lapse. That is honest but crude — a client scrolling a large
gallery will see it reload under them. Refreshing individual URLs in the
background as they approach expiry, or raising the TTL for thumbnails only,
would both be better.

**4. Deleting an event leaves its objects in the bucket.** The cascade is only
in the database. The fix is either a lifecycle rule on a prefix or a sweep that
reconciles keys against rows; both need a scheduled job, which is limitation 2
again.

Smaller things I am aware of: there is no download-all; the CSP still carries
`'unsafe-inline'` in `style-src` because Next injects inline styles for fonts
and CSS modules, and removing it needs nonce plumbing; and there is no email
delivery, so a temporary password is shown once in the UI for the lead to pass
on by hand.

## Repository map

```
app/
  page.tsx                   entry page — what it is, how it works, demo logins
  api/                       route handlers, zod-validated, one error envelope
  events/                    the workspace — contact sheet, uploader, publishing
  g/[slug]/                  the client gallery — PIN gate, masonry, lightbox
  login/  register/
components/                  shared UI
lib/
  auth/
    policy.ts                every authorization decision, and the invariants
    session.ts               cookies, actor resolution, gallery grants
    jwt.ts                   two token families, separated by audience
    hash.ts                  argon2id
  data/                      actor-scoped queries — events, photos, galleries
  storage/r2.ts              the only file that knows about S3
  rate-limit.ts              PIN throttling
  http.ts                    error envelope, handler wrapper, body parsing
  schemas.ts                 every input schema
prisma/
  schema.prisma              7 models
  migrations/                committed SQL history
  seed.ts                    the demo workspace
tests/
  *.test.ts                  integration suite
  e2e/                       Playwright
docs/
  ARCHITECTURE.md            how a request flows, and why the layers are here
  DECISIONS.md               six ADRs
  DEPLOYMENT.md              runbook, CORS policy, smoke test, failure modes
  INTERVIEW.md               my own prep notes, not a deliverable
DESIGN.md                    the design system this UI is built to
```
