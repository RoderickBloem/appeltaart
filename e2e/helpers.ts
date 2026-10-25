import { expect, type Page } from '@playwright/test'

const FIRESTORE = 'http://127.0.0.1:8080/v1/projects/demo-appeltaart/databases/(default)/documents'

export type ServerItem = { name: string; checked: boolean; deleted: boolean }

/**
 * Signs in as a user no other test uses, so tests that run in parallel never
 * share a list, and waits for the list screen. Returns the user's uid.
 */
export async function signInFresh(page: Page): Promise<string> {
  const email = `user-${crypto.randomUUID()}@example.com`
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  const uid = await page.evaluate((email) => window.emulatorSignIn!('Rick Tester', email), email)
  await expect(page.getByLabel('New item')).toBeVisible()
  return uid
}

export type ServerDoc = { id: string; name: string; normName: string; checked: boolean; deleted: boolean }

/**
 * Reads every item of a list straight from the Firestore emulator, tombstones
 * included, bypassing the app and its cache. "Bearer owner" is the emulator's
 * admin credential. Sorted by id.
 */
export async function serverDocs(listId: string): Promise<ServerDoc[]> {
  const response = await fetch(`${FIRESTORE}/lists/${listId}/items?pageSize=1000`, {
    headers: { Authorization: 'Bearer owner' },
  })
  expect(response.ok).toBe(true)
  const body = (await response.json()) as {
    documents?: { name: string; fields: Record<string, { stringValue?: string; booleanValue?: boolean; nullValue?: null }> }[]
  }
  return (body.documents ?? [])
    .map(({ name, fields }) => ({
      id: name.slice(name.lastIndexOf('/') + 1),
      name: fields.name.stringValue!,
      normName: fields.normName.stringValue!,
      // Missing fields: an item that was never checked or deleted.
      checked: fields.checked?.booleanValue ?? false,
      deleted: fields.deletedAt !== undefined && !('nullValue' in fields.deletedAt),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** The items of the user's own list (milestone 2: the list id is the uid), by name. */
export async function serverItems(uid: string): Promise<ServerItem[]> {
  return (await serverDocs(uid))
    .map(({ name, checked, deleted }) => ({ name, checked, deleted }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function addItems(page: Page, ...names: string[]) {
  const input = page.getByLabel('New item')
  for (const name of names) {
    await input.fill(name)
    await input.press('Enter')
  }
}

/** The item names in each section; tapping one checks or unchecks it. */
export const liveItems = (page: Page) => page.getByTestId('live-items').getByTestId('item-name')
export const checkedItems = (page: Page) => page.getByTestId('checked-items').getByTestId('item-name')
