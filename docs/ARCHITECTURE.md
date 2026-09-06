# Architecture

How a request moves through this application, and why the layers are where they
are.

## The shape

There are four layers, and the rule is that each one may only call downward.

```
app/                route handlers and server components — HTTP and rendering
  ↓
lib/data/           actor-scoped queries. Takes an Actor, returns rows.
  ↓
lib/auth/policy.ts  every authorization decision in the codebase
  ↓
Prisma / R2         the database and object storage
```

The load-bearing constraint is that **nothing in `app/` talks to Prisma
directly**. If a route handler could write its own query, then authorization
would live in as many places as there are handlers, and the day someone adds a
fifth one is the day a scope gets forgotten. Instead every entry point calls a
function in `lib/data/`, and every function in `lib/data/` starts by handing the
actor to `lib/auth/policy.ts`.

This is what makes the security model auditable. To answer "can a team member
read another member's photographs", you read one function — `visiblePhotoWhere`
— rather than tracing every code path that returns a photo.

## Two entry points, one policy

Next's App Router gives two ways into the same data: a Server Component
rendering a page, and a route handler answering `fetch`. Both are used here, and
both go through the same functions.

The event page renders its first page of photographs on the server, because that
is one round trip instead of three and the markup arrives already scoped to the
viewer. The client then takes over for anything interactive — uploading,
selecting, paginating — through the route handlers. The two paths return the
same rows because they call the same `listPhotos(actor, eventId, …)`.

The one difference is how failure is expressed. A route handler throws an
`ApiError` and the wrapper in `lib/http.ts` turns it into
`{ error: { code, message } }` with a status. A server component cannot do that,
so `lib/page.ts` bridges: a `NOT_FOUND` from policy becomes Next's `notFound()`
and renders the 404 page. Same decision, two renderings of it.

## Actors and scopes

An `Actor` is `{ id, email, name, role }` — resolved from the session cookie on
every request by re-reading the user row, not by trusting the token's claims. A
signed token proves someone logged in at some point; it does not prove they are
still an employee.

Policy exposes two kinds of thing:

**Scope fragments** — `visibleEventWhere(actor)`, `visiblePhotoWhere(actor,
eventId)` — return Prisma `where` objects that callers spread into their own
queries. This is how listing stays scoped without a separate "filter" step. A
member's photo list is narrowed by SQL; the rows that belong to their colleague
are never loaded, never serialised, never sent.

**Guards** — `requireEventAccess`, `requireEventOwner`, `requirePhotoAccess`,
`requireGalleryPhoto` — resolve a single record under the actor's scope and
throw if it does not resolve. Because the scope is inside the query, "you may
not see this" and "this does not exist" are the same empty result, which is what
makes the 404-not-403 rule structural rather than a thing to remember.

`requireEventOwner` is the one guard that deliberately distinguishes them: an
assigned member gets `FORBIDDEN` (they can see the event, so a 403 leaks
nothing), and anyone else gets `NOT_FOUND`.

## The customer path is not an actor

Nothing on the client gallery path takes an `Actor`, because a customer is not a
user — there is no row for them anywhere. A gallery token is not an identity, it
is a receipt: proof that someone typed the correct PIN for one specific slug
within the last two hours.

It is kept separate from the session mechanism in three ways at once. Different
cookie name, per gallery. Different JWT audience, so verification of one fails
outright against the other rather than depending on a downstream check. And a
different code path — `getPublicGallery(slug)` and `requireGalleryPhoto(slug,
photoId)` take a slug, never an actor, and reach photographs only through the
`GalleryPhoto` join.

That join is doing the real work. A photograph that exists, belongs to the same
event, and simply was not selected does not satisfy
`galleryLinks: { some: { gallery: publishedGalleryWhere(slug) } }`, so it has no
URL to hand out and returns 404. Publication state is read live inside that same
`where`, which is why unpublishing revokes access on the next request rather
than at token expiry.

## Where image bytes go

Never through the application. This is the single most important property of the
design and it is worth being precise about.

**Upload.** The browser asks for a presigned PUT. The API checks membership,
MIME type and size, generates the key itself as `events/{eventId}/{uuid}.{ext}`,
and returns a URL valid for ten minutes with `ContentType` and `ContentLength`
baked into the signature. The browser PUTs the bytes directly to storage. Then
it calls `confirm`, which runs `HeadObject` to prove the object arrived, reads
the bytes back once to decode and resize them, writes the thumbnail, and only
then inserts the `Photo` row.

The ordering matters: the row is the last thing written. Every earlier failure
leaves an unreferenced object in the bucket — cheap, and sweepable by a
lifecycle rule — rather than a row pointing at bytes that never landed.

**Download.** Every image URL in this application is a presigned GET with a
300-second TTL, produced after the authorization check that decided the caller
may see that photograph. There is no public bucket policy, no custom domain, and
no image-optimisation proxy in the path — `next/image` is deliberately switched
off, because its optimiser would need to fetch and cache those URLs and would
become a second, unauthenticated way to reach the bytes.

## Rate limiting without another service

PIN attempts are counted in Postgres, in the `PinAttempt` table, keyed by
`(gallerySlug, ipHash, attemptedAt)`. Five failures per gallery per IP per
fifteen minutes.

Two details are deliberate. The key is the **slug**, not a gallery id, so
attempts against slugs that do not resolve are still recorded — otherwise the
limiter would refuse to count attacks on nonexistent galleries and, worse, its
behaviour would differ between real and imaginary slugs and become an oracle.
And IPs are hashed with a server-side salt before storage, so the table can
answer "has this client failed five times" without holding an address that would
identify a visitor if the database leaked.

The trade-off is honest and recorded in the README: this is not atomic, so two
simultaneous attempts can both observe four failures and both proceed. For a
six-digit PIN backed by argon2id, "about five" is an acceptable ceiling. It
would not be for a general-purpose limiter.

## Failure and error shape

One envelope, everywhere: `{ error: { code, message } }`. Codes are
`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `RATE_LIMITED`,
`UPLOAD_FAILED`, `CONFLICT`, `INTERNAL`, each mapped to a status in one table.

Handlers are wrapped by `handler()`, which catches `ApiError` and `ZodError` and
renders them. An unexpected exception is logged server-side with its detail and
returned as a generic `INTERNAL` — a stack trace is a map of the codebase and
does not belong in a response body.

Messages are written for the person who will read them in a toast, and never
contain anything the caller was not already entitled to know. "That PIN doesn't
match" is the same sentence whether the PIN was wrong or the gallery does not
exist, and both cost the same amount of work.

## What would change at scale

The seams are already where they need to be.

**Thumbnails** move from synchronous generation inside `confirm` to a queue.
`PhotoStatus.PENDING` exists for this: write the row immediately, enqueue the
key, let a worker produce the thumbnail and flip it to `READY`.

**Photo listing** already uses cursor pagination rather than offset — deliberate,
because a contact sheet is appended to while it is being scrolled and `OFFSET`
would skip or repeat frames as rows shift underneath it. The index
`[eventId, createdAt]` supports it directly.

**The customer gallery** currently presigns every selected photograph on load.
At 600 photographs that is 600 signings per page view; it should paginate the
same way the workspace sheet does.

**Rate limiting** moves to Redis, or to `SELECT ... FOR UPDATE`, if it ever
guards something more valuable than a PIN.
