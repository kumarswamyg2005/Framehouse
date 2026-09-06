/**
 * Page-by-page UI audit.
 *
 * Where scripts/acceptance.mjs proves the specification is satisfied, this one
 * proves every control on every page actually does what it says. It walks each
 * route as each role and operates the interface: every button, every field,
 * every keyboard shortcut, every empty and error state.
 *
 *   npm run start &
 *   npm run audit
 */
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const PIN = '482917'

let passed = 0, failed = 0
const failures = []
let page_ = ''
const heading = (t) => { page_ = t; console.log(`\n\x1b[1m${t}\x1b[0m`) }

async function it(label, fn) {
  try {
    const detail = await fn()
    passed++
    console.log(`  \x1b[32m✔\x1b[0m ${label}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}`)
  } catch (e) {
    failed++
    const msg = String(e.message ?? e).split('\n')[0].slice(0, 88)
    failures.push(`${page_} — ${label}: ${msg}`)
    console.log(`  \x1b[31m✘\x1b[0m ${label}  \x1b[31m${msg}\x1b[0m`)
  }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg) }

const stamp = Date.now()
const LEAD = { name: 'Audit Lead', email: `audit-lead-${stamp}@a.test`, password: 'audit-lead-password' }
let MEMBER = { name: 'Audit Member', email: `audit-member-${stamp}@a.test`, password: '' }

/* ---- seed a big event via the API so pagination controls can be exercised -- */
function api() {
  const jar = new Map()
  return {
    async call(p, o = {}) {
      const r = await fetch(BASE + p, { ...o, headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers ?? {}) } })
      for (const c of r.headers.getSetCookie?.() ?? []) { const kv = c.split(';')[0]; const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)) }
      const t = await r.text()
      return { status: r.status, body: t ? JSON.parse(t) : null }
    },
  }
}

/* The entry-page clauses depend on the seeded demo gallery being published —
   that is what DEMO_MODE surfaces. Check it up front and say so plainly, rather
   than letting six clauses fail later with opaque click timeouts. */
{
  const probe = await fetch(`${BASE}/`).then((r) => r.text())
  if (!probe.includes('What the client receives')) {
    console.log('\n\x1b[31mThe entry page is not showing its demo card.\x1b[0m')
    console.log('  The audit needs seeded demo data with a published gallery, and DEMO_MODE="true".')
    console.log('  Run:  npm run db:seed\n')
    process.exit(2)
  }
}

console.log('Preparing an event large enough to exercise pagination…')
const a = api()
await a.call('/api/auth/register', { method: 'POST', body: JSON.stringify(LEAD) })
const big = (await a.call('/api/events', { method: 'POST', body: JSON.stringify({ name: `Audit Wedding ${stamp}` }) })).body.event.id
const addMember = await a.call(`/api/events/${big}/members`, { method: 'POST', body: JSON.stringify({ email: MEMBER.email, name: MEMBER.name }) })
MEMBER.password = addMember.body.temporaryPassword

const bytes = await sharp({ create: { width: 400, height: 267, channels: 3, background: { r: 40, g: 80, b: 120 } } }).jpeg().toBuffer()
const photoIds = []
for (let i = 0; i < 62; i++) {
  const pre = await a.call(`/api/events/${big}/photos/presign`, { method: 'POST', body: JSON.stringify({ filename: `AUD_${String(i).padStart(3, '0')}.JPG`, mimeType: 'image/jpeg', fileSize: bytes.length }) })
  await fetch(pre.body.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: bytes })
  const c = await a.call(`/api/events/${big}/photos/confirm`, { method: 'POST', body: JSON.stringify({ storageKey: pre.body.storageKey, filename: `AUD_${String(i).padStart(3, '0')}.JPG` }) })
  photoIds.push(c.body.photo.id)
}
await new Promise((r) => setTimeout(r, 4000))
const sel = await a.call(`/api/events/${big}/gallery`, { method: 'POST', body: JSON.stringify({ title: 'Audit Gallery', photoIds: photoIds.slice(0, 40) }) })
const bigSlug = (await a.call(`/api/galleries/${sel.body.gallery.id}/publish`, { method: 'POST', body: JSON.stringify({ pin: PIN }) })).body.slug
console.log(`  62 photos, 40 selected, gallery /g/${bigSlug}\n`)

const files = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-'))
  return [0, 1].map((i) => { const p = join(dir, `UP_${i}.JPG`); writeFileSync(p, bytes); return p })
})()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } })
const p = await ctx.newPage()
const jsErrors = []
p.on('pageerror', (e) => jsErrors.push(e.message))
p.on('console', (m) => { if (m.type() === 'error') jsErrors.push(m.text().slice(0, 120)) })

/* ========================== / entry page ================================= */
heading('Page: /  (entry)')
await p.goto(BASE)
await it('renders the hero', async () => { await p.getByText('Shoot together').waitFor() })
await it('nav “How it works” anchors down the page', async () => {
  // .first(): the sticky nav link and the hero link share an accessible name.
  await p.getByRole('link', { name: 'How it works' }).first().click()
  await p.waitForTimeout(600)
  must(await p.evaluate(() => window.scrollY > 200), 'page did not scroll')
})
await it('nav “Demo logins” anchors to the credentials block', async () => {
  await p.getByRole('link', { name: 'Demo logins' }).click()
  await p.waitForTimeout(600)
  await p.getByText('Sign in as any of them').waitFor()
})
await it('“See how it works” anchors down', async () => {
  await p.goto(BASE)
  await p.getByRole('link', { name: /See how it works/ }).click()
  await p.waitForTimeout(600)
  must(await p.evaluate(() => window.scrollY > 200), 'no scroll')
})
await it('client pass card shows link and masked PIN', async () => {
  await p.goto(BASE)
  const card = p.locator('div').filter({ hasText: /^What the client receives/ }).first()
  const t = await card.innerText()
  must(t.includes('/g/'), 'no gallery link'); must(t.includes('•'), 'PIN not masked')
  must(!/\d{6}/.test(t), 'a six-digit PIN is visible on the card')
})
await it('“Demo PIN below” jumps to the credentials block', async () => {
  await p.getByRole('link', { name: 'Demo PIN below' }).click()
  await p.waitForTimeout(500)
  await p.getByText('demo-admin-pass-2026').waitFor()
})
await it('“Open it as the client” reaches a PIN gate', async () => {
  await p.goto(BASE)
  await p.getByRole('link', { name: /Open it as the client/ }).click()
  await p.waitForURL(/\/g\//)
  await p.getByText('Enter the six-digit PIN').waitFor()
})
await it('“Sign in to the demo” reaches the sign-in form', async () => {
  await p.goto(BASE)
  await p.getByRole('link', { name: /Sign in to the demo/ }).click()
  await p.waitForURL('**/login')
})

/* ========================== /login ======================================= */
heading('Page: /login')
await p.goto(`${BASE}/login`)
await it('renders name-free sign-in form', async () => {
  await p.locator('#email').waitFor(); await p.locator('#password').waitFor()
  must((await p.locator('#name').count()) === 0, 'register-only field present')
})
await it('“← Framehouse” returns to the entry page', async () => {
  await p.getByRole('link', { name: /Framehouse/ }).first().click()
  await p.waitForURL(new RegExp(`${BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`))
})
await it('wrong password shows a generic error, stays on the page', async () => {
  await p.goto(`${BASE}/login`)
  await p.fill('#email', 'admin@demo.test'); await p.fill('#password', 'definitely-wrong-pw')
  await p.click('button[type=submit]')
  // Next injects its own empty role="alert" route announcer, so scope to the
  // one inside the form rather than taking whichever matches first.
  const alert = p.locator('form [role=alert]')
  await alert.waitFor({ timeout: 15000 })
  const t = await alert.innerText()
  must(/don.t match/i.test(t), `unexpected message: ${t}`)
  must(p.url().includes('/login'), 'navigated away')
  return t
})
await it('unknown email gives the identical message', async () => {
  await p.goto(`${BASE}/login`)
  await p.fill('#email', `nobody-${stamp}@nowhere.test`); await p.fill('#password', 'definitely-wrong-pw')
  await p.click('button[type=submit]')
  const alert2 = p.locator('form [role=alert]')
  await alert2.waitFor({ timeout: 15000 })
  must(/don.t match/i.test(await alert2.innerText()), 'different message')
})
await it('“Create a workspace” link reaches /register', async () => {
  await p.getByRole('link', { name: /Create a workspace/ }).click()
  await p.waitForURL('**/register')
})

/* ========================== /register =================================== */
heading('Page: /register')
await it('duplicate email is rejected with a clear message', async () => {
  await p.goto(`${BASE}/register`)
  await p.fill('#name', 'Dup'); await p.fill('#email', 'admin@demo.test'); await p.fill('#password', 'some-long-password')
  await p.click('button[type=submit]')
  await p.locator('form [role=alert]').waitFor({ timeout: 15000 })
  return await p.locator('form [role=alert]').innerText()
})
await it('short password is rejected', async () => {
  await p.goto(`${BASE}/register`)
  await p.fill('#name', 'Short'); await p.fill('#email', `short-${stamp}@a.test`); await p.fill('#password', 'abc')
  await p.click('button[type=submit]')
  await p.locator('form [role=alert]').waitFor({ timeout: 15000 })
})
await it('“Sign in” link returns to /login', async () => {
  await p.getByRole('link', { name: /^Sign in$/ }).click()
  await p.waitForURL('**/login')
})

/* ========================== /events (lead) ============================== */
heading('Page: /events  (lead)')
await p.goto(`${BASE}/login`)
await p.fill('#email', LEAD.email); await p.fill('#password', LEAD.password)
await p.click('button[type=submit]'); await p.waitForURL('**/events')
await it('signs in and lists the lead’s events', async () => {
  await p.getByRole('link', { name: new RegExp(`Audit Wedding ${stamp}`) }).waitFor()
})
await it('“New event” opens the form', async () => {
  await p.getByRole('button', { name: 'New event' }).click()
  await p.locator('#event-name').waitFor()
})
await it('“Cancel” closes the form again', async () => {
  await p.getByRole('button', { name: 'Cancel' }).click()
  must((await p.locator('#event-name').count()) === 0, 'form still open')
})
await it('creates an event with name, date and description', async () => {
  await p.getByRole('button', { name: 'New event' }).click()
  await p.fill('#event-name', `Second Event ${stamp}`)
  await p.fill('#event-date', '2026-12-01')
  await p.fill('#event-description', 'Audit description')
  await p.getByRole('button', { name: 'Create event' }).click()
  await p.waitForURL(/\/events\/[a-z0-9]+$/)
  await p.getByText('Audit description').waitFor()
  await p.getByText('1 December 2026').waitFor()
})
await it('empty event shows a useful empty state', async () => {
  await p.getByText('No frames yet').waitFor()
})
await it('“← All events” returns to the list', async () => {
  await p.getByRole('link', { name: /All events/ }).click()
  await p.waitForURL('**/events')
})
await it('header wordmark links home to /events', async () => {
  await p.getByRole('link', { name: 'Framehouse' }).click()
  await p.waitForURL('**/events')
})

/* ========================== /events/[id] (lead) ========================== */
heading('Page: /events/[id]  (lead — contact sheet)')
await p.getByRole('link', { name: new RegExp(`Audit Wedding ${stamp}`) }).click()
await p.waitForURL(/\/events\/[a-z0-9]+$/)
const eventUrl = p.url()
await p.locator('ul li button[aria-label*="frame"]').first().waitFor()
await p.waitForTimeout(2500)

await it('shows the first page of 60 frames', async () => {
  const n = await p.locator('ul li button[aria-label*="frame"]').count()
  must(n === 60, `got ${n}`); return `${n} frames`
})
await it('“Load more frames” pulls the rest', async () => {
  await p.getByRole('button', { name: /Load more frames/ }).click()
  await p.waitForTimeout(2500)
  const n = await p.locator('ul li button[aria-label*="frame"]').count()
  must(n === 62, `got ${n}`); return `${n} frames`
})
await it('toolbar counts are announced accessibly', async () => {
  await p.getByLabel('62 frames').waitFor()
  await p.getByLabel('40 selected').waitFor()
})
await it('“Clear selection” empties it', async () => {
  await p.getByRole('button', { name: 'Clear selection' }).click()
  await p.getByLabel('0 selected').waitFor({ timeout: 15000 })
})
await it('clicking a frame selects it', async () => {
  await p.locator('ul li button[aria-label*="frame"]').nth(0).click()
  await p.getByLabel('1 selected').waitFor({ timeout: 15000 })
})
await it('clicking again deselects it', async () => {
  await p.locator('ul li button[aria-label*="frame"]').nth(0).click()
  await p.getByLabel('0 selected').waitFor({ timeout: 15000 })
})
await it('shift+click selects a range', async () => {
  const f = p.locator('ul li button[aria-label*="frame"]')
  await f.nth(0).click()
  await f.nth(4).click({ modifiers: ['Shift'] })
  await p.getByLabel('5 selected').waitFor({ timeout: 15000 })
})
await it('arrow keys move focus between frames', async () => {
  const f = p.locator('ul li button[aria-label*="frame"]')
  await f.nth(0).focus()
  const before = await p.evaluate(() => document.activeElement?.getAttribute('aria-label'))
  await p.keyboard.press('ArrowRight')
  const after = await p.evaluate(() => document.activeElement?.getAttribute('aria-label'))
  must(before !== after, 'focus did not move')
})
await it('space toggles selection on the focused frame', async () => {
  const n0 = Number((await p.getByLabel(/\d+ selected/).getAttribute('aria-label')).split(' ')[0])
  await p.keyboard.press(' ')
  await p.waitForTimeout(400)
  const n1 = Number((await p.getByLabel(/\d+ selected/).getAttribute('aria-label')).split(' ')[0])
  must(n0 !== n1, `count unchanged at ${n0}`); return `${n0} → ${n1}`
})
await it('selection autosaves', async () => { await p.getByText('Selection saved').waitFor({ timeout: 15000 }) })
await it('keyboard hints are shown and dismissible', async () => {
  await p.getByText('shift+click').waitFor()
  await p.getByRole('button', { name: /Dismiss keyboard hints/ }).click()
  must((await p.getByText('shift+click').count()) === 0, 'hints still visible')
})
await it('double-click opens the loupe', async () => {
  await p.locator('ul li button[aria-label*="frame"]').nth(1).dblclick()
  await p.locator('[role=dialog]').waitFor()
  await p.locator('[role=dialog] img').first().waitFor({ timeout: 15000 })
})
await it('loupe → next frame', async () => {
  const before = await p.locator('[role=dialog]').getAttribute('aria-label')
  await p.getByRole('button', { name: '→' }).click(); await p.waitForTimeout(700)
  must(before !== (await p.locator('[role=dialog]').getAttribute('aria-label')), 'did not advance')
})
await it('loupe → previous frame', async () => {
  const before = await p.locator('[role=dialog]').getAttribute('aria-label')
  await p.getByRole('button', { name: '←' }).click(); await p.waitForTimeout(700)
  must(before !== (await p.locator('[role=dialog]').getAttribute('aria-label')), 'did not go back')
})
await it('loupe shows a frame counter', async () => { await p.getByText(/^\d{3} \/ \d{3}$/).waitFor() })
await it('esc closes the loupe', async () => {
  await p.keyboard.press('Escape'); await p.waitForTimeout(600)
  must((await p.locator('[role=dialog]').count()) === 0, 'still open')
})
await it('browser Back closes the loupe without leaving', async () => {
  await p.locator('ul li button[aria-label*="frame"]').nth(1).dblclick()
  await p.locator('[role=dialog]').waitFor()
  await p.goBack(); await p.waitForTimeout(900)
  must((await p.locator('[role=dialog]').count()) === 0, 'loupe still open')
  must(p.url() === eventUrl, `left the page: ${p.url()}`)
})

heading('Page: /events/[id]  (lead — uploading)')
await it('dropzone offers a file picker', async () => { await p.getByRole('button', { name: 'choose files' }).waitFor() })
await it('uploads files and reports progress to completion', async () => {
  await p.setInputFiles('input[type=file]', files)
  await p.getByText('2 uploaded').waitFor({ timeout: 60000 })
})
await it('new frames appear at the end of the sheet', async () => {
  const n = await p.locator('ul li button[aria-label*="frame"]').count()
  must(n === 64, `got ${n}`); return `${n} frames`
})
await it('pending frames resolve to real thumbnails', async () => {
  await p.waitForFunction(() => document.querySelectorAll('button[aria-label*="still processing"]').length === 0, null, { timeout: 60000 })
})
await it('“Clear finished” empties the queue', async () => {
  await p.getByRole('button', { name: 'Clear finished' }).click()
  must((await p.getByText('2 uploaded').count()) === 0, 'queue still listed')
})
await it('a non-image file is rejected client-side with a reason', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bad-')); const bad = join(dir, 'notes.txt')
  writeFileSync(bad, 'not an image')
  await p.setInputFiles('input[type=file]', [bad])
  await p.getByText(/Only JPEG, PNG and WebP/).first().waitFor({ timeout: 15000 })
  return 'rejected before upload'
})

heading('Page: /events/[id]  (lead — team roster)')
await it('adds a member and shows a one-time temporary password', async () => {
  await p.fill('#member-email', `roster-${stamp}@a.test`)
  await p.fill('#member-name', 'Roster Person')
  await p.getByRole('button', { name: 'Add to event' }).click()
  const status = p.locator('[role=status]').filter({ hasText: 'Account created' })
  await status.waitFor({ timeout: 20000 })
  must(/fh-[a-z0-9]+/.test(await status.innerText()), 'no temporary password shown')
})
await it('adding the same person twice is refused', async () => {
  await p.fill('#member-email', `roster-${stamp}@a.test`)
  await p.getByRole('button', { name: 'Add to event' }).click()
  const rosterAlert = p.locator('section [role=alert]').first()
  await rosterAlert.waitFor({ timeout: 20000 })
  return await rosterAlert.innerText()
})
await it('removes a member', async () => {
  const before = await p.getByRole('button', { name: 'Remove' }).count()
  await p.getByRole('button', { name: 'Remove' }).last().click()
  await p.waitForTimeout(2500)
  const after = await p.getByRole('button', { name: 'Remove' }).count()
  must(after === before - 1, `${before} → ${after}`); return `${before} → ${after}`
})

heading('Page: /events/[id]  (lead — publish panel)')
await it('“Gallery” opens the panel for a published gallery', async () => {
  await p.getByRole('button', { name: 'Gallery' }).click()
  await p.getByRole('button', { name: 'Unpublish' }).waitFor()
})
await it('share link is shown and highlighted', async () => {
  const el = p.locator(`text=/\\/g\\/${bigSlug}/`).first()
  await el.waitFor()
  const border = await el.evaluate((n) => getComputedStyle(n).borderColor)
  must(border && border !== 'rgba(0, 0, 0, 0)', 'link has no accent border')
  return border
})
await it('“Copy link” confirms', async () => {
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'])
  await p.getByRole('button', { name: 'Copy link' }).click()
  await p.getByRole('button', { name: 'Copied' }).waitFor({ timeout: 8000 })
})
await it('“Open” points at the real gallery', async () => {
  const href = await p.getByRole('link', { name: 'Open' }).getAttribute('href')
  must(href.includes(`/g/${bigSlug}`), href)
})
await it('“Set a new PIN” reveals six inputs', async () => {
  await p.getByRole('button', { name: 'Set a new PIN' }).click()
  must((await p.locator('input[aria-label^="PIN digit"]').count()) === 6, 'not six boxes')
})
await it('PIN inputs auto-advance', async () => {
  const b = p.locator('input[aria-label^="PIN digit"]')
  await b.nth(0).fill('1')
  must(await b.nth(1).evaluate((n) => n === document.activeElement), 'focus did not advance')
})
await it('“Set new PIN” is disabled until six digits are entered', async () => {
  const submit = p.getByRole('button', { name: 'Set new PIN' })
  must(!(await submit.isEnabled()), 'enabled with one digit')
})
await it('sets a new PIN and stays published', async () => {
  const b = p.locator('input[aria-label^="PIN digit"]')
  for (let i = 0; i < 6; i++) await b.nth(i).fill('246810'[i])
  await p.getByRole('button', { name: 'Set new PIN' }).click()
  await p.getByRole('button', { name: 'Copy message with PIN' }).waitFor({ timeout: 20000 })
  await p.getByLabel('Gallery published').waitFor()
})
await it('one-time message contains the link and the PIN', async () => {
  const t = await p.locator('body').innerText()
  must(t.includes(`/g/${bigSlug}`) && t.includes('PIN: 246810'), 'message incomplete')
})
await it('“Copy message with PIN” confirms', async () => {
  await p.getByRole('button', { name: 'Copy message with PIN' }).click()
  await p.getByRole('button', { name: 'Copied' }).first().waitFor({ timeout: 8000 })
})
await it('the old PIN no longer opens the gallery', async () => {
  const r = await fetch(`${BASE}/api/public/gallery/${bigSlug}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.7' }, body: JSON.stringify({ pin: PIN }) })
  must(r.status === 401, `HTTP ${r.status}`)
})
await it('“Done” closes the panel', async () => {
  await p.getByRole('button', { name: 'Done' }).click()
  must((await p.getByRole('button', { name: 'Unpublish' }).count()) === 0, 'panel still open')
})

/* ========================== /events/[id] (member) ======================== */
heading('Page: /events/[id]  (member)')
const memberCtx = await browser.newContext({ viewport: { width: 1440, height: 950 } })
const m = await memberCtx.newPage()
await m.goto(`${BASE}/login`)
await m.fill('#email', MEMBER.email); await m.fill('#password', MEMBER.password)
await m.click('button[type=submit]'); await m.waitForURL('**/events')
await it('member signs in with the temporary password', async () => {
  await m.getByRole('link', { name: new RegExp(`Audit Wedding ${stamp}`) }).waitFor()
})
await it('member cannot create events', async () => {
  must((await m.getByRole('button', { name: 'New event' }).count()) === 0, 'New event offered')
})
await m.getByRole('link', { name: new RegExp(`Audit Wedding ${stamp}`) }).click()
await m.waitForURL(/\/events\/[a-z0-9]+$/)
await it('member sees only their own frames (none yet)', async () => {
  await m.getByText('Nothing uploaded yet').waitFor({ timeout: 15000 })
})
await it('member has no publish control', async () => {
  must((await m.getByRole('button', { name: /^Publish$|^Gallery$/ }).count()) === 0, 'publish offered')
})
await it('member has no team roster', async () => {
  must((await m.getByRole('button', { name: 'Add to event' }).count()) === 0, 'roster offered')
})
await it('member has no clear-selection control', async () => {
  must((await m.getByRole('button', { name: 'Clear selection' }).count()) === 0, 'selection offered')
})
await it('member uploads and sees their own frame', async () => {
  await m.setInputFiles('input[type=file]', [files[0]])
  await m.getByText('1 uploaded').waitFor({ timeout: 60000 })
  await m.waitForFunction(() => document.querySelectorAll('button[aria-label*="still processing"]').length === 0, null, { timeout: 60000 })
  const n = await m.locator('ul li button[aria-label*="frame"]').count()
  must(n === 1, `got ${n}`); return `${n} frame, not the lead's 64`
})
await it('member click opens the loupe rather than selecting', async () => {
  await m.locator('ul li button[aria-label*="frame"]').first().click()
  await m.locator('[role=dialog]').waitFor({ timeout: 10000 })
  await m.keyboard.press('Escape')
})
await it('member can delete their own frame', async () => {
  await m.locator('ul li button[aria-label*="frame"]').first().click()
  await m.locator('[role=dialog]').waitFor()
  await m.getByRole('button', { name: /Delete frame/ }).click()
  await m.waitForTimeout(2500)
  must((await m.locator('ul li button[aria-label*="frame"]').count()) === 0, 'frame still present')
})

/* The lead's selection clauses above genuinely changed what is published — that
   is the point of them. Restore the full selection before auditing the customer
   gallery, so the pagination clauses measure paging rather than leftovers. */
await a.call(`/api/events/${big}/gallery`, {
  method: 'POST',
  body: JSON.stringify({ title: 'Audit Gallery', photoIds: photoIds.slice(0, 40) }),
})
await a.call(`/api/galleries/${sel.body.gallery.id}/publish`, {
  method: 'POST',
  body: JSON.stringify({ pin: '246810' }),
})

/* ========================== /g/[slug] gate =============================== */
heading('Page: /g/[slug]  (PIN gate)')
const custCtx = await browser.newContext({ viewport: { width: 1440, height: 950 } })
const c = await custCtx.newPage()
await c.goto(`${BASE}/g/${bigSlug}`)
await it('gate renders with six inputs and no photos', async () => {
  await c.getByText('Enter the six-digit PIN').waitFor()
  must((await c.locator('input[aria-label^="Digit"]').count()) === 6, 'not six')
  must((await c.locator('img').count()) === 0, 'photos visible before the PIN')
})
await it('digits auto-advance', async () => {
  const b = c.locator('input[aria-label^="Digit"]')
  await b.nth(0).fill('9')
  must(await b.nth(1).evaluate((n) => n === document.activeElement), 'no auto-advance')
})
await it('backspace steps back a box', async () => {
  await c.keyboard.press('Backspace')
  const b = c.locator('input[aria-label^="Digit"]')
  must(await b.nth(0).evaluate((n) => n === document.activeElement), 'did not step back')
})
await it('wrong PIN reports without revealing existence, and clears', async () => {
  const b = c.locator('input[aria-label^="Digit"]')
  for (let i = 0; i < 6; i++) await b.nth(i).fill('1')
  await c.getByText('That PIN doesn’t match.').waitFor({ timeout: 20000 })
  must((await b.nth(0).inputValue()) === '', 'boxes not cleared')
})
await it('a nonexistent slug shows the same gate, not a 404', async () => {
  const q = await custCtx.newPage()
  await q.goto(`${BASE}/g/zzzzzzzzzzzz`)
  await q.getByText('Enter the six-digit PIN').waitFor()
  await q.close()
})
await it('correct PIN unlocks the gallery', async () => {
  const b = c.locator('input[aria-label^="Digit"]')
  for (let i = 0; i < 6; i++) await b.nth(i).fill('246810'[i])
  await c.getByRole('button', { name: /^Open / }).first().waitFor({ timeout: 25000 })
})

/* ========================== /g/[slug] gallery ============================ */
heading('Page: /g/[slug]  (gallery)')
await it('header shows title, photographer, event and count', async () => {
  await c.getByText('Audit Gallery').waitFor()
  await c.getByText('Photographs by').waitFor()
  await c.getByText('Frames', { exact: true }).waitFor()
})
await it('first page renders 36 photographs', async () => {
  await c.waitForTimeout(2500)
  const n = await c.getByRole('button', { name: /^Open / }).count()
  must(n === 36, `got ${n}`); return `${n} of 40`
})
await it('scrolling pulls the remaining page', async () => {
  await c.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await c.waitForTimeout(3000)
  const n = await c.getByRole('button', { name: /^Open / }).count()
  must(n === 40, `got ${n}`); return `${n} of 40`
})
await it('only the selected photographs are present', async () => {
  const n = await c.getByRole('button', { name: /^Open / }).count()
  must(n === 40, `${n} — should never reach 62`)
})
await it('clicking a photograph opens the lightbox', async () => {
  await c.evaluate(() => window.scrollTo(0, 0)); await c.waitForTimeout(500)
  await c.getByRole('button', { name: /^Open / }).first().click()
  await c.locator('[role=dialog] img').first().waitFor({ timeout: 20000 })
})
await it('lightbox arrow buttons move between photographs', async () => {
  const before = await c.locator('[role=dialog]').getAttribute('aria-label')
  await c.getByRole('button', { name: 'Next photograph' }).click(); await c.waitForTimeout(800)
  must(before !== (await c.locator('[role=dialog]').getAttribute('aria-label')), 'did not advance')
  await c.getByRole('button', { name: 'Previous photograph' }).click(); await c.waitForTimeout(800)
})
await it('keyboard arrows also move', async () => {
  const before = await c.locator('[role=dialog]').getAttribute('aria-label')
  await c.keyboard.press('ArrowRight'); await c.waitForTimeout(800)
  must(before !== (await c.locator('[role=dialog]').getAttribute('aria-label')), 'no keyboard nav')
})
await it('frame counter is shown', async () => { await c.getByText(/^\d{3} \/ \d{3}$/).waitFor() })
await it('Download is authorization-checked, not a bucket link', async () => {
  const href = await c.getByRole('link', { name: 'Download' }).getAttribute('href')
  must(href.startsWith('/api/public/gallery/'), href)
  const noCookie = await fetch(BASE + href, { redirect: 'manual' })
  must(noCookie.status === 404, `without a cookie: HTTP ${noCookie.status}`)
  return 'redirects only with a valid gallery cookie'
})
await it('esc closes the lightbox', async () => {
  await c.keyboard.press('Escape'); await c.waitForTimeout(600)
  must((await c.locator('[role=dialog]').count()) === 0, 'still open')
})
await it('browser Back closes the lightbox without leaving the gallery', async () => {
  await c.getByRole('button', { name: /^Open / }).first().click()
  await c.locator('[role=dialog]').waitFor()
  await c.goBack(); await c.waitForTimeout(1000)
  must((await c.locator('[role=dialog]').count()) === 0, 'lightbox still open')
  must(c.url().includes(`/g/${bigSlug}`), `left: ${c.url()}`)
})
await it('unpublishing locks the customer out on reload', async () => {
  await a.call(`/api/galleries/${sel.body.gallery.id}/unpublish`, { method: 'POST' })
  await c.reload()
  await c.getByText('Enter the six-digit PIN').waitFor({ timeout: 20000 })
})

/* ========================== 404s and sign out =========================== */
heading('Pages: 404 and sign out')
await it('public 404 sits on the warm entry surface', async () => {
  const q = await custCtx.newPage()
  await q.goto(`${BASE}/no-such-page`)
  await q.getByText('Nothing at this address').waitFor()
  const bg = await q.evaluate(() => getComputedStyle(document.body).backgroundColor)
  must(bg === 'rgb(21, 17, 15)', bg); await q.close(); return bg
})
await it('workspace 404 sits on the cool tool surface', async () => {
  await p.goto(`${BASE}/events/not-a-real-event-id`)
  await p.getByText('This event is not on your list').waitFor()
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor)
  must(bg === 'rgb(18, 22, 28)', bg); return bg
})
await it('workspace 404 links back to the events list', async () => {
  await p.getByRole('link', { name: /Back to your events/ }).click()
  await p.waitForURL('**/events')
})
await it('sign out returns to /login', async () => {
  await p.getByRole('button', { name: 'Sign out' }).click()
  await p.waitForURL('**/login')
})
await it('after signing out the workspace is unreachable', async () => {
  await p.goto(`${BASE}/events`)
  await p.waitForURL('**/login', { timeout: 15000 })
})

heading('Console')
await it('no uncaught JavaScript errors across the whole walk', async () => {
  const real = jsErrors.filter((e) => !/Failed to load resource|net::ERR_ABORTED/i.test(e))
  must(real.length === 0, real.slice(0, 3).join(' | '))
  return `${jsErrors.length} suppressed network notices, 0 real`
})

await browser.close()
console.log(`\n${'─'.repeat(66)}`)
console.log(`  \x1b[32m${passed} passed\x1b[0m` + (failed ? `   \x1b[31m${failed} failed\x1b[0m` : '   0 failed'))
if (failed) { console.log('\n  Failures:'); for (const f of failures) console.log(`   • ${f}`) }
console.log(`${'─'.repeat(66)}\n`)
process.exit(failed ? 1 : 0)
