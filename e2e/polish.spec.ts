// Milestone 5: shopping polish.
import { expect, test } from '@playwright/test'
import { addItems, addMember, checkedItems, freshEmail, liveItems, row, serverDocs, signInFresh } from './helpers'

test('a delete can be undone from the toast', async ({ page }) => {
  const uid = await signInFresh(page)
  await addItems(page, 'Milk', 'Bread')
  await page.getByRole('button', { name: 'Delete Milk' }).click()
  await expect(liveItems(page)).toHaveText(['Bread'])
  await expect(page.getByRole('status')).toContainText('Deleted Milk')

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(liveItems(page)).toHaveText(['Bread', 'Milk'])
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect.poll(async () => (await serverDocs(uid)).every((i) => !i.deleted)).toBe(true)
})

test('clearing checked items can be undone, and the toast goes away by itself', async ({ page }) => {
  await signInFresh(page)
  await addItems(page, 'Milk', 'Bread', 'Eggs')
  await liveItems(page).filter({ hasText: 'Milk' }).click()
  await liveItems(page).filter({ hasText: 'Eggs' }).click()
  await expect(checkedItems(page)).toHaveCount(2)
  await page.getByRole('button', { name: 'Clear checked' }).click()
  await expect(checkedItems(page)).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('Cleared 2 items')

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(checkedItems(page)).toHaveText(['Milk', 'Eggs'])

  await page.getByRole('button', { name: 'Delete Bread' }).click()
  await expect(page.getByRole('status')).toBeVisible()
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 10_000 })
})

test('"Not synced" shows only while changes have not reached the server', async ({ page, context }) => {
  await signInFresh(page)
  await addItems(page, 'Milk')
  const marker = page.getByText('Not synced')
  await expect(marker).toHaveCount(0)

  await context.setOffline(true)
  await addItems(page, 'Bread')
  await expect(marker).toBeVisible()
  await context.setOffline(false)
  await expect(marker).toHaveCount(0, { timeout: 15_000 })
})

test('the same product added on two phones shows as one row, and one tap checks both', async ({ browser }) => {
  const [a, b] = await Promise.all([0, 1].map(async () => (await browser.newContext()).newPage()))
  const aUid = await signInFresh(a)
  const bUid = await signInFresh(b, freshEmail('bo'))
  await addMember(aUid, bUid)
  await addItems(a, 'Bread')
  await expect(liveItems(b)).toHaveText(['Bread'])

  await a.context().setOffline(true)
  await b.context().setOffline(true)
  await addItems(a, 'Milk: 1')
  await addItems(b, 'milk: 2 l')
  await a.context().setOffline(false)
  await b.context().setOffline(false)
  await expect.poll(async () => (await serverDocs(aUid)).filter((i) => i.normName === 'milk').length).toBe(2)

  for (const page of [a, b]) {
    await expect(liveItems(page)).toHaveText(['Bread', /^milk$/i])
    await expect(row(page, 'Milk').or(row(page, 'milk')).getByTestId('item-quantity')).toHaveText('1, 2 l')
  }
  await liveItems(a).filter({ hasText: /milk/i }).click()
  await expect.poll(async () => (await serverDocs(aUid)).filter((i) => i.normName === 'milk').every((i) => i.checked)).toBe(true)
  await expect(checkedItems(b)).toHaveCount(1)
})

test('the screen is kept awake while the list is open', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { wakeLocks: number }
    w.wakeLocks = 0
    Object.defineProperty(navigator, 'wakeLock', {
      value: {
        request: async () => {
          w.wakeLocks += 1
          return { released: false, release: async () => {}, addEventListener: () => {} }
        },
      },
    })
  })
  await signInFresh(page)
  await expect.poll(() => page.evaluate(() => (window as unknown as { wakeLocks: number }).wakeLocks)).toBeGreaterThan(0)
})
