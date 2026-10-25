import { normalise } from './normalise'
import { SEED_PRODUCTS } from './seed'

/** What the list has learned about a product (lists/{id}/products). */
export type Product = { name: string; normName: string; categoryId?: string; uses: number }

const seedByName = new Map(SEED_PRODUCTS.map((p) => [normalise(p.name), p]))

/** The category for a product: what the list learned, else the seed list's. */
export function categoryFor(products: Map<string, Product> | undefined, normName: string): string | undefined {
  return products?.get(normName)?.categoryId ?? seedByName.get(normName)?.categoryId
}

const MIN_LETTERS = 2
const MAX_SUGGESTIONS = 4

/** 0 when the name starts with `typed`, 1 when a later word does, else null. */
function rank(normName: string, typed: string): number | null {
  if (normName.startsWith(typed)) return 0
  return normName.split(/[\s-]+/).some((word) => word.startsWith(typed)) ? 1 : null
}

/**
 * Names to offer for what has been typed so far: the list's own products
 * first, most used first, then the seed list, shorter names first. Leaves
 * out what is already on the list, unchecked (`onList`, normalised names).
 */
export function suggest(typed: string, products: Map<string, Product> | undefined, onList: Set<string>): string[] {
  const query = normalise(typed)
  if (query.length < MIN_LETTERS) return []
  const fits = (normName: string) => !onList.has(normName) && rank(normName, query) !== null

  const learned = [...(products?.values() ?? [])]
    .filter((p) => fits(p.normName))
    .sort((a, b) => rank(a.normName, query)! - rank(b.normName, query)! || b.uses - a.uses || a.name.localeCompare(b.name))
  const seeded = [...seedByName]
    .filter(([normName]) => fits(normName) && !products?.has(normName))
    .sort(([a, pa], [b, pb]) => rank(a, query)! - rank(b, query)! || pa.name.length - pb.name.length || pa.name.localeCompare(pb.name))
    .map(([, p]) => p)

  return [...learned, ...seeded].slice(0, MAX_SUGGESTIONS).map((p) => p.name)
}
