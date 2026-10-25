/** Lower-cased, trimmed, accents folded: "  Äpfel " and "apfel" match. */
export function normalise(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
}
