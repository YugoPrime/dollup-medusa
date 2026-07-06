# Event "Scratch & Win" — Backend Plan (1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-authoritative backend for the thank-you-card code → contact → spin → points/draw loop, plus on-site review capture.

**Architecture:** Two new custom Medusa v2 modules following the existing `loyalty` / `size-requests` pattern: `event_draw` (codes, entries, rewards, draw entries, wheel settings) and `reviews` (order-linked star reviews). Store-facing API routes drive the storefront; the spin reward credits Doll Rewards points by finding-or-creating a customer from the entry email and calling the existing `loyalty` service. The wheel outcome is always chosen on the server from admin-configurable weights — the client never picks its prize.

**Tech Stack:** Medusa v2 (`@medusajs/framework`), TypeScript, Jest (`moduleIntegrationTestRunner` / `medusaIntegrationTestRunner`).

## Global Constraints

- Package manager: **yarn 4.12** (`yarn.lock` present). Run all scripts as `yarn <script>` from `Backend/dollup-medusa/`. Yarn passes trailing args straight through, so `yarn test:integration:modules event-draw` runs jest filtered to that path.
- Module tests: `yarn test:integration:modules` (module service tests via `moduleIntegrationTestRunner`).
- HTTP tests: `yarn test:integration:http` (route tests via `medusaIntegrationTestRunner`).
- Medusa CLI: `yarn medusa <cmd>` (e.g. `yarn medusa db:generate`, `yarn medusa db:migrate`).
- Model conventions: `model.define("Name", {...})`, `model.id({ prefix: "xxx" }).primaryKey()`, service extends `MedusaService({ Model })`, validation throws `MedusaError(MedusaError.Types.INVALID_DATA, msg)`. Copy the `size-requests` and `loyalty` modules as reference.
- Every new module MUST be registered in `medusa-config.ts` `modules: [...]` and have a migration in `src/modules/<name>/migrations/`.
- Loyalty credit path: accounts are unique per `customer_id`, credited via `loyaltyService.awardPoints(customerId, points, { reason, orderId })` where `orderId` is the idempotency key. Reuse it — do not re-implement point math.
- Reward currency in Phase 1 is **Doll Rewards points only** (no promo/voucher codes). Wheel slices: `pts_50`, `pts_100`, `pts_200`, `draw_entry` (+ optional `gift` handled manually).
- Money/points are integers. No floats in balances.

---

## File structure

**New module `event_draw`:**
- `src/modules/event-draw/index.ts` — module definition, exports `EVENT_DRAW_MODULE`
- `src/modules/event-draw/models/event-code.ts`
- `src/modules/event-draw/models/event-entry.ts`
- `src/modules/event-draw/models/event-reward.ts`
- `src/modules/event-draw/models/event-draw-entry.ts`
- `src/modules/event-draw/models/event-settings.ts`
- `src/modules/event-draw/service.ts`
- `src/modules/event-draw/migrations/Migration<ts>.ts` (generated)
- `src/modules/event-draw/__tests__/event-draw-service.spec.ts`

**New module `reviews`:**
- `src/modules/reviews/index.ts` — exports `REVIEWS_MODULE`
- `src/modules/reviews/models/product-review.ts`
- `src/modules/reviews/service.ts`
- `src/modules/reviews/migrations/Migration<ts>.ts`
- `src/modules/reviews/__tests__/reviews-service.spec.ts`

**Store API routes:**
- `src/api/store/event/validate-code/route.ts`
- `src/api/store/event/enter/route.ts`
- `src/api/store/event/spin/route.ts`
- `src/api/store/event/bonus-spin/route.ts`
- `src/api/store/reviews/route.ts`
- `src/api/store/event/__tests__/event-flow.spec.ts` (http integration)

**Admin API routes (list/read only here; UI is Plan 3):**
- `src/api/admin/event/codes/route.ts` (POST generate batch, GET list)
- `src/api/admin/event/entries/route.ts` (GET list)
- `src/api/admin/event/draw/route.ts` (GET period entries, POST pick winner)
- `src/api/admin/event/settings/route.ts` (GET/POST wheel config)
- `src/api/admin/reviews/route.ts` (GET list) + `src/api/admin/reviews/[id]/route.ts` (POST moderate)

**Config:**
- `medusa-config.ts` — register `./src/modules/event-draw` and `./src/modules/reviews`

---

### Task 1: Scaffold the `event_draw` module with models + migration

**Files:**
- Create: `src/modules/event-draw/models/event-code.ts`, `event-entry.ts`, `event-reward.ts`, `event-draw-entry.ts`, `event-settings.ts`
- Create: `src/modules/event-draw/service.ts`, `src/modules/event-draw/index.ts`
- Modify: `medusa-config.ts` (add module registration after the loyalty entry, ~line 135)
- Test: `src/modules/event-draw/__tests__/event-draw-service.spec.ts`

**Interfaces:**
- Produces: `EVENT_DRAW_MODULE = "event_draw"`; `EventDrawModuleService` with auto-generated CRUD (`createEventCodes`, `listEventCodes`, `retrieveEventCode`, etc. — plural model name pluralized by MedusaService).

- [ ] **Step 1: Write the models**

`event-code.ts`:
```typescript
import { model } from "@medusajs/framework/utils"

// One physical thank-you-card code. Single-use: redeemed_at set on first entry.
const EventCode = model
  .define("EventCode", {
    id: model.id({ prefix: "evtcode" }).primaryKey(),
    code: model.text(),          // e.g. "DUB-7K3P" (uppercased, normalized)
    batch_id: model.text(),      // print batch grouping
    redeemed_at: model.dateTime().nullable(),
  })
  .indexes([{ on: ["code"], unique: true, where: "deleted_at IS NULL" }])

export default EventCode
```

`event-entry.ts`:
```typescript
import { model } from "@medusajs/framework/utils"

// One entry per redeemed code. Holds contact capture + spin accounting.
const EventEntry = model.define("EventEntry", {
  id: model.id({ prefix: "evtent" }).primaryKey(),
  code: model.text(),
  email: model.text(),
  phone: model.text(),
  consent: model.boolean().default(false),
  spins_earned: model.number().default(1),
  spins_used: model.number().default(0),
  review_bonus_claimed: model.boolean().default(false),
  social_bonus_claimed: model.boolean().default(false),
  customer_id: model.text().nullable(), // set when points credited
  ip: model.text().nullable(),
})

export default EventEntry
```

`event-reward.ts`:
```typescript
import { model } from "@medusajs/framework/utils"

// A single spin outcome. type=points → credited to loyalty; draw_entry → row in EventDrawEntry.
const EventReward = model
  .define("EventReward", {
    id: model.id({ prefix: "evtrew" }).primaryKey(),
    entry_id: model.text(),
    slice: model.text(),          // "pts_50" | "pts_100" | "pts_200" | "draw_entry" | "gift"
    type: model.text(),           // "points" | "draw_entry" | "gift"
    points: model.number().default(0),
    status: model.text().default("issued"), // issued | credited | failed
    idempotency_key: model.text(),
  })
  .indexes([{ on: ["idempotency_key"], unique: true, where: "deleted_at IS NULL" }])

export default EventReward
```

`event-draw-entry.ts`:
```typescript
import { model } from "@medusajs/framework/utils"

// Grand-prize draw ticket for a period, e.g. "2026-07".
const EventDrawEntry = model.define("EventDrawEntry", {
  id: model.id({ prefix: "evtdraw" }).primaryKey(),
  entry_id: model.text(),
  draw_period: model.text(),
  is_winner: model.boolean().default(false),
})

export default EventDrawEntry
```

`event-settings.ts`:
```typescript
import { model } from "@medusajs/framework/utils"

// Singleton wheel config. weights_json = JSON string of { slice: weight }.
const EventSettings = model.define("EventSettings", {
  id: model.id({ prefix: "evtset" }).primaryKey(),
  singleton: model.text().default("default"), // always "default"; unique
  weights_json: model.text(),
  active_draw_period: model.text(), // e.g. "2026-07"
}).indexes([{ on: ["singleton"], unique: true, where: "deleted_at IS NULL" }])

export default EventSettings
```

- [ ] **Step 2: Write the service skeleton**

`service.ts`:
```typescript
import { MedusaService } from "@medusajs/framework/utils"

import EventCode from "./models/event-code"
import EventEntry from "./models/event-entry"
import EventReward from "./models/event-reward"
import EventDrawEntry from "./models/event-draw-entry"
import EventSettings from "./models/event-settings"

class EventDrawModuleService extends MedusaService({
  EventCode,
  EventEntry,
  EventReward,
  EventDrawEntry,
  EventSettings,
}) {}

export default EventDrawModuleService
```

- [ ] **Step 3: Write the index + register in config**

`index.ts`:
```typescript
import { Module } from "@medusajs/framework/utils"

import EventDrawModuleService from "./service"

export const EVENT_DRAW_MODULE = "event_draw"

export default Module(EVENT_DRAW_MODULE, {
  service: EventDrawModuleService,
})
```

In `medusa-config.ts`, add inside `modules: [...]` right after the loyalty block (`resolve: "./src/modules/loyalty"`):
```typescript
    { resolve: "./src/modules/event-draw" },
    { resolve: "./src/modules/reviews" },
```

- [ ] **Step 4: Generate the migration**

Run: `yarn medusa db:generate event_draw`
Expected: a `Migration<timestamp>.ts` appears in `src/modules/event-draw/migrations/` creating the five tables.

- [ ] **Step 5: Write a smoke test that the module resolves and CRUD works**

`__tests__/event-draw-service.spec.ts`:
```typescript
import { moduleIntegrationTestRunner } from "@medusajs/test-utils"

import { EVENT_DRAW_MODULE } from "../index"
import EventDrawModuleService from "../service"

jest.setTimeout(60 * 1000)

moduleIntegrationTestRunner<EventDrawModuleService>({
  moduleName: EVENT_DRAW_MODULE,
  resolve: "./src/modules/event-draw",
  testSuite: ({ service }) => {
    describe("EventDrawModuleService scaffold", () => {
      it("creates and lists an event code", async () => {
        await service.createEventCodes({ code: "DUB-AAAA", batch_id: "b1" })
        const codes = await service.listEventCodes({ code: "DUB-AAAA" })
        expect(codes).toHaveLength(1)
        expect(codes[0]).toMatchObject({ code: "DUB-AAAA", batch_id: "b1", redeemed_at: null })
      })
    })
  },
})
```

- [ ] **Step 6: Run the test**

Run: `yarn test:integration:modules event-draw`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/event-draw medusa-config.ts
git commit -m "feat(event-draw): scaffold module, models, migration"
```

---

### Task 2: Code batch generation + single-use validation

**Files:**
- Modify: `src/modules/event-draw/service.ts`
- Test: `src/modules/event-draw/__tests__/event-draw-service.spec.ts`

**Interfaces:**
- Produces:
  - `generateCodeBatch(count: number, batchId: string): Promise<string[]>` — returns the created codes.
  - `normalizeCode(raw: string): string` — uppercases, trims, strips spaces.
  - `redeemCode(rawCode: string): Promise<{ code: string }>` — throws `INVALID_DATA` if unknown, `NOT_ALLOWED` if already redeemed; sets `redeemed_at`.

- [ ] **Step 1: Write failing tests**

Add to the spec's `describe`:
```typescript
describe("code batch + redemption", () => {
  it("generates the requested number of unique codes", async () => {
    const codes = await service.generateCodeBatch(5, "batch-x")
    expect(new Set(codes).size).toBe(5)
    const stored = await service.listEventCodes({ batch_id: "batch-x" })
    expect(stored).toHaveLength(5)
  })

  it("redeems a code once, then rejects re-redemption", async () => {
    const [code] = await service.generateCodeBatch(1, "batch-y")
    const first = await service.redeemCode(code.toLowerCase()) // case-insensitive
    expect(first.code).toBe(code)
    await expect(service.redeemCode(code)).rejects.toThrow(/already/i)
  })

  it("rejects an unknown code", async () => {
    await expect(service.redeemCode("DUB-NOPE")).rejects.toThrow(/not found|invalid/i)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn test:integration:modules event-draw`
Expected: FAIL — `service.generateCodeBatch is not a function`.

- [ ] **Step 3: Implement the methods**

In `service.ts`, add to the class:
```typescript
import { MedusaError } from "@medusajs/framework/utils"

// ...inside the class:

  private static ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no 0/O/1/I

  normalizeCode(raw: string): string {
    return (raw ?? "").trim().toUpperCase().replace(/\s+/g, "")
  }

  private randomCode(): string {
    const a = EventDrawModuleService.ALPHABET
    let s = ""
    for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)]
    return `DUB-${s}`
  }

  async generateCodeBatch(count: number, batchId: string): Promise<string[]> {
    if (!Number.isInteger(count) || count <= 0 || count > 5000) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "count must be 1..5000")
    }
    const created: string[] = []
    const seen = new Set<string>()
    let guard = 0
    while (created.length < count && guard < count * 20) {
      guard++
      const code = this.randomCode()
      if (seen.has(code)) continue
      const existing = await this.listEventCodes({ code })
      if (existing.length) continue
      seen.add(code)
      await this.createEventCodes({ code, batch_id: batchId })
      created.push(code)
    }
    if (created.length < count) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "could not generate enough unique codes")
    }
    return created
  }

  async redeemCode(rawCode: string): Promise<{ code: string }> {
    const code = this.normalizeCode(rawCode)
    const [found] = await this.listEventCodes({ code })
    if (!found) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Code not found")
    }
    if (found.redeemed_at) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Code already used")
    }
    await this.updateEventCodes({ id: found.id, redeemed_at: new Date() })
    return { code }
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn test:integration:modules event-draw`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/event-draw
git commit -m "feat(event-draw): code batch generation + single-use redemption"
```

---

### Task 3: Entry creation + spin accounting + bonus spins

**Files:**
- Modify: `src/modules/event-draw/service.ts`
- Test: `src/modules/event-draw/__tests__/event-draw-service.spec.ts`

**Interfaces:**
- Produces:
  - `createEntry(input: { code: string; email: string; phone: string; consent: boolean; ip?: string }): Promise<EventEntryDTO>` — redeems the code (single-use) then creates the entry with `spins_earned = 1`.
  - `claimBonusSpin(entryId: string, kind: "review" | "social"): Promise<EventEntryDTO>` — increments `spins_earned` by 1, sets the matching `*_bonus_claimed`, idempotent (no-op if already claimed), hard cap of `spins_earned <= 3`.
  - `EventEntryDTO` = the stored entry shape (id, code, email, phone, consent, spins_earned, spins_used, review_bonus_claimed, social_bonus_claimed, customer_id, ip).

- [ ] **Step 1: Write failing tests**

```typescript
describe("entry + bonus spins", () => {
  async function freshEntry() {
    const [code] = await service.generateCodeBatch(1, "b-entry")
    return service.createEntry({
      code, email: "a@b.com", phone: "+23050001111", consent: true,
    })
  }

  it("creates an entry with 1 spin and marks the code redeemed", async () => {
    const entry = await freshEntry()
    expect(entry).toMatchObject({ email: "a@b.com", spins_earned: 1, spins_used: 0 })
    const [code] = await service.listEventCodes({ code: entry.code })
    expect(code.redeemed_at).not.toBeNull()
  })

  it("rejects a second entry on the same code", async () => {
    const entry = await freshEntry()
    await expect(
      service.createEntry({ code: entry.code, email: "c@d.com", phone: "x", consent: true }),
    ).rejects.toThrow(/already used/i)
  })

  it("adds a review bonus spin once (idempotent)", async () => {
    const entry = await freshEntry()
    const after = await service.claimBonusSpin(entry.id, "review")
    expect(after.spins_earned).toBe(2)
    expect(after.review_bonus_claimed).toBe(true)
    const again = await service.claimBonusSpin(entry.id, "review")
    expect(again.spins_earned).toBe(2) // no double count
  })

  it("caps total spins at 3", async () => {
    const entry = await freshEntry()
    await service.claimBonusSpin(entry.id, "review")
    const capped = await service.claimBonusSpin(entry.id, "social")
    expect(capped.spins_earned).toBe(3)
  })

  it("requires email and phone", async () => {
    const [code] = await service.generateCodeBatch(1, "b-req")
    await expect(
      service.createEntry({ code, email: "", phone: "", consent: true }),
    ).rejects.toThrow(/email/i)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn test:integration:modules event-draw`
Expected: FAIL — `service.createEntry is not a function`.

- [ ] **Step 3: Implement**

```typescript
export type EventEntryDTO = {
  id: string
  code: string
  email: string
  phone: string
  consent: boolean
  spins_earned: number
  spins_used: number
  review_bonus_claimed: boolean
  social_bonus_claimed: boolean
  customer_id: string | null
  ip: string | null
}

// inside the class:
  async createEntry(input: {
    code: string; email: string; phone: string; consent: boolean; ip?: string
  }): Promise<EventEntryDTO> {
    const email = (input.email ?? "").trim().toLowerCase()
    const phone = (input.phone ?? "").trim()
    if (!email || !/.+@.+\..+/.test(email)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "A valid email is required")
    }
    if (!phone) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "A phone/WhatsApp number is required")
    }
    // redeemCode enforces single-use + throws NOT_ALLOWED "already used"
    const { code } = await this.redeemCode(input.code)
    const entry = await this.createEventEntries({
      code, email, phone, consent: !!input.consent, spins_earned: 1, spins_used: 0,
      ip: input.ip ?? null,
    })
    return entry as EventEntryDTO
  }

  async claimBonusSpin(entryId: string, kind: "review" | "social"): Promise<EventEntryDTO> {
    const entry = await this.retrieveEventEntry(entryId)
    const flag = kind === "review" ? "review_bonus_claimed" : "social_bonus_claimed"
    if ((entry as any)[flag]) return entry as EventEntryDTO // idempotent
    const nextEarned = Math.min(3, entry.spins_earned + 1)
    const updated = await this.updateEventEntries({
      id: entryId, [flag]: true, spins_earned: nextEarned,
    })
    return updated as EventEntryDTO
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn test:integration:modules event-draw`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/event-draw
git commit -m "feat(event-draw): entry creation + bonus-spin accounting"
```

---

### Task 4: Wheel settings + server-side weighted spin

**Files:**
- Modify: `src/modules/event-draw/service.ts`
- Test: `src/modules/event-draw/__tests__/event-draw-service.spec.ts`

**Interfaces:**
- Produces:
  - `getSettings(): Promise<{ weights: Record<string, number>; active_draw_period: string }>` — lazily creates the singleton with defaults.
  - `updateSettings(input: { weights?: Record<string, number>; active_draw_period?: string }): Promise<...>`.
  - `spin(entryId: string): Promise<{ slice: string; type: string; points: number }>` — throws `NOT_ALLOWED` if no spins left; picks a slice by weight using `rng` (injectable for tests); records an `EventReward` and, for `draw_entry`, an `EventDrawEntry`; increments `spins_used`.
  - Slice catalog constant `SLICE_CATALOG`: `pts_50→{type:"points",points:50}`, `pts_100→{points:100}`, `pts_200→{points:200}`, `draw_entry→{type:"draw_entry",points:0}`, `gift→{type:"gift",points:0}`.

- [ ] **Step 1: Write failing tests**

```typescript
describe("settings + spin", () => {
  it("returns default weights on first read", async () => {
    const s = await service.getSettings()
    expect(s.weights.pts_50).toBeGreaterThan(0)
    expect(s.active_draw_period).toMatch(/^\d{4}-\d{2}$/)
  })

  it("spin consumes a spin and records a reward deterministically", async () => {
    const [code] = await service.generateCodeBatch(1, "b-spin")
    const entry = await service.createEntry({ code, email: "s@p.com", phone: "1", consent: true })
    // force rng=0 → first slice in the weighted order
    const result = await service.spin(entry.id, () => 0)
    expect(result.slice).toBeDefined()
    const after = await service.retrieveEventEntry(entry.id)
    expect(after.spins_used).toBe(1)
    const rewards = await service.listEventRewards({ entry_id: entry.id })
    expect(rewards).toHaveLength(1)
  })

  it("draw_entry slice creates a draw ticket for the active period", async () => {
    await service.updateSettings({ weights: { draw_entry: 1 } }) // only draw slice
    const [code] = await service.generateCodeBatch(1, "b-draw")
    const entry = await service.createEntry({ code, email: "d@p.com", phone: "1", consent: true })
    const result = await service.spin(entry.id, () => 0.5)
    expect(result.type).toBe("draw_entry")
    const tickets = await service.listEventDrawEntries({ entry_id: entry.id })
    expect(tickets).toHaveLength(1)
  })

  it("rejects a spin when none are left", async () => {
    await service.updateSettings({ weights: { pts_50: 1 } })
    const [code] = await service.generateCodeBatch(1, "b-none")
    const entry = await service.createEntry({ code, email: "n@p.com", phone: "1", consent: true })
    await service.spin(entry.id, () => 0) // uses the only base spin
    await expect(service.spin(entry.id, () => 0)).rejects.toThrow(/no spins/i)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn test:integration:modules event-draw`
Expected: FAIL — `service.getSettings is not a function`.

- [ ] **Step 3: Implement**

```typescript
type SliceDef = { type: "points" | "draw_entry" | "gift"; points: number }

const SLICE_CATALOG: Record<string, SliceDef> = {
  pts_50: { type: "points", points: 50 },
  pts_100: { type: "points", points: 100 },
  pts_200: { type: "points", points: 200 },
  draw_entry: { type: "draw_entry", points: 0 },
  gift: { type: "gift", points: 0 },
}

const DEFAULT_WEIGHTS: Record<string, number> = {
  pts_50: 45, pts_100: 25, pts_200: 8, draw_entry: 20, gift: 2,
}

// Period helper — computed from an injected clock so tests are deterministic.
function periodOf(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  return `${y}-${m}`
}

// inside the class:
  async getSettings(now: Date = new Date()) {
    let [row] = await this.listEventSettings({ singleton: "default" })
    if (!row) {
      row = await this.createEventSettings({
        singleton: "default",
        weights_json: JSON.stringify(DEFAULT_WEIGHTS),
        active_draw_period: periodOf(now),
      })
    }
    return {
      weights: JSON.parse(row.weights_json) as Record<string, number>,
      active_draw_period: row.active_draw_period,
    }
  }

  async updateSettings(input: { weights?: Record<string, number>; active_draw_period?: string }) {
    const current = await this.getSettings()
    const [row] = await this.listEventSettings({ singleton: "default" })
    const next = {
      id: row.id,
      weights_json: JSON.stringify(input.weights ?? current.weights),
      active_draw_period: input.active_draw_period ?? current.active_draw_period,
    }
    await this.updateEventSettings(next)
    return this.getSettings()
  }

  private pickSlice(weights: Record<string, number>, rng: () => number): string {
    const entries = Object.entries(weights).filter(([, w]) => w > 0)
    const total = entries.reduce((s, [, w]) => s + w, 0)
    let r = rng() * total
    for (const [slice, w] of entries) {
      r -= w
      if (r < 0) return slice
    }
    return entries[entries.length - 1][0]
  }

  async spin(entryId: string, rng: () => number = Math.random) {
    const entry = await this.retrieveEventEntry(entryId)
    if (entry.spins_used >= entry.spins_earned) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "No spins left")
    }
    const settings = await this.getSettings()
    const slice = this.pickSlice(settings.weights, rng)
    const def = SLICE_CATALOG[slice] ?? SLICE_CATALOG.pts_50
    const idempotencyKey = `${entryId}:${entry.spins_used}`

    await this.createEventRewards({
      entry_id: entryId, slice, type: def.type, points: def.points,
      status: "issued", idempotency_key: idempotencyKey,
    })
    if (def.type === "draw_entry") {
      await this.createEventDrawEntries({ entry_id: entryId, draw_period: settings.active_draw_period })
    }
    await this.updateEventEntries({ id: entryId, spins_used: entry.spins_used + 1 })
    return { slice, type: def.type, points: def.points }
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn test:integration:modules event-draw`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/event-draw
git commit -m "feat(event-draw): wheel settings + server-side weighted spin"
```

---

### Task 5: Credit spin points to Doll Rewards by email (workflow)

**Files:**
- Create: `src/workflows/credit-event-spin.ts`
- Test: `src/api/store/event/__tests__/event-flow.spec.ts` (http integration — exercises this via the spin route in Task 6; a direct workflow test is added here)
- Test: `src/workflows/__tests__/credit-event-spin.test.ts`

**Interfaces:**
- Consumes: `loyaltyService.ensureAccount(customerId)` + `loyaltyService.awardPoints(customerId, points, { reason, orderId })` (from `src/modules/loyalty/service.ts`); the platform `Modules.CUSTOMER` service (`customerService.listCustomers({ email })`, `customerService.createCustomers({ email })`).
- Produces: `creditEventSpinPoints(container, { entryId, email, points, rewardId }): Promise<{ customer_id: string; credited: number }>` — find-or-create customer by email, ensure loyalty account, award points using `orderId = "event:" + rewardId` as the idempotency key, then set `EventEntry.customer_id` and `EventReward.status = "credited"`. Awarding 0 points is a no-op success.

- [ ] **Step 1: Write the failing test**

`src/workflows/__tests__/credit-event-spin.test.ts`:
```typescript
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"

import { creditEventSpinPoints } from "../credit-event-spin"
import { EVENT_DRAW_MODULE } from "../../modules/event-draw"
import { LOYALTY_MODULE } from "../../modules/loyalty"

jest.setTimeout(90 * 1000)

medusaIntegrationTestRunner({
  testSuite: ({ getContainer }) => {
    it("creates a customer, credits points, is idempotent", async () => {
      const container = getContainer()
      const eventSvc: any = container.resolve(EVENT_DRAW_MODULE)
      const loyalty: any = container.resolve(LOYALTY_MODULE)

      const [code] = await eventSvc.generateCodeBatch(1, "wf")
      const entry = await eventSvc.createEntry({ code, email: "wf@x.com", phone: "1", consent: true })
      const [reward] = await eventSvc.createEventRewards({
        entry_id: entry.id, slice: "pts_100", type: "points", points: 100,
        status: "issued", idempotency_key: `${entry.id}:0`,
      })

      const first = await creditEventSpinPoints(container, {
        entryId: entry.id, email: "wf@x.com", points: 100, rewardId: reward.id,
      })
      expect(first.credited).toBe(100)

      const acct = await loyalty.getAccount(first.customer_id)
      expect(acct.points_balance).toBe(100)

      // idempotent re-run must NOT double-credit
      await creditEventSpinPoints(container, {
        entryId: entry.id, email: "wf@x.com", points: 100, rewardId: reward.id,
      })
      const acct2 = await loyalty.getAccount(first.customer_id)
      expect(acct2.points_balance).toBe(100)
    })
  },
})
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn test:integration:http credit-event-spin`
Expected: FAIL — cannot find `../credit-event-spin`.

- [ ] **Step 3: Implement**

`src/workflows/credit-event-spin.ts`:
```typescript
import { Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { EVENT_DRAW_MODULE } from "../modules/event-draw"
import { LOYALTY_MODULE } from "../modules/loyalty"
import type LoyaltyModuleService from "../modules/loyalty/service"
import type EventDrawModuleService from "../modules/event-draw/service"

export async function creditEventSpinPoints(
  container: MedusaContainer,
  args: { entryId: string; email: string; points: number; rewardId: string },
): Promise<{ customer_id: string; credited: number }> {
  const event = container.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const loyalty = container.resolve<LoyaltyModuleService>(LOYALTY_MODULE)
  const customerService: any = container.resolve(Modules.CUSTOMER)

  const email = args.email.trim().toLowerCase()

  // find-or-create customer by email
  const existing = await customerService.listCustomers({ email })
  const customer = existing?.[0] ?? (await customerService.createCustomers({ email }))

  await loyalty.ensureAccount(customer.id)
  if (args.points > 0) {
    // orderId is the idempotency key inside awardPoints
    await loyalty.awardPoints(customer.id, args.points, {
      reason: "event spin",
      orderId: `event:${args.rewardId}`,
    })
  }

  await event.updateEventEntries({ id: args.entryId, customer_id: customer.id })
  await event.updateEventRewards({ id: args.rewardId, status: "credited" })

  return { customer_id: customer.id, credited: args.points }
}
```

> Note: confirm `awardPoints`' third-arg shape in `src/modules/loyalty/service.ts` (Task 0 read shows `awardPoints(customerId, points, { reason?, orderId? })` with `orderId` idempotency). If the signature differs, match it exactly.

- [ ] **Step 4: Run to verify pass**

Run: `yarn test:integration:http credit-event-spin`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workflows/credit-event-spin.ts src/workflows/__tests__/credit-event-spin.test.ts
git commit -m "feat(event-draw): credit spin points to loyalty by email (idempotent)"
```

---

### Task 6: Store API routes for the loop

**Files:**
- Create: `src/api/store/event/validate-code/route.ts`, `enter/route.ts`, `spin/route.ts`, `bonus-spin/route.ts`
- Test: `src/api/store/event/__tests__/event-flow.spec.ts`

**Interfaces:**
- Consumes: `EventDrawModuleService` methods (Tasks 2-4), `creditEventSpinPoints` (Task 5).
- Produces HTTP contract used by Plan 2 (storefront):
  - `POST /store/event/validate-code` `{ code }` → `200 { ok: true }` or `400/409 { message }`. Does NOT redeem — just checks existence/unused.
  - `POST /store/event/enter` `{ code, email, phone, consent }` → `200 { entry_id, spins_remaining }`. Redeems the code.
  - `POST /store/event/bonus-spin` `{ entry_id, kind }` (`kind: "review"|"social"`) → `200 { spins_remaining }`.
  - `POST /store/event/spin` `{ entry_id }` → `200 { slice, type, points, spins_remaining, credited }`.

- [ ] **Step 1: Write failing http test**

`src/api/store/event/__tests__/event-flow.spec.ts`:
```typescript
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { EVENT_DRAW_MODULE } from "../../../../modules/event-draw"

jest.setTimeout(90 * 1000)

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    it("runs the full loop over HTTP", async () => {
      const svc: any = getContainer().resolve(EVENT_DRAW_MODULE)
      await svc.updateSettings({ weights: { pts_100: 1 } }) // deterministic points slice
      const [code] = await svc.generateCodeBatch(1, "http")

      const valid = await api.post("/store/event/validate-code", { code })
      expect(valid.status).toBe(200)

      const enter = await api.post("/store/event/enter", {
        code, email: "http@x.com", phone: "+2305", consent: true,
      })
      expect(enter.status).toBe(200)
      const entryId = enter.data.entry_id
      expect(enter.data.spins_remaining).toBe(1)

      const bonus = await api.post("/store/event/bonus-spin", { entry_id: entryId, kind: "review" })
      expect(bonus.data.spins_remaining).toBe(2)

      const spin = await api.post("/store/event/spin", { entry_id: entryId })
      expect(spin.status).toBe(200)
      expect(spin.data.points).toBe(100)
      expect(spin.data.spins_remaining).toBe(1)
    })

    it("rejects an unknown code", async () => {
      const res = await api.post("/store/event/validate-code", { code: "DUB-ZZZZ" })
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
    })
  },
})
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn test:integration:http event-flow`
Expected: FAIL — routes 404.

- [ ] **Step 3: Implement the four routes**

`validate-code/route.ts`:
```typescript
import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { EVENT_DRAW_MODULE } from "../../../../modules/event-draw"
import type EventDrawModuleService from "../../../../modules/event-draw/service"

export const POST = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const code = svc.normalizeCode((req.body as any)?.code ?? "")
  const [found] = await svc.listEventCodes({ code })
  if (!found) { res.status(400).json({ message: "We couldn't find that code." }); return }
  if (found.redeemed_at) { res.status(409).json({ message: "That code has already been used." }); return }
  res.json({ ok: true })
}
```

`enter/route.ts`:
```typescript
import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { EVENT_DRAW_MODULE } from "../../../../modules/event-draw"
import type EventDrawModuleService from "../../../../modules/event-draw/service"

export const POST = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const b = req.body as any
  try {
    const entry = await svc.createEntry({
      code: b?.code, email: b?.email, phone: b?.phone, consent: !!b?.consent,
      ip: req.ip,
    })
    res.json({ entry_id: entry.id, spins_remaining: entry.spins_earned - entry.spins_used })
  } catch (e) {
    const status = e instanceof MedusaError && e.type === MedusaError.Types.NOT_ALLOWED ? 409 : 400
    res.status(status).json({ message: e instanceof Error ? e.message : "Could not enter." })
  }
}
```

`bonus-spin/route.ts`:
```typescript
import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { EVENT_DRAW_MODULE } from "../../../../modules/event-draw"
import type EventDrawModuleService from "../../../../modules/event-draw/service"

export const POST = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const b = req.body as any
  const kind = b?.kind === "social" ? "social" : "review"
  const entry = await svc.claimBonusSpin(b?.entry_id, kind)
  res.json({ spins_remaining: entry.spins_earned - entry.spins_used })
}
```

`spin/route.ts`:
```typescript
import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { EVENT_DRAW_MODULE } from "../../../../modules/event-draw"
import type EventDrawModuleService from "../../../../modules/event-draw/service"
import { creditEventSpinPoints } from "../../../../workflows/credit-event-spin"

export const POST = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const entryId = (req.body as any)?.entry_id
  try {
    const result = await svc.spin(entryId)
    let credited = 0
    if (result.type === "points" && result.points > 0) {
      const entry = await svc.retrieveEventEntry(entryId)
      const [reward] = await svc.listEventRewards(
        { entry_id: entryId }, { order: { created_at: "DESC" }, take: 1 },
      )
      const out = await creditEventSpinPoints(req.scope, {
        entryId, email: entry.email, points: result.points, rewardId: reward.id,
      })
      credited = out.credited
    }
    const entry = await svc.retrieveEventEntry(entryId)
    res.json({
      slice: result.slice, type: result.type, points: result.points,
      spins_remaining: entry.spins_earned - entry.spins_used, credited,
    })
  } catch (e) {
    const status = e instanceof MedusaError && e.type === MedusaError.Types.NOT_ALLOWED ? 409 : 400
    res.status(status).json({ message: e instanceof Error ? e.message : "Spin failed." })
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn test:integration:http event-flow`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/store/event
git commit -m "feat(event-draw): store routes for validate/enter/bonus-spin/spin"
```

---

### Task 7: `reviews` module + store submit route + admin moderation

**Files:**
- Create: `src/modules/reviews/models/product-review.ts`, `service.ts`, `index.ts`
- Modify: `medusa-config.ts` (already added in Task 1 Step 3 — verify present)
- Create: `src/api/store/reviews/route.ts`, `src/api/admin/reviews/route.ts`, `src/api/admin/reviews/[id]/route.ts`
- Test: `src/modules/reviews/__tests__/reviews-service.spec.ts`

**Interfaces:**
- Produces:
  - `REVIEWS_MODULE = "reviews"`.
  - `createReview(input: { order_id?: string; product_id?: string; email: string; rating: number; body: string }): Promise<ProductReviewDTO>` — validates rating 1..5 and body length; status defaults `pending`.
  - `moderate(id: string, status: "published" | "rejected"): Promise<ProductReviewDTO>`.
  - HTTP: `POST /store/reviews` `{ email, rating, body, order_id?, product_id? }` → `200 { id, status }`. `GET /admin/reviews?status=` list. `POST /admin/reviews/:id` `{ status }` moderate.

- [ ] **Step 1: Model + service + index**

`models/product-review.ts`:
```typescript
import { model } from "@medusajs/framework/utils"

const ProductReview = model.define("ProductReview", {
  id: model.id({ prefix: "prev" }).primaryKey(),
  order_id: model.text().nullable(),
  product_id: model.text().nullable(),
  email: model.text(),
  rating: model.number(),
  body: model.text(),
  status: model.text().default("pending"), // pending | published | rejected
})

export default ProductReview
```

`service.ts`:
```typescript
import { MedusaError, MedusaService } from "@medusajs/framework/utils"
import ProductReview from "./models/product-review"

export type ProductReviewDTO = {
  id: string; order_id: string | null; product_id: string | null
  email: string; rating: number; body: string; status: string
  created_at: Date; updated_at: Date
}

class ReviewsModuleService extends MedusaService({ ProductReview }) {
  async createReview(input: {
    order_id?: string; product_id?: string; email: string; rating: number; body: string
  }): Promise<ProductReviewDTO> {
    const rating = Number(input.rating)
    const body = (input.body ?? "").trim()
    const email = (input.email ?? "").trim().toLowerCase()
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Rating must be 1–5")
    }
    if (body.length < 3 || body.length > 2000) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Review must be 3–2000 characters")
    }
    if (!email) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Email is required")
    const row = await this.createProductReviews({
      order_id: input.order_id ?? null, product_id: input.product_id ?? null,
      email, rating, body, status: "pending",
    })
    return row as ProductReviewDTO
  }

  async moderate(id: string, status: "published" | "rejected"): Promise<ProductReviewDTO> {
    const row = await this.updateProductReviews({ id, status })
    return row as ProductReviewDTO
  }
}

export default ReviewsModuleService
```

`index.ts`:
```typescript
import { Module } from "@medusajs/framework/utils"
import ReviewsModuleService from "./service"
export const REVIEWS_MODULE = "reviews"
export default Module(REVIEWS_MODULE, { service: ReviewsModuleService })
```

- [ ] **Step 2: Generate migration**

Run: `yarn medusa db:generate reviews`
Expected: migration file created under `src/modules/reviews/migrations/`.

- [ ] **Step 3: Write failing service test**

`__tests__/reviews-service.spec.ts`:
```typescript
import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { REVIEWS_MODULE } from "../index"
import ReviewsModuleService from "../service"

jest.setTimeout(60 * 1000)

moduleIntegrationTestRunner<ReviewsModuleService>({
  moduleName: REVIEWS_MODULE,
  resolve: "./src/modules/reviews",
  testSuite: ({ service }) => {
    it("creates a pending review and moderates it", async () => {
      const r = await service.createReview({
        order_id: "order_1", email: "r@x.com", rating: 5, body: "Love the fit!",
      })
      expect(r.status).toBe("pending")
      const pub = await service.moderate(r.id, "published")
      expect(pub.status).toBe("published")
    })

    it("rejects an out-of-range rating", async () => {
      await expect(
        service.createReview({ email: "r@x.com", rating: 9, body: "hi there" }),
      ).rejects.toThrow(/1.?5/)
    })
  },
})
```

- [ ] **Step 4: Run to verify fail → implement already done → pass**

Run: `yarn test:integration:modules reviews`
Expected: PASS (model+service written in Step 1).

- [ ] **Step 5: Add the HTTP routes**

`src/api/store/reviews/route.ts`:
```typescript
import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { REVIEWS_MODULE } from "../../../modules/reviews"
import type ReviewsModuleService from "../../../modules/reviews/service"

export const POST = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<ReviewsModuleService>(REVIEWS_MODULE)
  const b = req.body as any
  try {
    const r = await svc.createReview({
      order_id: b?.order_id, product_id: b?.product_id,
      email: b?.email, rating: b?.rating, body: b?.body,
    })
    res.json({ id: r.id, status: r.status })
  } catch (e) {
    res.status(400).json({ message: e instanceof Error ? e.message : "Could not submit review." })
  }
}
```

`src/api/admin/reviews/route.ts`:
```typescript
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { REVIEWS_MODULE } from "../../../modules/reviews"
import type ReviewsModuleService from "../../../modules/reviews/service"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<ReviewsModuleService>(REVIEWS_MODULE)
  const status = (req.query.status as string) || undefined
  const rows = await svc.listProductReviews(status ? { status } : {}, {
    order: { created_at: "DESC" }, take: 100,
  })
  res.json({ reviews: rows })
}
```

`src/api/admin/reviews/[id]/route.ts`:
```typescript
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { REVIEWS_MODULE } from "../../../../modules/reviews"
import type ReviewsModuleService from "../../../../modules/reviews/service"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<ReviewsModuleService>(REVIEWS_MODULE)
  const status = (req.body as any)?.status === "rejected" ? "rejected" : "published"
  const r = await svc.moderate(req.params.id, status)
  res.json({ review: r })
}
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/reviews src/api/store/reviews src/api/admin/reviews medusa-config.ts
git commit -m "feat(reviews): order-linked review capture + moderation routes"
```

---

### Task 8: Admin routes for codes / entries / draw / settings

**Files:**
- Create: `src/api/admin/event/codes/route.ts`, `entries/route.ts`, `draw/route.ts`, `settings/route.ts`
- Test: `src/api/admin/event/__tests__/event-admin.spec.ts`

**Interfaces:**
- Produces HTTP contract for Plan 3 (admin UI):
  - `POST /admin/event/codes` `{ count, batch_id }` → `{ codes: string[] }`; `GET /admin/event/codes?batch_id=` → `{ codes }`.
  - `GET /admin/event/entries` → `{ entries, count }`.
  - `GET /admin/event/draw?period=YYYY-MM` → `{ entries }`; `POST /admin/event/draw` `{ draw_entry_id }` → `{ winner }` (sets `is_winner`).
  - `GET /admin/event/settings` → `{ weights, active_draw_period }`; `POST /admin/event/settings` `{ weights?, active_draw_period? }` → updated settings.

- [ ] **Step 1: Write failing test**

`src/api/admin/event/__tests__/event-admin.spec.ts`:
```typescript
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
jest.setTimeout(90 * 1000)

medusaIntegrationTestRunner({
  testSuite: ({ api }) => {
    // NOTE: admin routes need an authenticated admin. Use the test runner's
    // admin auth helper the other admin specs in this repo use; copy the
    // header/login setup from an existing src/api/admin/**/__tests__ spec.
    it("generates a code batch and reads settings", async () => {
      const gen = await api.post("/admin/event/codes", { count: 3, batch_id: "adm" }, adminHeaders)
      expect(gen.data.codes).toHaveLength(3)
      const settings = await api.get("/admin/event/settings", adminHeaders)
      expect(settings.data.weights.pts_50).toBeGreaterThan(0)
    })
  },
})
```
> Before writing this test, open an existing `src/api/admin/**/__tests__/*.spec.ts` (e.g. size-requests) and copy its exact admin-auth setup into `adminHeaders`. Do not invent an auth mechanism.

- [ ] **Step 2: Run to verify failure**

Run: `yarn test:integration:http event-admin`
Expected: FAIL — routes 404.

- [ ] **Step 3: Implement routes**

`codes/route.ts`:
```typescript
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { EVENT_DRAW_MODULE } from "../../../../modules/event-draw"
import type EventDrawModuleService from "../../../../modules/event-draw/service"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const b = req.body as any
  const codes = await svc.generateCodeBatch(Number(b?.count), String(b?.batch_id ?? "batch"))
  res.json({ codes })
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const batch = req.query.batch_id as string | undefined
  const codes = await svc.listEventCodes(batch ? { batch_id: batch } : {}, { take: 5000 })
  res.json({ codes })
}
```

`entries/route.ts`:
```typescript
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { EVENT_DRAW_MODULE } from "../../../../modules/event-draw"
import type EventDrawModuleService from "../../../../modules/event-draw/service"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const [entries, count] = await svc.listAndCountEventEntries({}, {
    order: { created_at: "DESC" }, take: 200,
  })
  res.json({ entries, count })
}
```

`draw/route.ts`:
```typescript
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { EVENT_DRAW_MODULE } from "../../../../modules/event-draw"
import type EventDrawModuleService from "../../../../modules/event-draw/service"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const period = req.query.period as string | undefined
  const entries = await svc.listEventDrawEntries(period ? { draw_period: period } : {}, { take: 5000 })
  res.json({ entries })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const id = (req.body as any)?.draw_entry_id
  const winner = await svc.updateEventDrawEntries({ id, is_winner: true })
  res.json({ winner })
}
```

`settings/route.ts`:
```typescript
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { EVENT_DRAW_MODULE } from "../../../../modules/event-draw"
import type EventDrawModuleService from "../../../../modules/event-draw/service"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  res.json(await svc.getSettings())
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const b = req.body as any
  res.json(await svc.updateSettings({ weights: b?.weights, active_draw_period: b?.active_draw_period }))
}
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn test:integration:http event-admin`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/admin/event
git commit -m "feat(event-draw): admin routes for codes/entries/draw/settings"
```

---

### Task 9: Run migrations + full suite + manual smoke

- [ ] **Step 1: Apply migrations to the dev DB**

Run: `yarn medusa db:migrate`
Expected: `event_draw` + `reviews` tables created; no errors.

- [ ] **Step 2: Run the whole new suite**

Run: `yarn test:integration:modules event-draw reviews` then `yarn test:integration:http event-flow credit-event-spin event-admin`
Expected: all PASS.

- [ ] **Step 3: Manual smoke via curl (dev server running: `yarn dev`)**

```bash
# generate a batch (needs admin auth cookie/token — reuse your admin login)
# then, as store:
curl -sX POST localhost:9000/store/event/validate-code \
  -H 'content-type: application/json' -H "x-publishable-api-key: $PK" \
  -d '{"code":"DUB-XXXX"}'
```
Expected: `{"ok":true}` for a real unused code; `400` for a bad one.

- [ ] **Step 4: Commit any migration files**

```bash
git add src/modules/event-draw/migrations src/modules/reviews/migrations
git commit -m "chore(event-draw): migrations for event_draw + reviews"
```

---

## Self-review notes (coverage vs spec)

- Spec §2 loop → Tasks 2,3,4,6 (validate/enter/bonus/spin). ✅
- Spec §3 points-only rewards → Task 4 slice catalog + Task 5 loyalty credit. ✅
- Spec §4 reviews (on-site capture) → Task 7. Google/IG are storefront link-outs (Plan 2), not backend. ✅
- Spec §5 module (codes/entries/rewards/draw_entries/settings) → Tasks 1-4. ✅
- Spec §6 admin data → Task 8 (UI is Plan 3). ✅
- Spec §7 monthly draw → Task 4 (draw_entry creation) + Task 8 (`GET/POST /admin/event/draw`). ✅
- Spec §8 anti-abuse → single-use code (Task 2), required contact (Task 3), bonus cap +2 / max 3 spins (Task 3), server-chosen slice (Task 4). IP stored (Task 3); soft rate-limit is a route middleware to add in Plan 2 hardening. ✅
- Spec §9 loyalty-by-email idempotency → Task 5 (`orderId = event:<rewardId>`). ✅

**Open verification for the implementer (do before Task 5):** open `src/modules/loyalty/service.ts` and confirm the exact `awardPoints` signature + options object (`reason`, `orderId`) and the `getAccount`/`ensureAccount` names. Match them verbatim.
```
```
