import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { CATEGORIES, category, categoryOrder } from './categories'
import { categoryFor, suggest } from './dictionary'
import type { Household } from './household'
import {
  clearChecked,
  deleteItem,
  enterItem,
  parseEntry,
  restoreItems,
  setCategory,
  setChecked,
  useItems,
  type Item,
  type List,
} from './items'
import { useProducts, type Product } from './products'
import { useUndoToast } from './UndoToast'

/**
 * Items with the same normalised name, shown as one row: two phones that
 * both added milk while offline. A tap checks or unchecks them all.
 */
type Group = { key: string; items: Item[]; name: string; checked: boolean; quantity: string; categoryId?: string }

/**
 * Groups `items` (in the order they were added) and sorts the groups by
 * category in shop order. An item without a category of its own takes the
 * one the household remembers for the product, or the seed list's: it may
 * have been added on a phone that had not yet heard of that category.
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

/** One list: the input with its suggestions, the live items, and the checked ones. */
export function Items({ household, list, uid }: { household: Household; list: List; uid: string }) {
  const { items, pending } = useItems(list)
  const unsynced = useLasting(pending, UNSYNCED_MS)
  const products = useProducts(household)
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  // The group whose category picker is open.
  const [picking, setPicking] = useState<string | null>(null)
  const [toast, showToast] = useUndoToast()

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
    showToast({ message: `Deleted ${group.name}`, undo: () => restoreItems(list, ids) })
  }

  function clear() {
    const ids = clearChecked(list, items ?? [])
    showToast({ message: `Cleared ${ids.length} item${ids.length === 1 ? '' : 's'}`, undo: () => restoreItems(list, ids) })
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

      {toast}
    </>
  )
}
