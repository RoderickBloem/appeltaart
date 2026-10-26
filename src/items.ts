import {
  collection,
  deleteField,
  doc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type DocumentReference,
  type FirestoreError,
  type SnapshotMetadata,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { keepListening, report } from './firestoreHelpers'
import type { Household } from './household'
import { normalise } from './normalise'
import { rememberCategory, rememberProduct } from './products'

export type Item = {
  id: string
  name: string
  normName: string
  checked: boolean
  createdAt: Timestamp
  /** One of CATEGORIES in src/categories.ts; missing when not yet known. */
  categoryId?: string
  /** Free text: "6", "ripe", "2 kg". */
  quantity?: string
}

/**
 * The document whose `items` collection holds a list: the shared document
 * for the main list, lists/{id}/lists/{listId} for the others (src/lists.ts).
 * Every operation takes the list it acts on, so the test harness can run the
 * same code against several Firestore clients.
 */
export type List = DocumentReference

const itemRef = (list: List, id: string) => doc(list, 'items', id)

// Deleted items count towards this until the tombstone purge removes them.
const MAX_ITEMS = 2000
const MAX_BATCH = 500

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
 * another phone made in between (decision 9 in docs/spec.md).
 */
export function addItem(list: List, createdBy: string, name: string, categoryId?: string, quantity?: string): string {
  const ref = doc(collection(list, 'items'))
  report(
    setDoc(
      ref,
      {
        name,
        normName: normalise(name),
        createdAt: nextCreatedAt(),
        updatedAt: serverTimestamp(),
        createdBy,
        ...(categoryId && { categoryId }),
        ...(quantity && { quantity }),
      },
      { merge: true },
    ),
  )
  return ref.id
}

/**
 * Splits what was typed into a name and a quantity: "Tomatoes: 6" or
 * "Avocados: ripe". `quantity` is undefined without a colon, and empty with
 * nothing after it.
 */
export function parseEntry(text: string): { name: string; quantity?: string } {
  const colon = text.indexOf(':')
  if (colon < 0) return { name: text.trim() }
  return { name: text.slice(0, colon).trim(), quantity: text.slice(colon + 1).trim() }
}

/**
 * What typing `text` into a list does. A product already on the list,
 * checked or not, is put back unchecked and given the new quantity, if one
 * was typed, rather than added twice. A new one is added in the category
 * `categoryFor` gives it.
 */
export function enterItem(
  household: Household,
  list: List,
  uid: string,
  text: string,
  items: Item[],
  categoryFor: (normName: string) => string | undefined,
) {
  const { name, quantity } = parseEntry(text)
  if (!name) return
  const namesakes = items.filter((item) => item.normName === normalise(name))
  if (namesakes.length === 0) addItem(list, uid, name, categoryFor(normalise(name)), quantity)
  for (const item of namesakes) {
    const change = {
      ...(item.checked && { checked: false }),
      ...(quantity !== undefined && quantity !== (item.quantity ?? '') && { quantity: quantity || deleteField() }),
    }
    if (Object.keys(change).length > 0) report(updateDoc(itemRef(list, item.id), { ...change, updatedAt: serverTimestamp() }))
  }
  rememberProduct(household, name)
}

/**
 * Puts `items` (namesakes, normally one) in a category, and remembers it for
 * the product.
 */
export function setCategory(household: Household, list: List, items: Item[], categoryId: string) {
  for (const item of items) report(updateDoc(itemRef(list, item.id), { categoryId, updatedAt: serverTimestamp() }))
  rememberCategory(household, items[0].name, categoryId)
}

/** Not offered in the app; the sync tests use it (spec, "Operation semantics"). */
export function renameItem(list: List, id: string, name: string) {
  report(updateDoc(itemRef(list, id), { name, normName: normalise(name), updatedAt: serverTimestamp() }))
}

export function setChecked(list: List, id: string, checked: boolean) {
  report(updateDoc(itemRef(list, id), { checked, updatedAt: serverTimestamp() }))
}

export function deleteItem(list: List, id: string) {
  report(updateDoc(itemRef(list, id), { deletedAt: serverTimestamp(), updatedAt: serverTimestamp() }))
}

/** Brings deleted items back: the undo of a delete or a clear. */
export function restoreItems(list: List, ids: string[]) {
  for (const id of ids) report(updateDoc(itemRef(list, id), { deletedAt: null, updatedAt: serverTimestamp() }))
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
 * e2e/sync.spec.ts; decision 7 in docs/spec.md).
 */
export function watchItems(
  list: List,
  onItems: (items: Item[], metadata: SnapshotMetadata) => void,
  onError?: (error: FirestoreError) => void,
) {
  const all = query(collection(list, 'items'), limit(MAX_ITEMS))
  return onSnapshot(
    all,
    { includeMetadataChanges: true },
    (snapshot) => {
      const items = snapshot.docs
        // 'estimate' makes a pending deletedAt read as a time, not null, so an
        // item deleted offline disappears at once.
        .map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }) as Item & { deletedAt?: unknown })
        .filter((item) => item.deletedAt == null)
        .map(({ id, name, normName, checked, createdAt, categoryId, quantity }) => ({
          id,
          name,
          normName,
          checked: checked === true,
          createdAt,
          categoryId,
          quantity,
        }))
      items.sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis() || a.id.localeCompare(b.id))
      onItems(items, snapshot.metadata)
    },
    onError,
  )
}

/**
 * The live items, oldest first; `undefined` until the first snapshot. And
 * whether some change has not reached the server yet.
 */
export function useItems(list: List): { items: Item[] | undefined; pending: boolean } {
  const [state, setState] = useState<{ items: Item[] | undefined; pending: boolean }>({ items: undefined, pending: false })
  useEffect(
    () =>
      keepListening((onError) =>
        watchItems(list, (items, metadata) => setState({ items, pending: metadata.hasPendingWrites }), onError),
      ),
    [list],
  )
  return state
}
