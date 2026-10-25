// Milestone 7: a seed list of common groceries, type-ahead, and the category
// filled in automatically.
import { expect, test, type Page } from '@playwright/test'
import { addItems, liveItems, row, setCategory, signInFresh } from './helpers'

const suggestions = (page: Page) => page.getByTestId('suggestions').getByRole('button')

async function typeOnly(page: Page, text: string) {
  await page.getByLabel('New item').fill(text)
}

async function addAndDelete(page: Page, name: string) {
  await addItems(page, name)
  await page.getByRole('button', { name: `Delete ${name}` }).click()
  await expect(row(page, name)).toHaveCount(0)
}

test('a few letters suggest common groceries; picking one adds it in its category', async ({ page }) => {
  await signInFresh(page)
  await typeOnly(page, 'toma')
  await expect(suggestions(page).first()).toHaveText('Tomatoes')
  await suggestions(page).first().click()

  await expect(liveItems(page)).toHaveText(['Tomatoes'])
  await expect(row(page, 'Tomatoes')).toHaveAttribute('data-category', 'produce')
  await expect(page.getByLabel('New item')).toHaveValue('')
  await expect(page.getByLabel('New item')).toBeFocused()
  await expect(suggestions(page)).toHaveCount(0)
})

test('a common grocery typed in full gets its category without picking', async ({ page }) => {
  await signInFresh(page)
  await addItems(page, 'bananas', 'Frozen peas', 'washing-up liquid', 'Glitter')
  await expect(row(page, 'bananas')).toHaveAttribute('data-category', 'produce')
  await expect(row(page, 'Frozen peas')).toHaveAttribute('data-category', 'frozen')
  await expect(row(page, 'washing-up liquid')).toHaveAttribute('data-category', 'household')
  await expect(row(page, 'Glitter')).toHaveAttribute('data-category', '')
})

test('products this list has used come first, the most used first', async ({ page }) => {
  await signInFresh(page)
  await addAndDelete(page, 'Toffee crunch')
  await addAndDelete(page, 'Tortilla chips extra')
  await addAndDelete(page, 'Tortilla chips extra')
  await typeOnly(page, 'to')
  await expect(suggestions(page).nth(0)).toHaveText('Tortilla chips extra')
  await expect(suggestions(page).nth(1)).toHaveText('Toffee crunch')
  // Then the seed list.
  await expect(suggestions(page).nth(2)).toHaveText(/^To/)
})

test("the list's own category beats the seed list's", async ({ page }) => {
  await signInFresh(page)
  await addItems(page, 'Tomatoes')
  await setCategory(page, 'Tomatoes', 'Pantry')
  await page.getByRole('button', { name: 'Delete Tomatoes' }).click()
  await expect(row(page, 'Tomatoes')).toHaveCount(0)

  await typeOnly(page, 'tom')
  await suggestions(page).first().click()
  await expect(row(page, 'Tomatoes')).toHaveAttribute('data-category', 'pantry')
})

test('a suggestion keeps the quantity typed after the colon', async ({ page }) => {
  await signInFresh(page)
  await typeOnly(page, 'avoc: 3 ripe')
  await suggestions(page).first().click()
  await expect(liveItems(page)).toHaveText(['Avocados'])
  await expect(row(page, 'Avocados').getByTestId('item-quantity')).toHaveText('3 ripe')
})

test('items already on the list are not suggested', async ({ page }) => {
  await signInFresh(page)
  await addItems(page, 'Tomatoes')
  await typeOnly(page, 'toma')
  await expect(suggestions(page).filter({ hasText: /^Tomatoes$/ })).toHaveCount(0)
})
