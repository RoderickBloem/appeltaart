# Shopping List App — MVP Spec and Roadmap

Oct 24, 2026 · @Rick

## Goals and scope

The MVP is a shared grocery list for three family members that keeps working when the phone has no signal in the shop. Everything else is deferred.

In scope for the MVP:

- One shared list, three members, installable from the browser as a home-screen app.
- Add an item by typing, check it off, delete it, clear all checked items.
- Changes appear on the other phones within a second when online.
- Changes made offline are kept across an app restart and flush on reconnect.

Deferred to the mid-term build:

- Colour-coded categories ordered to match the store layout.
- A known-product dictionary so a few letters are enough.
- Quantities and units per item.
- Multiple lists, one per shop.

The success test is concrete: put all three phones in flight mode, make conflicting edits on each, bring them back one at a time, and end with every phone showing the same list.

## Data model

Two collections. Items are documents under a list, so a real-time listener on one list delivers exactly the items that list contains.

```
lists/{listId}
lists/{listId}/items/{itemId}
```

The list document:

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | "Household" |
| `members` | map of uid to `true` | Membership test for the security rules |
| `invites` | array of string | Pending invitations: addresses, normalised (lower case; Gmail without dots and +suffix) |
| `invitedAs` | map of normalised address to string | The same addresses as typed, for showing |
| `createdAt` | timestamp | `serverTimestamp()` |

The item document:

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | As typed, including capitals |
| `normName` | string | Lower-cased, trimmed, accents folded; used to spot duplicates |
| `checked` | boolean | Missing means false (see open question 9) |
| `deletedAt` | timestamp or null | Null or missing means live |
| `createdAt` | timestamp | From the phone's clock, not `serverTimestamp()`; orders the list (see open question 6) |
| `updatedAt` | timestamp | Set on every write |
| `createdBy` | string | uid, for a later "who added this" |
| `categoryId` | string, optional | One of the categories in `src/categories.ts`; missing until known |
| `quantity` | string, optional | Free text after a colon: "6", "ripe", "2 kg" |

What the list has learned about each product is in `lists/{listId}/products/{normName}` (the id URI-encoded): `name`, `normName`, `categoryId`, `uses`, `lastUsed`.

The mid-term fields — `categoryId`, `quantity`, `unit` — are added later without migrating anything, because a missing field reads as undefined and the UI can treat that as the default.

Ids are generated client-side by `doc(collection(...))`, so an add works offline and the document appears in the local cache immediately.

## Operation semantics

One rule governs all of them: always write with `updateDoc` and name only the fields that changed. The server then orders the writes, and two people changing different fields of the same item both keep their change.

| Operation | Write | Conflict outcome |
| --- | --- | --- |
| Add | `setDoc` with `merge: true` of a new item, without `checked` or `deletedAt` | New id each time, so two adds never collide; a re-sent add cannot undo a check or delete (open question 9) |
| Rename | `updateDoc { name, normName, updatedAt }` | Later write wins |
| Check / uncheck | `updateDoc { checked, updatedAt }` | Later write wins; survives a concurrent rename |
| Delete | `updateDoc { deletedAt: serverTimestamp() }` | A concurrent rename lands and the item stays deleted |
| Undelete | `updateDoc { deletedAt: null }` | Later write wins, so undo works |
| Clear checked | Batched `deletedAt` writes, up to 500 per batch | An item unchecked elsewhere at the same time stays deleted; undo brings it back |

Deletion is soft so that undo is possible and so a batch clear can be reversed. Hard deletion would also be correct here, since the server propagates removals and no client can resurrect a document, but it gives up undo for nothing.

The items query fetches every item, tombstones included, with a `limit()`, and the app drops deleted items itself; filtering on `where('deletedAt', '==', null)` in the query loses deletes (open question 7). Tombstones are purged by hand with a script that removes items whose `deletedAt` is older than 30 days, which also keeps them from crowding live items out of the limit.

The one case the data model cannot fix: two people offline both add milk, producing two items. Collapse them in the UI by grouping live items with the same `normName`, showing one row, and applying a check to every item in the group.

## Offline and sync

The local cache is the source of truth for the interface. The UI never waits on the network, and a write that cannot reach the server sits in an IndexedDB queue until it can.

Initialise Firestore with persistent caching rather than the default in-memory cache:

```javascript
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});
```

This is the single most important line in the project. Realtime Database was ruled out for precisely this reason: on the web it queues offline writes in memory only, so closing the tab in the shop loses them.

The rest follows from it:

- One `onSnapshot` listener on the items collection, attached when the list screen mounts and detached when it unmounts.
- Render from the snapshot regardless of `metadata.fromCache`, so a cold start with no signal still shows the list.
- Show a small "not synced" marker when `snapshot.metadata.hasPendingWrites` is true, so it is visible when something has not left the phone.
- Never await a write before updating the interface. Firestore's promise resolves on server acknowledgement, which never comes while offline; the local change is already applied.

Timestamps come from `serverTimestamp()`. Offline, the field reads as null locally until the write lands, so the UI must tolerate a null `updatedAt` for a few seconds.

The service worker caches the app shell so the app opens with no network at all. Firestore handles the data; the service worker only handles the code.

## Auth and security rules

Firebase Auth with Google sign-in. Each family member signs in with the Google account already on their phone, so there are no passwords to manage.

Membership lives in the list document, and the item rules read it:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /lists/{listId} {
      function isMember() {
        return request.auth != null
          && request.auth.uid in resource.data.members;
      }
      allow read, update: if isMember();
      allow create: if request.auth != null;

      match /items/{itemId} {
        function parentMembers() {
          return get(/databases/$(database)/documents/lists/$(listId)).data.members;
        }
        allow read, write: if request.auth != null
          && request.auth.uid in parentMembers();
      }
    }
  }
}
```

The `get()` in the item rule costs one document read per rule evaluation. At family scale this is irrelevant; it would matter at thousands of users.

Adding a member is a manual step for now: write their uid into `members` from the Firebase console after they sign in once. An invite flow is not worth building for three people.

As built in milestone 4 (`firestore.rules`), the rules are stricter than the sketch above: clients can never change `members`, not even a member, so only the console can share a list (open question 10); a list can only be created at `lists/{own uid}` with only its creator as member; and items cannot be deleted outright, only marked with `deletedAt`. The owner of `lists/{uid}` reaches its items by uid, without the `get()`, because the app writes items before the list document reaches the server.

One caveat worth knowing: rules are not evaluated locally against the offline cache in the same way as on the server, so a write that the rules would reject can appear to succeed on the phone and then be rolled back when it reaches the server. With everyone a full member this never fires in practice.

## MVP interface

One screen, plus a sign-in screen. Buy Me a Pie's layout is the model: live items at the top, checked items collected below.

- A text field pinned at the top that stays focused after submitting, so several items can be typed in a row without reaching for it again.
- Live items in a list, newest at the bottom. Tapping anywhere on a row checks it.
- Checked items in a dimmed section underneath, tappable to uncheck.
- Swipe left on a row to delete, with an undo toast for a few seconds.
- Pull down, or a button, to clear all checked items.
- A sync indicator only when there are pending writes. No indicator when everything is clean.

Two details that matter more than they look:

1. Keep the screen awake while the app is in the foreground, via the Screen Wake Lock API. Shopping with a phone that locks every thirty seconds is the main reason people abandon these apps.
2. Touch targets of at least 48 pixels, since this is used one-handed while pushing a trolley. **Changed 2026-10-25, at the maintainer's request:** 44 pixels, so that about fifteen items fit on a Pixel 9 (`e2e/layout.spec.ts`).

No settings screen, no list switcher, no categories. Those arrive with the mid-term build.

## Test harness

Run everything against the Firestore emulator, not the live project. The emulator starts in a second, resets between tests, and lets a test disconnect a client on demand.

The harness builds three clients against the emulator, each a separate Firestore instance with its own cache, and drives them through `useEmulator` plus `disableNetwork()` and `enableNetwork()` to simulate flight mode. (As built in milestone 3: each client is a page in its own browser context, so it has its own IndexedDB and network connections; a restart is a page reload. See `src/harness.ts` and `e2e/sync.spec.ts`.)

The properties to assert, stated so they can be checked mechanically:

1. **Convergence.** After any sequence of operations on any clients, once every client is online and idle, all three read the same set of live items with the same field values.
2. **No lost adds.** An item added on any client, online or offline, is present on every client after reconnection. This is the property that fails most often in hand-rolled sync.
3. **Delete beats concurrent edit.** An item deleted on one client while renamed on another ends up deleted everywhere.
4. **Restart durability.** A client that makes writes offline, is torn down and rebuilt against the same IndexedDB, then reconnects, still delivers those writes.
5. **Idempotent clear.** Clearing checked items twice, on two clients, leaves the same state as clearing once.

Property 4 is the one that reproduces your current bug, so write it first.

Drive these with fast-check: generate random operation sequences over a small alphabet of operations and random partition points, then assert convergence. A hundred generated cases will find ordering bugs that three phones on a kitchen table will not. Keep every failing case fast-check shrinks as a named regression test.

## Mid-term: categories, dictionary, quantities

*As built (2026-10-25), ahead of the order below at the maintainer's request: categories, the learned half of the dictionary, and quantities. Where the build differs from this section, open questions 13–16 say how.*

These are the features that make the app worth using over paper. Each is additive to the MVP schema.

### Categories ordered by store layout

A category is a colour and a sort position, and the position is what makes the list match the walk through the shop.

```
lists/{listId}/categories/{categoryId}
  name: "Fruit & vegetables"
  colour: "#4caf50"
  order: 100
```

Items carry `categoryId`. The list groups by category and sorts the groups by `order`, so the list reads in aisle sequence and you never double back. Use sparse integers spaced by 100 so reordering a category is one write, not a renumbering of all of them. Uncategorised items fall into a group at the bottom.

If you later shop at two stores with different layouts, the category set stays shared and only `order` differs per store. That argues for keeping `order` in a per-store map rather than a scalar, but do not build it until the second store actually exists.

### Known products

Two tiers, which together give the "type three letters" feel.

- A seed dictionary of roughly 200 common groceries in English, each with a default category, shipped as a JSON file in the app. This is what makes the app useful on day one, before it has learned anything.
- A learned dictionary per list: every item ever added, with its `normName`, the category it ended up in, and a use count. Stored as one document per list to keep reads at one per session.

The type-ahead searches the learned dictionary first, ordered by use count, then the seed list. Picking a suggestion fills in the category automatically, which is where most of the time saving comes from.

### Quantities

Add `quantity` (number) and `unit` (string or null) to the item. Parse them out of the typed text rather than making people use a separate field: "2 kg potatoes" or "3 milk" is how people actually type. A leading number, an optional unit from a small known set, and the rest is the name. Show it back as an editable chip on the row so a misparse is easy to correct.

### Changing a category quickly

The requirement is that fixing a wrong category takes one gesture. Long-press a row to open a colour strip of all categories, tap one, done. Make that write update both the item and the learned dictionary entry, so the correction sticks for next time. That feedback loop is what makes the dictionary converge on your household's actual habits within a few weeks.

## Build order

Each milestone ends in something installable on a phone. Resist merging them; the value of this sequence is that a regression has a small window to hide in.

1. **Skeleton.** Vite, React, TypeScript, a PWA manifest, a service worker, Firebase project created, Google sign-in working. Ends with: the app installs to the home screen and shows your name.
2. **Single-device list.** Add, check, uncheck, delete, clear checked, against Firestore with persistent caching. One device only. Ends with: the list survives a force-quit with no network.
3. **Emulator and harness.** Properties 1 to 5 from the test section, with fast-check generating the sequences. Ends with: a green suite over a hundred generated partition scenarios.
4. **Sharing.** Members map, security rules, uids added by hand. Ends with: three phones, one list, conflicting offline edits converging.
5. **Shopping polish.** Wake lock, undo toast, pending-write indicator, duplicate collapsing. Ends with: an actual shop visit that does not annoy anyone.
6. **Categories.** Category collection, colours, aisle ordering, long-press reassignment.
7. **Dictionary.** Seed list, learned entries, type-ahead, automatic category on pick.
8. **Quantities.** Inline parsing of the typed text, editable chip.

Stop after step 5 and use it for a fortnight before starting step 6. The mid-term features are guesses about what you want until the MVP has told you which of them you actually reach for.

For Claude Code: hand it this document, then one milestone per session. Ask for the test from step 3 before the feature it covers wherever the ordering allows it, and keep the emulator suite in the loop so each session can verify its own work.

## Open questions (added during milestone 1)

1. **Clear checked vs. a concurrent uncheck.** A check or uncheck writes only `checked`, never `deletedAt`. So if one phone clears checked items while another unchecks one of them to keep it, the item stays deleted; only undo brings it back. **Decided 2026-10-24: acceptable.** An uncheck does not write `deletedAt`; the operation table states this outcome.
2. **Offline delete and the live-items query.** `deletedAt: serverTimestamp()` reads as null on the phone until the server confirms the write. If the local query engine also treats the pending value as null, `where('deletedAt', '==', null)` keeps showing a deleted item while offline. Check this in the emulator harness (milestone 3). If it fails, add a boolean `deleted` next to `deletedAt`, or use a timestamp set on the phone. **Settled 2026-10-24 (milestone 2): no problem.** A pending server timestamp does not match `== null` in the local query engine, so an offline delete leaves the live-items query at once and stays gone after a restart with no network. Covered by the test "an offline delete leaves the live list at once, also after a restart" in `e2e/list.spec.ts`.
3. **Null `updatedAt`.** Reading snapshots with `{ serverTimestamps: 'estimate' }` gives a local estimate instead of null.
4. **Emulator API names.** With the current modular SDK the harness uses `connectFirestoreEmulator` and `connectAuthEmulator`, not `useEmulator`. **Settled (milestone 3):** the harness uses those.
5. **"Property 4 reproduces your current bug."** No bug is described and no earlier app exists in this repository. Property 4 was written first in milestone 3 and passes; the bug the generated scenarios did find is open question 7.

## Open questions (added during milestone 2)

6. **Ordering by `createdAt`.** While a write is pending, the local estimate of a `serverTimestamp()` has whole-second precision, so items typed offline within the same second came out in random order. **Decided 2026-10-24:** `createdAt` is set from the phone's clock, strictly increasing within one app session. Items added on different phones are ordered by those phones' clocks, which is close enough for a shopping list. `updatedAt` and `deletedAt` stay `serverTimestamp()`.

## Open questions (added during milestone 3)

7. **A filtered query loses deletes.** With the items query filtered on `deletedAt == null`, this sequence leaves a phone showing a deleted item for good: phone A deletes an item; phone B changes the same item (rename, check, anything) before the delete reaches it. B's write succeeds on the server, but the item no longer matches B's query there, so the server never sends it to B again, and B keeps its own version, not deleted, with `hasPendingWrites` stuck on true. Only a restart of B clears it. Seen against the emulator, both with the persistent and the memory cache, both online and offline; not checked against the production backend, since no project exists yet. **Decided 2026-10-25:** the query has no filter on `deletedAt`; the app filters deleted items itself, reading pending timestamps with `{ serverTimestamps: 'estimate' }` so an offline delete still disappears at once (question 2). The cost is downloading tombstones until the 30-day purge. The same trap applies to any future query that filters on a field phones change, such as `checked` or `categoryId`: filter those on the phone too. Covered by test "3. a delete and a concurrent change on another phone" in `e2e/sync.spec.ts`.
8. **`enableNetwork()` on a client that is already online.** Against the emulator, this made the SDK (13.1.0) fail an internal assertion and stop syncing. The app never calls it; the harness calls it only on a client that is offline. If a later milestone reacts to the browser's `online` event, keep that rule.
9. **A re-sent add undid a delete.** Firestore re-sends a write whose confirmation did not arrive, for example when the phone lost signal just after sending it. If another phone deleted or cleared the new item in between, the re-sent add, a full `setDoc` with `deletedAt: null`, brought it back. Found twice by the generated scenarios in a run of 300 (shrunk cases are the "re-sent add" regressions in `e2e/sync.spec.ts`). The mechanism is inferred from those cases; holding the request back to force it did not work, as the emulator drops requests from a closed connection. **Decided 2026-10-25:** an add writes only its own fields (`name`, `normName`, `createdAt`, `updatedAt`, `createdBy`) with `merge: true`; a missing `checked` reads as false and a missing `deletedAt` as live. A re-sent add can still undo a rename made in between, which is rare and harmless.

## Open questions (added during milestone 4)

10. **Who may change `members`.** The sketch above lets any member update the list document, so any member could add anyone. **Decided 2026-10-25:** no client may change `members`; sharing is the manual console step this spec already describes. Members may still update other list fields.
11. **Which list a member sees.** Every user's app creates `lists/{uid}` at first sign-in, before anyone can add them to the household list, so a member belongs to two lists. **Decided 2026-10-25:** the app shows the list with the most members, then the oldest, then by id; the household list therefore wins as soon as the maintainer adds them, and every phone makes the same choice. Items typed into the solo list before that stay there, unseen. The app creates the solo list only when the server confirms the user belongs to no list, never from the cache alone.

## Open questions (added after milestone 4)

12. **Adding users from the app.** **Decided 2026-10-25 by the maintainer, replacing decision 10:** any member can invite someone from the app by typing their Gmail address (the Share button). All members have the same rights, including inviting. The address goes into the list's `invites`; when the invited person signs in with Google, their app finds the invitation and adds them to `members`. The rules let an invited person, with a verified address that matches, add exactly themselves and remove exactly their own invitation; nobody else can change `members`. Addresses are compared lower-cased, and Gmail addresses without dots or +suffix, in the app and in the rules alike. An emailed code was the alternative; it needs a server to send mail, which the app does not have. A list joined but not yet confirmed by the server is not shown, since the rules would refuse its item listener. Removing a member is still only possible in the console.

## Open questions (added with categories, quantities and polish)

13. **Categories are fixed in code for now.** Eight categories in shop order (`src/categories.ts`), not a Firestore collection; there is no way yet to rename, recolour or reorder them in the app. Items and products store the category id, so moving the set into Firestore later keeps the data. The category is chosen by tapping the colour bar at the start of a row, rather than by a long-press, which is hard to discover.
14. **The learned dictionary is one document per product**, `lists/{id}/products/{normName}`, rather than one document per list: concurrent edits of different products never touch the same document, and the rules are the items' rules. Choosing a category for an item stores it for the product; a new item of that product gets it when added. An item without a category of its own shows the product's category, so an item added on a phone that had not yet heard of the category still ends up coloured. The seed dictionary of common groceries is not built.
15. **Quantities are free text after a colon**, "tomatoes: 6" or "avocados: ripe", as the maintainer asked, rather than a parsed leading number and unit. Typing a product that is already on the list, checked or not, puts it back unchecked and sets the new quantity instead of adding it again; "tomatoes:" with nothing after the colon removes the quantity.
16. **Shopping polish as built.** Deleting and clearing show an undo toast for five seconds; undo sets `deletedAt` back to null. Swipe-to-delete is not built: the × button stays. "Not synced" appears once a change has waited more than two seconds for the server, so it does not flash on every tap. The screen is kept awake with the Screen Wake Lock API while the app is visible. Items with the same `normName` show as one row, with their quantities joined, and a tap checks or unchecks them all. The lines between rows are gone, at the maintainer's request.
