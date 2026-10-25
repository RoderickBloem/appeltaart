import { expect, type Page } from '@playwright/test'

const FIRESTORE = 'http://127.0.0.1:8080/v1/projects/demo-appeltaart/databases/(default)/documents'

/** An unsigned ID token for `uid`, optionally with an email; the emulator accepts these. */
export function tokenFor(uid: string, email?: { address: string; verified: boolean }): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  return `${part({ alg: 'none', typ: 'JWT' })}.${part({
    iss: 'https://securetoken.google.com/demo-appeltaart',
    aud: 'demo-appeltaart',
    sub: uid,
    user_id: uid,
    iat: now,
    exp: now + 3600,
    auth_time: now,
    firebase: { sign_in_provider: 'google.com' },
    ...(email && { email: email.address, email_verified: email.verified }),
  })}.`
}

/**
 * Adds `uid` to a list's members with the emulator's admin credential, as
 * the maintainer does by hand in the Firebase console. Clients may not.
 */
export async function addMember(listId: string, uid: string) {
  const mask = encodeURIComponent(`members.\`${uid}\``)
  const response = await fetch(`${FIRESTORE}/lists/${listId}?updateMask.fieldPaths=${mask}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { members: { mapValue: { fields: { [uid]: { booleanValue: true } } } } } }),
  })
  expect(response.ok, await response.text()).toBe(true)
}

export type ServerItem = { name: string; checked: boolean; deleted: boolean }

/** An address no other test uses; a Gmail one, since that is what people invite. */
export const freshEmail = (name = 'user') => `${name}.${crypto.randomUUID().slice(0, 8)}@gmail.com`

/**
 * Signs in as a user no other test uses (unless `email` is given), so tests that run in parallel never
 * share a list, and waits for the list screen. Returns the user's uid.
 */
export async function signInFresh(page: Page, email = freshEmail()): Promise<string> {
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

/** The row of the item called exactly `name`, live or checked. */
export const row = (page: Page, name: string) =>
  page.getByRole('listitem').filter({ has: page.getByTestId('item-name').getByText(name, { exact: true }) })

/** Sets the category of the item called `name` through its colour swatch. */
export async function setCategory(page: Page, name: string, category: string) {
  await page.getByRole('button', { name: `Category of ${name}` }).click()
  await page.getByRole('button', { name: category, exact: true }).click()
}
