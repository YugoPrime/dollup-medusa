# Pre-order Quote Intake — Plan A: Backend Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend data model, service methods, and public price-preview route that the SHEIN quote-intake feature sits on — no daemon, no UI yet.

**Architecture:** Two new entities (`PreorderQuoteRequest`, `PreorderQuoteItem`) inside the existing `preorder` module. Pure helper functions (URL validation, rate-limit check, request-status rollup, stale-lock check) are unit-tested in isolation; the service methods compose them over the Medusa data layer. A public store route exposes the existing `previewPrice` math for the on-page simulator.

**Tech Stack:** Medusa v2 (`MedusaService`, `model.define`, hand-written MikroORM migrations), TypeScript, Jest unit tests. Reuses `modules/preorder/lib/pricing.ts` unchanged.

**Spec:** `docs/superpowers/specs/2026-06-06-preorder-quote-intake-design.md` (§4, §5, §6a, §10)

**This plan is the hard dependency** for Plans B (daemon), C (storefront), D (admin). Those are written after this ships against the real interfaces.

---

## File Structure

- Create: `src/modules/preorder/models/preorder-quote-request.ts` — request entity
- Create: `src/modules/preorder/models/preorder-quote-item.ts` — item/job entity
- Create: `src/modules/preorder/migrations/Migration20260606000000.ts` — both tables
- Create: `src/modules/preorder/lib/quote-helpers.ts` — pure functions (validate URL, rollup status, stale-lock, rate-limit)
- Create: `src/modules/preorder/lib/__tests__/quote-helpers.unit.spec.ts` — helper tests
- Modify: `src/modules/preorder/service.ts` — register models + add quote methods + heartbeat
- Modify: `src/modules/preorder/models/preorder-settings.ts` — add `shein_daemon_last_seen_at`
- Create: `src/api/store/preorder/price-preview/route.ts` — public simulator route
- Create: `src/api/store/preorder/price-preview/__tests__/...` — (route is thin; covered by helper + manual smoke)

> **Conventions reminders (from memory + module patterns):**
> - Linkable keys are camelCase: `module.linkable.preorderQuoteRequest`.
> - `hasMany` MUST specify `mappedBy` explicitly (`medusa-v2-hasmany-mappedby`).
> - Migrations: do NOT `ON CONFLICT` against a unique index created in the same tx (`medusa-migration-on-conflict-same-tx-fails`) — use `WHERE NOT EXISTS`.
> - MUR is whole rupees in this DB — no `*100` (`sourcing-push-100x-price-bug-fixed-2026-06-03`).

---

### Task 1: Add daemon-heartbeat field to settings model

**Files:**
- Modify: `src/modules/preorder/models/preorder-settings.ts`

- [ ] **Step 1: Add the field**

In `preorder-settings.ts`, inside the `model.define("PreorderSettings", { ... })` block, add after the last existing field (before the closing `})`):

```ts
  // Liveness heartbeat written by the SHEIN headless daemon every poll.
  // Used to detect daemon-offline so new quote items go straight to manual.
  shein_daemon_last_seen_at: model.dateTime().nullable(),
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/preorder/models/preorder-settings.ts
git commit -m "feat(preorder): add shein_daemon_last_seen_at to settings model"
```

---

### Task 2: Pure helpers — URL validation

**Files:**
- Create: `src/modules/preorder/lib/quote-helpers.ts`
- Create: `src/modules/preorder/lib/__tests__/quote-helpers.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/preorder/lib/__tests__/quote-helpers.unit.spec.ts`:

```ts
import { isValidSheinUrl, parseQuoteUrls } from "../quote-helpers"

describe("isValidSheinUrl", () => {
  it("accepts a shein.com product URL", () => {
    expect(isValidSheinUrl("https://www.shein.com/Aloruh-Dress-p-12345.html")).toBe(true)
  })
  it("accepts regional shein subdomains", () => {
    expect(isValidSheinUrl("https://m.shein.com/x-p-1.html")).toBe(true)
  })
  it("rejects non-shein hosts", () => {
    expect(isValidSheinUrl("https://example.com/x")).toBe(false)
  })
  it("rejects garbage", () => {
    expect(isValidSheinUrl("not a url")).toBe(false)
  })
})

describe("parseQuoteUrls", () => {
  it("splits newline-separated links, trims, drops blanks", () => {
    const input = "https://www.shein.com/a-p-1.html\n\n https://www.shein.com/b-p-2.html \n"
    expect(parseQuoteUrls(input)).toEqual([
      "https://www.shein.com/a-p-1.html",
      "https://www.shein.com/b-p-2.html",
    ])
  })
  it("caps at 5 and reports the overflow count", () => {
    const six = Array.from({ length: 6 }, (_, i) => `https://www.shein.com/x-p-${i}.html`).join("\n")
    const { urls, dropped } = parseQuoteUrlsCapped(six, 5)
    expect(urls).toHaveLength(5)
    expect(dropped).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:unit src/modules/preorder/lib/__tests__/quote-helpers.unit.spec.ts`
Expected: FAIL — "Cannot find module '../quote-helpers'".

- [ ] **Step 3: Write minimal implementation**

Create `src/modules/preorder/lib/quote-helpers.ts`:

```ts
/**
 * Pure helpers for the SHEIN quote-intake flow. No Medusa/DB dependency —
 * unit-tested in isolation, composed by the service layer.
 */

// Mirror the bookmarklet's host check (api/hooks/preorder-bookmarklet/route.ts):
// shein.com with an optional single-label subdomain (www, m, us, etc.).
const SHEIN_URL_RE = /^https?:\/\/(?:[a-z0-9-]+\.)?shein\.com\//i

export function isValidSheinUrl(url: string): boolean {
  if (typeof url !== "string") return false
  return SHEIN_URL_RE.test(url.trim())
}

export function parseQuoteUrls(raw: string): string[] {
  if (typeof raw !== "string") return []
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

export function parseQuoteUrlsCapped(
  raw: string,
  max: number,
): { urls: string[]; dropped: number } {
  const all = parseQuoteUrls(raw)
  return { urls: all.slice(0, max), dropped: Math.max(0, all.length - max) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test:unit src/modules/preorder/lib/__tests__/quote-helpers.unit.spec.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add src/modules/preorder/lib/quote-helpers.ts src/modules/preorder/lib/__tests__/quote-helpers.unit.spec.ts
git commit -m "feat(preorder): quote URL validation + parsing helpers"
```

---

### Task 3: Pure helpers — request-status rollup

**Files:**
- Modify: `src/modules/preorder/lib/quote-helpers.ts`
- Modify: `src/modules/preorder/lib/__tests__/quote-helpers.unit.spec.ts`

- [ ] **Step 1: Add the failing test**

Append to `quote-helpers.unit.spec.ts`:

```ts
import { rollupRequestStatus } from "../quote-helpers"

describe("rollupRequestStatus", () => {
  const s = (...statuses: string[]) => statuses.map((status) => ({ status }))

  it("all quoted -> quoted", () => {
    expect(rollupRequestStatus(s("quoted", "quoted"))).toBe("quoted")
  })
  it("all reserved -> reserved", () => {
    expect(rollupRequestStatus(s("reserved", "reserved"))).toBe("reserved")
  })
  it("mix of quoted and needs_manual -> partial", () => {
    expect(rollupRequestStatus(s("quoted", "needs_manual"))).toBe("partial")
  })
  it("all needs_manual -> needs_manual", () => {
    expect(rollupRequestStatus(s("needs_manual", "needs_manual"))).toBe("needs_manual")
  })
  it("any still pending/scraping -> pending", () => {
    expect(rollupRequestStatus(s("quoted", "scraping"))).toBe("pending")
    expect(rollupRequestStatus(s("pending", "quoted"))).toBe("pending")
  })
  it("reserved items count as resolved alongside quoted", () => {
    expect(rollupRequestStatus(s("reserved", "quoted"))).toBe("partial")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:unit src/modules/preorder/lib/__tests__/quote-helpers.unit.spec.ts`
Expected: FAIL — "rollupRequestStatus is not a function".

- [ ] **Step 3: Implement**

Append to `quote-helpers.ts`:

```ts
export type QuoteItemStatusLike = { status: string }
export type RequestStatus =
  | "pending"
  | "quoted"
  | "partial"
  | "needs_manual"
  | "reserved"

/**
 * Roll N item statuses up to the request status.
 * - Any item still in-flight (pending|scraping) -> "pending".
 * - All reserved -> "reserved"; all quoted -> "quoted"; all needs_manual -> "needs_manual".
 * - Otherwise a resolved mix -> "partial".
 * `failed` items are treated as resolved-but-not-actionable (don't block "quoted"/rollup);
 * they neither force "partial" alone nor count as quoted.
 */
export function rollupRequestStatus(
  items: QuoteItemStatusLike[],
): RequestStatus {
  if (items.length === 0) return "pending"
  const inFlight = items.some(
    (i) => i.status === "pending" || i.status === "scraping",
  )
  if (inFlight) return "pending"

  const actionable = items.filter((i) => i.status !== "failed")
  if (actionable.length === 0) return "needs_manual" // all failed -> owner sees it

  const allReserved = actionable.every((i) => i.status === "reserved")
  if (allReserved) return "reserved"
  const allQuoted = actionable.every((i) => i.status === "quoted")
  if (allQuoted) return "quoted"
  const allManual = actionable.every((i) => i.status === "needs_manual")
  if (allManual) return "needs_manual"
  return "partial"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test:unit src/modules/preorder/lib/__tests__/quote-helpers.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/preorder/lib/quote-helpers.ts src/modules/preorder/lib/__tests__/quote-helpers.unit.spec.ts
git commit -m "feat(preorder): request-status rollup helper"
```

---

### Task 4: Pure helpers — stale-lock + daemon-online check

**Files:**
- Modify: `src/modules/preorder/lib/quote-helpers.ts`
- Modify: `src/modules/preorder/lib/__tests__/quote-helpers.unit.spec.ts`

- [ ] **Step 1: Add the failing test**

Append to `quote-helpers.unit.spec.ts`:

```ts
import { isLockStale, isDaemonOnline } from "../quote-helpers"

describe("isLockStale", () => {
  const now = new Date("2026-06-06T12:00:00Z")
  it("null lock is stale (reclaimable)", () => {
    expect(isLockStale(null, now, 5)).toBe(true)
  })
  it("lock 6 min old is stale", () => {
    expect(isLockStale(new Date("2026-06-06T11:54:00Z"), now, 5)).toBe(true)
  })
  it("lock 2 min old is fresh", () => {
    expect(isLockStale(new Date("2026-06-06T11:58:00Z"), now, 5)).toBe(false)
  })
})

describe("isDaemonOnline", () => {
  const now = new Date("2026-06-06T12:00:00Z")
  it("heartbeat 2 min ago -> online", () => {
    expect(isDaemonOnline(new Date("2026-06-06T11:58:00Z"), now, 5)).toBe(true)
  })
  it("heartbeat 6 min ago -> offline", () => {
    expect(isDaemonOnline(new Date("2026-06-06T11:54:00Z"), now, 5)).toBe(false)
  })
  it("never seen (null) -> offline", () => {
    expect(isDaemonOnline(null, now, 5)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:unit src/modules/preorder/lib/__tests__/quote-helpers.unit.spec.ts`
Expected: FAIL — "isLockStale is not a function".

- [ ] **Step 3: Implement**

Append to `quote-helpers.ts`:

```ts
const MS_PER_MIN = 60_000

/** A scraping lock older than `maxAgeMin` (or absent) is reclaimable. */
export function isLockStale(
  lockedAt: Date | null,
  now: Date,
  maxAgeMin: number,
): boolean {
  if (!lockedAt) return true
  return now.getTime() - lockedAt.getTime() > maxAgeMin * MS_PER_MIN
}

/** Daemon is online if it heartbeat within `maxAgeMin`. */
export function isDaemonOnline(
  lastSeenAt: Date | null,
  now: Date,
  maxAgeMin: number,
): boolean {
  if (!lastSeenAt) return false
  return now.getTime() - lastSeenAt.getTime() <= maxAgeMin * MS_PER_MIN
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test:unit src/modules/preorder/lib/__tests__/quote-helpers.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/preorder/lib/quote-helpers.ts src/modules/preorder/lib/__tests__/quote-helpers.unit.spec.ts
git commit -m "feat(preorder): stale-lock + daemon-online time helpers"
```

---

### Task 5: Define the two models

**Files:**
- Create: `src/modules/preorder/models/preorder-quote-request.ts`
- Create: `src/modules/preorder/models/preorder-quote-item.ts`

- [ ] **Step 1: Write the request model**

Create `src/modules/preorder/models/preorder-quote-request.ts`:

```ts
import { model } from "@medusajs/framework/utils"

import PreorderQuoteItem from "./preorder-quote-item"

/**
 * One client submission to /preorder/request. Holds contact + lifecycle status;
 * the actual links/quotes live on PreorderQuoteItem children.
 */
const PreorderQuoteRequest = model.define("PreorderQuoteRequest", {
  id: model.id({ prefix: "pqreq" }).primaryKey(),
  // { whatsapp: string, name?: string }
  contact: model.json(),
  status: model
    .enum([
      "pending",
      "quoted",
      "partial",
      "needs_manual",
      "reserved",
      "expired",
      "abandoned",
    ])
    .default("pending"),
  notes: model.text().nullable(),
  items_count: model.number().default(0),
  client_ip: model.text().nullable(),
  reserved_cart_id: model.text().nullable(),
  expires_at: model.dateTime().nullable(),
  items: model.hasMany(() => PreorderQuoteItem, { mappedBy: "request" }),
})

export default PreorderQuoteRequest
```

- [ ] **Step 2: Write the item model**

Create `src/modules/preorder/models/preorder-quote-item.ts`:

```ts
import { model } from "@medusajs/framework/utils"

import PreorderQuoteRequest from "./preorder-quote-request"

/**
 * One SHEIN link within a quote request. Doubles as the daemon job row:
 * status drives the scrape lifecycle (pending -> scraping -> quoted/...).
 */
const PreorderQuoteItem = model.define("PreorderQuoteItem", {
  id: model.id({ prefix: "pqitem" }).primaryKey(),
  request: model.belongsTo(() => PreorderQuoteRequest, { mappedBy: "items" }),
  position: model.number().default(0),
  shein_url: model.text(),

  // Job state
  status: model
    .enum([
      "pending",
      "scraping",
      "quoted",
      "needs_manual",
      "failed",
      "reserved",
    ])
    .default("pending"),
  attempts: model.number().default(0),
  locked_at: model.dateTime().nullable(),
  last_attempt_at: model.dateTime().nullable(),
  last_error_kind: model
    .enum([
      "challenge",
      "removed",
      "parse-fail",
      "network-error",
      "timeout",
      "invalid-url",
    ])
    .nullable(),

  // Scrape result
  scraped_title: model.text().nullable(),
  scraped_thumbnail: model.text().nullable(),
  scraped_price_usd: model.number().nullable(),
  color_options: model.json().nullable(),
  size_options: model.json().nullable(),

  // Pricing snapshot (binding quote)
  all_in_price_mur: model.number().nullable(),
  price_breakdown: model.json().nullable(),
  fx_rate_used: model.number().nullable(),
  settings_snapshot: model.json().nullable(),

  // Client selection
  selected_size: model.text().nullable(),
  selected_color: model.text().nullable(),

  // Reserve
  reserved_product_id: model.text().nullable(),
  reserved_at: model.dateTime().nullable(),
})

export default PreorderQuoteItem
```

- [ ] **Step 3: Type-check (no test yet — models are declarative)**

Run: `yarn tsc --noEmit 2>&1 | grep -E "preorder-quote" || echo "no errors in new models"`
Expected: `no errors in new models`.

- [ ] **Step 4: Commit**

```bash
git add src/modules/preorder/models/preorder-quote-request.ts src/modules/preorder/models/preorder-quote-item.ts
git commit -m "feat(preorder): PreorderQuoteRequest + PreorderQuoteItem models"
```

---

### Task 6: Migration for both tables + settings column

**Files:**
- Create: `src/modules/preorder/migrations/Migration20260606000000.ts`

- [ ] **Step 1: Write the migration**

Create `src/modules/preorder/migrations/Migration20260606000000.ts`:

```ts
import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260606000000 extends Migration {
  async up(): Promise<void> {
    // settings: daemon heartbeat column
    this.addSql(
      'alter table if exists "preorder_settings" add column if not exists "shein_daemon_last_seen_at" timestamptz null;',
    )

    // request table
    this.addSql(
      'create table if not exists "preorder_quote_request" (' +
        '"id" text not null, ' +
        '"contact" jsonb not null, ' +
        `"status" text not null default 'pending', ` +
        '"notes" text null, ' +
        '"items_count" integer not null default 0, ' +
        '"client_ip" text null, ' +
        '"reserved_cart_id" text null, ' +
        '"expires_at" timestamptz null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "preorder_quote_request_pkey" primary key ("id"));',
    )

    // item table
    this.addSql(
      'create table if not exists "preorder_quote_item" (' +
        '"id" text not null, ' +
        '"request_id" text not null, ' +
        '"position" integer not null default 0, ' +
        '"shein_url" text not null, ' +
        `"status" text not null default 'pending', ` +
        '"attempts" integer not null default 0, ' +
        '"locked_at" timestamptz null, ' +
        '"last_attempt_at" timestamptz null, ' +
        '"last_error_kind" text null, ' +
        '"scraped_title" text null, ' +
        '"scraped_thumbnail" text null, ' +
        '"scraped_price_usd" numeric null, ' +
        '"color_options" jsonb null, ' +
        '"size_options" jsonb null, ' +
        '"all_in_price_mur" integer null, ' +
        '"price_breakdown" jsonb null, ' +
        '"fx_rate_used" numeric null, ' +
        '"settings_snapshot" jsonb null, ' +
        '"selected_size" text null, ' +
        '"selected_color" text null, ' +
        '"reserved_product_id" text null, ' +
        '"reserved_at" timestamptz null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "preorder_quote_item_pkey" primary key ("id"));',
    )
    this.addSql(
      'create index if not exists "preorder_quote_item_request_id" on "preorder_quote_item" ("request_id") where "deleted_at" is null;',
    )
    // Daemon poll filters by status — index it.
    this.addSql(
      'create index if not exists "preorder_quote_item_status" on "preorder_quote_item" ("status") where "deleted_at" is null;',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "preorder_quote_item" cascade;')
    this.addSql('drop table if exists "preorder_quote_request" cascade;')
    this.addSql(
      'alter table if exists "preorder_settings" drop column if exists "shein_daemon_last_seen_at";',
    )
  }
}
```

- [ ] **Step 2: Run the migration against local/dev DB**

Run: `set -a && . ./.env.local-render && set +a && yarn medusa db:migrate`
Expected: migration `Migration20260606000000` runs without error; tables created.

> Note (memory `sourcing-push-100x-price-bug-fixed-2026-06-03`): local exec needs the
> DB env from `.env.local-render` (there is no `.env`); DB reached at 127.0.0.1:5432 via
> the `coolify-db-tunnel` PM2 process. Confirm the tunnel is up first.

- [ ] **Step 3: Commit**

```bash
git add src/modules/preorder/migrations/Migration20260606000000.ts
git commit -m "feat(preorder): migration for quote request + item tables"
```

---

### Task 7: Register models on the service

**Files:**
- Modify: `src/modules/preorder/service.ts`

- [ ] **Step 1: Import and register the new models in MedusaService**

At the top of `service.ts`, add imports next to the existing model imports:

```ts
import PreorderQuoteRequest from "./models/preorder-quote-request"
import PreorderQuoteItem from "./models/preorder-quote-item"
```

Find the `MedusaService({ ... })` call (the base class the service extends — it currently lists `PreorderSettings, PreorderToken`). Add the two new models to that object so the auto-generated CRUD methods (`createPreorderQuoteRequests`, `listPreorderQuoteItems`, `updatePreorderQuoteItems`, etc.) exist:

```ts
class PreorderModuleService extends MedusaService({
  PreorderSettings,
  PreorderToken,
  PreorderQuoteRequest,
  PreorderQuoteItem,
}) {
```

- [ ] **Step 2: Type-check**

Run: `yarn tsc --noEmit 2>&1 | grep -E "service\.ts" | grep -iv "chat|stories" || echo "no new service errors"`
Expected: `no new service errors`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/preorder/service.ts
git commit -m "feat(preorder): register quote models on service"
```

---

### Task 8: Service — createQuoteRequest (with rate-limit + daemon-offline branch)

**Files:**
- Modify: `src/modules/preorder/service.ts`

- [ ] **Step 1: Add the method**

Add to the `PreorderModuleService` class body (after the existing `previewPrice` method). This composes the Task 2/4 helpers; it does NOT re-implement validation inline:

```ts
  /**
   * Create a quote request + its item rows. Enforces <=5 links and the per-IP
   * hourly rate limit (settings.submissions_per_ip_per_hour). If the SHEIN
   * daemon is offline (stale heartbeat), items are created directly as
   * "needs_manual" so the storefront shows the by-hand card immediately
   * instead of an indefinite spinner.
   */
  async createQuoteRequest(input: {
    contact: { whatsapp: string; name?: string }
    rawUrls: string
    clientIp?: string | null
    notes?: string | null
    now?: Date
  }): Promise<{ requestId: string; itemCount: number; dropped: number }> {
    const now = input.now ?? new Date()
    const settings = await this.getSettings()

    const { urls, dropped } = parseQuoteUrlsCapped(input.rawUrls, 5)
    const valid = urls.filter((u) => isValidSheinUrl(u))
    if (valid.length === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No valid SHEIN links found. Links must be shein.com product URLs.",
      )
    }

    // Per-IP rate limit (NAT-friendly default lives in settings).
    if (input.clientIp) {
      const windowStart = new Date(now.getTime() - 60 * 60 * 1000)
      const recent = await (this as any).listPreorderQuoteRequests(
        { client_ip: input.clientIp, created_at: { $gte: windowStart } },
        { take: 100 },
      )
      const limit = Number(settings.submissions_per_ip_per_hour ?? 5)
      if (Array.isArray(recent) && recent.length >= limit) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          "rate_limited",
        )
      }
    }

    const daemonOnline = isDaemonOnline(
      settings.shein_daemon_last_seen_at
        ? new Date(settings.shein_daemon_last_seen_at)
        : null,
      now,
      5,
    )
    const initialStatus = daemonOnline ? "pending" : "needs_manual"

    const request = await (this as any).createPreorderQuoteRequests({
      contact: input.contact,
      notes: input.notes ?? null,
      items_count: valid.length,
      client_ip: input.clientIp ?? null,
      status: daemonOnline ? "pending" : "needs_manual",
      expires_at: new Date(now.getTime() + 48 * 60 * 60 * 1000),
    })

    await (this as any).createPreorderQuoteItems(
      valid.map((url, i) => ({
        request_id: request.id,
        position: i,
        shein_url: url,
        status: initialStatus,
        last_error_kind: daemonOnline ? null : null,
      })),
    )

    return { requestId: request.id, itemCount: valid.length, dropped }
  }
```

- [ ] **Step 2: Add the helper imports**

At the top of `service.ts`, add:

```ts
import {
  parseQuoteUrlsCapped,
  isValidSheinUrl,
  isDaemonOnline,
  isLockStale,
  rollupRequestStatus,
} from "./lib/quote-helpers"
```

- [ ] **Step 3: Type-check**

Run: `yarn tsc --noEmit 2>&1 | grep -E "service\.ts" | grep -iv "chat|stories" || echo "ok"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add src/modules/preorder/service.ts
git commit -m "feat(preorder): createQuoteRequest with rate-limit + daemon-offline branch"
```

---

### Task 9: Service — daemon job methods (list / claim / recordResult / heartbeat)

**Files:**
- Modify: `src/modules/preorder/service.ts`

- [ ] **Step 1: Add the methods**

Add to the class body:

```ts
  /** Daemon poll: oldest pending jobs first. */
  async listQuoteJobs(opts: { status?: string; limit?: number } = {}): Promise<any[]> {
    const status = opts.status ?? "pending"
    const take = opts.limit ?? 5
    return (this as any).listPreorderQuoteItems(
      { status },
      { take, order: { created_at: "ASC" } },
    )
  }

  /**
   * Atomically claim a job for scraping. Returns false if the row is already
   * locked by a fresh (non-stale) lock — prevents double-scrape across poll
   * cycles. A scraping row whose lock is stale (>5 min) is reclaimable.
   */
  async claimQuoteJob(itemId: string, now: Date = new Date()): Promise<boolean> {
    const [item] = await (this as any).listPreorderQuoteItems({ id: itemId })
    if (!item) return false
    if (
      item.status === "scraping" &&
      !isLockStale(item.locked_at ? new Date(item.locked_at) : null, now, 5)
    ) {
      return false
    }
    await (this as any).updatePreorderQuoteItems({
      id: itemId,
      status: "scraping",
      locked_at: now,
      last_attempt_at: now,
      attempts: Number(item.attempts ?? 0) + 1,
    })
    return true
  }

  /**
   * Record a daemon (or manual) scrape result and bubble the request status.
   * `outcome` decides the item's terminal-ish status this attempt.
   */
  async recordScrapeResult(
    itemId: string,
    payload: {
      outcome: "quoted" | "failed" | "needs_manual"
      scraped_title?: string | null
      scraped_thumbnail?: string | null
      scraped_price_usd?: number | null
      color_options?: unknown
      size_options?: unknown
      all_in_price_mur?: number | null
      price_breakdown?: unknown
      fx_rate_used?: number | null
      settings_snapshot?: unknown
      last_error_kind?: string | null
    },
  ): Promise<void> {
    const [item] = await (this as any).listPreorderQuoteItems({ id: itemId })
    if (!item) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "quote item not found")
    }
    await (this as any).updatePreorderQuoteItems({
      id: itemId,
      status: payload.outcome,
      locked_at: null,
      scraped_title: payload.scraped_title ?? item.scraped_title ?? null,
      scraped_thumbnail: payload.scraped_thumbnail ?? item.scraped_thumbnail ?? null,
      scraped_price_usd: payload.scraped_price_usd ?? item.scraped_price_usd ?? null,
      color_options: payload.color_options ?? item.color_options ?? null,
      size_options: payload.size_options ?? item.size_options ?? null,
      all_in_price_mur: payload.all_in_price_mur ?? item.all_in_price_mur ?? null,
      price_breakdown: payload.price_breakdown ?? item.price_breakdown ?? null,
      fx_rate_used: payload.fx_rate_used ?? item.fx_rate_used ?? null,
      settings_snapshot: payload.settings_snapshot ?? item.settings_snapshot ?? null,
      last_error_kind: payload.last_error_kind ?? null,
    })
    await this.recomputeRequestStatus(item.request_id)
  }

  /** Re-roll a request's status from its items. */
  async recomputeRequestStatus(requestId: string): Promise<void> {
    const items = await (this as any).listPreorderQuoteItems({
      request_id: requestId,
    })
    const next = rollupRequestStatus(items.map((i: any) => ({ status: i.status })))
    await (this as any).updatePreorderQuoteRequests({ id: requestId, status: next })
  }

  /** Daemon liveness — write heartbeat on the singleton settings row. */
  async recordDaemonHeartbeat(now: Date = new Date()): Promise<void> {
    const settings = await this.getSettings()
    await (this as any).updatePreorderSettings({
      id: settings.id,
      shein_daemon_last_seen_at: now,
    })
  }
```

> Note: `updatePreorderSettings` is the existing settings updater used by
> `updateSettings` — match whatever method name the current service uses (check the
> existing `updateSettings` body and reuse the same underlying call).

- [ ] **Step 2: Type-check**

Run: `yarn tsc --noEmit 2>&1 | grep -E "service\.ts" | grep -iv "chat|stories" || echo "ok"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/preorder/service.ts
git commit -m "feat(preorder): daemon job methods + heartbeat + status rollup"
```

---

### Task 10: Service — getQuoteRequest, setManualQuote, selectQuoteItemOptions, expireOldRequests

**Files:**
- Modify: `src/modules/preorder/service.ts`

- [ ] **Step 1: Add the methods**

```ts
  /** Storefront poll + admin detail. */
  async getQuoteRequest(
    id: string,
    opts: { withItems?: boolean } = {},
  ): Promise<any> {
    const [request] = await (this as any).listPreorderQuoteRequests({ id })
    if (!request) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "request not found")
    }
    if (!opts.withItems) return request
    const items = await (this as any).listPreorderQuoteItems(
      { request_id: id },
      { order: { position: "ASC" } },
    )
    return { ...request, items }
  }

  /**
   * Admin inline manual quote: owner types the SHEIN USD price, we run the same
   * pricing math the daemon would and write a binding snapshot.
   */
  async setManualQuote(
    itemId: string,
    input: { priceUsd: number },
  ): Promise<void> {
    if (!Number.isFinite(input.priceUsd) || input.priceUsd <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "priceUsd must be a positive number",
      )
    }
    const preview = await this.previewPrice({ sheinPriceUsd: input.priceUsd })
    const settings = await this.getSettings()
    await this.recordScrapeResult(itemId, {
      outcome: "quoted",
      scraped_price_usd: input.priceUsd,
      all_in_price_mur: preview.finalPriceMur,
      price_breakdown: preview,
      fx_rate_used: preview.fxRateUsed,
      settings_snapshot: settings,
    })
  }

  /** Client picks size/colour on a quoted card. */
  async selectQuoteItemOptions(
    itemId: string,
    input: { size?: string | null; color?: string | null },
  ): Promise<void> {
    await (this as any).updatePreorderQuoteItems({
      id: itemId,
      selected_size: input.size ?? null,
      selected_color: input.color ?? null,
    })
  }

  /** Cron: mark unreserved requests older than 48h as expired. */
  async expireOldRequests(now: Date = new Date()): Promise<number> {
    const requests = await (this as any).listPreorderQuoteRequests({
      status: ["pending", "quoted", "partial", "needs_manual"],
    })
    let expired = 0
    for (const r of requests) {
      if (r.expires_at && new Date(r.expires_at).getTime() < now.getTime()) {
        await (this as any).updatePreorderQuoteRequests({
          id: r.id,
          status: "expired",
        })
        expired++
      }
    }
    return expired
  }
```

- [ ] **Step 2: Type-check**

Run: `yarn tsc --noEmit 2>&1 | grep -E "service\.ts" | grep -iv "chat|stories" || echo "ok"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/preorder/service.ts
git commit -m "feat(preorder): getQuoteRequest, setManualQuote, selectOptions, expireOldRequests"
```

---

### Task 11: Public price-preview store route (the simulator backend)

**Files:**
- Create: `src/api/store/preorder/price-preview/route.ts`

- [ ] **Step 1: Write the route**

Create `src/api/store/preorder/price-preview/route.ts`. Mirrors the admin route but is
public, read-only, GET, with the bookmarklet's `0 < usd <= 10000` clamp:

```ts
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { PREORDER_MODULE } from "../../../../modules/preorder"
import type PreorderModuleService from "../../../../modules/preorder/service"

/**
 * GET /store/preorder/price-preview?usd=22.5
 * Public simulator: USD -> all-in MUR estimate (live settings, NOT a binding
 * quote). No auth, no PII. Clamped to the same bound as the bookmarklet.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const raw = (req.query?.usd ?? "") as string
  const usd = Number(raw)
  if (!Number.isFinite(usd) || usd <= 0 || usd > 10000) {
    res.status(400).json({ message: "usd must be a number in (0, 10000]" })
    return
  }
  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  try {
    const preview = await svc.previewPrice({ sheinPriceUsd: usd })
    res.json({
      finalPriceMur: preview.finalPriceMur,
      fxRateUsed: preview.fxRateUsed,
      breakdown: preview,
    })
  } catch (err) {
    res.status(400).json({ message: (err as Error)?.message ?? "failed" })
  }
}
```

> Note: `/store/*` routes require a publishable key + the calling origin in
> `STORE_CORS`. The storefront calls this server-side or with the existing publishable
> key — no new CORS entry needed beyond what the storefront already has.

- [ ] **Step 2: Type-check**

Run: `yarn tsc --noEmit 2>&1 | grep -E "price-preview" || echo "ok"`
Expected: `ok`.

- [ ] **Step 3: Manual smoke (dev server)**

Run: `yarn dev` (separate shell), then:
`curl "http://localhost:9000/store/preorder/price-preview?usd=22.5" -H "x-publishable-api-key: $PK"`
Expected: JSON `{ "finalPriceMur": <whole rupees, e.g. 1040>, ... }`. Verify the number is whole rupees, NOT ×100.

- [ ] **Step 4: Commit**

```bash
git add src/api/store/preorder/price-preview/route.ts
git commit -m "feat(preorder): public price-preview store route for simulator"
```

---

### Task 12: Full suite green + push

**Files:** none (verification task)

- [ ] **Step 1: Run the full unit suite**

Run: `yarn test:unit`
Expected: all preorder specs pass, including the new `quote-helpers.unit.spec.ts`. Pre-existing unrelated failures in `chat`/`stories` specs (documented type errors) are out of scope — confirm no NEW failures in `preorder`.

- [ ] **Step 2: Full type-check (scoped to preorder)**

Run: `yarn tsc --noEmit 2>&1 | grep -iE "preorder|quote" || echo "no preorder type errors"`
Expected: `no preorder type errors`.

- [ ] **Step 3: Push**

```bash
git push origin master
```

Expected: backend foundation on origin/master. Coolify auto-deploys; the migration runs on container boot via `start.sh`.

---

## Self-Review Notes

- **Spec §4 (data model):** Tasks 5–6 — both entities + all fields + heartbeat column. ✓
- **Spec §5 (service methods):** `createQuoteRequest` (T8), `getQuoteRequest` (T10), `listQuoteJobs`/`claimQuoteJob`/`recordScrapeResult`/`recordDaemonHeartbeat` (T9), `setManualQuote`/`selectQuoteItemOptions`/`expireOldRequests` (T10). `reserveQuoteItem` is **deferred to Plan C** (needs the storefront cart + `createPreorderProduct` `hideFromCatalog` param — built where it's consumed). ✓ noted gap is intentional.
- **Spec §6a (simulator):** Task 11 public route. Frontend widget is Plan C. ✓
- **Spec §10 (rate-limit/expiry/daemon-offline):** rate-limit + daemon-offline in T8, expiry in T10, stale-lock in T9. ✓
- **Type consistency:** `recordScrapeResult` signature in T9 is reused by `setManualQuote` in T10 (same `outcome: "quoted"` shape). `rollupRequestStatus`/`isLockStale`/`isDaemonOnline` defined T3/T4, consumed T8/T9. ✓
- **Deferred to later plans (intentional, not gaps):** `reserveQuoteItem` + `createPreorderProduct` `hideFromCatalog` (Plan C), daemon endpoints' HTTP wrappers (Plan B wraps T9 service methods in `/admin/preorder/quote-jobs/*` routes), `expireOldRequests` cron registration (Plan B, alongside daemon).
- **Placeholder scan:** no TBD/TODO; every code step has full code. ✓
