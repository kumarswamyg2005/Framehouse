# Interview notes

Not part of the deliverable — this is my own preparation. The five questions the
brief signposts, plus the two I expect to be pushed hardest on.

---

## Why presigned direct upload instead of proxying through your API?

Because proxying makes the server pay for the client's uplink.

A 25 MB file through a serverless function means holding that function open for
as long as the upload takes, which is a property of the photographer's wifi at a
venue, not of any work being done. Vercel's request body limit rejects it
outright anyway. Four hundred frames would be hundreds of function-seconds spent
moving bytes nobody looks at.

Presigning inverts it: the API makes a small, fast authorization decision — is
this person on this event, is this an allowed type, is it under the cap — issues
a narrowly-scoped credential, and gets out of the way.

**The follow-up is "doesn't that trust the client more?"** No — it trusts it
less, and there are three specific controls. `ContentType` and `ContentLength`
are baked into the signature, so a client that presigned a 2 MB JPEG cannot
upload a 2 GB video; storage rejects the mismatch, not us. The object key is
generated server-side as `events/{eventId}/{uuid}.{ext}`, so the client cannot
choose where bytes land, traverse a path, or overwrite anything. And `confirm`
calls `HeadObject` and writes the row from what actually arrived.

## What stops a team member reading another event's photos?

The query, not a check after the query.

`lib/auth/policy.ts` exposes `visiblePhotoWhere(actor, eventId)`, which returns
a Prisma `where` fragment: for an admin, every photo in an event they own; for a
member, only rows where `uploadedById` is them. Every read spreads that in. The
colleague's rows are never loaded, never serialised, never sent — so there is no
version of this where a UI bug leaks them.

The single-record path is the same idea: `requirePhotoAccess` resolves the photo
*under the actor's scope* in one query, so "you may not see this" and "this does
not exist" are the same empty result.

**Follow-up: "what if someone adds a new endpoint and forgets?"** That is the
real risk, and it is why nothing in `app/` talks to Prisma directly — every
entry point goes through `lib/data/`, and every function there takes the actor
first. A new endpoint that skips it is visible in review as a missing argument.

## What happens if the upload succeeds but the confirm call fails?

An unreferenced object sits in the bucket and there is no database row.

That ordering is deliberate: the row is the last thing written, after
`HeadObject` proves the object arrived. The failure mode is a few kilobytes of
storage that a lifecycle rule can sweep — as opposed to the alternative, a row
pointing at bytes that never landed, which is a permanently broken frame in
someone's contact sheet.

The client sees the file marked failed with a Retry, and the rest of the batch
keeps going. Retrying presigns a fresh key rather than reusing the old one.

**What I would add with more time:** a sweep reconciling keys against rows. It
needs a scheduled job, which is the same gap as pruning the attempts table.

## Why 404 instead of 403 on cross-tenant access?

A 403 says "this exists and you may not have it". That is a disclosure. Given
`GET /api/events/:id`, an attacker who gets 403 for one id and 404 for another
has learned which events are real and can map a system they have no access to.

So anyone not entitled to know a resource exists gets 404 — identical to an id
that was never real. It is structural rather than remembered: the actor's scope
is already inside the `where` clause, so both cases are the same empty result.

**403 is still used, deliberately, in one place:** when the actor can already
see the resource but may not perform the action. A member assigned to an event
who tries to publish gets 403, because they have been looking at that event and
404 would be a confusing lie. A member who is *not* assigned gets 404 for the
same call.

## How would you scale this to 50,000 photos per event?

Four things, in the order they would break.

**Thumbnails.** Already off the request path via `after()`, but still the same
invocation. At 50,000 that needs a real queue and a worker pool. `finalisePhoto`
is already a standalone function taking a photo id — it is a change of trigger,
not a rewrite.

**The contact sheet.** Cursor pagination is already there, and deliberately not
offset: a sheet is appended to while it is scrolled, and `OFFSET` would skip or
repeat frames as rows shift. At 50,000 the grid itself needs windowing so the
DOM holds a few hundred nodes rather than all of them.

**Selection.** `saveSelection` replaces the whole set. That is right for a few
hundred and wrong for tens of thousands — it becomes a diff, and probably a
`GalleryPhoto` write per toggle rather than a bulk replace.

**Presigning.** Cheap individually — an HMAC, no network — but proportional to
what is rendered, which is why the gallery pages at 36. Beyond a point the
answer is a signed cookie scoped to a key prefix rather than per-object URLs.

---

## The two I expect to be pushed hardest on

### "You wrote your own auth. Why not NextAuth?"

Say the honest version first: **in a production codebase with a team, I would
probably use it.** I did not here for two reasons.

This challenge is graded on security and I would be asked to explain the auth
path. It is about 150 lines and I can account for all of them — why the cookie
is `SameSite=Lax` and not `Strict`, why login verifies against a decoy hash when
the email is unknown, why the user row is re-read on every request instead of
trusted from the token, why session and gallery tokens differ by `aud` rather
than by a scope field I would have to remember to check. "The library does that"
is a worse answer than code I wrote.

And the requirement is genuinely small: two roles, email and password, no OAuth,
no account linking, no magic links.

**Then volunteer what it cost, before being asked.** No password reset, no email
verification, no MFA, no device management, no session revocation list — the
closest thing is that a deleted user fails the per-request database read. If the
product grew a second authentication method I would migrate rather than extend.

### "What is the weakest part of this?"

Answer it straight rather than deflecting. **Thumbnail finalisation still runs
in the same invocation as the request that triggered it.** `after()` fixed the
latency and stopped requests being held open, but not the compute. A burst of
uploads still lands on one instance. It works comfortably for a wedding and is
the wrong shape for a 50,000-photo event, and the fix is a queue I chose not to
build because it is infrastructure this challenge does not need.

The second weakest: nothing prunes `AccessAttempt`. `pruneAttempts()` exists and
is correct, but nothing calls it on a schedule.

Both are in the README under Known limitations. Being able to name them, say why
they are acceptable here, and describe the fix is the point — a submission with
no known limitations is one where nobody looked.
