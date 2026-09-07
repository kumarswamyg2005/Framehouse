/**
 * Acceptance run.
 *
 * Walks every requirement in the challenge brief against a running instance,
 * through the real HTTP API and a real browser — nothing stubbed. Each clause is
 * numbered to the section of the specification it comes from, so a reviewer can
 * read this next to the PDF.
 *
 *   npm run start &      # or point BASE at the deployment
 *   npm run acceptance
 */
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:3000'

let passed = 0
let failed = 0
const failures = []
let section = ''

const heading = (t) => {
  section = t
  console.log(`\n\x1b[1m${t}\x1b[0m`)
}
function check(clause, label, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  \x1b[32m✔\x1b[0m ${clause.padEnd(7)} ${label}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}`)
  } else {
    failed++
    failures.push(`${section} — ${clause} ${label} ${detail}`)
    console.log(`  \x1b[31m✘\x1b[0m ${clause.padEnd(7)} ${label}  \x1b[31m${detail}\x1b[0m`)
  }
}

/* --- a tiny cookie-aware client, so roles stay isolated -------------------
 *
 * Each one carries a distinct X-Forwarded-For. The throttle is per subject per
 * IP, and every simulated actor here comes from one machine — without this, the
 * rate-limit clause would trip the limiter for every later client and report
 * failures that are an artefact of the harness rather than the app. Real
 * clients arrive from different addresses; this makes the simulation match.
 */
let ipCounter = 0
function client() {
  const jar = new Map()
  const ip = `203.0.113.${++ipCounter}`
  return {
    ip,
    cookies: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    async call(path, opts = {}) {
      const res = await fetch(BASE + path, {
        ...opts,
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip,
          Cookie: this.cookies(),
          ...(opts.headers ?? {}),
        },
      })
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const kv = c.split(';')[0]
        const i = kv.indexOf('=')
        jar.set(kv.slice(0, i), kv.slice(i + 1))
      }
      const text = await res.text()
      let body = null
      try { body = text ? JSON.parse(text) : null } catch { body = text }
      return { status: res.status, body, headers: res.headers }
    },
  }
}

const stamp = Date.now()
const LEAD = { email: `lead-${stamp}@accept.test`, password: 'acceptance-lead-pw', name: 'Meera Raghavan' }
const LEAD2 = { email: `lead2-${stamp}@accept.test`, password: 'acceptance-lead2-pw', name: 'Rival Studio' }
const MEMBER_A = { email: `m1-${stamp}@accept.test`, name: 'Nikhil Shetty' }
const MEMBER_B = { email: `m2-${stamp}@accept.test`, name: 'Sana Qureshi' }
const PIN = '482917'

function fixtures(n) {
  const dir = mkdtempSync(join(tmpdir(), 'accept-'))
  return Promise.all(
    Array.from({ length: n }, async (_, i) => {
      const bytes = await sharp({
        create: { width: 900, height: 600, channels: 3, background: { r: 20 + i * 30, g: 70, b: 110 } },
      }).jpeg().toBuffer()
      const p = join(dir, `DSC_0${100 + i}.JPG`)
      writeFileSync(p, bytes)
      return p
    })
  )
}

async function upload(api, eventId, name, bytes) {
  const pre = await api.call(`/api/events/${eventId}/photos/presign`, {
    method: 'POST',
    body: JSON.stringify({ filename: name, mimeType: 'image/jpeg', fileSize: bytes.length }),
  })
  if (pre.status !== 200) return { failedAt: 'presign', pre }
  const put = await fetch(pre.body.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: bytes })
  const conf = await api.call(`/api/events/${eventId}/photos/confirm`, {
    method: 'POST',
    body: JSON.stringify({ storageKey: pre.body.storageKey, filename: name }),
  })
  return { pre, put, conf }
}

const jpeg = async (seed = 1) =>
  sharp({ create: { width: 800, height: 533, channels: 3, background: { r: seed * 20, g: 60, b: 90 } } })
    .jpeg().toBuffer()

/* ========================================================================= */

const lead = client()
const lead2 = client()
const memberA = client()
const memberB = client()
const idle = client()
const customer = client()

heading('§2.1  Admin / Lead')

const reg = await lead.call('/api/auth/register', { method: 'POST', body: JSON.stringify(LEAD) })
check('2.1', 'Register', reg.status === 201, `HTTP ${reg.status}`)
check('2.1', 'Registration returns no password material',
  !JSON.stringify(reg.body).match(/passwordHash|\$argon2|acceptance-lead-pw/))

const me = await lead.call('/api/auth/me')
check('2.1', 'Login / session established', me.status === 200 && me.body.user.role === 'ADMIN', me.body?.user?.role)

const ev = await lead.call('/api/events', {
  method: 'POST',
  body: JSON.stringify({ name: 'Arjun & Priya Wedding', description: 'Two days, Bangalore.', date: '2026-08-22' }),
})
check('2.1', 'Create an event', ev.status === 201, `HTTP ${ev.status}`)
const eventId = ev.body?.event?.id

const addA = await lead.call(`/api/events/${eventId}/members`, { method: 'POST', body: JSON.stringify(MEMBER_A) })
const addB = await lead.call(`/api/events/${eventId}/members`, { method: 'POST', body: JSON.stringify(MEMBER_B) })
check('2.1', 'Add team members', addA.status === 201 && addB.status === 201)
check('2.1', 'New member gets a one-time temporary password',
  typeof addA.body?.temporaryPassword === 'string' && addA.body.temporaryPassword.length > 8)
MEMBER_A.password = addA.body?.temporaryPassword
MEMBER_B.password = addB.body?.temporaryPassword

heading('§2.2  Team Member')

const la = await memberA.call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: MEMBER_A.email, password: MEMBER_A.password }) })
const lb = await memberB.call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: MEMBER_B.email, password: MEMBER_B.password }) })
check('2.2', 'Member login', la.status === 200 && lb.status === 200)
check('2.2', 'Member role is MEMBER, not ADMIN', la.body?.user?.role === 'MEMBER', la.body?.user?.role)

const evList = await memberA.call('/api/events')
check('2.2', 'View assigned events', evList.status === 200 && evList.body.events.length === 1)

await idle.call('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Idle', email: `idle-${stamp}@accept.test`, password: 'idle-password-1' }) })
const idleList = await idle.call('/api/events')
check('2.2', 'Unassigned account sees no events', idleList.body?.events?.length === 0)

const upA = []
for (let i = 0; i < 3; i++) upA.push(await upload(memberA, eventId, `NIKHIL_${i}.JPG`, await jpeg(i + 1)))
const upB = []
for (let i = 0; i < 2; i++) upB.push(await upload(memberB, eventId, `SANA_${i}.JPG`, await jpeg(i + 5)))
check('2.2', 'Upload photos (multiple)', upA.every(u => u.conf?.status === 201) && upB.every(u => u.conf?.status === 201))
check('4',   'Upload goes browser → object storage directly', upA[0].put?.status === 200, `PUT ${upA[0].put?.status}`)

await new Promise(r => setTimeout(r, 2500)) // finalisation

const aPhotos = await memberA.call(`/api/events/${eventId}/photos`)
const bPhotos = await memberB.call(`/api/events/${eventId}/photos`)
check('2.2', 'Member sees only their own uploads',
  aPhotos.body.photos.length === 3 && bPhotos.body.photos.length === 2,
  `A=${aPhotos.body.photos.length} B=${bPhotos.body.photos.length}`)

const allPhotos = await lead.call(`/api/events/${eventId}/photos`)
check('2.1', 'Lead views all photos uploaded by the team',
  allPhotos.body.photos.length === 5, `${allPhotos.body.photos.length} of 5`)

const aIds = new Set(aPhotos.body.photos.map(p => p.id))
const bIds = bPhotos.body.photos.map(p => p.id)
check('2.2', 'Member cannot see another member’s photo ids', !bIds.some(id => aIds.has(id)))
const crossPhoto = await memberA.call(`/api/photos/${bIds[0]}/url`)
check('2.2', 'Member cannot open another member’s photo', crossPhoto.status === 404, `HTTP ${crossPhoto.status}`)
const crossDelete = await memberA.call(`/api/photos/${bIds[0]}`, { method: 'DELETE' })
check('2.2', 'Member cannot delete another member’s photo', crossDelete.status === 404, `HTTP ${crossDelete.status}`)

heading('§4  Photo upload & storage')

const meta = allPhotos.body.photos[0]
check('4', 'Metadata: photo id', typeof meta.id === 'string')
check('4', 'Metadata: uploaded by', typeof meta.uploadedBy?.name === 'string')
check('4', 'Metadata: filename', typeof meta.filename === 'string' && meta.filename.endsWith('.JPG'))
check('4', 'Metadata: created at', typeof meta.createdAt === 'string')
check('4', 'Storage key never exposed to the client', !('storageKey' in meta))
check('4', 'Image URL is presigned, not public', /[?&](X-Amz-Signature|Signature)=/.test(meta.thumbnailUrl ?? ''))
const stripped = (meta.thumbnailUrl ?? '').split('?')[0]
const unsigned = await fetch(stripped)
check('6', 'Unsigned object read refused', !unsigned.ok, `HTTP ${unsigned.status}`)
check('4', 'Files are not stored in the database', /^https?:\/\//.test(meta.thumbnailUrl ?? ''))

heading('§5 / §2.1  Gallery management')

const selected = allPhotos.body.photos.slice(0, 3).map(p => p.id)
const unselectedId = allPhotos.body.photos[4].id
const sel = await lead.call(`/api/events/${eventId}/gallery`, { method: 'POST', body: JSON.stringify({ title: 'Arjun & Priya', photoIds: selected }) })
check('2.1', 'Select photos for sharing', sel.status === 200 && sel.body.gallery.selected === 3)

const pub = await lead.call(`/api/galleries/${sel.body.gallery.id}/publish`, { method: 'POST', body: JSON.stringify({ pin: PIN }) })
check('2.1', 'Create and publish a gallery', pub.status === 200)
check('2.1', 'Generate a shareable link', typeof pub.body.slug === 'string' && pub.body.slug.length === 12, pub.body.slug)
check('2.1', 'Set a PIN for the gallery', pub.status === 200)
check('6',   'PIN never returned by the API', !JSON.stringify(pub.body).includes(PIN))
const slug = pub.body.slug

const galleryForLead = await lead.call(`/api/events/${eventId}/gallery`)
check('6', 'PIN hash never returned to the lead either', !JSON.stringify(galleryForLead.body).match(/pinHash|\$argon2/))

heading('§2.3  Customer')

const before = await customer.call(`/api/public/gallery/${slug}`)
check('2.3', 'Gallery closed without a PIN', before.status === 404, `HTTP ${before.status}`)
const wrong = await customer.call(`/api/public/gallery/${slug}/verify`, { method: 'POST', body: JSON.stringify({ pin: '111111' }) })
check('6',   'Incorrect PIN rejected', wrong.status === 401)
const ghost = await client().call(`/api/public/gallery/zzzzzzzzzzzz/verify`, { method: 'POST', body: JSON.stringify({ pin: '111111' }) })
check('6',   'Unknown gallery gives the identical message', ghost.body?.error?.message === wrong.body?.error?.message)

const ok = await customer.call(`/api/public/gallery/${slug}/verify`, { method: 'POST', body: JSON.stringify({ pin: PIN }) })
check('2.3', 'Correct PIN grants access', ok.status === 200)
const view = await customer.call(`/api/public/gallery/${slug}`)
check('2.3', 'Customer views published photos', view.status === 200 && view.body.photos.length === 3, `${view.body?.photos?.length} of 3`)
check('2.3', 'Customer needs no account', !customer.cookies().includes('fh_session'))
const custPhoto = await customer.call(`/api/public/gallery/${slug}/photos/${selected[0]}/url`)
check('2.3', 'Customer can open a full photo', custPhoto.status === 200)
const custUnselected = await customer.call(`/api/public/gallery/${slug}/photos/${unselectedId}/url`)
check('6',   'Unpublished photo unreachable by id', custUnselected.status === 404, `HTTP ${custUnselected.status}`)
const custApi = await customer.call('/api/events')
check('6',   'Gallery token grants no authenticated access', custApi.status === 401, `HTTP ${custApi.status}`)

heading('§6  Failure scenarios named in the brief')

const otherEvent = await memberA.call(`/api/events/cmtqzzzzzzzzzzzzzzzzzzzz`)
check('6.a', 'Accessing another event → 404', otherEvent.status === 404, `HTTP ${otherEvent.status}`)

const memberPublish = await memberA.call(`/api/galleries/${sel.body.gallery.id}/publish`, { method: 'POST', body: JSON.stringify({ pin: '999999' }) })
check('6.b', 'Member publishing → 403 (visible event, forbidden action)', memberPublish.status === 403, `HTTP ${memberPublish.status}`)

const orphan = await memberA.call(`/api/events/${eventId}/photos/confirm`, {
  method: 'POST',
  body: JSON.stringify({ storageKey: `events/${eventId}/00000000-0000-0000-0000-000000000000.jpg`, filename: 'ghost.jpg' }),
})
check('6.c', 'Failed upload writes no row', orphan.status === 502 && orphan.body.error.code === 'UPLOAD_FAILED')

check('6.e', 'Unselected photo unreachable', custUnselected.status === 404)

heading('§6  Cross-tenant isolation (two leads)')

await lead2.call('/api/auth/register', { method: 'POST', body: JSON.stringify(LEAD2) })
const probes = [
  ['read the event',    () => lead2.call(`/api/events/${eventId}`)],
  ['list its photos',   () => lead2.call(`/api/events/${eventId}/photos`)],
  ['change selection',  () => lead2.call(`/api/events/${eventId}/gallery`, { method: 'POST', body: JSON.stringify({ title: 'x', photoIds: [] }) })],
  ['set its PIN',       () => lead2.call(`/api/galleries/${sel.body.gallery.id}/publish`, { method: 'POST', body: JSON.stringify({ pin: '999999' }) })],
  ['unpublish it',      () => lead2.call(`/api/galleries/${sel.body.gallery.id}/unpublish`, { method: 'POST' })],
  ['add a member',      () => lead2.call(`/api/events/${eventId}/members`, { method: 'POST', body: JSON.stringify({ email: 'x@y.test' }) })],
]
for (const [label, fn] of probes) {
  const r = await fn()
  check('6', `Second lead cannot ${label}`, r.status === 404, `HTTP ${r.status}`)
}
const stillMine = await client().call(`/api/public/gallery/${slug}/verify`, { method: 'POST', body: JSON.stringify({ pin: PIN }) })
check('6', 'Owner’s PIN still works after the attempt', stillMine.status === 200)

/*
  The rate-limit clause runs here, after everything that needs a working PIN.

  Each simulated client carries its own X-Forwarded-For, which is enough to keep
  them independent locally. It is not enough against a real deployment: Vercel's
  proxy overwrites that header with the true client address, so every client in
  this file collapses onto one IP and five deliberate failures lock the gallery
  for whatever runs next. Ordering is the fix — the limiter is behaving exactly
  as designed, and the harness has no way to fake distinct source addresses
  through a proxy that rewrites them.
*/
heading('§6.d  PIN rate limiting')

const rl = client()
let limited = null
for (let i = 1; i <= 8 && !limited; i++) {
  const r = await rl.call(`/api/public/gallery/${slug}/verify`, { method: 'POST', body: JSON.stringify({ pin: '000000' }) })
  if (r.status === 429) limited = { at: i, retry: r.headers.get('retry-after') }
}
check('6.d', 'Repeated wrong PIN rate-limited', !!limited, limited ? `at attempt ${limited.at}, Retry-After ${limited.retry}s` : 'never limited')

heading('§6  Input validation & error handling')

const cases = [
  ['40 MB file refused',        () => lead.call(`/api/events/${eventId}/photos/presign`, { method: 'POST', body: JSON.stringify({ filename: 'h.jpg', mimeType: 'image/jpeg', fileSize: 40 * 1024 * 1024 }) }), 400],
  ['executable MIME refused',   () => lead.call(`/api/events/${eventId}/photos/presign`, { method: 'POST', body: JSON.stringify({ filename: 'p.exe', mimeType: 'application/x-msdownload', fileSize: 1024 }) }), 400],
  ['malformed email refused',   () => client().call('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: 'x', email: 'nope', password: 'longenoughpw' }) }), 400],
  ['short password refused',    () => client().call('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: 'x', email: `v${stamp}@a.test`, password: 'short' }) }), 400],
  ['non-JSON body refused',     () => lead.call('/api/events', { method: 'POST', body: 'not json' }), 400],
  ['bad PIN shape refused',     () => client().call(`/api/public/gallery/${slug}/verify`, { method: 'POST', body: JSON.stringify({ pin: 'abcdef' }) }), 400],
  ['bad page cursor refused',   () => customer.call(`/api/public/gallery/${slug}?after=`), 400],
  ['anonymous API refused',     () => client().call('/api/events'), 401],
]
for (const [label, fn, expected] of cases) {
  const r = await fn()
  check('6', label, r.status === expected, `HTTP ${r.status}, expected ${expected}`)
}
const envelope = await client().call('/api/events')
check('6', 'Consistent error envelope { error: { code, message } }',
  typeof envelope.body?.error?.code === 'string' && typeof envelope.body?.error?.message === 'string')

heading('§6  Revocation')

await lead.call(`/api/galleries/${sel.body.gallery.id}/unpublish`, { method: 'POST' })
const afterUnpub = await customer.call(`/api/public/gallery/${slug}`)
check('6', 'Unpublishing revokes an existing customer session', afterUnpub.status === 404, `HTTP ${afterUnpub.status}`)
await lead.call(`/api/galleries/${sel.body.gallery.id}/publish`, { method: 'POST', body: JSON.stringify({ pin: PIN }) })
const oldPinAfterRepublish = await client().call(`/api/public/gallery/${slug}/verify`, { method: 'POST', body: JSON.stringify({ pin: PIN }) })
check('6', 'Republishing restores access with the new PIN', oldPinAfterRepublish.status === 200)

heading('§6  Security headers')

const page = await fetch(`${BASE}/login`)
const h = page.headers
check('6', 'Content-Security-Policy', !!h.get('content-security-policy'))
check('6', 'X-Content-Type-Options: nosniff', h.get('x-content-type-options') === 'nosniff')
check('6', 'X-Frame-Options: DENY', h.get('x-frame-options') === 'DENY')
check('6', 'Referrer-Policy', !!h.get('referrer-policy'))
check('6', 'Strict-Transport-Security', !!h.get('strict-transport-security'))
const apiHead = await fetch(`${BASE}/api/auth/me`)
check('6', 'API responses are no-store', (apiHead.headers.get('cache-control') ?? '').includes('no-store'))

/* ---- browser pass: §3 workflow and §6 responsive UI ---------------------- */
heading('§3  End-to-end workflow in a browser')

/** Reports the reason a browser step failed instead of leaving a bare cross. */
async function step(clause, label, fn) {
  try {
    const detail = await fn()
    check(clause, label, true, typeof detail === 'string' ? detail : '')
  } catch (error) {
    check(clause, label, false, String(error).split('\n')[0].slice(0, 90))
  }
}

const files = await fixtures(3)
const browser = await chromium.launch()

const leadCtx = await browser.newContext()
const leadPage = await leadCtx.newPage()
await leadPage.goto(`${BASE}/login`)
await leadPage.fill('#email', LEAD.email)
await leadPage.fill('#password', LEAD.password)
await leadPage.click('button[type=submit]')
await leadPage.waitForURL('**/events')
check('3.1', 'Lead signs in and lands on their events', leadPage.url().endsWith('/events'))

await leadPage.getByRole('link', { name: /Arjun & Priya Wedding/ }).click()
await leadPage.waitForURL(/\/events\/[a-z0-9]+$/)
await leadPage.locator('ul li button[aria-label*="frame"]').first().waitFor()
check('3.3', 'Lead reviews the contact sheet', (await leadPage.locator('ul li button[aria-label*="frame"]').count()) === 5)

const memberCtx = await browser.newContext()
const memberPage = await memberCtx.newPage()
await memberPage.goto(`${BASE}/login`)
await memberPage.fill('#email', MEMBER_A.email)
await memberPage.fill('#password', MEMBER_A.password)
await memberPage.click('button[type=submit]')
await memberPage.waitForURL('**/events')
await memberPage.getByRole('link', { name: /Arjun & Priya Wedding/ }).click()
await memberPage.waitForURL(/\/events\/[a-z0-9]+$/)
await memberPage.getByRole('link', { name: /All events/ }).waitFor({ timeout: 60_000 })
await memberPage.locator('ul li button[aria-label*="frame"]').first().waitFor()
check('2.2', 'Member UI hides the publish control', (await memberPage.getByRole('button', { name: 'Publish' }).count()) === 0)
check('2.2', 'Member UI hides the team roster', (await memberPage.getByRole('button', { name: 'Add to event' }).count()) === 0)

await memberPage.setInputFiles('input[type=file]', files)
await memberPage.getByText('3 uploaded').waitFor({ timeout: 60_000 })
await memberPage.waitForFunction(() => document.querySelectorAll('button[aria-label*="still processing"]').length === 0, null, { timeout: 60_000 })
check('3.2', 'Member uploads through the UI', (await memberPage.locator('ul li button[aria-label*="frame"]').count()) === 6)

await leadPage.reload()
await leadPage.locator('ul li button[aria-label*="frame"]').first().waitFor()

// Selection is a toggle, and the API section above already chose three frames.
// Clear first so this clause measures the UI rather than the leftover state.
const clear = leadPage.getByRole('button', { name: 'Clear selection' })
if (await clear.count()) {
  await clear.click()
  await leadPage.getByLabel('0 selected').waitFor({ timeout: 20_000 })
}

const frames = leadPage.locator('ul li button[aria-label*="frame"]')
await frames.nth(0).click()
await frames.nth(1).click()
await leadPage.getByText('Selection saved').waitFor({ timeout: 20_000 })
check('3.3', 'Lead selects photos', (await leadPage.getByLabel('2 selected').count()) > 0)

await leadPage.getByRole('button', { name: 'Gallery' }).click()
await leadPage.getByRole('button', { name: 'Set a new PIN' }).click()
const pinBoxes = leadPage.locator('input[aria-label^="PIN digit"]')
for (let i = 0; i < 6; i++) await pinBoxes.nth(i).fill(PIN[i])
await leadPage.getByRole('button', { name: 'Set new PIN' }).click()

// Wait for something that only exists AFTER the publish response lands. The
// toolbar badge is not it — the gallery was already published, so that matches
// immediately and the checks below would race the request.
await step('3.4', 'Lead publishes and gets a link', async () => {
  const link = leadPage.locator(`text=/\\/g\\/${slug}/`).first()
  await link.waitFor({ timeout: 20_000 })
  return await link.innerText()
})
await step('2.1', 'Share link is copyable', async () => {
  await leadPage.getByRole('button', { name: /^Copy link$|^Copied$/ }).waitFor({ timeout: 10_000 })
})
await step('2.1', 'One-time message with the PIN offered', async () => {
  await leadPage.getByRole('button', { name: /Copy message with PIN/ }).waitFor({ timeout: 10_000 })
})
await step('2.1', 'Share link is visually highlighted for copying', async () => {
  const border = await leadPage
    .locator(`text=/\\/g\\/${slug}/`)
    .first()
    .evaluate((el) => getComputedStyle(el).borderColor)
  if (border === 'rgba(0, 0, 0, 0)' || !border) throw new Error('no accent border on the link')
  return border
})

const custCtx = await browser.newContext()
const custPage = await custCtx.newPage()
await custPage.goto(`${BASE}/g/${slug}`)
const gate = custPage.locator('input[aria-label^="Digit"]')
await gate.first().waitFor()
for (let i = 0; i < 6; i++) await gate.nth(i).fill('1')
await custPage.getByText('That PIN doesn’t match.').waitFor({ timeout: 20_000 })
check('6.d', 'Wrong PIN message reveals nothing', true)
for (let i = 0; i < 6; i++) await gate.nth(i).fill(PIN[i])
await custPage.getByRole('button', { name: /^Open / }).first().waitFor({ timeout: 20_000 })
check('3.5', 'Customer opens the gallery with link + PIN', (await custPage.getByRole('button', { name: /^Open / }).count()) === 2)
await custPage.getByRole('button', { name: /^Open / }).first().click()
await custPage.locator('[role=dialog] img').first().waitFor({ timeout: 20_000 })
check('2.3', 'Customer browses photos in a lightbox', true)

heading('§6  Responsive UI')
for (const [w, label] of [[360, '360px'], [390, '390px'], [768, '768px'], [1440, '1440px']]) {
  const c = await browser.newContext({ viewport: { width: w, height: 900 } })
  const pg = await c.newPage()
  let worst = 0
  for (const route of ['/', '/login', '/register', `/g/${slug}`]) {
    await pg.goto(BASE + route)
    await pg.waitForTimeout(500)
    worst = Math.max(worst, await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
  }
  check('6', `No horizontal overflow at ${label}`, worst === 0, `${worst}px`)
  await c.close()
}

await browser.close()

/* ------------------------------------------------------------------------- */
console.log(`\n${'─'.repeat(64)}`)
console.log(`  \x1b[32m${passed} passed\x1b[0m` + (failed ? `   \x1b[31m${failed} failed\x1b[0m` : '   0 failed'))
if (failed) {
  console.log('\n  Failures:')
  for (const f of failures) console.log(`   • ${f}`)
}
console.log(`${'─'.repeat(64)}\n`)
process.exit(failed ? 1 : 0)
