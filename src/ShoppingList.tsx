import type { User } from 'firebase/auth'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { db } from './firebase'
import { addItem, clearChecked, deleteItem, ensureList, listRef, setChecked, useItems, type Item } from './list'

export function ShoppingList({ user }: { user: User }) {
  const uid = user.uid
  // Milestone 2 has one list per user, stored under the user's uid. Sharing
  // (milestone 4) replaces this with a list found through its members map.
  const list = useMemo(() => listRef(db, uid), [uid])
  const items = useItems(list)
  const [text, setText] = useState('')

  useEffect(() => void ensureList(list, [uid]), [list, uid])

  function submit(event: FormEvent) {
    event.preventDefault()
    const name = text.trim()
    if (name) addItem(list, uid, name)
    setText('')
  }

  const live = items?.filter((item) => !item.checked) ?? []
  const checked = items?.filter((item) => item.checked) ?? []

  const row = (item: Item) => (
    <li key={item.id}>
      <button className="item" data-testid="item-name" onClick={() => setChecked(list, item.id, !item.checked)}>
        {item.name}
      </button>
      <button className="delete" aria-label={`Delete ${item.name}`} onClick={() => deleteItem(list, item.id)}>
        ×
      </button>
    </li>
  )

  return (
    <>
      {/* Stays focused after submitting, so several items can be typed in a row. */}
      <form className="add" onSubmit={submit}>
        <input
          aria-label="New item"
          placeholder="Add an item"
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
