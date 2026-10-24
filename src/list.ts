import {
  collection,
  doc,
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
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { db } from './firebase'

export type Item = {
  id: string
  name: string
  checked: boolean
  createdAt: Timestamp
}

// Milestone 2 has one list per user, stored under the user's uid. Sharing
// (milestone 4) replaces this with a list found through its members map.
const listRef = (uid: string) => doc(db, 'lists', uid)
const itemsRef = (uid: string) => collection(listRef(uid), 'items')

const MAX_ITEMS = 500
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

/** Creates the user's list document the first time they open the app. */
export function ensureList(uid: string) {
  getDoc(listRef(uid))
    .then((snapshot) => {
      if (!snapshot.exists()) {
        report(setDoc(listRef(uid), { name: 'Household', members: { [uid]: true }, createdAt: serverTimestamp() }))
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

export function addItem(uid: string, createdBy: string, name: string) {
  report(
    setDoc(doc(itemsRef(uid)), {
      name,
      normName: normalise(name),
      checked: false,
      deletedAt: null,
      createdAt: nextCreatedAt(),
      updatedAt: serverTimestamp(),
      createdBy,
    }),
  )
}

export function setChecked(uid: string, id: string, checked: boolean) {
  report(updateDoc(doc(itemsRef(uid), id), { checked, updatedAt: serverTimestamp() }))
}

export function deleteItem(uid: string, id: string) {
  report(updateDoc(doc(itemsRef(uid), id), { deletedAt: serverTimestamp(), updatedAt: serverTimestamp() }))
}

export function clearChecked(uid: string, items: Item[]) {
  const checked = items.filter((item) => item.checked)
  for (let start = 0; start < checked.length; start += MAX_BATCH) {
    const batch = writeBatch(db)
    for (const item of checked.slice(start, start + MAX_BATCH)) {
      batch.update(doc(itemsRef(uid), item.id), { deletedAt: serverTimestamp(), updatedAt: serverTimestamp() })
    }
    report(batch.commit())
  }
}

/** The live items, oldest first; `undefined` until the first snapshot. */
export function useItems(uid: string): Item[] | undefined {
  const [items, setItems] = useState<Item[] | undefined>(undefined)

  useEffect(() => {
    const live = query(itemsRef(uid), where('deletedAt', '==', null), limit(MAX_ITEMS))
    // Renders from the cache too, so a cold start with no network shows the list.
    return onSnapshot(live, (snapshot) => {
      const next = snapshot.docs.map((d) => {
        const data = d.data()
        return { id: d.id, name: data.name, checked: data.checked, createdAt: data.createdAt } as Item
      })
      next.sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis() || a.id.localeCompare(b.id))
      setItems(next)
    })
  }, [uid])

  return items
}
