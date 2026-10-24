import { expect, test } from '@playwright/test'
import { addItems, checkedItems, liveItems, serverItems, signInFresh } from './helpers'

test('items are added in order and the field stays focused', async ({ page }) => {
  const uid = await signInFresh(page)
  await addItems(page, 'Milk', 'Bread', 'Äpfel')

  await expect(liveItems(page)).toHaveText(['Milk', 'Bread', 'Äpfel'])
  await expect(page.getByLabel('New item')).toBeFocused()
  await expect(page.getByLabel('New item')).toHaveValue('')
  await expect.poll(() => serverItems(uid)).toEqual([
    { name: 'Äpfel', checked: false, deleted: false },
    { name: 'Bread', checked: false, deleted: false },
    { name: 'Milk', checked: false, deleted: false },
  ])
})

test('blank input adds nothing', async ({ page }) => {
  await signInFresh(page)
  await addItems(page, '   ', 'Milk')
  await expect(liveItems(page)).toHaveText(['Milk'])
})

test('tapping a row checks it, tapping a checked row unchecks it', async ({ page }) => {
  const uid = await signInFresh(page)
  await addItems(page, 'Milk', 'Bread')

  await liveItems(page).filter({ hasText: 'Milk' }).click()
  await expect(liveItems(page)).toHaveText(['Bread'])
  await expect(checkedItems(page)).toHaveText(['Milk'])
  await expect.poll(async () => (await serverItems(uid)).find((i) => i.name === 'Milk')?.checked).toBe(true)

  await checkedItems(page).filter({ hasText: 'Milk' }).click()
  await expect(liveItems(page)).toHaveText(['Milk', 'Bread'])
  await expect(checkedItems(page)).toHaveCount(0)
  await expect.poll(async () => (await serverItems(uid)).find((i) => i.name === 'Milk')?.checked).toBe(false)
})

test('clear checked deletes only the checked items', async ({ page }) => {
  const uid = await signInFresh(page)
  await addItems(page, 'Milk', 'Bread', 'Eggs')
  await liveItems(page).filter({ hasText: 'Milk' }).click()
  await liveItems(page).filter({ hasText: 'Eggs' }).click()
  await expect(checkedItems(page)).toHaveCount(2)

  await page.getByRole('button', { name: 'Clear checked' }).click()
  await expect(checkedItems(page)).toHaveCount(0)
  await expect(liveItems(page)).toHaveText(['Bread'])
  await expect.poll(() => serverItems(uid)).toEqual([
    { name: 'Bread', checked: false, deleted: false },
    { name: 'Eggs', checked: true, deleted: true },
    { name: 'Milk', checked: true, deleted: true },
  ])
})

test('delete is soft: the item leaves the list and stays on the server as a tombstone', async ({ page }) => {
  const uid = await signInFresh(page)
  await addItems(page, 'Milk', 'Bread')
  await page.getByRole('button', { name: 'Delete Milk' }).click()

  await expect(liveItems(page)).toHaveText(['Bread'])
  await expect.poll(() => serverItems(uid)).toEqual([
    { name: 'Bread', checked: false, deleted: false },
    { name: 'Milk', checked: false, deleted: true },
  ])
})

// Open question 2 in docs/spec.md: deletedAt is a pending server timestamp
// while offline. The live-items query must not keep matching it as null.
test('an offline delete leaves the live list at once, also after a restart', async ({ page, context }) => {
  const uid = await signInFresh(page)
  await addItems(page, 'Milk', 'Bread')
  await expect.poll(async () => (await serverItems(uid)).length).toBe(2)

  await context.setOffline(true)
  await page.getByRole('button', { name: 'Delete Milk' }).click()
  await expect(liveItems(page)).toHaveText(['Bread'])

  await page.reload()
  await expect(liveItems(page)).toHaveText(['Bread'])

  await context.setOffline(false)
  await expect.poll(async () => (await serverItems(uid)).find((i) => i.name === 'Milk')?.deleted).toBe(true)
})

// The milestone's exit test: writes made with no network survive closing the
// app with no network, and reach the server once the network returns.
test('offline changes survive a force-quit and sync when back online', async ({ context }) => {
  let page = await context.newPage()
  const uid = await signInFresh(page)
  await addItems(page, 'Milk', 'Bread')
  await expect.poll(async () => (await serverItems(uid)).length).toBe(2)

  await context.setOffline(true)
  await addItems(page, 'Eggs', 'Butter')
  await liveItems(page).filter({ hasText: 'Bread' }).click()
  await page.getByRole('button', { name: 'Delete Milk' }).click()
  await expect(liveItems(page)).toHaveText(['Eggs', 'Butter'])

  // Closing the page without any shutdown is as close to a force-quit as a
  // browser gets; the IndexedDB data lives on in the browser context.
  await page.close({ runBeforeUnload: false })
  page = await context.newPage()
  await page.goto('/')
  await expect(liveItems(page)).toHaveText(['Eggs', 'Butter'])
  await expect(checkedItems(page)).toHaveText(['Bread'])
  expect(await serverItems(uid)).toEqual([
    { name: 'Bread', checked: false, deleted: false },
    { name: 'Milk', checked: false, deleted: false },
  ])

  await context.setOffline(false)
  await expect.poll(() => serverItems(uid)).toEqual([
    { name: 'Bread', checked: true, deleted: false },
    { name: 'Butter', checked: false, deleted: false },
    { name: 'Eggs', checked: false, deleted: false },
    { name: 'Milk', checked: false, deleted: true },
  ])
})
