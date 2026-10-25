import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  FieldPath,
  getDoc,
  increment,
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
  type FirestoreError,
  type QueryDocumentSnapshot,
  type DocumentReference,
  type Firestore,
  type SnapshotMetadata,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import type { Product } from './dictionary'
import { normalise } from './normalise'

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
 * The document whose `items` collection holds a list: the household document
 * for its main list, lists/{householdId}/lists/{id} for the others. Every
 * operation takes the list it acts on, so the test harness can run the same
 * code against several Firestore clients.
 */
export type List = DocumentReference

/**
 * A household: the people (`members`), their invitations, and what they
 * have learned about products, shared by all their lists. Stored in `lists/`
 * because it began as a single list; its own `items` are the main list.
 */
export type Household = DocumentReference

/** The id of a household's main list, the one everyone in it sees. */
export const MAIN_LIST = 'main'

export const listIn = (household: Household, listId: string): List =>
  listId === MAIN_LIST ? household : doc(household, 'lists', listId)

export const listRef = (db: Firestore, listId: string): List => doc(db, 'lists', listId)
const itemRef = (list: List, id: string) => doc(list, 'items', id)
// One document per product the list has ever had, keyed by its normalised
// name; encoded, since a name may contain a slash.
const productRef = (household: Household, normName: string) =>
  doc(household, 'products', encodeURIComponent(normName))

// Deleted items count towards this until the tombstone purge removes them.
const MAX_ITEMS = 2000
const MAX_BATCH = 500

export { normalise } from './normalise'

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
export function addItem(list: List, createdBy: string, name: string, categoryId?: string, quantity?: string): string {
  const ref = doc(collection(list, 'items'))
  const normName = normalise(name)
  report(
    setDoc(
      ref,
      {
        name,
        normName,
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
 * What typing `text` into the list does. A product already on the list,
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
 * Notes that the product was put on the list once more. Never touches its
 * category, which only setCategory() changes.
 */
export function rememberProduct(household: Household, name: string) {
  const normName = normalise(name)
  report(setDoc(productRef(household, normName), { name, normName, uses: increment(1), lastUsed: serverTimestamp() }, { merge: true }))
}

/**
 * Puts `items` (namesakes, normally one) in a category, and remembers it for
 * the product, so the next time it is typed it lands there by itself.
 */
export function setCategory(household: Household, list: List, items: Item[], categoryId: string) {
  for (const item of items) report(updateDoc(itemRef(list, item.id), { categoryId, updatedAt: serverTimestamp() }))
  const { name, normName } = items[0]
  report(setDoc(productRef(household, normName), { name, normName, categoryId }, { merge: true }))
}

/** Every product the household has learned, by normalised name; `undefined` until known. */
export function useProducts(household: Household): Map<string, Product> | undefined {
  const [products, setProducts] = useState<Map<string, Product> | undefined>(undefined)
  useEffect(
    () =>
      onSnapshot(collection(household, 'products'), (snapshot) => {
        const known = new Map<string, Product>()
        for (const d of snapshot.docs) {
          const { name, normName, categoryId, uses } = d.data()
          known.set(normName, { name, normName, categoryId, uses: uses ?? 0 })
        }
        setProducts(known)
      }),
    [household],
  )
  return products
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
 * e2e/sync.spec.ts; see open question 7 in docs/spec.md).
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
 * Lower case; for Gmail also without dots and +suffix, as Gmail delivers
 * j.doe+shop@gmail.com to jdoe@gmail.com. Same as normaliseEmail() in
 * firestore.rules, which checks it.
 */
export function normaliseEmail(email: string): string {
  const lower = email.trim().toLowerCase()
  const [local, domain, ...rest] = lower.split('@')
  const gmail = rest.length === 0 && (domain === 'gmail.com' || domain === 'googlemail.com')
  return gmail ? `${local.split('+')[0].replaceAll('.', '')}@gmail.com` : lower
}

/**
 * Invites `email` to the list; their app joins when they sign in with it.
 * `invites` holds the normalised address, which is what is matched;
 * `invitedAs` keeps it as typed, for showing.
 */
export function invite(list: List, email: string) {
  const address = normaliseEmail(email)
  report(updateDoc(list, 'invites', arrayUnion(address), new FieldPath('invitedAs', address), email.trim().toLowerCase()))
}

/** `address` is the normalised address, as in `invites`. */
export function withdrawInvite(list: List, address: string) {
  report(updateDoc(list, 'invites', arrayRemove(address), new FieldPath('invitedAs', address), deleteField()))
}

/** Joins a list the user is invited to: adds them, uses up the invitation. */
function join(list: List, uid: string, email: string) {
  report(updateDoc(list, new FieldPath('members', uid), true, 'invites', arrayRemove(email)))
}

/**
 * The household to use: among those the user is a member of, the one with
 * the most members, then the oldest, so a household they were invited to
 * wins over the one their app made at first sign-in. Items there stay there.
 */
function chooseHousehold(households: QueryDocumentSnapshot<DocumentData>[]): string {
  const size = (d: QueryDocumentSnapshot<DocumentData>) => Object.keys(d.data().members ?? {}).length
  const created = (d: QueryDocumentSnapshot<DocumentData>) =>
    (d.data({ serverTimestamps: 'estimate' }).createdAt as Timestamp | undefined)?.toMillis() ?? Infinity
  return [...households].sort((a, b) => size(b) - size(a) || created(a) - created(b) || a.id.localeCompare(b.id))[0].id
}

/**
 * The user's household, `undefined` until known. Joins any household the
 * user is invited to. Creates the user's own if the server says they belong
 * to none; never from the cache alone, which may simply not know the shared
 * one yet.
 */
export function useHousehold(db: Firestore, uid: string, email: string | null): Household | undefined {
  const [household, setHousehold] = useState<Household | undefined>(undefined)

  useEffect(() => {
    let chosen: string | undefined
    const mine = query(collection(db, 'lists'), where(new FieldPath('members', uid), '==', true))
    const stopMine = onSnapshot(mine, { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.empty) {
        if (!snapshot.metadata.fromCache) void ensureList(listRef(db, uid), [uid])
        return
      }
      // A household joined but not yet confirmed by the server would refuse
      // the item listener; the user's own never does (see firestore.rules).
      // The one already chosen stays usable through later pending writes,
      // such as the user's name being recorded in it.
      const usable = snapshot.docs.filter((d) => d.id === uid || d.id === chosen || !d.metadata.hasPendingWrites)
      if (usable.length === 0) return
      const id = chooseHousehold(usable)
      chosen = id
      // Keep the same reference while the choice stands, so the listeners
      // below it are not restarted on every change to the document.
      setHousehold((current) => (current?.id === id ? current : listRef(db, id)))
    })

    if (!email) return stopMine
    const address = normaliseEmail(email)
    const invited = query(collection(db, 'lists'), where('invites', 'array-contains', address))
    const stopInvited = onSnapshot(invited, (snapshot) => {
      for (const d of snapshot.docs) if (!d.metadata.hasPendingWrites) join(d.ref, uid, address)
    })
    return () => {
      stopMine()
      stopInvited()
    }
  }, [db, uid, email])

  return household
}

export type Person = { uid: string; name: string }

const DEFAULT_MAIN_NAME = 'Shopping'

export type HouseholdInfo = {
  people: Person[]
  /** Pending invitations: the normalised address, and the address as typed. */
  invites: { address: string; typed: string }[]
  mainListName: string
}

/** Who is in the household, who is invited, and the main list's name; `undefined` until known. */
export function useHouseholdInfo(household: Household): HouseholdInfo | undefined {
  const [info, setInfo] = useState<HouseholdInfo | undefined>(undefined)
  useEffect(
    () =>
      onSnapshot(household, (snapshot) => {
        const data = snapshot.data() ?? {}
        const invites = ((data.invites ?? []) as string[]).map((address) => ({
          address,
          typed: (data.invitedAs?.[address] as string | undefined) ?? address,
        }))
        const people = Object.keys(data.members ?? {})
          .map((uid) => ({ uid, name: (data.memberNames?.[uid] as string | undefined) ?? 'Someone' }))
          .sort((a, b) => a.name.localeCompare(b.name))
        setInfo({ people, invites, mainListName: data.mainListName ?? DEFAULT_MAIN_NAME })
      }),
    [household],
  )
  return info
}

/** Records the user's name in the household, so others can pick them for a list. */
export function setMyName(household: Household, uid: string, name: string) {
  report(updateDoc(household, new FieldPath('memberNames', uid), name))
}

export type ListEntry = { id: string; name: string; visibleTo: string[] }

const RETRY_MS = 1_500

/**
 * Runs `listen` and, when it fails, runs it again a few seconds later. The
 * rules refuse a listener while a document it depends on has not reached
 * the server yet, such as a list just created, and a refused listener stops.
 */
function keepListening(listen: (onError: () => void) => () => void): () => void {
  let stopped = false
  let stop = () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  const start = () => {
    stop = listen(() => {
      if (!stopped) timer = setTimeout(start, RETRY_MS)
    })
  }
  start()
  return () => {
    stopped = true
    clearTimeout(timer)
    stop()
  }
}

/**
 * The household's lists the user sees: the main list first, at once, then
 * the others by name. `complete` is false until the others are known, which
 * for a new household waits for the server (see keepListening).
 */
export function useLists(
  household: Household,
  uid: string,
  info: HouseholdInfo | undefined,
): { lists: ListEntry[]; complete: boolean } {
  const [others, setOthers] = useState<ListEntry[] | undefined>(undefined)
  useEffect(
    () =>
      keepListening((onError) =>
        onSnapshot(
          query(collection(household, 'lists'), where(new FieldPath('visibleTo', uid), '==', true)),
          (snapshot) =>
            setOthers(
              snapshot.docs
                .map((d) => ({ id: d.id, name: d.data().name as string, visibleTo: Object.keys(d.data().visibleTo ?? {}) }))
                .sort((a, b) => a.name.localeCompare(b.name)),
            ),
          onError,
        ),
      ),
    [household, uid],
  )
  const main = {
    id: MAIN_LIST,
    name: info?.mainListName ?? DEFAULT_MAIN_NAME,
    visibleTo: info?.people.map((p) => p.uid) ?? [uid],
  }
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

/** Shows a list (not the main one) to someone in the household, or stops showing it. */
export function setVisible(household: Household, listId: string, uid: string, visible: boolean) {
  report(updateDoc(listIn(household, listId), new FieldPath('visibleTo', uid), visible ? true : deleteField()))
}

/**
 * The live items, in shop order; `undefined` until the first snapshot. And
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
