import { useState, type FormEvent } from 'react'
import { nameOf, type Household, type HouseholdInfo } from './household'
import { createList, MAIN_LIST, setVisible, type ListEntry } from './lists'

/** The list menu: pick a list, tick who sees it, delete it, or create one. */
export function ListsPanel({
  household,
  uid,
  info,
  lists,
  current,
  onPick,
  onDelete,
  onDone,
}: {
  household: Household
  uid: string
  info: HouseholdInfo
  lists: ListEntry[]
  current: ListEntry
  onPick: (id: string) => void
  onDelete: (list: ListEntry) => void
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
    <section className="panel" data-testid="lists">
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
              {nameOf(p)}
            </label>
          ))}
          {info.people.some((p) => !p.name) && (
            <p className="muted">Names appear once each person has opened the app since this update.</p>
          )}
          <button aria-label={`Delete ${current.name}`} onClick={() => onDelete(current)}>
            Delete list
          </button>
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
