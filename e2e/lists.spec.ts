// Several lists in one household: a menu picks the list, each list is shown
// to the people picked for it, and categories and products are shared.
import { expect, test, type Browser, type Page } from '@playwright/test'
import {
  addItems,
  addMember,
  createList,
  freshEmail,
  liveItems,
  row,
  setCategory,
  showList,
  signIn,
  signInFresh,
  tokenFor,
} from './helpers'

async function phone(browser: Browser, name: string, own = true) {
  const page = await (await browser.newContext()).newPage()
  const email = freshEmail(name.toLowerCase())
  const uid = own ? await signInFresh(page, email, name) : await signIn(page, email, name)
  return { page, uid }
}

/** Two people in one household: Ann's, which Ben is added to. */
async function household(browser: Browser) {
  const a = await phone(browser, 'Ann')
  const b = await phone(browser, 'Ben', false)
  await addMember(a.uid, b.uid)
  await addItems(a.page, 'Bread')
  await expect(liveItems(b.page)).toHaveText(['Bread'])
  return { a, b }
}

const whoSees = (page: Page, person: string) => page.getByTestId('lists').getByRole('checkbox', { name: person })

test('the menu creates lists and switches between them; each has its own items', async ({ page }) => {
  await signInFresh(page)
  await expect(page.getByTestId('list-menu')).toContainText('Shopping')
  await addItems(page, 'Milk')

  await createList(page, 'DIY')
  await expect(liveItems(page)).toHaveCount(0)
  await addItems(page, 'Screws')

  await showList(page, 'Shopping')
  await expect(liveItems(page)).toHaveText(['Milk'])
  await showList(page, 'DIY')
  await expect(liveItems(page)).toHaveText(['Screws'])
})

test('the phone remembers which list it showed, also after a restart', async ({ page }) => {
  await signInFresh(page)
  await createList(page, 'DIY')
  await addItems(page, 'Screws')
  await expect(liveItems(page)).toHaveText(['Screws'])
  await page.reload()
  await expect(page.getByTestId('list-menu')).toContainText('DIY')
  await expect(liveItems(page)).toHaveText(['Screws'])
})

test('a new list is shown to everyone in the household, unless they are unticked', async ({ browser }) => {
  const { a, b } = await household(browser)
  await createList(a.page, 'Presents')
  await addItems(a.page, 'Book')

  // Ben sees it at first, and the items on it.
  await showList(b.page, 'Presents')
  await expect(liveItems(b.page)).toHaveText(['Book'])
  await showList(b.page, 'Shopping')

  // Ann hides it from Ben; she cannot untick herself.
  await a.page.getByTestId('list-menu').click()
  await expect(whoSees(a.page, 'Ann')).toBeChecked()
  await expect(whoSees(a.page, 'Ann')).toBeDisabled()
  await whoSees(a.page, 'Ben').click()
  await expect(whoSees(a.page, 'Ben')).not.toBeChecked()
  await b.page.getByTestId('list-menu').click()
  await expect(b.page.getByTestId('lists').getByRole('button', { name: 'Presents' })).toHaveCount(0)

  // And the rules keep Ben out, not only the menu.
  const presents = await a.page.evaluate(() => localStorage.getItem('appeltaart:list'))
  const response = await fetch(
    `http://127.0.0.1:8080/v1/projects/demo-appeltaart/databases/(default)/documents/lists/${a.uid}/lists/${presents}/items`,
    { headers: { Authorization: `Bearer ${tokenFor(b.uid)}` } },
  )
  expect(response.status).toBe(403)

  // Ticked again, Ben has it back.
  await whoSees(a.page, 'Ben').click()
  await expect(whoSees(a.page, 'Ben')).toBeChecked()
  await expect(b.page.getByTestId('lists').getByRole('button', { name: 'Presents' })).toBeVisible()
})

test('a list showing on a phone that loses access falls back to the main list', async ({ browser }) => {
  const { a, b } = await household(browser)
  await createList(a.page, 'Presents')
  await showList(b.page, 'Presents')
  await a.page.getByTestId('list-menu').click()
  await whoSees(a.page, 'Ben').click()
  await expect(b.page.getByTestId('list-menu')).toContainText('Shopping')
  await expect(liveItems(b.page)).toHaveText(['Bread'])
})

test('categories and learned products are shared by all lists', async ({ page }) => {
  await signInFresh(page)
  await createList(page, 'DIY')
  await addItems(page, 'Quinoa')
  await setCategory(page, 'Quinoa', 'Pantry')

  await showList(page, 'Shopping')
  await addItems(page, 'quinoa')
  await expect(row(page, 'quinoa')).toHaveAttribute('data-category', 'pantry')
  // And the product is suggested on every list.
  await showList(page, 'DIY')
  await page.getByLabel('New item').fill('qui')
  await expect(page.getByTestId('suggestions').getByRole('button')).toHaveCount(0)
  await page.getByRole('button', { name: 'Delete Quinoa' }).click()
  await page.getByLabel('New item').fill('qui')
  // As last typed.
  await expect(page.getByTestId('suggestions').getByRole('button').first()).toHaveText('quinoa')
})

test('the share panel names the people in the household', async ({ browser }) => {
  const { a } = await household(browser)
  await a.page.getByRole('button', { name: 'Share' }).click()
  await expect(a.page.getByTestId('people')).toHaveText(/Ann.*Ben|Ben.*Ann/)
})
