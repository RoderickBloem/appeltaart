// Milestone 4's exit test: three phones, one list, conflicting offline edits
// converging. Each phone is its own browser context running the real app.
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { addItems, addMember, checkedItems, freshEmail, liveItems, signInFresh } from './helpers'

type Phone = { context: BrowserContext; page: Page; uid: string }

async function phone(browser: import('@playwright/test').Browser, email = freshEmail()): Promise<Phone> {
  const context = await browser.newContext()
  const page = await context.newPage()
  return { context, page, uid: await signInFresh(page, email) }
}

/** Opens the share panel and invites `email`. */
async function invite(page: Page, email: string) {
  await page.getByRole('button', { name: 'Share' }).click()
  await page.getByLabel('Gmail address').fill(email)
  await page.getByRole('button', { name: 'Invite' }).click()
}

test('a member invites someone by Gmail address, who joins on signing in and can invite the next', async ({ browser }) => {
  const a = await phone(browser)
  await addItems(a.page, 'Milk')

  // Capitals do not matter.
  const bEmail = freshEmail('bea')
  await invite(a.page, bEmail.toUpperCase())
  await expect(a.page.getByTestId('invites')).toContainText(bEmail)

  const b = await phone(browser, bEmail)
  await expect(liveItems(b.page)).toHaveText(['Milk'])
  // The invitation is used up, and the panel counts two people.
  await expect(a.page.getByTestId('invites')).not.toContainText(bEmail)
  await expect(a.page.getByTestId('member-count')).toHaveText('2 people in this household')

  // The newcomer has the same rights, including inviting.
  const cEmail = freshEmail('cas')
  await invite(b.page, cEmail)
  const c = await phone(browser, cEmail)
  await expect(liveItems(c.page)).toHaveText(['Milk'])
  await addItems(c.page, 'Bread')
  await expect(liveItems(a.page)).toHaveText(['Bread', 'Milk'])
  await expect(liveItems(b.page)).toHaveText(['Bread', 'Milk'])
})

test('a Gmail invitation ignores dots and a +suffix, as Gmail does', async ({ browser }) => {
  const a = await phone(browser)
  await addItems(a.page, 'Milk')
  const local = `dora${crypto.randomUUID().slice(0, 8)}`
  await invite(a.page, `d.o.r.a${local.slice(4)}+shopping@gmail.com`)
  const b = await phone(browser, `${local}@gmail.com`)
  await expect(liveItems(b.page)).toHaveText(['Milk'])
})

test('a withdrawn invitation lets nobody in', async ({ browser }) => {
  const a = await phone(browser)
  await addItems(a.page, 'Milk')
  const bEmail = freshEmail('eve')
  await invite(a.page, bEmail)
  await a.page.getByRole('button', { name: `Withdraw invitation for ${bEmail}` }).click()
  await expect(a.page.getByTestId('invites')).not.toContainText(bEmail)

  const b = await phone(browser, bEmail)
  await addItems(b.page, 'Own item')
  await expect(liveItems(b.page)).toHaveText(['Own item'])
})

const tap = (page: Page, name: string) => page.getByTestId('item-name').filter({ hasText: name }).click()

test('a member added by hand sees the shared list instead of their own', async ({ browser }) => {
  const [a, b] = [await phone(browser), await phone(browser)]
  await addItems(a.page, 'Milk')
  // b has a list of its own until the maintainer adds them.
  await addItems(b.page, 'Own item')
  await expect(liveItems(b.page)).toHaveText(['Own item'])

  await addMember(a.uid, b.uid)
  await expect(liveItems(b.page)).toHaveText(['Milk'])
  await b.page.reload()
  await expect(liveItems(b.page)).toHaveText(['Milk'])

  await addItems(b.page, 'Bread')
  await expect(liveItems(a.page)).toHaveText(['Bread', 'Milk'])
})

test('three phones make conflicting edits offline and end with the same list', async ({ browser }) => {
  test.setTimeout(60_000)
  const phones = [await phone(browser), await phone(browser), await phone(browser)]
  const [a, b, c] = phones
  await addMember(a.uid, b.uid)
  await addMember(a.uid, c.uid)
  await addItems(a.page, 'Milk', 'Bread', 'Eggs')
  for (const { page } of phones) await expect(liveItems(page)).toHaveText(['Bread', 'Milk', 'Eggs'])

  // Online, a change reaches the others within a moment.
  await addItems(b.page, 'Butter')
  for (const { page } of phones) await expect(liveItems(page)).toHaveText(['Bread', 'Milk', 'Eggs', 'Butter'])

  for (const { context } of phones) await context.setOffline(true)

  // a checks Milk while b deletes it: the delete wins.
  await tap(a.page, 'Milk')
  await addItems(a.page, 'Apples')
  await b.page.getByRole('button', { name: 'Delete Milk' }).click()
  // b and c both check Eggs, and c clears it.
  await tap(b.page, 'Eggs')
  await tap(c.page, 'Eggs')
  await c.page.getByRole('button', { name: 'Clear checked' }).click()
  await addItems(c.page, 'Coffee')

  // b is force-quit and reopened, still offline.
  await b.page.close({ runBeforeUnload: false })
  b.page = await b.context.newPage()
  await b.page.goto('/')
  await expect(liveItems(b.page)).toHaveText(['Bread', 'Butter'])
  await expect(checkedItems(b.page)).toHaveText(['Eggs'])

  // Back online one at a time.
  for (const { context, page } of phones) {
    await context.setOffline(false)
    await page.waitForTimeout(1_000)
  }

  for (const { page } of phones) {
    await expect(liveItems(page)).toHaveText(['Apples', 'Bread', 'Butter', 'Coffee'])
    await expect(checkedItems(page)).toHaveCount(0)
  }
})
