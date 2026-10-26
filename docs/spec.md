# Appeltaart — spec

Started Oct 24, 2026 · @Rick. Describes the app as built; how it got there is in "Decisions" at the end, and progress and deployment are in [`plan.md`](plan.md).

## Goals

A shared grocery list for the family that keeps working when the phone has no signal in the shop.

- Installable from the browser as a home-screen app; Google sign-in.
- Add an item by typing, check it off, delete it, clear all checked items.
- Changes appear on the other phones within a second when online.
- Changes made offline are kept across an app restart and sent on reconnect.
- Several lists, each shown to the people picked for it; colour-coded categories in shop order; a dictionary so a few letters are enough; quantities.

The success test: put all phones in flight mode, make conflicting edits on each, bring them back one at a time, and end with every phone showing the same list.

## Data model

```
lists/{householdId}                         the shared document
lists/{householdId}/items/{itemId}          the main list
lists/{householdId}/lists/{listId}          further lists
lists/{householdId}/lists/{listId}/items/{itemId}
lists/{householdId}/products/{normName}     what the app has learned about products
```

There is one shared document; the app does not show it as a thing of its own. It sits in `lists/` because it began as the only list, and its id is the uid of whoever signed in first.

The shared document:

| Field | Type | Notes |
| --- | --- | --- |
| `members` | map of uid to `true` | Who uses the app; the rules check it |
| `memberNames` | map of uid to string | Display names; each person's app records its own |
| `invites` | array of string | Pending invitations, normalised: lower case, Gmail without dots and `+suffix` |
| `invitedAs` | map of normalised address to string | The same addresses as typed, for showing |
| `createdAt` | timestamp | |

A further list:

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | |
| `visibleTo` | map of uid to `true` | Who sees the list; always includes whoever changes it |
| `deletedAt` | timestamp or null | Set when deleted; null or missing means live |
| `createdAt`, `createdBy` | timestamp, uid | |

An item:

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | As typed, including capitals |
| `normName` | string | Lower-cased, trimmed, accents folded; spots duplicates and finds the product |
| `checked` | boolean | Missing means false (decision 9) |
| `deletedAt` | timestamp or null | Null or missing means live |
| `createdAt` | timestamp | From the phone's clock; orders the list within a category (decision 6) |
| `updatedAt` | timestamp | `serverTimestamp()`, set on every write |
| `createdBy` | string | uid |
| `categoryId` | string, optional | One of the categories in `src/categories.ts` |
| `quantity` | string, optional | Free text: "6", "ripe", "2 kg" |

A product, keyed by its URI-encoded `normName`: `name` (as last typed), `normName`, `categoryId`, `uses`, `lastUsed`.

Ids are generated on the phone by `doc(collection(...))`, so an add works offline and appears in the local cache at once.

## Operations

One rule governs them all: write only the fields that change, so the server orders the writes and two people changing different fields of the same item both keep their change.

| Operation | Write | Conflict outcome |
| --- | --- | --- |
| Add | `setDoc` with `merge: true`, without `checked` or `deletedAt` | New id each time, so two adds never collide; a re-sent add cannot undo a check or delete (decision 9) |
| Rename | `updateDoc { name, normName, updatedAt }` | Later write wins (not offered in the app; the sync tests use it) |
| Check / uncheck | `updateDoc { checked, updatedAt }` | Later write wins |
| Set quantity | `updateDoc { quantity, updatedAt }` | Later write wins |
| Set category | `updateDoc { categoryId, updatedAt }`, and the same on the product | Later write wins |
| Delete | `updateDoc { deletedAt: serverTimestamp() }` | A concurrent change lands and the item stays deleted |
| Undo a delete or clear | `updateDoc { deletedAt: null }` | Later write wins |
| Clear checked | Batched `deletedAt` writes, up to 500 per batch | An item unchecked elsewhere at the same time stays deleted (decision 1) |

Deletion is soft, for lists as for items, so that undo works.

The items query fetches every item, deleted ones included, with a `limit()` of 2000, and the app drops deleted items itself: filtering on `deletedAt` in the query loses deletes (decision 7). Deleted items are meant to be purged with admin rights once older than 30 days; that script is not written yet (`plan.md`, "Still open").

Two people adding the same product while offline produce two items. The app shows items with the same `normName` as one row, with their quantities joined, and a tap checks or unchecks them all.

Typing a product that is already on the list, checked or not, puts it back unchecked and sets the new quantity instead of adding it again.

## Offline and sync

The local cache is the source of truth for the interface. The UI never waits on the network, and a write that cannot reach the server waits in an IndexedDB queue.

- Firestore is initialised with `persistentLocalCache` and `persistentMultipleTabManager`. This is the most important line in the project: with the default in-memory cache, closing the app in the shop loses unsent writes.
- One `onSnapshot` listener per list, rendered regardless of `metadata.fromCache`, so a cold start with no signal shows the list.
- Writes are never awaited; Firestore's promise resolves only on server confirmation.
- "Not synced" shows once a change has waited more than two seconds for the server.
- A listener the rules refuse, for example on a list just created whose document has not reached the server, retries every 1.5 seconds.
- The service worker caches the app shell, so the app opens with no network at all.

## People and security rules

Firebase Auth with Google sign-in; no passwords.

Nobody gets in without an invitation (decision 19). Any member can invite someone from the Share panel by their Gmail address; when that person signs in with that address, their app adds them to `members` and records their name. All members have the same rights. Removing someone is done in the Firebase console.

`firestore.rules` enforces:

- Only members read the shared document; an invited person may read it to join.
- No client creates the shared document.
- Members may change only `invites`, `invitedAs` and their own entry in `memberNames`.
- An invited person, with a verified address that matches, may add exactly themselves to `members` and remove exactly their own invitation.
- Items and products of the main list: members only. Further lists and their items: members in that list's `visibleTo`, which may name only members and must include whoever changes it.
- No client deletes a document outright.

The rules read the shared document with `get()`, one extra read per evaluation; irrelevant at family scale.

## Interface

One list screen, plus a sign-in screen. Live items at the top, checked items dimmed underneath.

- Top bar: the list name, which opens the list menu (switch, create, tick who sees it, delete); the user's name; Share; Sign out.
- A text field pinned at the top that stays focused after submitting. "name: amount" sets a quantity. From two letters on, up to four suggestions appear under it; picking one adds it at once.
- Items sorted by category in shop order, then in the order they were added. A colour bar starts each row; tapping it opens the category picker.
- Tapping a row checks it; a checked row unchecks it. × deletes, with Undo for five seconds; so does "Clear checked".
- The screen stays awake while the app is visible (Screen Wake Lock API).
- Touch targets of 44 px, so that fifteen items fit on a Pixel 9 (decision 16).

## Categories, dictionary, quantities

- **Categories**: eight, fixed in `src/categories.ts` with their colours, in the order of a walk through the shop; uncategorised items come last.
- **Learned products**: choosing a category for an item stores it on the product, so the next time anyone types that product, on any list, it lands in that category.
- **Seed dictionary**: `src/seed.ts`, about 220 common groceries in English with a category, so the app helps from the first day. What the app has learned takes precedence. An item without a category of its own shows the product's category, learned or seeded.
- **Suggestions**: the app's own products first, most used first, then the seed list, shorter names first; a name starting with the typed letters before one where a later word does. Products already on the list are left out. A suggestion keeps a quantity typed after the colon.
- **Quantities**: free text after a colon, shown as a chip after the name. "tomatoes:" with nothing after the colon removes it.

## Test harness

Everything runs against the Firebase emulators with the demo project `demo-appeltaart`, never against the live project.

- `e2e/*.spec.ts`: Playwright tests of the real app, several of them with two or three phones, each a separate browser context.
- `e2e/sync.spec.ts` with `src/harness.ts`: three simulated phones, each in its own browser context (its own IndexedDB and network connections), a restart being a page reload. fast-check generates sequences of adds, renames, checks, deletes, clears, offline and online switches, restarts and pauses, 100 per property (`SYNC_RUNS` for more). After each sequence every phone goes online, and the test checks:
  1. **Convergence.** Every phone shows exactly the live items the server holds.
  2. **No lost adds.** Every add reached the server.
  3. **Delete beats concurrent edit.** The live items are exactly the added minus the deleted ones.
  4. **Restart durability.** Writes made offline survive a restart and arrive on reconnect.
  5. **Idempotent clear.** Clearing checked items on two phones equals clearing once.
- Every counterexample fast-check shrinks is kept as a named regression test.
- `e2e/rules.spec.ts` checks the rules through the emulator's REST API.

## Build order

The original plan, all built; kept for reference. Each milestone ended in something installable.

1. **Skeleton.** Vite, React, TypeScript, PWA manifest, service worker, Google sign-in.
2. **Single-device list.** Add, check, uncheck, delete, clear checked, with persistent caching. Ends with: the list survives a force-quit with no network.
3. **Emulator and harness.** Properties 1 to 5 over a hundred generated scenarios.
4. **Sharing.** Members map, security rules. Ends with: three phones, one list, conflicting offline edits converging.
5. **Shopping polish.** Wake lock, undo toast, pending-write indicator, duplicate collapsing.
6. **Categories.** Colours, shop order, quick reassignment.
7. **Dictionary.** Seed list, learned entries, type-ahead, automatic category.
8. **Quantities.**

Then, at the maintainer's request: invitations, multiple lists, invitation only.

## Decisions

Numbered as they were taken; the code refers to them by number.

1. **Clear checked vs. a concurrent uncheck** (2026-10-24). An uncheck writes only `checked`, so an item cleared on one phone while unchecked on another stays deleted; undo brings it back. Acceptable.
2. **Offline delete** (2026-10-24). A pending `serverTimestamp()` reads as null, so `deletedAt` is read with `{ serverTimestamps: 'estimate' }`; an item deleted offline disappears at once and stays gone after a restart.
3. **Pending timestamps** read with `{ serverTimestamps: 'estimate' }` give a local estimate instead of null.
4. **Emulator API**: `connectFirestoreEmulator` and `connectAuthEmulator`.
5. *(The original spec's "property 4 reproduces your current bug" referred to no known bug; property 4 passed from the start.)*
6. **`createdAt` from the phone's clock** (2026-10-24). A pending `serverTimestamp()` is estimated only to the second, which shuffled items typed offline. Strictly increasing within one app session; items from different phones are ordered by those phones' clocks.
7. **No `deletedAt` filter in queries** (2026-10-25, found by the generated tests). With the items query filtered on `deletedAt == null`, a phone that changed an item just as another deleted it never heard of the delete: the item had left its query on the server. The query fetches deleted items too and the app drops them. The same applies to any field phones change, such as `checked`, `categoryId` or a list's `deletedAt`: filter those on the phone.
8. **`enableNetwork()` only on a client that is offline.** On one that is already online it made the SDK (13.1.0) fail an internal assertion and stop syncing against the emulator.
9. **An add writes neither `checked` nor `deletedAt`** (2026-10-25, found by the generated tests). Firestore re-sends a write whose confirmation was lost; a full `setDoc` re-sent after another phone's delete brought the item back. A re-sent add can still undo a rename made in between, which is rare and harmless.
10. *(Superseded by 12.)* Only the console changes `members`.
11. **Accounts with a list document of their own** from before invitations: the shared document with the most members, then the oldest, wins.
12. **Invitations by Gmail address** (2026-10-25, the maintainer). Any member invites from the app; the invited person joins on signing in. An emailed code would need a server to send mail.
13. **Categories fixed in code** (2026-10-25). Not editable in the app yet; items and products store the category id, so moving the set into Firestore later keeps the data. Chosen by tapping the colour bar rather than a long-press, which is hard to discover.
14. **One document per learned product** rather than one per list: concurrent edits of different products never touch the same document.
15. **Quantities as free text after a colon** (2026-10-25, the maintainer), rather than a parsed number and unit.
16. **Polish as built** (2026-10-25). No swipe-to-delete; × and undo instead. "Not synced" only after two seconds. Rows of 44 px without lines between them, at the maintainer's request (`e2e/layout.spec.ts`).
17. **Seed dictionary in English**; another language is a matter of adding names. The maintainer will provide a list from their supermarket.
18. **Multiple lists** (2026-10-25, the maintainer). One group of people, invitations in one place, each list shown to the people picked for it, a menu to pick the list, categories and products shared by all lists. Built without moving data: the document that held the one list holds the people, invitations and products, and its items are the main list.
19. **Invitation only** (2026-10-25, the maintainer). The app no longer creates a list document for a new account, and the rules forbid it; someone not invited sees only their name and Sign out. Firebase cannot refuse a Google sign-in without a server-side function, so the rules simply give such an account no data.
