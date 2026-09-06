# Deployment

Four accounts, about twenty minutes. Everything the application needs is an
environment variable — there is no build-time coupling to a provider.

Run `npm run preflight` at the end of each stage. It checks the environment,
the database, and — the one that matters — that the bucket refuses an unsigned
read. If that check ever passes when it should not, every photograph in the
system is world-readable.

---

## 1. Database — Neon

1. Create a project at neon.tech. Pick the region nearest your Vercel region.
2. From the connection details, copy **two** strings:
   - the **pooled** connection string → `DATABASE_URL`
   - the **direct** connection string → `DIRECT_URL`

   Prisma migrations need a direct connection; the app itself should go through
   the pooler. Using the pooled URL for migrations fails in ways that read like
   a schema problem and are not.

3. Apply the schema from your local checkout:

   ```bash
   DATABASE_URL="<pooled>" DIRECT_URL="<direct>" npx prisma migrate deploy
   ```

## 2. Storage — Cloudflare R2

1. Create a bucket. **Leave public access disabled and do not attach a custom
   domain.** The application never needs one, and attaching one would undo the
   first security invariant.
2. Create an API token scoped to **Object Read & Write** on that bucket only.
   Copy the access key id and secret.
3. Add a CORS policy so the browser can PUT directly to storage:

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

   Without this, uploads fail in the browser with an opaque network error while
   working perfectly from curl. It is the single most common way this deploy
   goes wrong.

## 3. Application — Vercel

1. Import the repository.
2. Set every variable from the table in the README. Generate the two secrets
   fresh — do not reuse the development ones:

   ```bash
   openssl rand -base64 48   # JWT_SECRET
   openssl rand -base64 24   # IP_HASH_SALT
   ```

3. `NEXT_PUBLIC_APP_URL` is your deployed origin with **no trailing slash**.
   Gallery links are built from it.
4. Deploy. `npm run build` runs `prisma generate` first.

## 4. Seed the demo data

Point a local checkout at production and seed it once:

```bash
DATABASE_URL="<pooled>" DIRECT_URL="<direct>" \
R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=... \
NEXT_PUBLIC_APP_URL="https://your-app.vercel.app" \
SEED_ADMIN_PASSWORD=... SEED_MEMBER_PASSWORD=... SEED_GALLERY_PIN=482917 \
npm run db:seed
```

It prints the gallery URL. Put that, and the credentials, into the README's
"Live demo" table.

**Then remove the `SEED_*` variables from Vercel.** They are not read at
runtime, and leaving them in the dashboard is a plaintext password sitting
somewhere it does not need to be.

**`DEMO_MODE` is the switch that matters here.** Set it to `true` only for a
deployment whose galleries are all fictional — it is what puts the demo sign-in
credentials and the seeded gallery link on the entry page. For this submission
that is correct and wanted. For a deployment with a real client's wedding on it,
leave it unset; `npm run preflight` reports which state you are in.

---

## Smoke test

Do this from a device that has never visited the site, in a private window.

- [ ] The entry page loads cold and explains what the product is.
- [ ] Sign in as `admin@demo.test`. The contact sheet shows 30 frames.
- [ ] Sign in as `nikhil@demo.test`. Fewer frames — only his own.
- [ ] Sign in as `idle@demo.test`. The event list is empty.
- [ ] Upload a photograph. It appears as a placeholder, then resolves.
- [ ] Open the gallery link. Enter the wrong PIN — the message says nothing
      about whether the gallery exists. Enter the right one.
- [ ] Open a photograph, press the browser Back button. The lightbox closes and
      you stay on the gallery.
- [ ] Change the PIN from the workspace. The old one stops working immediately.
- [ ] `curl -I` a photo URL with the query string stripped. It must 403.
- [ ] The entry page shows demo credentials **only if you meant it** — check
      `DEMO_MODE` matches the kind of deployment this is.

## If something is wrong

| Symptom | Cause |
|---|---|
| Uploads fail in the browser, fine from curl | R2 CORS not configured, or the origin does not match exactly |
| Migrations hang or error oddly | Using the pooled URL where the direct one is needed |
| Signed out immediately after signing in | `NEXT_PUBLIC_APP_URL` does not match the real origin, or it is `http://` |
| Gallery link 404s for the client | Gallery not published, or `NEXT_PUBLIC_APP_URL` has a trailing slash |
| Images 403 in the gallery | Presigned URLs expired — the page reloads them every 4.5 minutes; if it persists, the system clock on the server is skewed |
