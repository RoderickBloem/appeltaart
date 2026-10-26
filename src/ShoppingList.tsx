import { signOut, type User } from 'firebase/auth'
import { useEffect, useState } from 'react'
import { auth, db } from './firebase'
import { setMyName, useHousehold, useHouseholdInfo, type Household } from './household'
import { Items } from './Items'
import { deleteList, listIn, MAIN_LIST, restoreList, useLists } from './lists'
import { ListsPanel } from './ListsPanel'
import { SharePanel } from './SharePanel'
import { useUndoToast } from './UndoToast'
import { useWakeLock } from './useWakeLock'

const displayName = (user: User) => user.displayName ?? user.email ?? 'Someone'

/** The signed-in screen. */
export function ShoppingList({ user }: { user: User }) {
  // Only a verified address can be invited, so only that one is looked up.
  const household = useHousehold(db, user.uid, user.emailVerified ? user.email : null, displayName(user))
  useWakeLock()
  if (household) return <ListScreen key={household.id} household={household} user={user} />
  // Until the list is known; for someone not invited, that is all there is.
  return (
    <main className="screen">
      <header className="bar">
        <span className="who" data-testid="user-name">
          {displayName(user)}
        </span>
        <button onClick={() => signOut(auth)}>Sign out</button>
      </header>
    </main>
  )
}

const LAST_LIST = 'appeltaart:list'

/** The list this phone showed last, kept across restarts. */
function useLastList(): [string, (id: string) => void] {
  const [listId, setListId] = useState(() => {
    try {
      return localStorage.getItem(LAST_LIST) ?? MAIN_LIST
    } catch {
      return MAIN_LIST
    }
  })
  const choose = (id: string) => {
    setListId(id)
    try {
      localStorage.setItem(LAST_LIST, id)
    } catch {
      // Private mode: the choice lasts until the app closes.
    }
  }
  return [listId, choose]
}

function ListScreen({ household, user }: { household: Household; user: User }) {
  const info = useHouseholdInfo(household)
  const { lists, complete } = useLists(household, user.uid, info)
  const [listId, setListId] = useLastList()
  const [panel, setPanel] = useState<'lists' | 'share' | null>(null)
  const [toast, showToast] = useUndoToast()
  const name = displayName(user)

  // Records the user's name, so others can pick them for a list.
  useEffect(() => {
    if (info && !info.people.some((p) => p.uid === user.uid && p.name === name)) setMyName(household, user.uid, name)
  }, [info, household, user.uid, name])

  // A remembered list that is gone falls back to the main list, but only once
  // all lists are known: until then it may simply not have arrived.
  const current = lists.find((l) => l.id === listId) ?? (complete ? lists[0] : undefined)
  const toggle = (which: 'lists' | 'share') => setPanel(panel === which ? null : which)

  return (
    <main className="screen">
      <header className="bar">
        <button
          className="list-menu"
          data-testid="list-menu"
          aria-expanded={panel === 'lists'}
          disabled={!current}
          onClick={() => toggle('lists')}
        >
          <span>{current?.name ?? 'Appeltaart'}</span> ▾
        </button>
        <span className="who" data-testid="user-name">
          {name}
        </span>
        <button aria-expanded={panel === 'share'} onClick={() => toggle('share')}>
          Share
        </button>
        <button onClick={() => signOut(auth)}>Sign out</button>
      </header>
      {panel === 'share' && <SharePanel household={household} info={info} onDone={() => setPanel(null)} />}
      {panel === 'lists' && current && info && (
        <ListsPanel
          household={household}
          uid={user.uid}
          info={info}
          lists={lists}
          current={current}
          onPick={(id) => {
            setListId(id)
            setPanel(null)
          }}
          onDelete={(list) => {
            deleteList(household, list.id)
            setListId(MAIN_LIST)
            setPanel(null)
            showToast({ message: `Deleted ${list.name}`, undo: () => restoreList(household, list.id) })
          }}
          onDone={() => setPanel(null)}
        />
      )}
      {current && <Items key={current.id} household={household} list={listIn(household, current.id)} uid={user.uid} />}
      {toast}
    </main>
  )
}
