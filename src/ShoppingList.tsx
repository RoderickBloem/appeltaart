import { signOut, type User } from 'firebase/auth'
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
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
  useItems,
  useListInfo,
  useMyList,
  useProductCategories,
  withdrawInvite,
  type Item,
  type List,
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
  const list = useMyList(db, user.uid, user.emailVerified ? user.email : null)
  const [sharing, setSharing] = useState(false)
  useWakeLock()

  return (
    <main className="screen">
      <header className="bar">
        <h1>Appeltaart</h1>
        <span className="who" data-testid="user-name">
          {user.displayName ?? user.email}
        </span>
        {list && (
          <button aria-expanded={sharing} onClick={() => setSharing(!sharing)}>
            Share
          </button>
        )}
        <button onClick={() => signOut(auth)}>Sign out</button>
      </header>
      {list && sharing && <SharePanel list={list} onDone={() => setSharing(false)} />}
      {/* Nothing to show until the list is known; from the cache that is at once. */}
      {list && <Items key={list.id} list={list} uid={user.uid} />}
    </main>
  )
}

function SharePanel({ list, onDone }: { list: List; onDone: () => void }) {
  const info = useListInfo(list)
  const [email, setEmail] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (email.includes('@')) invite(list, email)
    setEmail('')
  }

  return (
    <section className="share">
      <p data-testid="member-count">
        {info && (info.members === 1 ? 'Only you use this list' : `${info.members} people share this list`)}
      </p>
      <ul data-testid="invites">
        {info?.invites.map(({ address, typed }) => (
          <li key={address}>
            <span>{typed}</span>
            <span className="muted">invited</span>
            <button aria-label={`Withdraw invitation for ${typed}`} onClick={() => withdrawInvite(list, address)}>
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
      <p className="muted">They join when they sign in to Appeltaart with that address.</p>
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
 * one the list remembers for the product: it may have been added on a phone
 * that had not yet heard of that category.
 */
function groupItems(items: Item[], known: Map<string, string> | undefined): Group[] {
  const groups = new Map<string, Item[]>()
  for (const item of items) groups.set(item.normName, [...(groups.get(item.normName) ?? []), item])
  const grouped = [...groups].map(([key, members]) => ({
    key,
    items: members,
    name: members[0].name,
    checked: members.every((i) => i.checked),
    quantity: [...new Set(members.flatMap((i) => (i.quantity ? [i.quantity] : [])))].join(', '),
    categoryId: members.find((i) => i.categoryId)?.categoryId ?? known?.get(key),
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

function Items({ list, uid }: { list: List; uid: string }) {
  const { items, pending } = useItems(list)
  const unsynced = useLasting(pending, UNSYNCED_MS)
  const known = useProductCategories(list)
  const [text, setText] = useState('')
  // The group whose category picker is open.
  const [picking, setPicking] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  function submit(event: FormEvent) {
    event.preventDefault()
    enterItem(list, uid, text, items ?? [], known)
    setText('')
  }

  const groups = groupItems(items ?? [], known)
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
    setCategory(list, group.items, categoryId)
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
          aria-label="New item"
          placeholder="Add an item, or item: amount"
          value={text}
          onChange={(event) => setText(event.target.value)}
          autoComplete="off"
          enterKeyHint="enter"
        />
        {/* Only while something has not left the phone. */}
        {unsynced && <span className="pending">Not synced</span>}
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
