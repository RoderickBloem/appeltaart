import { signOut, type User } from 'firebase/auth'
import { useState, type CSSProperties, type FormEvent } from 'react'
import { CATEGORIES, category } from './categories'
import { auth, db } from './firebase'
import {
  clearChecked,
  deleteItem,
  enterItem,
  invite,
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

export function ShoppingList({ user }: { user: User }) {
  // Only a verified address can be invited, so only that one is looked up.
  const list = useMyList(db, user.uid, user.emailVerified ? user.email : null)
  const [sharing, setSharing] = useState(false)

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

function Items({ list, uid }: { list: List; uid: string }) {
  const items = useItems(list)
  const known = useProductCategories(list)
  const [text, setText] = useState('')
  // The item whose category picker is open.
  const [picking, setPicking] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    enterItem(list, uid, text, items ?? [], known)
    setText('')
  }

  const live = items?.filter((item) => !item.checked) ?? []
  const checked = items?.filter((item) => item.checked) ?? []

  function choose(item: Item, categoryId: string) {
    setCategory(list, items?.filter((i) => i.normName === item.normName) ?? [item], categoryId)
    setPicking(null)
  }

  const row = (item: Item) => {
    const cat = category(item.categoryId)
    return (
      <li key={item.id} data-category={cat?.id ?? ''} style={{ '--cat': cat?.colour ?? 'transparent' } as CSSProperties}>
        <div className="row">
          <button
            className="swatch"
            aria-label={`Category of ${item.name}`}
            aria-expanded={picking === item.id}
            title={cat?.name ?? 'No category'}
            onClick={() => setPicking(picking === item.id ? null : item.id)}
          >
            <span />
          </button>
          <button className="item" onClick={() => setChecked(list, item.id, !item.checked)}>
            <span data-testid="item-name">{item.name}</span>
            {item.quantity && (
              <span className="quantity" data-testid="item-quantity">
                {item.quantity}
              </span>
            )}
          </button>
          <button className="delete" aria-label={`Delete ${item.name}`} onClick={() => deleteItem(list, item.id)}>
            ×
          </button>
        </div>
        {picking === item.id && (
          <div className="picker">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                style={{ '--cat': c.colour } as CSSProperties}
                aria-pressed={c.id === item.categoryId}
                onClick={() => choose(item, c.id)}
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
      </form>

      <ul className="items" data-testid="live-items">
        {live.map(row)}
      </ul>

      {checked.length > 0 && (
        <section className="checked">
          <ul className="items" data-testid="checked-items">
            {checked.map(row)}
          </ul>
          <button onClick={() => clearChecked(list, checked)}>Clear checked</button>
        </section>
      )}
    </>
  )
}
