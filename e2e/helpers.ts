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

/**
 * Reads the user's items straight from the Firestore emulator, bypassing the
 * app and its cache. "Bearer owner" is the emulator's admin credential.
 */
export async function serverItems(uid: string): Promise<ServerItem[]> {
  const response = await fetch(`${FIRESTORE}/lists/${uid}/items?pageSize=300`, {
    headers: { Authorization: 'Bearer owner' },
  })
  expect(response.ok).toBe(true)
  const body = (await response.json()) as {
    documents?: { fields: Record<string, { stringValue?: string; booleanValue?: boolean; nullValue?: null }> }[]
  }
  return (body.documents ?? [])
    .map(({ fields }) => ({
      name: fields.name.stringValue!,
      checked: fields.checked.booleanValue!,
      deleted: !('nullValue' in fields.deletedAt),
    }))
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
