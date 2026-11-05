import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  FieldPath,
  onSnapshot,
  query,
  updateDoc,
  where,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type QueryDocumentSnapshot,
  type Timestamp,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { keepListening, report } from './firestoreHelpers'

/**
 * The shared document: the people who use the app (`members`, with their
 * names and addresses in `memberNames` and `memberEmails`), invitations, and what they have learned about
 * products. Its own `items` are the main list. Stored in `lists/` because it
 * began as the only list. The app does not show it as a thing of its own.
 */
export type Household = DocumentReference

export const householdRef = (db: Firestore, id: string): Household => doc(db, 'lists', id)

/** `name` and `email` are undefined for someone whose app has not recorded them yet. */
export type Person = { uid: string; name?: string; email?: string }

export const nameOf = (person: Person) => person.name ?? 'Name not known yet'

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
 * Invites `email`; their app joins when they sign in with it. `invites` holds
 * the normalised address, which is what is matched; `invitedAs` keeps it as
 * typed, for showing.
 */
export function invite(household: Household, email: string) {
  const address = normaliseEmail(email)
  report(updateDoc(household, 'invites', arrayUnion(address), new FieldPath('invitedAs', address), email.trim().toLowerCase()))
}

/** `address` is the normalised address, as in `invites`. */
export function withdrawInvite(household: Household, address: string) {
  report(updateDoc(household, 'invites', arrayRemove(address), new FieldPath('invitedAs', address), deleteField()))
}

/** Adds the user, records their name and address for the others, and uses up the invitation. */
function join(household: Household, uid: string, email: string, name: string) {
  report(
    updateDoc(
      household,
      new FieldPath('members', uid),
      true,
      new FieldPath('memberNames', uid),
      name,
      new FieldPath('memberEmails', uid),
      email,
      'invites',
      arrayRemove(normaliseEmail(email)),
    ),
  )
}

/** Records the user's name and address, so others can tell who is who. */
export function setMyDetails(household: Household, uid: string, name: string, email: string | null) {
  report(
    email
      ? updateDoc(household, new FieldPath('memberNames', uid), name, new FieldPath('memberEmails', uid), email)
      : updateDoc(household, new FieldPath('memberNames', uid), name),
  )
}

/**
 * There is one shared document; an account from before invitations may also
 * have one of its own. The one with the most members, then the oldest, wins.
 */
function choose(candidates: QueryDocumentSnapshot<DocumentData>[]): string {
  const size = (d: QueryDocumentSnapshot<DocumentData>) => Object.keys(d.data().members ?? {}).length
  const created = (d: QueryDocumentSnapshot<DocumentData>) =>
    (d.data({ serverTimestamps: 'estimate' }).createdAt as Timestamp | undefined)?.toMillis() ?? Infinity
  return [...candidates].sort((a, b) => size(b) - size(a) || created(a) - created(b) || a.id.localeCompare(b.id))[0].id
}

/**
 * The shared document the user is in, `undefined` until known (and for
 * someone not invited, for good). Joins it when the user is invited, which
 * needs a verified `email`.
 */
export function useHousehold(db: Firestore, uid: string, email: string | null, name: string): Household | undefined {
  const [household, setHousehold] = useState<Household | undefined>(undefined)

  useEffect(() => {
    let chosen: string | undefined
    const mine = query(collection(db, 'lists'), where(new FieldPath('members', uid), '==', true))
    // Retried after an error: otherwise the phone would keep whatever it had
    // found until then, possibly only an old document of its own.
    const stopMine = keepListening((onError) =>
      onSnapshot(
        mine,
        { includeMetadataChanges: true },
        (snapshot) => {
          // A join the server has not confirmed would only have its listeners
          // refused; wait for it. Once chosen, later pending writes do not matter.
          const usable = snapshot.docs.filter((d) => d.id === chosen || !d.metadata.hasPendingWrites)
          if (usable.length === 0) return
          const id = choose(usable)
          chosen = id
          // Keep the same reference while the choice stands, so the listeners
          // below it are not restarted on every change to the document.
          setHousehold((current) => (current?.id === id ? current : householdRef(db, id)))
        },
        onError,
      ),
    )
    if (!email) return stopMine

    const invitations = query(collection(db, 'lists'), where('invites', 'array-contains', normaliseEmail(email)))
    const stopInvited = keepListening((onError) =>
      onSnapshot(
        invitations,
        (snapshot) => {
          for (const d of snapshot.docs) if (!d.metadata.hasPendingWrites) join(d.ref, uid, email, name)
        },
        onError,
      ),
    )
    return () => {
      stopMine()
      stopInvited()
    }
  }, [db, uid, email, name])

  return household
}

export type HouseholdInfo = {
  /** Named people first, by name. */
  people: Person[]
  /** Pending invitations: the normalised address, and the address as typed. */
  invites: { address: string; typed: string }[]
}

/** Who uses the app and who is invited; `undefined` until known. */
export function useHouseholdInfo(household: Household): HouseholdInfo | undefined {
  const [info, setInfo] = useState<HouseholdInfo | undefined>(undefined)
  useEffect(
    () =>
      keepListening((onError) =>
        onSnapshot(
          household,
          (snapshot) => {
            const data = snapshot.data() ?? {}
            const invites = ((data.invites ?? []) as string[]).map((address) => ({
              address,
              typed: (data.invitedAs?.[address] as string | undefined) ?? address,
            }))
            const people = Object.keys(data.members ?? {})
              .map((uid) => ({
                uid,
                name: data.memberNames?.[uid] as string | undefined,
                email: data.memberEmails?.[uid] as string | undefined,
              }))
              // Named people first, by name.
              .sort((a, b) => (a.name ?? '\uffff').localeCompare(b.name ?? '\uffff'))
            setInfo({ people, invites })
          },
          onError,
        ),
      ),
    [household],
  )
  return info
}
