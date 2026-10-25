import {
  collection,
  doc,
  FieldPath,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
  type DocumentReference,
  type Firestore,
  type SnapshotMetadata,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'

export type Item = {
  id: string
  name: string
  normName: string
  checked: boolean
  createdAt: Timestamp
}

/**
 * Every operation takes the list document it acts on, so the test harness can
 * run the same code against several Firestore clients.
 */
export type List = DocumentReference

export const listRef = (db: Firestore, listId: string): List => doc(db, 'lists', listId)
const itemRef = (list: List, id: string) => doc(list, 'items', id)

// Deleted items count towards this until the tombstone purge removes them.
const MAX_ITEMS = 2000
const MAX_BATCH = 500

/** Lower-cased, trimmed, accents folded: "  Äpfel " and "apfel" match. */
export function normalise(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
}

// Writes are never awaited: the promise resolves only when the server
// confirms, which never happens offline. The local cache already has the
// change, and the snapshot listener shows it at once.
function report(write: Promise<void>) {
  write.catch((e) => console.error('Write failed', e))
}

/**
 * Creates the list document the first time a member opens the app. Resolves
 * once the write is issued, not when the server confirms it.
 */
export function ensureList(list: List, members: string[]): Promise<void> {
  return getDoc(list)
    .then((snapshot) => {
      if (!snapshot.exists()) {
        const memberMap = Object.fromEntries(members.map((uid) => [uid, true]))
        report(setDoc(list, { name: 'Household', members: memberMap, createdAt: serverTimestamp() }))
      }
    })
    // Offline with nothing cached: try again on the next start.
    .catch(() => {})
}

// createdAt orders the list, so it comes from the phone's clock. A pending
// serverTimestamp() is estimated only to the whole second, which would shuffle
// items typed offline in quick succession. Strictly increasing, so two adds
// in the same millisecond keep their order too.
let lastCreated = 0

function nextCreatedAt(): Timestamp {
  lastCreated = Math.max(Date.now(), lastCreated + 1)
  return Timestamp.fromMillis(lastCreated)
}

/**
 * Returns the new item's id.
 *
 * Writes neither `checked` nor `deletedAt`, and merges: a missing `checked`
 * means unchecked, a missing `deletedAt` means live. Firestore re-sends a
 * write whose confirmation was lost, for example when the phone lost signal
 * just after sending it; a full set would then wipe a check or a delete that
 * another phone made in between (open question 9 in docs/spec.md).
 */
export function addItem(list: List, createdBy: string, name: string): string {
  const ref = doc(collection(list, 'items'))
  report(
    setDoc(
      ref,
      { name, normName: normalise(name), createdAt: nextCreatedAt(), updatedAt: serverTimestamp(), createdBy },
      { merge: true },
    ),
  )
  return ref.id
}

export function renameItem(list: List, id: string, name: string) {
  report(updateDoc(itemRef(list, id), { name, normName: normalise(name), updatedAt: serverTimestamp() }))
}

export function setChecked(list: List, id: string, checked: boolean) {
  report(updateDoc(itemRef(list, id), { checked, updatedAt: serverTimestamp() }))
}

export function deleteItem(list: List, id: string) {
  report(updateDoc(itemRef(list, id), { deletedAt: serverTimestamp(), updatedAt: serverTimestamp() }))
}

/** Deletes the checked ones among `items`; returns their ids. */
export function clearChecked(list: List, items: Item[]): string[] {
  const checked = items.filter((item) => item.checked)
  for (let start = 0; start < checked.length; start += MAX_BATCH) {
    const batch = writeBatch(list.firestore)
    for (const item of checked.slice(start, start + MAX_BATCH)) {
      batch.update(itemRef(list, item.id), { deletedAt: serverTimestamp(), updatedAt: serverTimestamp() })
    }
    report(batch.commit())
  }
  return checked.map((item) => item.id)
}

/**
 * Listens to the live items, oldest first. Calls back from the cache too, so
 * a cold start with no network shows the list. Returns the unsubscribe.
 *
 * The query includes deleted items and drops them here, rather than filtering
 * on `deletedAt == null` in the query. With that filter, an item one phone
 * changed just as another deleted it leaves the server's query result, so the
 * first phone never hears of the delete and shows the item forever (found by
 * e2e/sync.spec.ts; see open question 7 in docs/spec.md).
 */
export function watchItems(list: List, onItems: (items: Item[], metadata: SnapshotMetadata) => void) {
  const all = query(collection(list, 'items'), limit(MAX_ITEMS))
  return onSnapshot(all, { includeMetadataChanges: true }, (snapshot) => {
    const items = snapshot.docs
      // 'estimate' makes a pending deletedAt read as a time, not null, so an
      // item deleted offline disappears at once.
      .map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }) as Item & { deletedAt?: unknown })
      .filter((item) => item.deletedAt == null)
      .map(({ id, name, normName, checked, createdAt }) => ({ id, name, normName, checked: checked === true, createdAt }))
    items.sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis() || a.id.localeCompare(b.id))
    onItems(items, snapshot.metadata)
  })
}

/**
 * The list to show: among the lists the user is a member of, the one with
 * the most members, then the oldest, so a household list the maintainer
 * added them to wins over the solo list their app made at first sign-in.
 * Items on that solo list stay there.
 */
function chooseList(lists: QueryDocumentSnapshot<DocumentData>[]): string {
  const size = (d: QueryDocumentSnapshot<DocumentData>) => Object.keys(d.data().members ?? {}).length
  const created = (d: QueryDocumentSnapshot<DocumentData>) =>
    (d.data({ serverTimestamps: 'estimate' }).createdAt as Timestamp | undefined)?.toMillis() ?? Infinity
  return [...lists].sort((a, b) => size(b) - size(a) || created(a) - created(b) || a.id.localeCompare(b.id))[0].id
}

/**
 * The list the user sees, `undefined` until known. Creates the user's own
 * list if the server says they belong to none; never from the cache alone,
 * which may simply not know the shared list yet.
 */
export function useMyList(db: Firestore, uid: string): List | undefined {
  const [list, setList] = useState<List | undefined>(undefined)

  useEffect(() => {
    const mine = query(collection(db, 'lists'), where(new FieldPath('members', uid), '==', true))
    return onSnapshot(mine, (snapshot) => {
      if (snapshot.empty) {
        if (!snapshot.metadata.fromCache) void ensureList(listRef(db, uid), [uid])
        return
      }
      const id = chooseList(snapshot.docs)
      // Keep the same reference while the choice stands, so the items
      // listener is not restarted on every change to the list document.
      setList((current) => (current?.id === id ? current : listRef(db, id)))
    })
  }, [db, uid])

  return list
}

/** The live items, oldest first; `undefined` until the first snapshot. */
export function useItems(list: List): Item[] | undefined {
  const [items, setItems] = useState<Item[] | undefined>(undefined)
  useEffect(() => watchItems(list, setItems), [list])
  return items
}
