import { expect, test } from '@playwright/test'
import { addItems, addMember, freshEmail, liveItems, row, setCategory, signInFresh } from './helpers'

test('a product remembers its category: typed again later, it lands in the same one', async ({ page }) => {
  await signInFresh(page)
  await addItems(page, 'Quinoa')
  await expect(row(page, 'Quinoa')).toHaveAttribute('data-category', '')

  await setCategory(page, 'Quinoa', 'Pantry')
  await expect(row(page, 'Quinoa')).toHaveAttribute('data-category', 'pantry')

  // Next week: bought, cleared, and typed again in different capitals.
  await page.getByRole('button', { name: 'Delete Quinoa' }).click()
  await expect(row(page, 'Quinoa')).toHaveCount(0)
  await addItems(page, 'quinoa')
  await expect(row(page, 'quinoa')).toHaveAttribute('data-category', 'pantry')
})

test('items are sorted by category in shop order, uncategorised last', async ({ page }) => {
  await signInFresh(page)
  await addItems(page, 'Milk', 'Soap', 'Tomatoes', 'Bread', 'Cucumber')
  await setCategory(page, 'Milk', 'Dairy & eggs')
  await setCategory(page, 'Tomatoes', 'Fruit & vegetables')
  await setCategory(page, 'Bread', 'Bread & bakery')
  await setCategory(page, 'Cucumber', 'Fruit & vegetables')
  // Within a category, the order they were added in.
  await expect(liveItems(page)).toHaveText(['Tomatoes', 'Cucumber', 'Bread', 'Milk', 'Soap'])
})

test('a category set on one phone is used on the other', async ({ browser }) => {
  const [a, b] = await Promise.all([browser.newContext(), browser.newContext()].map(async (c) => (await c).newPage()))
  const aUid = await signInFresh(a)
  const bUid = await signInFresh(b, freshEmail('bo'))
  await addMember(aUid, bUid)
  await addItems(a, 'Bread')
  await expect(liveItems(b)).toHaveText(['Bread'])

  await addItems(a, 'Quinoa')
  await setCategory(a, 'Quinoa', 'Pantry')
  await a.getByRole('button', { name: 'Delete Quinoa' }).click()
  await expect(row(a, 'Quinoa')).toHaveCount(0)
  await expect(liveItems(b)).toHaveText(['Bread'])

  await addItems(b, 'Quinoa')
  await expect(row(b, 'Quinoa')).toHaveAttribute('data-category', 'pantry')
  await expect(row(a, 'Quinoa')).toHaveAttribute('data-category', 'pantry')
})

test('a category changed again is remembered as changed', async ({ page }) => {
  await signInFresh(page)
  await addItems(page, 'Milk')
  await setCategory(page, 'Milk', 'Dairy & eggs')
  await setCategory(page, 'Milk', 'Drinks')
  await expect(row(page, 'Milk')).toHaveAttribute('data-category', 'drinks')
  await page.getByRole('button', { name: 'Delete Milk' }).click()
  await expect(row(page, 'Milk')).toHaveCount(0)
  await addItems(page, 'milk')
  await expect(row(page, 'milk')).toHaveAttribute('data-category', 'drinks')
})
