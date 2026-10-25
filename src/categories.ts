/**
 * The categories, in the order of a walk through the shop. Fixed in code for
 * now; the ids are stored on items and products, so moving the set into
 * Firestore later (spec, "Categories ordered by store layout") keeps them.
 */
export type Category = { id: string; name: string; colour: string }

export const CATEGORIES: Category[] = [
  { id: 'produce', name: 'Fruit & vegetables', colour: '#43a047' },
  { id: 'bakery', name: 'Bread & bakery', colour: '#a1887f' },
  { id: 'dairy', name: 'Dairy & eggs', colour: '#42a5f5' },
  { id: 'meat', name: 'Meat & fish', colour: '#e53935' },
  { id: 'pantry', name: 'Pantry', colour: '#ffb300' },
  { id: 'frozen', name: 'Frozen', colour: '#26c6da' },
  { id: 'drinks', name: 'Drinks', colour: '#8e24aa' },
  { id: 'household', name: 'Household', colour: '#78909c' },
]

const byId = new Map(CATEGORIES.map((c, i) => [c.id, { ...c, order: i }]))

export const category = (id: string | undefined) => (id ? byId.get(id) : undefined)

/** Sort position: shop order, unknown or uncategorised last. */
export const categoryOrder = (id: string | undefined) => category(id)?.order ?? CATEGORIES.length
