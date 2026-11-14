import { expect, test } from '@playwright/test'
import { addItems, addMember, freshEmail, liveItems, row, setCategory, signIn, signInFresh } from './helpers'

const DOCUMENTS = 'http://127.0.0.1:8080/v1/projects/demo-appeltaart/databases/(default)/documents'

test('a product remembers its category: typed again later, it lands in the same one', async ({ page }) => {
  await signInFresh(page)
  await addItems(page, 'Quinoa')
  await expect(row(page, 'Quinoa')).toHaveAttribute('data-category', '')

  await setCategory(page, 'Quinoa', 'Rice, pasta & spirits')
  await expect(row(page, 'Quinoa')).toHaveAttribute('data-category', 'pasta')

  // Next week: bought, cleared, and typed again in different capitals.
  await page.getByRole('button', { name: 'Delete Quinoa' }).click()
  await expect(row(page, 'Quinoa')).toHaveCount(0)
  await addItems(page, 'quinoa')
  await expect(row(page, 'quinoa')).toHaveAttribute('data-category', 'pasta')
})

test('items are sorted by category in shop order, uncategorised last', async ({ page }) => {
  await signInFresh(page)
  await addItems(page, 'Milk', 'Soap', 'Tomatoes', 'Bread', 'Cucumber')
  await setCategory(page, 'Milk', 'Chilled')
  await setCategory(page, 'Tomatoes', 'Fruit & vegetables')
  await setCategory(page, 'Bread', 'Bread & deli')
  await setCategory(page, 'Cucumber', 'Fruit & vegetables')
  // Within a category, the order they were added in.
  await expect(liveItems(page)).toHaveText(['Tomatoes', 'Cucumber', 'Milk', 'Bread', 'Soap'])
})

test('a category set on one phone is used on the other', async ({ browser }) => {
  const [a, b] = await Promise.all([browser.newContext(), browser.newContext()].map(async (c) => (await c).newPage()))
  const aUid = await signInFresh(a)
  const bUid = await signIn(b, freshEmail('bo'))
  await addMember(aUid, bUid)
  await addItems(a, 'Bread')
  await expect(liveItems(b)).toHaveText(['Bread'])

  await addItems(a, 'Quinoa')
  await setCategory(a, 'Quinoa', 'Rice, pasta & spirits')
  await a.getByRole('button', { name: 'Delete Quinoa' }).click()
  await expect(row(a, 'Quinoa')).toHaveCount(0)
  await expect(liveItems(b)).toHaveText(['Bread'])

  await addItems(b, 'Quinoa')
  await expect(row(b, 'Quinoa')).toHaveAttribute('data-category', 'pasta')
  await expect(row(a, 'Quinoa')).toHaveAttribute('data-category', 'pasta')
})

test('a category changed again is remembered as changed', async ({ page }) => {
  await signInFresh(page)
  await addItems(page, 'Milk')
  await setCategory(page, 'Milk', 'Chilled')
  await setCategory(page, 'Milk', 'Drinks & toiletries')
  await expect(row(page, 'Milk')).toHaveAttribute('data-category', 'drinks')
  await page.getByRole('button', { name: 'Delete Milk' }).click()
  await expect(row(page, 'Milk')).toHaveCount(0)
  await addItems(page, 'milk')
  await expect(row(page, 'milk')).toHaveAttribute('data-category', 'drinks')
})

test('the categories follow the walk through the shop', async ({ page }) => {
  await signInFresh(page)
  // One common grocery per category, added in the opposite order.
  await addItems(page, 'Ice cream', 'Bread', 'Coffee', 'Beer', 'Spaghetti', 'Tinned tuna', 'Milk', 'Bananas')
  await expect(liveItems(page)).toHaveText(['Bananas', 'Milk', 'Tinned tuna', 'Spaghetti', 'Beer', 'Coffee', 'Bread', 'Ice cream'])
})

test('items and products stored with the categories from before the shop layout still show sensibly', async ({ page }) => {
  const uid = await signInFresh(page)
  // Written directly, as an older version of the app wrote them.
  const item = (id: string, name: string, categoryId: string) =>
    fetch(`${DOCUMENTS}/lists/${uid}/items?documentId=${id}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          name: { stringValue: name },
          normName: { stringValue: name.toLowerCase() },
          categoryId: { stringValue: categoryId },
          createdAt: { timestampValue: new Date().toISOString() },
        },
      }),
    })
  for (const [id, name, categoryId] of [
    ['a', 'Kefir', 'dairy'],
    ['b', 'Lamb shanks', 'meat'],
    ['c', 'Rice', 'pantry'],
    ['d', 'Quinoa', 'pantry'],
    ['e', 'Sourdough', 'bakery'],
  ]) {
    expect((await item(id, name, categoryId)).ok).toBe(true)
  }
  // Dairy and meat are now chilled; pantry was split, so its products take
  // the seed list's category, or none; the others kept their ids.
  await expect(row(page, 'Kefir')).toHaveAttribute('data-category', 'chilled')
  await expect(row(page, 'Lamb shanks')).toHaveAttribute('data-category', 'chilled')
  await expect(row(page, 'Rice')).toHaveAttribute('data-category', 'pasta')
  await expect(row(page, 'Quinoa')).toHaveAttribute('data-category', '')
  await expect(row(page, 'Sourdough')).toHaveAttribute('data-category', 'bakery')
})
