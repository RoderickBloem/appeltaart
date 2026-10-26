import {
  collection,
  deleteField,
  doc,
  FieldPath,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { keepListening, report } from './firestoreHelpers'
import type { Household, HouseholdInfo } from './household'
import type { List } from './items'

/** The main list: the shared document's own items, which everyone sees. */
export const MAIN_LIST = 'main'
const MAIN_LIST_NAME = 'Shopping'

export type ListEntry = { id: string; name: string; visibleTo: string[] }

/** The document whose `items` are the list `listId`. */
export const listIn = (household: Household, listId: string): List =>
  listId === MAIN_LIST ? household : doc(household, 'lists', listId)

/**
 * The lists the user sees: the main list first, at once, then the others by
 * name. `complete` is false until the others are known (see keepListening).
 */
export function useLists(household: Household, uid: string, info: HouseholdInfo | undefined): { lists: ListEntry[]; complete: boolean } {
  const [others, setOthers] = useState<ListEntry[] | undefined>(undefined)
  useEffect(
    () =>
      keepListening((onError) =>
        onSnapshot(
          query(collection(household, 'lists'), where(new FieldPath('visibleTo', uid), '==', true)),
          (snapshot) =>
            setOthers(
              snapshot.docs
                .map((d) => ({ id: d.id, data: d.data({ serverTimestamps: 'estimate' }) }))
                // Deleted lists are dropped here, not in the query, for the
                // reason in watchItems (src/items.ts).
                .filter(({ data }) => data.deletedAt == null)
                .map(({ id, data }) => ({ id, name: data.name as string, visibleTo: Object.keys(data.visibleTo ?? {}) }))
                .sort((a, b) => a.name.localeCompare(b.name)),
            ),
          onError,
        ),
      ),
    [household, uid],
  )
  const main = { id: MAIN_LIST, name: MAIN_LIST_NAME, visibleTo: info?.people.map((p) => p.uid) ?? [uid] }
  return { lists: [main, ...(others ?? [])], complete: others !== undefined }
}

/** Creates a list that `visibleTo` see; returns its id. */
export function createList(household: Household, uid: string, name: string, visibleTo: string[]): string {
  const ref = doc(collection(household, 'lists'))
  report(
    setDoc(ref, {
      name,
      visibleTo: Object.fromEntries(visibleTo.map((u) => [u, true])),
      createdAt: serverTimestamp(),
      createdBy: uid,
    }),
  )
  return ref.id
}

/**
 * Deletes a list (not the main one) for everyone. Like an item, it is only
 * marked deleted, so the delete can be undone.
 */
export function deleteList(household: Household, listId: string) {
  report(updateDoc(listIn(household, listId), { deletedAt: serverTimestamp() }))
}

export function restoreList(household: Household, listId: string) {
  report(updateDoc(listIn(household, listId), { deletedAt: null }))
}

/** Shows a list (not the main one) to someone, or stops showing it. */
export function setVisible(household: Household, listId: string, uid: string, visible: boolean) {
  report(updateDoc(listIn(household, listId), new FieldPath('visibleTo', uid), visible ? true : deleteField()))
}
