import type { User } from 'firebase/auth'
import { useEffect, useState, type FormEvent } from 'react'
import { addItem, clearChecked, deleteItem, ensureList, setChecked, useItems, type Item } from './list'

export function ShoppingList({ user }: { user: User }) {
  const uid = user.uid
  const items = useItems(uid)
  const [text, setText] = useState('')

  useEffect(() => ensureList(uid), [uid])

  function submit(event: FormEvent) {
    event.preventDefault()
    const name = text.trim()
    if (name) addItem(uid, uid, name)
    setText('')
  }

  const live = items?.filter((item) => !item.checked) ?? []
  const checked = items?.filter((item) => item.checked) ?? []

  const row = (item: Item) => (
    <li key={item.id}>
      <button className="item" data-testid="item-name" onClick={() => setChecked(uid, item.id, !item.checked)}>
        {item.name}
      </button>
      <button className="delete" aria-label={`Delete ${item.name}`} onClick={() => deleteItem(uid, item.id)}>
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
          <button onClick={() => clearChecked(uid, checked)}>Clear checked</button>
        </section>
      )}
    </>
  )
}
