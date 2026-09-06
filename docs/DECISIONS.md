# Decision records

Six choices that were not obvious, and what they cost.

---

## 1. Cloudflare R2 rather than S3

**Status:** accepted

The product is bulk image delivery. A wedding gallery is a few hundred
full-resolution photographs that a client opens, scrolls, reopens on a phone,
and forwards to their family — the read pattern is heavy and repetitive, and on
S3 every one of those reads is billed egress. R2 charges nothing for egress at
all. At the scale of this challenge the difference is pennies; at the scale of a
studio with fifty active galleries it is the dominant line on the bill.

R2 is S3-compatible, so the cost of the choice is close to zero: the same AWS
SDK, the same presigning, the same `HeadObject`. Everything that knows about
storage lives in one file, and that file works unchanged against MinIO in local
development, which is how the whole upload path is testable without a cloud
account.

What it costs. R2's consistency and feature surface trail S3's — no lifecycle
rules as mature, no Glacier-style archival tier, fewer regions. None of those
matter for this application today, and if one started to, the migration is
credentials and an endpoint.

The alternative I did not take was storing images in Postgres, which the brief
explicitly rules out and which would be wrong regardless: it puts megabytes
through a connection pool sized for kilobytes.

---

## 2. Custom JWT auth rather than NextAuth

**Status:** accepted

This is the decision I expect to be pushed on hardest, so: NextAuth is a good
library and in a production codebase with a team I would probably reach for it.
I did not here, for two reasons.

The first is that this challenge is graded on security and I will be asked to
explain the auth path in an interview. It is about 150 lines — `hash.ts`,
`jwt.ts`, `session.ts` — and I can account for every one of them: why the cookie
is `httpOnly` and `SameSite=Lax` rather than `Strict`, why login verifies
against a decoy hash when the email is unknown, why the user row is re-read on
every request instead of trusted from the token. "The library does that" is a
worse answer than code I wrote, and a library I could only describe from its
documentation would be a liability in that conversation.

The second is that the requirement is genuinely small. Two roles, email and
password, no OAuth providers, no account linking, no magic links. NextAuth's
adapter layer, session strategies and provider abstraction are all machinery for
problems this application does not have.

What it costs. Real ones. There is no password reset flow, no email
verification, no MFA, no device management, and no session revocation list — the
closest thing is that a deleted user fails the per-request database read. Adding
any of those means writing them. If the product grew a second authentication
method I would migrate rather than extend.

The related choice — two token families separated by their `aud` claim rather
than one token with a scope field — is what makes "a gallery cookie grants zero
access to the authenticated API" a property of signature verification rather
than of remembering to check a field.

---

## 3. Presigned direct upload rather than proxying through the API

**Status:** accepted

The obvious implementation is `POST /api/photos` with a multipart body: the
server receives the bytes, validates them, and forwards them to storage. It is
simpler to write and it is the wrong shape here.

A 25 MB file proxied through the application is 25 MB into a serverless function
that then has to hold it in memory or spool it to disk, and send it on. Vercel's
request body limit would reject it outright, and even where it does not, the
function is billed for the duration of a client's upload — which is a function
of the client's uplink, not of any work being done. A photographer uploading 400
frames from a venue's wifi would hold hundreds of function-seconds open moving
bytes that the server has no reason to look at.

Presigning inverts it. The API's job becomes a small, fast authorization
decision — is this person on this event, is this an allowed type, is it under
the cap — and then it issues a short-lived, narrowly-scoped credential and gets
out of the way. The bytes go browser to storage over a connection the
application never participates in. It also makes per-file progress possible,
which is the difference between a usable multi-file uploader and a spinner.

What it costs, and how it is paid for. Handing a client a credential means
trusting it less, not more, so there are three compensating controls. The
signature bakes in `ContentType` and `ContentLength`, so a client that presigned
a 2 MB JPEG cannot upload a 2 GB video — storage itself rejects the mismatch.
The object key is generated server-side as `events/{eventId}/{uuid}.{ext}`, so
the client cannot choose where its bytes land, cannot traverse a path, and
cannot overwrite an existing object. And the `confirm` step calls `HeadObject`
and writes the database row from what actually arrived rather than from what the
client claimed.

The remaining gap is that `Content-Type` is whatever the client asked to sign —
storage records it without inspecting the bytes. So `confirm` decodes the object
with sharp, and a file that does not decode as an image is deleted and refused.
That check exists because of this decision.

---

## 4. 404 rather than 403 for cross-tenant reads

**Status:** accepted

A 403 says "this exists and you may not have it". That is a disclosure. Given
`GET /api/events/:id`, an attacker who gets 403 for one id and 404 for another
has learned which events are real, and can map the shape of a system they have
no access to. The same applies to photo ids and gallery slugs.

So the rule is: an actor who is not entitled to know a resource exists gets 404,
identical to a genuinely nonexistent id. This is enforced structurally rather
than by remembering — `requireEventAccess` resolves the event with the actor's
scope already in the `where` clause, so "not yours" and "not there" are the same
empty result and produce the same response by construction.

403 is still used, deliberately, in one situation: when the actor can already
see the resource but may not perform the action. A team member assigned to an
event who tries to publish it gets 403, because they know the event exists —
they have been looking at it — and 404 would be a confusing lie. A member who is
*not* assigned gets 404 for that same publish call.

What it costs. Genuine permission mistakes are harder to debug from the outside;
an admin who mistyped an id and an admin who lost access see the same page.
Server-side logs distinguish them, and I think the trade is right for a product
whose entire value proposition is that private photographs stay private.

---

## 5. argon2id for both passwords and gallery PINs

**Status:** accepted

argon2id is the current OWASP first recommendation. It is memory-hard, which is
what bcrypt is not: bcrypt's cost parameter buys CPU time, and GPU and FPGA
attackers have far more of that than they have memory bandwidth. Parameters are
pinned explicitly at `m=19456, t=2, p=1` — the OWASP floor — rather than left
implicit, so the cost is reviewable in the diff and raising it later is a
one-line change.

The less obvious half is using it for gallery PINs too. A six-digit PIN has a
million possibilities, which is nothing — a fast hash would let anyone who
obtained the database recover every PIN in seconds. argon2id makes each guess
cost real memory and time, which turns an afternoon into an impractical amount
of work. It is not sufficient on its own, which is why the rate limiter exists;
the two are the same defence at different layers.

What it costs. Each verification takes on the order of 50 to 100 milliseconds
and 19 MB of memory, which is the point, but it is real latency on the login and
PIN paths and real memory pressure on a small serverless instance. It also means
the decoy-hash comparison on login — needed so an unknown email costs the same
time as a wrong password — costs a full hash rather than being free.

`@node-rs/argon2` was chosen over a pure-JS implementation because native
bindings do the work off the main thread rather than blocking the event loop for
100 ms per login.

---

## 6. Thumbnails generated at write time

**Status:** accepted, with a known ceiling

A contact sheet is the primary screen in this product and it is dense by design
— a lead scanning 1,250 frames wants them all on one surface. Serving originals
into that grid would mean pulling something like 3 GB over the wire to render
one screen. So every photo gets a 480px-wide WebP at upload, and the grid uses
those; the full-resolution original is fetched only when a frame is opened in
the loupe.

The alternative is generating on read, through an image CDN or a transform
service. That is genuinely better at scale — it is lazy, it adapts to the
requesting device, and it costs nothing for photos nobody looks at. It also
means either a paid service or a public transform endpoint, and a public
transform endpoint pointed at private originals is exactly the hole the first
invariant exists to close. Doing it at write time keeps the bucket private with
no exceptions.

A useful side effect: decoding the image to resize it is the only real check
that the uploaded bytes are an image at all, since `Content-Type` is
client-chosen. That check became load-bearing (see ADR 3).

What it costs, and it is the sharpest limitation in the project. Generation
happens synchronously inside the `confirm` request, so a burst of uploads is a
burst of CPU-heavy serverless invocations, and a single large image holds a
function open while sharp works. This is fine for a wedding and wrong for a
50,000-photo event. The schema already anticipates the fix: `PhotoStatus` has a
`PENDING` state, so the row can be written immediately, the key pushed onto a
queue, and a worker can produce the thumbnail and flip the row to `READY`. The
grid would show a placeholder in the gap. I did not build the queue because it
is infrastructure this challenge does not need, but the seam is there.
