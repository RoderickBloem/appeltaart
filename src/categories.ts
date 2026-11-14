/**
 * The categories, in the order of a walk through the family's supermarket:
 * one per aisle or pair of aisles, after its signs (decision 21 in
 * docs/spec.md). Fixed in code; the ids are stored on items and products.
 */
export type Category = { id: string; name: string; colour: string }

export const CATEGORIES: Category[] = [
  { id: 'produce', name: 'Fruit & vegetables', colour: '#43a047' },
  { id: 'chilled', name: 'Chilled', colour: '#42a5f5' },
  { id: 'tins', name: 'Tins & sauces', colour: '#e53935' },
  { id: 'pasta', name: 'Rice, pasta & spirits', colour: '#ffb300' },
  { id: 'drinks', name: 'Drinks & toiletries', colour: '#8e24aa' },
  { id: 'household', name: 'Household & coffee', colour: '#78909c' },
  { id: 'bakery', name: 'Bread & deli', colour: '#a1887f' },
  { id: 'frozen', name: 'Frozen & sweets', colour: '#26c6da' },
]

// Ids from the first set of categories that are no longer in use. Dairy and
// meat became Chilled; Pantry was split over three aisles, so it maps to no
// category, and its products fall back to the seed list's. The other old
// ids kept their name, with a wider meaning.
const REPLACED: Record<string, string | undefined> = { dairy: 'chilled', meat: 'chilled', pantry: undefined }

/** A stored category id as a current one; undefined for none or one that cannot be mapped. */
export const currentCategory = (id: string | undefined): string | undefined =>
  id !== undefined && id in REPLACED ? REPLACED[id] : id

const byId = new Map(CATEGORIES.map((c, i) => [c.id, { ...c, order: i }]))

export const category = (id: string | undefined) => {
  const current = currentCategory(id)
  return current ? byId.get(current) : undefined
}

/** Sort position: shop order, unknown or uncategorised last. */
export const categoryOrder = (id: string | undefined) => category(id)?.order ?? CATEGORIES.length
