import { collection, doc, increment, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { report } from './firestoreHelpers'
import type { Household } from './household'
import { normalise } from './normalise'

/** What the household has learned about a product, shared by all lists. */
export type Product = { name: string; normName: string; categoryId?: string; uses: number }

// One document per product ever put on a list, keyed by its normalised
// name; encoded, since a name may contain a slash.
const productRef = (household: Household, normName: string) =>
  doc(household, 'products', encodeURIComponent(normName))

/**
 * Notes that the product was put on a list once more, as last typed. Never
 * touches its category, which only rememberCategory() changes.
 */
export function rememberProduct(household: Household, name: string) {
  const normName = normalise(name)
  report(setDoc(productRef(household, normName), { name, normName, uses: increment(1), lastUsed: serverTimestamp() }, { merge: true }))
}

/** Remembers the product's category, so the next time it is typed it lands there by itself. */
export function rememberCategory(household: Household, name: string, categoryId: string) {
  const normName = normalise(name)
  report(setDoc(productRef(household, normName), { name, normName, categoryId }, { merge: true }))
}

/** Every product the household has learned, by normalised name; `undefined` until known. */
export function useProducts(household: Household): Map<string, Product> | undefined {
  const [products, setProducts] = useState<Map<string, Product> | undefined>(undefined)
  useEffect(
    () =>
      onSnapshot(collection(household, 'products'), (snapshot) => {
        const known = new Map<string, Product>()
        for (const d of snapshot.docs) {
          const { name, normName, categoryId, uses } = d.data()
          known.set(normName, { name, normName, categoryId, uses: uses ?? 0 })
        }
        setProducts(known)
      }),
    [household],
  )
  return products
}
