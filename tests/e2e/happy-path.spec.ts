import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'

/**
 * The workflow from the brief, end to end, in a real browser:
 *
 *   lead registers -> creates an event -> adds a team member
 *   -> member signs in and uploads -> lead reviews, selects and publishes
 *   -> customer opens the link, enters the PIN, sees exactly the selected count
 *
 * Nothing is stubbed. Files go browser -> presigned PUT -> object storage, and
 * the customer's images come back as presigned GETs.
 */

const UPLOAD_COUNT = 4
const SELECT_COUNT = 2
const PIN = '482917'

const unique = Date.now()
const LEAD = { email: `lead-${unique}@e2e.test`, password: 'e2e-lead-password', name: 'Meera Raghavan' }
const MEMBER = { email: `member-${unique}@e2e.test`, name: 'Nikhil Shetty' }

/** Real JPEGs, written once, so the upload path is exercised for what it is. */
function makeFixtures(count: number): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), 'framehouse-e2e-'))
  return Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const bytes = await sharp({
        create: { width: 1200, height: 800, channels: 3, background: { r: 30 + i * 45, g: 70, b: 120 } },
      })
        .jpeg()
        .toBuffer()
      const path = join(dir, `DSC_02${String(i).padStart(2, '0')}.JPG`)
      writeFileSync(path, bytes)
      return path
    })
  )
}

test('lead publishes a gallery and a customer opens it with the PIN', async ({ browser }) => {
  const files = await makeFixtures(UPLOAD_COUNT)

  // --- lead: register, create an event, add a member --------------------
  const leadContext = await browser.newContext()
  const lead = await leadContext.newPage()

  await lead.goto('/register')
  await lead.fill('#name', LEAD.name)
  await lead.fill('#email', LEAD.email)
  await lead.fill('#password', LEAD.password)
  await lead.click('button[type=submit]')
  await lead.waitForURL('**/events')

  await lead.click('text=New event')
  await lead.fill('#event-name', 'Arjun & Priya Wedding')
  await lead.click('button:has-text("Create event")')
  await lead.waitForURL(/\/events\/[a-z0-9]+$/)
  const eventUrl = lead.url()

  await lead.fill('#member-email', MEMBER.email)
  await lead.fill('#member-name', MEMBER.name)
  await lead.click('button:has-text("Add to event")')

  // The temporary password is shown exactly once, at creation.
  const credential = lead.locator('[role=status]')
  await expect(credential).toContainText(MEMBER.email)
  const memberPassword = (await credential.innerText()).match(/fh-[a-z0-9]+/)?.[0]
  expect(memberPassword, 'a temporary password should be issued').toBeTruthy()

  // --- member: sign in and upload --------------------------------------
  const memberContext = await browser.newContext()
  const member = await memberContext.newPage()

  await member.goto('/login')
  await member.fill('#email', MEMBER.email)
  await member.fill('#password', memberPassword!)
  await member.click('button[type=submit]')
  await member.waitForURL('**/events')

  await member.click(`text=Arjun & Priya Wedding`)
  await member.waitForURL(/\/events\/[a-z0-9]+$/)

  await member.setInputFiles('input[type=file]', files)
  await expect(member.getByText(`${UPLOAD_COUNT} uploaded`)).toBeVisible({ timeout: 60_000 })
  await expect(member.locator('ul li button[aria-label*="frame"]')).toHaveCount(UPLOAD_COUNT)

  // A member cannot publish: the control is not rendered for them at all.
  await expect(member.getByRole('button', { name: 'Publish' })).toHaveCount(0)

  // --- lead: review, select, publish -----------------------------------
  await lead.goto(eventUrl)
  const frames = lead.locator('ul li button[aria-label*="frame"]')
  await expect(frames).toHaveCount(UPLOAD_COUNT)

  for (let i = 0; i < SELECT_COUNT; i++) await frames.nth(i).click()
  await expect(lead.getByText('Selection saved')).toBeVisible()
  await expect(lead.getByText(`${SELECT_COUNT} selected`)).toBeVisible()

  await lead.getByRole('button', { name: 'Publish' }).click()
  const pinBoxes = lead.locator('input[aria-label^="PIN digit"]')
  for (let i = 0; i < 6; i++) await pinBoxes.nth(i).fill(PIN[i]!)
  await lead.getByRole('button', { name: 'Publish', exact: true }).last().click()

  await expect(lead.getByText('Published', { exact: true })).toBeVisible()
  const shareUrl = await lead.locator('span:has-text("/g/")').first().innerText()
  expect(shareUrl).toContain('/g/')

  // --- customer: no account, link plus PIN ------------------------------
  const customerContext = await browser.newContext()
  const customer = await customerContext.newPage()

  await customer.goto(shareUrl)
  await expect(customer.getByText('Enter the six-digit PIN your photographer sent you.')).toBeVisible()

  // A wrong PIN says nothing about whether the gallery exists.
  const gateBoxes = customer.locator('input[aria-label^="Digit"]')
  for (let i = 0; i < 6; i++) await gateBoxes.nth(i).fill('1')
  await expect(customer.getByText('That PIN doesn’t match.')).toBeVisible()

  for (let i = 0; i < 6; i++) await gateBoxes.nth(i).fill(PIN[i]!)

  // Exactly the selected count — not everything uploaded to the event.
  await expect(customer.getByRole('button', { name: /^Open / })).toHaveCount(SELECT_COUNT, {
    timeout: 20_000,
  })
  // The metadata rail states the count independently of the grid.
  await expect(customer.getByText('Frames', { exact: true })).toBeVisible()

  // The lightbox fetches the full-resolution original through the gallery path.
  await customer.getByRole('button', { name: /^Open / }).first().click()
  await expect(customer.locator('[role=dialog] img')).toBeVisible({ timeout: 20_000 })
  await customer.keyboard.press('Escape')

  // --- unpublishing revokes the customer's existing session -------------
  await lead.getByRole('button', { name: 'Unpublish' }).click()
  await expect(lead.getByText('Unpublished. The link no longer opens.')).toBeVisible()

  await customer.reload()
  await expect(customer.getByText('Enter the six-digit PIN your photographer sent you.')).toBeVisible()

  await leadContext.close()
  await memberContext.close()
  await customerContext.close()
})
