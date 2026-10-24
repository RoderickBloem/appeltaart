# Plan and progress

The milestones are defined in [`spec.md`](spec.md), section "Build order". One milestone per session; each ends with `npm run build`, `npm run lint` and `npm run test:e2e` passing.

| # | Milestone | Status |
| --- | --- | --- |
| 1 | Skeleton | Built and tested in the browser. Waiting on the maintainer: Firebase project, `.env.production`, deploy, install on a phone. |
| 2 | Single-device list | Built and tested against the emulators (7 tests in `e2e/list.spec.ts`). Not yet tried on a phone. |
| 3 | Emulator and harness | Next |
| 4 | Sharing | Not started |
| 5 | Shopping polish | Not started |
| 6 | Categories | Not started; only after two weeks of using milestone 5 |
| 7 | Dictionary | Not started |
| 8 | Quantities | Not started |

## Decisions

- **2026-10-24 — Clear checked vs. a concurrent uncheck.** If one phone clears checked items while another unchecks one of them, the item stays deleted; undo brings it back. An uncheck writes only `checked`.
- **2026-10-24 — Everything is committed to `main`.**
- **2026-10-24 — Offline delete (open question 2).** Settled: the live-items query drops an offline-deleted item at once; no extra `deleted` field needed.
- **2026-10-24 — `createdAt` from the phone's clock.** A pending `serverTimestamp()` is estimated to whole seconds, which shuffled items added offline. See open question 6 in the spec.
- **2026-10-24 — One list per user, for now.** The list document is `lists/{uid}`, created on first sign-in with `members: { uid: true }`. Milestone 4 replaces this with a list found through its members map.

## What milestone 2 built

- `src/firebase.ts`: Firestore with `persistentLocalCache` and `persistentMultipleTabManager`, connected to the Firestore emulator when `VITE_USE_EMULATORS` is `true`. `window.emulatorSignIn` now resolves to the uid.
- `src/list.ts`: the item writes from the spec's operation table (add, check, uncheck, soft delete, batched clear checked) and `useItems`, one `onSnapshot` on `where('deletedAt', '==', null)` with `limit(500)`, sorted by `createdAt` on the phone. Writes are never awaited.
- `src/ShoppingList.tsx`: the input at the top (stays focused), live items, checked items dimmed below, a delete button per row, and "Clear checked".
- `npm run test:e2e` now starts the Firestore emulator as well. Each list test signs in as a fresh user, so tests do not share a list, and reads the server state straight from the emulator's REST API.

Left for milestone 5, as the build order says: swipe to delete, the undo toast, the pending-write indicator, wake lock, duplicate collapsing.

## Notes for milestone 3

- The e2e tests already show restart durability (property 4) in a real browser: `e2e/list.spec.ts`, "offline changes survive a force-quit and sync when back online". The harness still needs it with several clients.
- The harness can call the functions in `src/list.ts` directly if they take a Firestore instance; today they use the single `db` from `src/firebase.ts`, so that needs a small refactor.
- Use `connectFirestoreEmulator` and `connectAuthEmulator` (open question 4).
