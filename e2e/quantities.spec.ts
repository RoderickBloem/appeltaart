import { expect, test } from '@playwright/test'
import { addItems, checkedItems, liveItems, row, setCategory, signInFresh } from './helpers'

const quantity = (page: import('@playwright/test').Page, name: string) => row(page, name).getByTestId('item-quantity')

test('"name: amount" adds the item with a quantity, a number or anything else', async ({ page }) => {
  await signInFresh(page)
  await addItems(page, 'Tomatoes: 6', 'Avocados : ripe', 'Rice')
  await expect(liveItems(page)).toHaveText(['Tomatoes', 'Avocados', 'Rice'])
  await expect(quantity(page, 'Tomatoes')).toHaveText('6')
  await expect(quantity(page, 'Avocados')).toHaveText('ripe')
  await expect(quantity(page, 'Rice')).toHaveCount(0)
})

test('typing a product already on the list changes it instead of adding it twice', async ({ page }) => {
  await signInFresh(page)
  await addItems(page, 'Tomatoes: 6')
  await expect(quantity(page, 'Tomatoes')).toHaveText('6')
  await addItems(page, 'tomatoes: 8')
  await expect(liveItems(page)).toHaveText(['Tomatoes'])
  await expect(quantity(page, 'Tomatoes')).toHaveText('8')

  // Without an amount, the amount stays; with an empty one, it goes.
  await addItems(page, 'TOMATOES')
  await expect(quantity(page, 'Tomatoes')).toHaveText('8')
  await addItems(page, 'tomatoes:')
  await expect(liveItems(page)).toHaveText(['Tomatoes'])
  await expect(quantity(page, 'Tomatoes')).toHaveCount(0)
})

test('typing a checked product puts it back on the list', async ({ page }) => {
  await signInFresh(page)
  await addItems(page, 'Milk')
  await liveItems(page).filter({ hasText: 'Milk' }).click()
  await expect(checkedItems(page)).toHaveText(['Milk'])
  await addItems(page, 'milk: 2')
  await expect(liveItems(page)).toHaveText(['Milk'])
  await expect(checkedItems(page)).toHaveCount(0)
  await expect(quantity(page, 'Milk')).toHaveText('2')
})

test('the category is remembered by the name, whatever the quantity', async ({ page }) => {
  await signInFresh(page)
  await addItems(page, 'Quinoa: 6')
  await setCategory(page, 'Quinoa', 'Pantry')
  await page.getByRole('button', { name: 'Delete Quinoa' }).click()
  await expect(row(page, 'Quinoa')).toHaveCount(0)
  await addItems(page, 'quinoa: 3')
  await expect(row(page, 'quinoa')).toHaveAttribute('data-category', 'pantry')
})
