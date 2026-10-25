import { expect, test } from '@playwright/test'
import { addItems, addMember, liveItems, signInFresh, tokenFor } from './helpers'

const DOCUMENTS = 'http://127.0.0.1:8080/v1/projects/demo-appeltaart/databases/(default)/documents'

/** A REST call to the Firestore emulator as `uid`, or signed out with null. */
const as = (uid: string | null, path: string, init: { method?: string; body?: object } = {}) =>
  fetch(`${DOCUMENTS}${path}`, {
    method: init.method ?? 'GET',
    headers: { ...(uid ? { Authorization: `Bearer ${tokenFor(uid)}` } : {}), 'Content-Type': 'application/json' },
    body: init.body && JSON.stringify(init.body),
  })

const membersField = (...uids: string[]) => ({
  members: { mapValue: { fields: Object.fromEntries(uids.map((u) => [u, { booleanValue: true }])) } },
})

const itemFields = { name: { stringValue: 'Bread' }, normName: { stringValue: 'bread' } }

/** Lists where members.<member> == true, queried as `uid`. */
const queryLists = (uid: string, member: string) =>
  as(uid, ':runQuery', {
    method: 'POST',
    body: {
      structuredQuery: {
        from: [{ collectionId: 'lists' }],
        where: { fieldFilter: { field: { fieldPath: `members.\`${member}\`` }, op: 'EQUAL', value: { booleanValue: true } } },
      },
    },
  })

/** A uid no other test uses. */
const fresh = (name: string) => `${name}-${crypto.randomUUID()}`

/** Signs in through the app, adds an item, and waits for the list document on the server. */
async function ownerWithList(page: import('@playwright/test').Page) {
  const uid = await signInFresh(page)
  await addItems(page, 'Milk')
  await expect(liveItems(page)).toHaveText(['Milk'])
  await expect.poll(async () => (await as(uid, `/lists/${uid}`)).status).toBe(200)
  return uid
}

test('only members can read a list and its items', async ({ page }) => {
  const member = fresh('member')
  const owner = await ownerWithList(page)
  expect((await as(owner, `/lists/${owner}/items`)).status).toBe(200)

  expect((await as('stranger', `/lists/${owner}`)).status).toBe(403)
  expect((await as('stranger', `/lists/${owner}/items`)).status).toBe(403)
  expect((await as(null, `/lists/${owner}/items`)).status).toBe(403)

  await addMember(owner, member)
  expect((await as(member, `/lists/${owner}`)).status).toBe(200)
  expect((await as(member, `/lists/${owner}/items`)).status).toBe(200)
})

test('only members can add and change items', async ({ page }) => {
  const member = fresh('member')
  const owner = await ownerWithList(page)
  await addMember(owner, member)
  const create = (uid: string, id: string) =>
    as(uid, `/lists/${owner}/items?documentId=${id}`, { method: 'POST', body: { fields: itemFields } })

  expect((await create('stranger', 'a')).status).toBe(403)
  expect((await create(member, 'b')).status).toBe(200)
  const check = (uid: string) =>
    as(uid, `/lists/${owner}/items/b?updateMask.fieldPaths=checked`, {
      method: 'PATCH',
      body: { fields: { checked: { booleanValue: true } } },
    })
  expect((await check('stranger')).status).toBe(403)
  expect((await check(owner)).status).toBe(200)
})

test('items are never deleted outright, only marked deleted', async ({ page }) => {
  const member = fresh('member')
  const owner = await ownerWithList(page)
  await addMember(owner, member)
  await as(owner, `/lists/${owner}/items?documentId=c`, { method: 'POST', body: { fields: itemFields } })
  expect((await as(owner, `/lists/${owner}/items/c`, { method: 'DELETE' })).status).toBe(403)
  expect((await as(member, `/lists/${owner}/items/c`, { method: 'DELETE' })).status).toBe(403)
})

test('nobody changes the members from the app, not even the owner', async ({ page }) => {
  const member = fresh('member')
  const owner = await ownerWithList(page)
  await addMember(owner, member)
  const addSelf = (uid: string, newcomer: string) =>
    as(uid, `/lists/${owner}?updateMask.fieldPaths=${encodeURIComponent(`members.\`${newcomer}\``)}`, {
      method: 'PATCH',
      body: { fields: membersField(newcomer) },
    })
  expect((await addSelf('stranger', 'stranger')).status).toBe(403)
  expect((await addSelf(owner, 'friend')).status).toBe(403)
  expect((await addSelf(member, 'friend')).status).toBe(403)
})

test("a user cannot create a list under someone else's uid, or with other members", async () => {
  const create = (uid: string, listId: string, members: string[]) =>
    as(uid, `/lists?documentId=${listId}`, { method: 'POST', body: { fields: membersField(...members) } })
  expect((await create('attacker', 'victim', ['attacker'])).status).toBe(403)
  expect((await create('attacker', 'attacker', ['attacker', 'victim'])).status).toBe(403)
  const newcomer = fresh('newcomer')
  expect((await create(newcomer, newcomer, [newcomer])).status).toBe(200)
})

test('a user can look up the lists they belong to, and no one else’s', async ({ page }) => {
  const member = fresh('member')
  const owner = await ownerWithList(page)
  await addMember(owner, member)

  const mine = await queryLists(member, member)
  expect(mine.status).toBe(200)
  const results = (await mine.json()) as { document?: { name: string } }[]
  expect(results.flatMap((r) => (r.document ? [r.document.name.split('/').pop()] : []))).toEqual([owner])

  expect((await queryLists('stranger', owner)).status).toBe(403)
})
