// Milestone 4's exit test: three phones, one list, conflicting offline edits
// converging. Each phone is its own browser context running the real app.
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { addItems, addMember, checkedItems, liveItems, signInFresh } from './helpers'

type Phone = { context: BrowserContext; page: Page; uid: string }

async function phone(browser: import('@playwright/test').Browser): Promise<Phone> {
  const context = await browser.newContext()
  const page = await context.newPage()
  return { context, page, uid: await signInFresh(page) }
}

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
  await expect(liveItems(a.page)).toHaveText(['Milk', 'Bread'])
})

test('three phones make conflicting edits offline and end with the same list', async ({ browser }) => {
  test.setTimeout(60_000)
  const phones = [await phone(browser), await phone(browser), await phone(browser)]
  const [a, b, c] = phones
  await addMember(a.uid, b.uid)
  await addMember(a.uid, c.uid)
  await addItems(a.page, 'Milk', 'Bread', 'Eggs')
  for (const { page } of phones) await expect(liveItems(page)).toHaveText(['Milk', 'Bread', 'Eggs'])

  // Online, a change reaches the others within a moment.
  await addItems(b.page, 'Butter')
  for (const { page } of phones) await expect(liveItems(page)).toHaveText(['Milk', 'Bread', 'Eggs', 'Butter'])

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
    await expect(liveItems(page)).toHaveText(['Bread', 'Butter', 'Apples', 'Coffee'])
    await expect(checkedItems(page)).toHaveCount(0)
  }
})
