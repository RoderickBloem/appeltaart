// The sync properties from docs/spec.md, section "Test harness", checked on
// three clients against the Firestore emulator. Each client is a page in its
// own browser context, like a separate phone, running src/harness.ts;
// fast-check generates the operation sequences here.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import fc from 'fast-check'
import type { ListOp, Look } from '../src/harness'
import { addMember, createHousehold, serverDocs, type ServerDoc } from './helpers'

const CLIENTS = 3
// Generated scenarios per property. SYNC_RUNS=1000 for a longer hunt.
const RUNS = Number(process.env.SYNC_RUNS ?? 100)
const SETTLE_MS = 10_000

type Op = ListOp | { kind: 'offline' } | { kind: 'online' } | { kind: 'restart' } | { kind: 'pause' }
type Step = { client: number; op: Op }

// A small alphabet: few names, so duplicates and renames to the same name
// are common; small pick numbers, since lists are short.
const clientArb = fc.integer({ min: 0, max: CLIENTS - 1 })
const nameArb = fc.constantFrom('Milk', 'milk', 'Bread', 'Äpfel', 'apfel', 'Eggs')
const pickArb = fc.nat({ max: 7 })
const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 5, arbitrary: nameArb.map((name) => ({ kind: 'add' as const, name })) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('rename' as const), pick: pickArb, name: nameArb }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('check' as const), pick: pickArb }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('uncheck' as const), pick: pickArb }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('delete' as const), pick: pickArb }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'clear' as const }) },
  { weight: 3, arbitrary: fc.constant({ kind: 'offline' as const }) },
  { weight: 2, arbitrary: fc.constant({ kind: 'online' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'restart' as const }) },
  // Lets changes travel between online clients, so later steps conflict with them.
  { weight: 2, arbitrary: fc.constant({ kind: 'pause' as const }) },
)
const stepsArb = fc.array(fc.record({ client: clientArb, op: opArb }), { minLength: 1, maxLength: 25 })

type Phone = { page: Page; email: string; offline: boolean }

/**
 * Three phones, each signed in as a new user, on a new empty list that phone
 * 0 owns and shares with the others, all online.
 */
class Scenario {
  readonly id = crypto.randomUUID()
  /** Phone 0's uid; set by start(). */
  listId = ''
  /** Ids written by add operations, and by delete and clear operations. */
  readonly added = new Set<string>()
  readonly deleted = new Set<string>()

  constructor(readonly phones: Phone[]) {}

  static async start(pages: Page[]): Promise<Scenario> {
    const scenario = new Scenario([])
    scenario.phones.push(...pages.map((page, i) => ({ page, email: `phone-${i}-${scenario.id}@example.com`, offline: false })))
    const uids = await Promise.all(scenario.phones.map((phone) => scenario.open(phone)))
    scenario.listId = uids[0]
    // Phone 0's household, made and shared with admin rights, as the real
    // one was. The rules only let members read the items, so the phones
    // start listening after.
    await createHousehold(uids[0])
    for (const uid of uids.slice(1)) await addMember(scenario.listId, uid)
    await Promise.all(scenario.phones.map((phone) => scenario.watch(phone)))
    return scenario
  }

  private async open(phone: Phone): Promise<string> {
    await phone.page.evaluate(() => window.harness!.dispose())
    return phone.page.evaluate(
      ({ id, email, offline }) => window.harness!.open(id, email, offline),
      { id: this.id, email: phone.email, offline: phone.offline },
    )
  }

  private watch(phone: Phone) {
    return phone.page.evaluate((listId) => window.harness!.watch(listId), this.listId)
  }

  async run(steps: Step[]) {
    for (const { client, op } of steps) {
      const phone = this.phones[client]
      switch (op.kind) {
        case 'offline':
        case 'online':
          phone.offline = op.kind === 'offline'
          await phone.page.evaluate((offline) => window.harness!.setOffline(offline), phone.offline)
          break
        case 'restart':
          // A force-quit and reopen: the page reloads and finds its IndexedDB.
          await phone.page.reload()
          await phone.page.waitForFunction(() => window.harness !== undefined)
          await this.open(phone)
          await this.watch(phone)
          break
        case 'pause':
          await phone.page.waitForTimeout(300)
          break
        default: {
          const ids = await phone.page.evaluate((op) => window.harness!.apply(op), op)
          if (op.kind === 'add') ids.forEach((id) => this.added.add(id))
          if (op.kind === 'delete' || op.kind === 'clear') ids.forEach((id) => this.deleted.add(id))
        }
      }
    }
  }

  /**
   * Brings every phone online, waits until each has sent its writes and shows
   * what the server holds, and returns what everyone sees.
   */
  async settle() {
    await Promise.all(this.phones.map(async (phone) => {
      phone.offline = false
      await phone.page.evaluate(() => window.harness!.setOffline(false))
    }))
    await Promise.all(this.phones.map((phone) => phone.page.evaluate((ms) => window.harness!.waitForWrites(ms), SETTLE_MS)))

    const server = await serverDocs(this.listId)
    const expected = server.filter((i) => !i.deleted).map(({ id, name, normName, checked }) => ({ id, name, normName, checked }))
    const looks = () => Promise.all(this.phones.map((phone) => phone.page.evaluate(() => window.harness!.look())))
    const agree = (all: Look[]) => all.every((l) => l.synced && JSON.stringify(l.items) === JSON.stringify(expected))

    let all = await looks()
    for (const deadline = Date.now() + SETTLE_MS; !agree(all) && Date.now() < deadline; all = await looks()) {
      await this.phones[0].page.waitForTimeout(50)
    }
    return { looks: all, server, converged: agree(all) }
  }
}

type Settled = Awaited<ReturnType<Scenario['settle']>>

const liveIds = (server: ServerDoc[]) => server.filter((i) => !i.deleted).map((i) => i.id)

/** Properties 1 to 4, checked once every phone is online and idle. */
function checkProperties(scenario: Scenario, settled: Settled) {
  const { added, deleted } = scenario
  const serverIds = new Set(settled.server.map((i) => i.id))

  // 1. Convergence: every phone shows the server's live items, field for field.
  expect(settled.converged, `phones converge: ${JSON.stringify(settled)}`).toBe(true)

  // 2. No lost adds; with a restart in between, this is also 4, restart
  // durability: every add reached the server.
  for (const id of added) expect(serverIds.has(id), `add ${id} reached the server`).toBe(true)

  // 3. Delete beats concurrent edit: nothing deleted is live, however it was
  // renamed or checked meanwhile. And nothing else disappeared.
  expect(liveIds(settled.server).sort()).toEqual([...added].filter((id) => !deleted.has(id)).sort())
}

test.describe('sync properties', () => {
  let contexts: BrowserContext[]
  let pages: Page[]

  async function openPhones(browser: Browser) {
    contexts = await Promise.all(Array.from({ length: CLIENTS }, () => browser.newContext()))
    pages = await Promise.all(contexts.map((c) => c.newPage()))
    await Promise.all(pages.map(async (page) => {
      await page.goto('/')
      await page.waitForFunction(() => window.harness !== undefined)
    }))
  }

  test.beforeEach(({ browser }) => openPhones(browser))
  test.afterEach(() => Promise.all(contexts.map((c) => c.close())))

  test('4. writes made offline survive a restart and arrive on reconnect', async () => {
    const scenario = await Scenario.start(pages)
    await scenario.run([{ client: 0, op: { kind: 'add', name: 'Milk' } }])
    await scenario.settle()
    await scenario.run([
      { client: 0, op: { kind: 'offline' } },
      { client: 0, op: { kind: 'add', name: 'Bread' } },
      { client: 0, op: { kind: 'check', pick: 0 } },
      { client: 0, op: { kind: 'restart' } },
    ])

    // Still offline after the restart: the phone shows its own writes; the
    // server and the other phones have not seen them.
    const names = async () => (await pages[0].evaluate(() => window.harness!.look())).items.map(({ name, checked }) => ({ name, checked }))
    await expect.poll(names).toEqual(expect.arrayContaining([{ name: 'Milk', checked: true }, { name: 'Bread', checked: false }]))
    expect((await serverDocs(scenario.listId)).map(({ name, checked }) => ({ name, checked }))).toEqual([{ name: 'Milk', checked: false }])

    const settled = await scenario.settle()
    checkProperties(scenario, settled)
    expect(settled.server.map(({ name, checked }) => ({ name, checked }))).toEqual(
      expect.arrayContaining([{ name: 'Milk', checked: true }, { name: 'Bread', checked: false }]),
    )
  })

  test('3. a delete and a concurrent change on another phone: the change lands, the item stays deleted', async () => {
    for (const change of [
      { kind: 'rename', pick: 0, name: 'Oat milk' },
      { kind: 'check', pick: 0 },
    ] as ListOp[]) {
      for (const offline of [true, false]) {
        const scenario = await Scenario.start(pages)
        await scenario.run([{ client: 0, op: { kind: 'add', name: 'Milk' } }])
        await scenario.settle()
        await scenario.run([
          ...(offline ? ([{ client: 0, op: { kind: 'offline' } }, { client: 1, op: { kind: 'offline' } }] as Step[]) : []),
          { client: 0, op: { kind: 'delete', pick: 0 } },
          { client: 1, op: change },
        ])
        const settled = await scenario.settle()
        checkProperties(scenario, settled)
        expect(settled.server).toEqual([expect.objectContaining({ deleted: true })])
      }
    }
  })

  // Counterexamples fast-check found and shrank, kept so they run every time.
  const regressions: Record<string, Step[]> = {
    // A write stalled behind a restarted client: three clients shared one
    // page and ran out of the browser's connections per host. Fixed by giving
    // each client its own browser context.
    'a clear after a restart elsewhere reaches the server': [
      { client: 1, op: { kind: 'add', name: 'Milk' } },
      { client: 1, op: { kind: 'check', pick: 0 } },
      { client: 0, op: { kind: 'restart' } },
      { client: 1, op: { kind: 'rename', pick: 3, name: 'Milk' } },
      { client: 1, op: { kind: 'uncheck', pick: 4 } },
      { client: 2, op: { kind: 'clear' } },
    ],
    // Phone 0's add reached the server but its confirmation did not reach
    // phone 0, which went offline. Phone 2 cleared the item; phone 0 re-sent
    // the add on reconnect and brought it back. Fixed by an add that writes
    // neither checked nor deletedAt (open question 9).
    'a re-sent add does not bring back a cleared item': [
      { client: 0, op: { kind: 'add', name: 'Milk' } },
      { client: 2, op: { kind: 'add', name: 'milk' } },
      { client: 0, op: { kind: 'offline' } },
      { client: 2, op: { kind: 'check', pick: 0 } },
      { client: 1, op: { kind: 'add', name: 'Eggs' } },
      { client: 2, op: { kind: 'clear' } },
    ],
    // The harness let phone 2 restart before its add was saved locally, when
    // a snapshot with another phone's items arrived first. Fixed by waiting
    // until the phone shows its own change.
    'an add shown on screen survives an immediate restart': [
      { client: 0, op: { kind: 'add', name: 'Milk' } },
      { client: 0, op: { kind: 'add', name: 'Milk' } },
      { client: 2, op: { kind: 'add', name: 'milk' } },
      { client: 2, op: { kind: 'restart' } },
    ],
    'a re-sent add does not bring back a deleted item': [
      { client: 0, op: { kind: 'add', name: 'Milk' } },
      { client: 0, op: { kind: 'offline' } },
      { client: 1, op: { kind: 'delete', pick: 1 } },
      { client: 0, op: { kind: 'add', name: 'Eggs' } },
    ],
  }
  for (const [name, steps] of Object.entries(regressions)) {
    test(`regression: ${name}`, async () => {
      const scenario = await Scenario.start(pages)
      await scenario.run(steps)
      checkProperties(scenario, await scenario.settle())
    })
  }

  test('1–4 hold over generated partition scenarios', async () => {
    test.setTimeout(30 * 60_000)
    await fc.assert(
      fc.asyncProperty(stepsArb, async (steps) => {
        const scenario = await Scenario.start(pages)
        await scenario.run(steps)
        checkProperties(scenario, await scenario.settle())
      }),
      { numRuns: RUNS },
    )
  })

  test('5. clearing checked items on two phones equals clearing once', async () => {
    test.setTimeout(30 * 60_000)
    const twoClients = fc.tuple(clientArb, clientArb).filter(([a, b]) => a !== b)
    await fc.assert(
      fc.asyncProperty(stepsArb, twoClients, fc.boolean(), async (steps, [a, b], offline) => {
        const scenario = await Scenario.start(pages)
        await scenario.run(steps)
        const before = await scenario.settle()
        checkProperties(scenario, before)
        const expected = before.server.filter((i) => !i.deleted && !i.checked).map((i) => i.id)

        await scenario.run([
          ...(offline ? ([{ client: a, op: { kind: 'offline' } }, { client: b, op: { kind: 'offline' } }] as Step[]) : []),
          { client: a, op: { kind: 'clear' } },
          { client: b, op: { kind: 'clear' } },
        ])
        const after = await scenario.settle()
        expect(after.converged, `phones converge: ${JSON.stringify(after)}`).toBe(true)
        expect(liveIds(after.server)).toEqual(expected)
      }),
      { numRuns: RUNS },
    )
  })
})
