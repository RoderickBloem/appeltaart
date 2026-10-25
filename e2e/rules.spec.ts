import { expect, test } from '@playwright/test'
import { addItems, liveItems, signInFresh } from './helpers'

const FIRESTORE = 'http://127.0.0.1:8080/v1/projects/demo-appeltaart/databases/(default)/documents'

/** An unsigned ID token for `uid`; the emulator accepts these. */
function tokenFor(uid: string): string {
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
  })}.`
}

const getAs = (uid: string | null, path: string) =>
  fetch(`${FIRESTORE}/${path}`, { headers: uid ? { Authorization: `Bearer ${tokenFor(uid)}` } : {} })

test('only the owner can read a list and its items', async ({ page }) => {
  const uid = await signInFresh(page)
  await addItems(page, 'Milk')
  await expect(liveItems(page)).toHaveText(['Milk'])
  // The app creates the list document shortly after sign-in.
  await expect.poll(async () => (await getAs(uid, `lists/${uid}`)).status).toBe(200)
  expect((await getAs(uid, `lists/${uid}/items`)).status).toBe(200)

  expect((await getAs('someone-else', `lists/${uid}`)).status).toBe(403)
  expect((await getAs('someone-else', `lists/${uid}/items`)).status).toBe(403)
  expect((await getAs(null, `lists/${uid}/items`)).status).toBe(403)
})

test("a user cannot create a list under someone else's uid", async () => {
  const response = await fetch(`${FIRESTORE}/lists?documentId=victim`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenFor('attacker')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { members: { mapValue: { fields: { attacker: { booleanValue: true } } } } } }),
  })
  expect(response.status).toBe(403)
})
