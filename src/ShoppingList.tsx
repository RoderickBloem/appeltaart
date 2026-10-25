import { signOut, type User } from 'firebase/auth'
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { categoryFor, suggest, type Product } from './dictionary'
import { CATEGORIES, category, categoryOrder } from './categories'
import { auth, db } from './firebase'
import {
  clearChecked,
  deleteItem,
  enterItem,
  invite,
  restoreItems,
  setCategory,
  setChecked,
  createList,
  listIn,
  MAIN_LIST,
  parseEntry,
  setMyName,
  setVisible,
  useHousehold,
  useHouseholdInfo,
  useItems,
  useLists,
  useProducts,
  withdrawInvite,
  type Household,
  type HouseholdInfo,
  type Item,
  type List,
  type ListEntry,
} from './list'

/**
 * Keeps the screen on while the app is in the foreground: a phone that locks
 * every thirty seconds is the main annoyance of shopping lists. The browser
 * drops the lock when the app is hidden, so it is taken again on return.
 */
function useWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | undefined
    let stopped = false
    const take = () => {
      if (document.visibilityState !== 'visible') return
      navigator.wakeLock
        .request('screen')
        .then((taken) => {
          if (stopped) void taken.release()
          else lock = taken
        })
        // Refused, e.g. in battery saver: the screen just locks as usual.
        .catch(() => {})
    }
    take()
    document.addEventListener('visibilitychange', take)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', take)
      void lock?.release()
    }
  }, [])
}

export function ShoppingList({ user }: { user: User }) {
  // Only a verified address can be invited, so only that one is looked up.
  const household = useHousehold(db, user.uid, user.emailVerified ? user.email : null)
  useWakeLock()
  if (household) return <HouseholdScreen key={household.id} household={household} user={user} />
  // Until the list is known; for someone not invited, that is all there is.
  return (
    <main className="screen">
      <header className="bar">
        <span className="who" data-testid="user-name">
          {user.displayName ?? user.email}
        </span>
        <button onClick={() => signOut(auth)}>Sign out</button>
      </header>
    </main>
  )
}

const LAST_LIST = 'appeltaart:list'

/** The list this phone showed last; a list that is gone falls back to the main one. */
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

function HouseholdScreen({ household, user }: { household: Household; user: User }) {
  const info = useHouseholdInfo(household)
  const { lists, complete } = useLists(household, user.uid, info)
  const [listId, setListId] = useLastList()
  const [panel, setPanel] = useState<'lists' | 'share' | null>(null)
  const name = user.displayName ?? user.email ?? 'Someone'

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
          onDone={() => setPanel(null)}
        />
      )}
      {current && (
        <Items key={current.id} household={household} list={listIn(household, current.id)} uid={user.uid} />
      )}
    </main>
  )
}

function ListsPanel({
  household,
  uid,
  info,
  lists,
  current,
  onPick,
  onDone,
}: {
  household: Household
  uid: string
  info: HouseholdInfo
  lists: ListEntry[]
  current: ListEntry
  onPick: (id: string) => void
  onDone: () => void
}) {
  const [newName, setNewName] = useState('')

  function create(event: FormEvent) {
    event.preventDefault()
    const name = newName.trim()
    if (!name) return
    // Everyone sees a new list until someone unticks them.
    onPick(createList(household, uid, name, info.people.map((p) => p.uid)))
    setNewName('')
  }

  return (
    <section className="share" data-testid="lists">
      <ul className="choices">
        {lists.map((l) => (
          <li key={l.id}>
            <button aria-current={l.id === current.id} onClick={() => onPick(l.id)}>
              {l.name}
            </button>
          </li>
        ))}
      </ul>
      {current.id !== MAIN_LIST && (
        <fieldset>
          <legend>Who sees {current.name}</legend>
          {info.people.map((p) => (
            <label key={p.uid}>
              <input
                type="checkbox"
                checked={current.visibleTo.includes(p.uid)}
                // Nobody hides a list from themselves; that would lose it.
                disabled={p.uid === uid}
                onChange={(event) => setVisible(household, current.id, p.uid, event.target.checked)}
              />
              {p.name}
            </label>
          ))}
        </fieldset>
      )}
      <form onSubmit={create}>
        <input
          aria-label="New list name"
          placeholder="New list"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          autoComplete="off"
        />
        <button className="primary">Create</button>
      </form>
      <button onClick={onDone}>Done</button>
    </section>
  )
}

function SharePanel({ household, info, onDone }: { household: Household; info: HouseholdInfo | undefined; onDone: () => void }) {
  const [email, setEmail] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (email.includes('@')) invite(household, email)
    setEmail('')
  }

  return (
    <section className="share">
      <p data-testid="member-count">
        {info && (info.people.length === 1 ? 'Only you, so far' : `${info.people.length} people use these lists`)}
      </p>
      <p data-testid="people">{info?.people.map((p) => p.name).join(', ')}</p>
      <ul data-testid="invites">
        {info?.invites.map(({ address, typed }) => (
          <li key={address}>
            <span>{typed}</span>
            <span className="muted">invited</span>
            <button aria-label={`Withdraw invitation for ${typed}`} onClick={() => withdrawInvite(household, address)}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={submit}>
        <input
          aria-label="Gmail address"
          type="email"
          placeholder="Their Gmail address"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="off"
        />
        <button className="primary">Invite</button>
      </form>
      <p className="muted">They join when they sign in to Appeltaart with that address. Each list shows who sees it.</p>
      <button onClick={onDone}>Done</button>
    </section>
  )
}

/**
 * Items with the same normalised name, shown as one row: two phones that
 * both added milk while offline. A tap checks or unchecks them all.
 */
type Group = { key: string; items: Item[]; name: string; checked: boolean; quantity: string; categoryId?: string }

/**
 * Groups `items` (in the order they were added) and sorts the groups by
 * category in shop order. An item without a category of its own takes the
 * one the list remembers for the product, or the seed list's: it may have
 * been added on a phone that had not yet heard of that category.
 */
function groupItems(items: Item[], products: Map<string, Product> | undefined): Group[] {
  const groups = new Map<string, Item[]>()
  for (const item of items) groups.set(item.normName, [...(groups.get(item.normName) ?? []), item])
  const grouped = [...groups].map(([key, members]) => ({
    key,
    items: members,
    name: members[0].name,
    checked: members.every((i) => i.checked),
    quantity: [...new Set(members.flatMap((i) => (i.quantity ? [i.quantity] : [])))].join(', '),
    categoryId: members.find((i) => i.categoryId)?.categoryId ?? categoryFor(products, key),
  }))
  // A stable sort, so within a category the order they were added in stays.
  return grouped.sort((a, b) => categoryOrder(a.categoryId) - categoryOrder(b.categoryId))
}

/**
 * True once `value` has been true for `ms` without a break. Online, a change
 * is confirmed within a fraction of a second, which should not flash a
 * "Not synced" marker on every tap.
 */
function useLasting(value: boolean, ms: number): boolean {
  const [lasting, setLasting] = useState(false)
  useEffect(() => {
    if (!value) return
    const timer = setTimeout(() => setLasting(true), ms)
    return () => {
      clearTimeout(timer)
      setLasting(false)
    }
  }, [value, ms])
  return value && lasting
}

const UNSYNCED_MS = 2_000

type Toast = { message: string; undo: () => void }

const TOAST_MS = 5_000

function Items({ household, list, uid }: { household: Household; list: List; uid: string }) {
  const { items, pending } = useItems(list)
  const unsynced = useLasting(pending, UNSYNCED_MS)
  const products = useProducts(household)
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  // The group whose category picker is open.
  const [picking, setPicking] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  function enter(entry: string) {
    enterItem(household, list, uid, entry, items ?? [], (normName) => categoryFor(products, normName))
    setText('')
    input.current?.focus()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    enter(text)
  }

  const typed = parseEntry(text)
  const onList = new Set((items ?? []).filter((i) => !i.checked).map((i) => i.normName))
  const suggestions = suggest(typed.name, products, onList)
  // Picking a suggestion keeps a quantity typed after the colon.
  const pick = (name: string) => enter(typed.quantity === undefined ? name : `${name}: ${typed.quantity}`)

  const groups = groupItems(items ?? [], products)
  const live = groups.filter((g) => !g.checked)
  const checked = groups.filter((g) => g.checked)

  function toggle(group: Group) {
    for (const item of group.items) if (item.checked === group.checked) setChecked(list, item.id, !group.checked)
  }

  function remove(group: Group) {
    const ids = group.items.map((i) => i.id)
    for (const id of ids) deleteItem(list, id)
    setToast({ message: `Deleted ${group.name}`, undo: () => restoreItems(list, ids) })
  }

  function clear() {
    const ids = clearChecked(list, items ?? [])
    setToast({ message: `Cleared ${ids.length} item${ids.length === 1 ? '' : 's'}`, undo: () => restoreItems(list, ids) })
  }

  function choose(group: Group, categoryId: string) {
    setCategory(household, list, group.items, categoryId)
    setPicking(null)
  }

  const row = (group: Group) => {
    const cat = category(group.categoryId)
    return (
      <li key={group.key} data-category={cat?.id ?? ''} style={{ '--cat': cat?.colour ?? 'transparent' } as CSSProperties}>
        <div className="row">
          <button
            className="swatch"
            aria-label={`Category of ${group.name}`}
            aria-expanded={picking === group.key}
            title={cat?.name ?? 'No category'}
            onClick={() => setPicking(picking === group.key ? null : group.key)}
          >
            <span />
          </button>
          <button className="item" onClick={() => toggle(group)}>
            <span data-testid="item-name">{group.name}</span>
            {group.quantity && (
              <span className="quantity" data-testid="item-quantity">
                {group.quantity}
              </span>
            )}
          </button>
          <button className="delete" aria-label={`Delete ${group.name}`} onClick={() => remove(group)}>
            ×
          </button>
        </div>
        {picking === group.key && (
          <div className="picker">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                style={{ '--cat': c.colour } as CSSProperties}
                aria-pressed={c.id === group.categoryId}
                onClick={() => choose(group, c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </li>
    )
  }

  return (
    <>
      {/* Stays focused after submitting, so several items can be typed in a row. */}
      <form className="add" onSubmit={submit}>
        <input
          ref={input}
          aria-label="New item"
          placeholder="Add an item, or item: amount"
          value={text}
          onChange={(event) => setText(event.target.value)}
          autoComplete="off"
          enterKeyHint="enter"
        />
        {/* Only while something has not left the phone. */}
        {unsynced && <span className="pending">Not synced</span>}
        {suggestions.length > 0 && (
          <div className="suggestions" data-testid="suggestions">
            {suggestions.map((name) => (
              <button
                key={name}
                type="button"
                // Keeps the keyboard up: the input never loses focus.
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => pick(name)}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </form>

      <ul className="items" data-testid="live-items">
        {live.map(row)}
      </ul>

      {checked.length > 0 && (
        <section className="checked">
          <ul className="items" data-testid="checked-items">
            {checked.map(row)}
          </ul>
          <button onClick={clear}>Clear checked</button>
        </section>
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          <button
            onClick={() => {
              toast.undo()
              setToast(null)
            }}
          >
            Undo
          </button>
        </div>
      )}
    </>
  )
}
