// Test harness for the sync properties in docs/spec.md, section "Test harness".
// Loaded only in emulator builds (see main.tsx). e2e/sync.spec.ts drives it.
//
// Each client runs in its own page, in its own browser context, so like a
// separate phone it has its own IndexedDB and its own network connections.
// (Several clients in one page exhaust the browser's six connections per host
// and stall each other's writes.) "Offline" is disableNetwork(); a restart is
// a page reload followed by open() with the same list, which finds the same
// IndexedDB.
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential } from 'firebase/auth'
import {
  clearIndexedDbPersistence,
  connectFirestoreEmulator,
  disableNetwork,
  enableNetwork,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
  waitForPendingWrites,
  type Firestore,
} from 'firebase/firestore'
import { app as mainApp } from './firebase'
import {
  addItem,
  clearChecked,
  deleteItem,
  ensureList,
  listRef,
  renameItem,
  setChecked,
  watchItems,
  type Item,
  type List,
} from './list'

/** What a client shows, or what the server holds, for comparison. */
export type ItemView = { id: string; name: string; normName: string; checked: boolean }

/** Operations that act on the list. Going offline, restarting and pausing are in e2e/sync.spec.ts. */
export type ListOp =
  | { kind: 'add'; name: string }
  | { kind: 'rename'; pick: number; name: string }
  | { kind: 'check'; pick: number }
  | { kind: 'uncheck'; pick: number }
  | { kind: 'delete'; pick: number }
  | { kind: 'clear' }

export type Look = {
  /** The live items the client shows, by id. */
  items: ItemView[]
  /** Whether the listener last showed server-confirmed data with no pending writes. */
  synced: boolean
}

type Client = {
  app: FirebaseApp
  db: Firestore
  list: List
  uid: string
  items: Item[]
  synced: boolean
  offline: boolean
  unsubscribe: () => void
}

let client: Client | undefined

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Polls until `condition` holds or time runs out. */
async function until(condition: () => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (!condition() && Date.now() < deadline) await sleep(10)
}

function current(): Client {
  if (!client) throw new Error('No client open in this page')
  return client
}

/**
 * Opens this page's client on `listId`, signed in as `email`, and returns its
 * uid. After a reload, the same arguments find the same IndexedDB, with the
 * user still signed in and any unsent writes still queued.
 */
async function open(listId: string, email: string, offline: boolean): Promise<string> {
  const app = initializeApp(mainApp.options, `client-${listId}`)
  const auth = getAuth(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  // A phone that restarts in flight mode comes back still offline. Issued
  // first, so it runs before the client's first network attempt.
  if (offline) void disableNetwork(db)

  await auth.authStateReady()
  if (!auth.currentUser) {
    const credential = GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, name: email, email_verified: true }))
    await signInWithCredential(auth, credential)
  }

  const opened: Client = {
    app,
    db,
    list: listRef(db, listId),
    uid: auth.currentUser!.uid,
    items: [],
    synced: false,
    offline,
    unsubscribe: () => {},
  }
  opened.unsubscribe = watchItems(opened.list, (items, metadata) => {
    opened.items = items
    opened.synced = !metadata.fromCache && !metadata.hasPendingWrites
  })
  client = opened
  return opened.uid
}

/** Creates the list document with every client as a member, and waits for the server. */
async function createList(uids: string[]) {
  const { list, db } = current()
  await ensureList(list, uids)
  await waitForPendingWrites(db)
}

/** Picks an item the client currently shows, the way a person taps one they can see. */
function pick(items: Item[], index: number): Item | undefined {
  return items.length === 0 ? undefined : items[index % items.length]
}

/**
 * Whether `items` show the effect of `op` on `ids`. An item that has gone
 * meanwhile counts as shown: another phone deleted it.
 */
function shows(items: Item[], op: ListOp, ids: string[]): boolean {
  const byId = new Map(items.map((item) => [item.id, item]))
  switch (op.kind) {
    case 'add':
      return byId.has(ids[0])
    case 'rename':
      return byId.get(ids[0])?.name === op.name || !byId.has(ids[0])
    case 'check':
    case 'uncheck':
      return byId.get(ids[0])?.checked === (op.kind === 'check') || !byId.has(ids[0])
    case 'delete':
    case 'clear':
      return ids.every((id) => !byId.has(id))
  }
}

/** Applies an operation; returns the ids of the items it wrote to. */
async function apply(op: ListOp): Promise<string[]> {
  const c = current()
  const { list, items } = c
  let ids: string[] = []

  switch (op.kind) {
    case 'add':
      ids = [addItem(list, c.uid, op.name)]
      break
    case 'rename': {
      const item = pick(items, op.pick)
      if (item) renameItem(list, item.id, op.name)
      ids = item ? [item.id] : []
      break
    }
    case 'check':
    case 'uncheck': {
      const item = pick(items.filter((i) => i.checked === (op.kind === 'uncheck')), op.pick)
      if (item) setChecked(list, item.id, op.kind === 'check')
      ids = item ? [item.id] : []
      break
    }
    case 'delete': {
      const item = pick(items, op.pick)
      if (item) deleteItem(list, item.id)
      ids = item ? [item.id] : []
      break
    }
    case 'clear':
      ids = clearChecked(list, items)
      break
  }

  // Wait until the screen shows the change, as a person only taps again (or
  // force-quits) after seeing it. Any snapshot is not enough: one carrying
  // another phone's change can arrive before this write is saved locally.
  if (ids.length > 0) await until(() => shows(c.items, op, ids), 2_000)
  return ids
}

// Only on a change of state: enableNetwork() on a client that is already
// online trips an internal assertion in the SDK against the emulator.
async function setOffline(offline: boolean) {
  const c = current()
  if (offline && !c.offline) await disableNetwork(c.db)
  if (!offline && c.offline) await enableNetwork(c.db)
  c.offline = offline
}

/** Resolves when every write has reached the server, or after `timeoutMs`. */
async function waitForWrites(timeoutMs: number) {
  await Promise.race([waitForPendingWrites(current().db), sleep(timeoutMs)])
}

/** What the client shows right now. */
function look(): Look {
  const c = current()
  const items = c.items.map(({ id, name, normName, checked }) => ({ id, name, normName, checked })).sort(byId)
  return { items, synced: c.synced }
}

/** Tears the client down and deletes its cache, so the next scenario starts clean. */
async function dispose() {
  if (!client) return
  const { unsubscribe, db, app } = client
  client = undefined
  unsubscribe()
  await terminate(db)
  await clearIndexedDbPersistence(db)
  await deleteApp(app)
}

export const harness = { open, createList, apply, setOffline, waitForWrites, look, dispose }

declare global {
  interface Window {
    harness?: typeof harness
  }
}
window.harness = harness
