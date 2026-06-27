# Feed Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin page where the owner drags products from the most recent sourcing push onto a month calendar to schedule each as a daily IG/FB feed post, published by the existing 18:00 MU cron.

**Architecture:** Thin override layer on the existing `feed-posts` module. A "drop" creates a `planned` FeedPost row (snapshot + carousel images + caption built at drop time via the existing `buildFeedPostForDate` forced-product path). The daily cron is amended to publish a pre-planned row instead of skipping it; empty days still auto-pick. New admin REST endpoints back the page; native HTML5 drag-and-drop, no new deps.

**Tech Stack:** Medusa v2.13.1, TypeScript, `@medusajs/framework`, `@medusajs/admin-sdk`, `@medusajs/ui`, Jest, Yarn 4.

## Global Constraints

- Package manager is **`yarn`**, never `npm`.
- **No new runtime dependencies** (pre-install vetting rule). DnD is native HTML5.
- MUR prices are **whole rupees** in this DB — never multiply/divide by 100.
- Dates are **Mauritius local "YYYY-MM-DD"**; use helpers in `src/lib/mauritius-date.ts` (`mauritiusToday`, `addDaysToMauritiusDate`). MU is UTC+4, no DST.
- **One feed post per day** (the `FeedPost` model is date-keyed).
- The feed only features **`status:"published"`** products (sourcing pushes create `draft` products until "Go Live"). Draft products cannot be planned.
- All admin routes use `AuthenticatedMedusaRequest` (admin-only), matching existing `feed-posts`/`sourcing` routes.
- Module service key constants: `FEED_POSTS_MODULE = "feed_posts"`, `SOURCING_MODULE = "sourcing"`.
- Test discovery (jest.config.js): module tests `src/modules/*/__tests__/**/*.[jt]s` (run `yarn test:integration:modules`); unit specs `src/**/__tests__/**/*.unit.spec.[jt]s` (run `yarn test:unit`).

---

## File structure

- Modify `src/modules/feed-posts/service.ts` — add `listByDateRange`, `deletePlannedByDate`.
- Create `src/lib/feed-planner.ts` — `planFeedPostForDate` (guard + replace + build, no publish) and `decideDailyPublishAction` (pure cron decision).
- Create `src/lib/__tests__/feed-planner.unit.spec.ts` — unit tests for `decideDailyPublishAction`.
- Create `src/modules/feed-posts/__tests__/feed-planner-service.spec.ts` — module tests for the two service methods.
- Create `src/api/admin/feed-posts/pool/route.ts` — `GET` latest-push pool.
- Create `src/api/admin/feed-posts/calendar/route.ts` — `GET` rows in date range.
- Create `src/api/admin/feed-posts/plan/route.ts` — `POST` plan a day, `DELETE` unplan a day.
- Modify `src/jobs/daily-feed-post.ts` — publish a pre-planned row using `decideDailyPublishAction`.
- Create `src/admin/routes/feed-planner/page.tsx` — the drag-and-drop page.

---

## Task 1: Service methods — range list + planned-only delete

**Files:**
- Modify: `src/modules/feed-posts/service.ts`
- Test: `src/modules/feed-posts/__tests__/feed-planner-service.spec.ts`

**Interfaces:**
- Consumes: existing `FeedPostsModuleService` (`MedusaService({ FeedPost })`), `FeedPostDTO`, `FeedPostStatus`.
- Produces:
  - `listByDateRange(from: string, to: string): Promise<FeedPostDTO[]>` — rows with `from <= post_date <= to`.
  - `deletePlannedByDate(date: string): Promise<number>` — deletes only `status="planned"` rows for `date`; returns count deleted.

- [ ] **Step 1: Write the failing test**

Create `src/modules/feed-posts/__tests__/feed-planner-service.spec.ts`:

```ts
import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { FEED_POSTS_MODULE } from "../index"
import FeedPostsModuleService from "../service"

jest.setTimeout(60 * 1000)

moduleIntegrationTestRunner<FeedPostsModuleService>({
  moduleName: FEED_POSTS_MODULE,
  resolve: "./src/modules/feed-posts",
  testSuite: ({ service }) => {
    describe("FeedPostsModuleService — planner methods", () => {
      beforeEach(async () => {
        await service.createPlanned({
          post_date: "2026-07-01", product_id: "prod_a",
          product_snapshot: null, image_urls: ["x"], caption: null,
        })
        await service.createPlanned({
          post_date: "2026-07-05", product_id: "prod_b",
          product_snapshot: null, image_urls: ["y"], caption: null,
          status: "posted",
        })
        await service.createPlanned({
          post_date: "2026-07-20", product_id: "prod_c",
          product_snapshot: null, image_urls: ["z"], caption: null,
        })
      })

      it("listByDateRange returns only rows within the inclusive range", async () => {
        const rows = await service.listByDateRange("2026-07-01", "2026-07-10")
        const dates = rows.map((r) => r.post_date).sort()
        expect(dates).toEqual(["2026-07-01", "2026-07-05"])
      })

      it("deletePlannedByDate deletes only planned rows, never posted", async () => {
        const deletedPlanned = await service.deletePlannedByDate("2026-07-01")
        expect(deletedPlanned).toBe(1)
        const deletedPosted = await service.deletePlannedByDate("2026-07-05")
        expect(deletedPosted).toBe(0)
        const remaining = await service.listByDateRange("2026-07-01", "2026-07-31")
        expect(remaining.map((r) => r.post_date).sort()).toEqual([
          "2026-07-05", "2026-07-20",
        ])
      })
    })
  },
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:integration:modules src/modules/feed-posts/__tests__/feed-planner-service.spec.ts`
Expected: FAIL — `service.listByDateRange is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/modules/feed-posts/service.ts`, add these methods inside the
`FeedPostsModuleService` class (next to `findByDate`):

```ts
  /** Feed posts whose post_date is within [from, to] inclusive (MU date strings). */
  async listByDateRange(from: string, to: string): Promise<FeedPostDTO[]> {
    const rows = await this.listFeedPosts(
      { post_date: { $gte: from, $lte: to } } as any,
      { take: 1000 },
    )
    return rows as unknown as FeedPostDTO[]
  }

  /**
   * Deletes the `planned` row(s) for a date. Never deletes posted/failed rows
   * (those represent real or attempted publishes). Returns the count removed.
   */
  async deletePlannedByDate(date: string): Promise<number> {
    const rows = (await this.listFeedPosts({
      post_date: date,
      status: "planned",
    })) as unknown as FeedPostDTO[]
    if (rows.length === 0) return 0
    await this.deleteFeedPosts(rows.map((r) => r.id))
    return rows.length
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test:integration:modules src/modules/feed-posts/__tests__/feed-planner-service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/feed-posts/service.ts src/modules/feed-posts/__tests__/feed-planner-service.spec.ts
git commit -m "feat(feed-posts): listByDateRange + deletePlannedByDate service methods"
```

---

## Task 2: Cron decision function (pure, testable)

**Files:**
- Create: `src/lib/feed-planner.ts`
- Test: `src/lib/__tests__/feed-planner.unit.spec.ts`

**Interfaces:**
- Consumes: `FeedPostDTO`, `FeedPostStatus` from `../modules/feed-posts/service`.
- Produces:
  - `type DailyPublishAction = "publish_existing" | "auto_pick" | "skip"`
  - `decideDailyPublishAction(existing: { status: FeedPostStatus } | null): DailyPublishAction`
    - `null` → `"auto_pick"`
    - `planned` → `"publish_existing"`
    - `failed` → `"publish_existing"` (retry)
    - `posted` → `"skip"`
    - `skipped` → `"skip"`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/feed-planner.unit.spec.ts`:

```ts
import { decideDailyPublishAction } from "../feed-planner"

describe("decideDailyPublishAction", () => {
  it("auto-picks when there is no row for the day", () => {
    expect(decideDailyPublishAction(null)).toBe("auto_pick")
  })
  it("publishes an existing planned row", () => {
    expect(decideDailyPublishAction({ status: "planned" })).toBe("publish_existing")
  })
  it("retries (publishes) an existing failed row", () => {
    expect(decideDailyPublishAction({ status: "failed" })).toBe("publish_existing")
  })
  it("skips an already-posted row", () => {
    expect(decideDailyPublishAction({ status: "posted" })).toBe("skip")
  })
  it("skips a skipped row", () => {
    expect(decideDailyPublishAction({ status: "skipped" })).toBe("skip")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:unit src/lib/__tests__/feed-planner.unit.spec.ts`
Expected: FAIL — cannot find module `../feed-planner`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/feed-planner.ts`:

```ts
import type { FeedPostStatus } from "../modules/feed-posts/service"

export type DailyPublishAction = "publish_existing" | "auto_pick" | "skip"

/**
 * Decides what the daily cron should do for today given the existing FeedPost
 * row (if any) for today's MU date. A pre-planned row from the Feed Planner is
 * published; an empty day is auto-picked; a posted/skipped day is left alone.
 */
export function decideDailyPublishAction(
  existing: { status: FeedPostStatus } | null,
): DailyPublishAction {
  if (!existing) return "auto_pick"
  switch (existing.status) {
    case "planned":
    case "failed":
      return "publish_existing"
    case "posted":
    case "skipped":
      return "skip"
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test:unit src/lib/__tests__/feed-planner.unit.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/feed-planner.ts src/lib/__tests__/feed-planner.unit.spec.ts
git commit -m "feat(feed-posts): pure daily publish-decision function"
```

---

## Task 3: planFeedPostForDate helper (guard + replace + build, no publish)

**Files:**
- Modify: `src/lib/feed-planner.ts`

**Interfaces:**
- Consumes: `buildFeedPostForDate` from `./feed-post-pipeline`; `FEED_POSTS_MODULE` + `FeedPostsModuleService` + `FeedPostDTO`; `MedusaContainer`.
- Produces:
  - `type PlanResult = { ok: true; row: FeedPostDTO } | { ok: false; reason: "posted" | "past" | "not_published" | "no_images" }`
  - `planFeedPostForDate(args: { scope: MedusaContainer; postDate: string; productId: string; today: string; dedupDays: number }): Promise<PlanResult>`
    - reject `"past"` if `postDate < today`
    - reject `"posted"` if an existing row for `postDate` is `status="posted"`
    - delete any existing `planned` row for `postDate`
    - call `buildFeedPostForDate({ scope, postDate, dedupDays, productId, force: true })`; map its `no_eligible_product` → `"not_published"`, `no_images` → `"no_images"`
    - on success return `{ ok: true, row }`

Note: no separate test task — this orchestration is covered by the route manual verification (Task 5) and depends on container/DB. Keep it a thin, obvious wrapper.

- [ ] **Step 1: Add the implementation**

Append to `src/lib/feed-planner.ts`:

```ts
import type { MedusaContainer } from "@medusajs/framework/types"
import { FEED_POSTS_MODULE } from "../modules/feed-posts"
import type FeedPostsModuleService from "../modules/feed-posts/service"
import type { FeedPostDTO } from "../modules/feed-posts/service"
import { buildFeedPostForDate } from "./feed-post-pipeline"

export type PlanResult =
  | { ok: true; row: FeedPostDTO }
  | { ok: false; reason: "posted" | "past" | "not_published" | "no_images" }

/**
 * Schedules a specific product as the feed post for `postDate` without
 * publishing. Replaces any existing *planned* row for that date; refuses dates
 * in the past or dates already posted. Builds the full snapshot+images+caption
 * via the shared pipeline (forced product), so the daily cron can publish it
 * verbatim at 18:00 MU.
 */
export async function planFeedPostForDate(args: {
  scope: MedusaContainer
  postDate: string
  productId: string
  today: string
  dedupDays: number
}): Promise<PlanResult> {
  const { scope, postDate, productId, today, dedupDays } = args
  if (postDate < today) return { ok: false, reason: "past" }

  const feed = scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const existing = await feed.findByDate(postDate)
  if (existing && existing.status === "posted") {
    return { ok: false, reason: "posted" }
  }

  await feed.deletePlannedByDate(postDate)

  const built = await buildFeedPostForDate({
    scope,
    postDate,
    dedupDays,
    productId,
    force: true,
  })
  if (!built.ok) {
    // forced product not in the published source → treat as not-published
    const reason = built.reason === "no_images" ? "no_images" : "not_published"
    return { ok: false, reason }
  }
  return { ok: true, row: built.row }
}
```

- [ ] **Step 2: Typecheck**

Run: `yarn build`
Expected: build succeeds (no TS errors in `src/lib/feed-planner.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/feed-planner.ts
git commit -m "feat(feed-posts): planFeedPostForDate helper (plan without publish)"
```

---

## Task 4: Amend the daily cron to publish pre-planned rows

**Files:**
- Modify: `src/jobs/daily-feed-post.ts`

**Interfaces:**
- Consumes: `decideDailyPublishAction` (Task 2); existing `buildFeedPostForDate`, `publishFeedPostRow`, `FEED_POSTS_MODULE`/service, `mauritiusToday`, Telegram + logger.

- [ ] **Step 1: Read the current job**

Run: `cat src/jobs/daily-feed-post.ts`
Note the kill-switch (`FEED_AUTO_PUBLISH`), `isMetaIgConfigured` guard, build→publish→Telegram flow.

- [ ] **Step 2: Replace the whole file**

Overwrite `src/jobs/daily-feed-post.ts` with this complete version. It keeps the
kill-switch + Meta guard + Telegram messaging exactly as before; only the
decide/build/publish middle changes (decide via `decideDailyPublishAction`,
publish a pre-planned/failed row directly, auto-pick only on empty days). The
`built.row.image_urls.length` reference becomes `imageCount`.

```ts
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { mauritiusToday } from "../lib/mauritius-date"
import {
  buildFeedPostForDate,
  publishFeedPostRow,
} from "../lib/feed-post-pipeline"
import { isMetaIgConfigured } from "../lib/meta-ig"
import { escapeTelegramHtml, sendTelegram } from "../lib/telegram"
import { FEED_POSTS_MODULE } from "../modules/feed-posts"
import type FeedPostsModuleService from "../modules/feed-posts/service"
import { decideDailyPublishAction } from "../lib/feed-planner"

const ADMIN_URL = process.env.ADMIN_URL ?? "https://api.dollupboutique.com/app"
const DEFAULT_DEDUP_DAYS = 30

/**
 * Daily IG/FB feed post — one product per day, posted at 18:00 Mauritius.
 * A pre-planned row from the Feed Planner is published as-is; an empty day is
 * auto-picked (newest-collection weighting + dedup); a posted/skipped day is
 * left alone. Uses the product's own photos (carousel), not a story template.
 *
 * Kill-switch: FEED_AUTO_PUBLISH must be "true".
 */
export default async function dailyFeedPost(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  if (process.env.FEED_AUTO_PUBLISH !== "true") {
    return // dormant; toggle FEED_AUTO_PUBLISH=true in Coolify when ready
  }
  if (!isMetaIgConfigured()) {
    logger.warn(
      "[feed-post] META_PAGE_ACCESS_TOKEN or META_IG_BUSINESS_ACCOUNT_ID missing — cannot publish",
    )
    return
  }

  const postDate = mauritiusToday()
  const dedupDays = Number(process.env.FEED_DEDUP_DAYS) || DEFAULT_DEDUP_DAYS

  const feed = container.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const existing = await feed.findByDate(postDate)
  const action = decideDailyPublishAction(existing)

  if (action === "skip") {
    logger.info(
      `[feed-post] ${postDate}: ${existing?.status} row already exists — skipping`,
    )
    return
  }

  let feedPostId: string
  let name: string
  let imageCount: number

  if (action === "publish_existing" && existing) {
    feedPostId = existing.id
    const snap = (existing.product_snapshot ?? {}) as { name?: string }
    name = snap.name ?? existing.product_id ?? "(unknown)"
    imageCount = (existing.image_urls as string[] | null)?.length ?? 0
  } else {
    let built
    try {
      built = await buildFeedPostForDate({ scope: container, postDate, dedupDays })
    } catch (err) {
      const msg = (err as Error)?.message ?? "buildFeedPostForDate failed"
      logger.error(`[feed-post] build failed for ${postDate}: ${msg}`)
      await sendTelegram(
        `⚠️ Daily feed post build failed for ${escapeTelegramHtml(postDate)}: ${escapeTelegramHtml(msg)}`,
      )
      return
    }
    if (!built.ok) {
      if (built.reason === "exists") {
        logger.info(`[feed-post] ${postDate} already has a feed post — skipping`)
        return
      }
      const reason =
        built.reason === "no_images"
          ? "picked product has no usable feed photo"
          : "no eligible product to feature"
      logger.warn(`[feed-post] ${postDate}: ${reason}`)
      await sendTelegram(
        `🟡 <b>No feed post for ${escapeTelegramHtml(postDate)}</b>\n\n${escapeTelegramHtml(reason)}.`,
      )
      return
    }
    feedPostId = built.row.id
    const snap = (built.row.product_snapshot ?? {}) as { name?: string }
    name = snap.name ?? built.product_id
    imageCount = built.row.image_urls.length
  }

  const result = await publishFeedPostRow({ scope: container, feedPostId })

  if (result.ok) {
    logger.info(
      `[feed-post] ${postDate}: published "${name}" → IG ${result.ig_media_id}${result.fb_post_id ? ` / FB ${result.fb_post_id}` : ""}`,
    )
    await sendTelegram(
      [
        `🛍️ <b>Feed post published — ${escapeTelegramHtml(postDate)}</b>`,
        "",
        `📦 ${escapeTelegramHtml(name)}`,
        `🖼️ ${imageCount} photo(s)`,
        `📷 IG: ${escapeTelegramHtml(result.ig_media_id ?? "")}`,
        result.fb_post_id ? `📘 FB: ${escapeTelegramHtml(result.fb_post_id)}` : null,
      ]
        .filter((l): l is string => l !== null)
        .join("\n"),
    )
    return
  }

  logger.error(`[feed-post] ${postDate}: publish failed: ${result.error}`)
  await sendTelegram(
    [
      `❌ <b>Feed post failed — ${escapeTelegramHtml(postDate)}</b>`,
      "",
      `📦 ${escapeTelegramHtml(name)}`,
      `Error: ${escapeTelegramHtml(result.error ?? "unknown")}`,
      "",
      `Retry from <a href="${ADMIN_URL}">admin</a> (POST /admin/feed-posts).`,
    ].join("\n"),
  )
}

export const config = {
  name: "daily-feed-post",
  // 14:00 UTC = 18:00 Mauritius (UTC+4, no DST). Daily.
  schedule: "0 14 * * *",
}
```

- [ ] **Step 3: Typecheck / build**

Run: `yarn build`
Expected: build succeeds; no references to an undefined `built` remain outside the `else` branch.

- [ ] **Step 4: Manual reasoning check (no automated cron test)**

Confirm by reading: with a `planned` row present, `action === "publish_existing"`
→ `publishFeedPostRow` runs on that row's id; with no row, `auto_pick` builds then
publishes; with `posted`, returns early. Cross-check against `decideDailyPublishAction`
unit tests (Task 2).

- [ ] **Step 5: Commit**

```bash
git add src/jobs/daily-feed-post.ts
git commit -m "feat(feed-posts): daily cron publishes pre-planned rows, auto-fills empty days"
```

---

## Task 5: Admin API — pool, calendar, plan/unplan

**Files:**
- Create: `src/api/admin/feed-posts/pool/route.ts`
- Create: `src/api/admin/feed-posts/calendar/route.ts`
- Create: `src/api/admin/feed-posts/plan/route.ts`

**Interfaces:**
- Consumes: `SOURCING_MODULE`/`SourcingModuleService` (`listDraftItems`), `FEED_POSTS_MODULE`/`FeedPostsModuleService` (`listByDateRange`, `findByDate`), `ContainerRegistrationKeys.QUERY`, `planFeedPostForDate` (Task 3), `mauritiusToday`.
- Produces these HTTP contracts (consumed by Task 6):
  - `GET /admin/feed-posts/pool` →
    `{ pushed_at: string | null, products: Array<{ id: string, title: string, ref: string | null, thumbnail: string | null, status: string, scheduled_date: string | null }> }`
  - `GET /admin/feed-posts/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` →
    `{ feed_posts: Array<{ id, post_date, product_id, status, image_urls, product_snapshot }> }`
  - `POST /admin/feed-posts/plan` body `{ date, product_id }` → `{ ok: true, feed_post }` or `{ ok: false, reason }` (status 409 posted, 422 past/not_published/no_images, 400 bad input)
  - `DELETE /admin/feed-posts/plan` body `{ date }` → `{ ok: true, deleted: number }`

- [ ] **Step 1: Pool route**

Create `src/api/admin/feed-posts/pool/route.ts`:

```ts
import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { SOURCING_MODULE } from "../../../../modules/sourcing"
import type SourcingModuleService from "../../../../modules/sourcing/service"
import { FEED_POSTS_MODULE } from "../../../../modules/feed-posts"
import type FeedPostsModuleService from "../../../../modules/feed-posts/service"
import { mauritiusToday, addDaysToMauritiusDate } from "../../../../lib/mauritius-date"

type DraftItemRow = {
  ref: string | null
  published_product_id: string | null
  published_at: Date | string | null
}

/**
 * GET /admin/feed-posts/pool
 * Products from the most recent sourcing push (the draft order whose items have
 * the newest published_at), each annotated with their published status and
 * whether they're already planned on an upcoming day.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const sourcing = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
  const feed = req.scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const items = (await (sourcing as any).listDraftItems(
    { published_product_id: { $ne: null } },
    { take: 2000 },
  )) as DraftItemRow[]

  if (items.length === 0) {
    res.json({ pushed_at: null, products: [] })
    return
  }

  // Latest push = max published_at; group that day's items by their draft order
  // is overkill — take the items pushed within the same 6h window as the newest.
  const withTime = items
    .filter((i) => i.published_product_id && i.published_at)
    .map((i) => ({ ...i, t: new Date(i.published_at as string).getTime() }))
    .sort((a, b) => b.t - a.t)

  if (withTime.length === 0) {
    res.json({ pushed_at: null, products: [] })
    return
  }
  const newest = withTime[0].t
  const WINDOW_MS = 6 * 60 * 60 * 1000
  const latest = withTime.filter((i) => newest - i.t <= WINDOW_MS)
  const productIds = latest.map((i) => i.published_product_id as string)
  const refById = new Map(latest.map((i) => [i.published_product_id as string, i.ref]))

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "status", "thumbnail"],
    filters: { id: productIds },
  })

  // Upcoming planned rows → scheduled_date per product.
  const today = mauritiusToday()
  const horizon = addDaysToMauritiusDate(today, 120)
  const upcoming = await feed.listByDateRange(today, horizon)
  const scheduledByProduct = new Map<string, string>()
  for (const r of upcoming) {
    if (r.product_id && (r.status === "planned" || r.status === "posted")) {
      scheduledByProduct.set(r.product_id, r.post_date)
    }
  }

  const out = (products as Array<{ id: string; title: string; status: string; thumbnail: string | null }>).map(
    (p) => ({
      id: p.id,
      title: p.title,
      ref: refById.get(p.id) ?? null,
      thumbnail: p.thumbnail ?? null,
      status: p.status,
      scheduled_date: scheduledByProduct.get(p.id) ?? null,
    }),
  )

  res.json({ pushed_at: new Date(newest).toISOString(), products: out })
}
```

- [ ] **Step 2: Calendar route**

Create `src/api/admin/feed-posts/calendar/route.ts`:

```ts
import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { FEED_POSTS_MODULE } from "../../../../modules/feed-posts"
import type FeedPostsModuleService from "../../../../modules/feed-posts/service"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** GET /admin/feed-posts/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const from = String(req.query.from ?? "")
  const to = String(req.query.to ?? "")
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    res.status(400).json({ ok: false, reason: "bad_range" })
    return
  }
  const feed = req.scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const feed_posts = await feed.listByDateRange(from, to)
  res.json({ feed_posts })
}
```

- [ ] **Step 3: Plan route (POST + DELETE)**

Create `src/api/admin/feed-posts/plan/route.ts`:

```ts
import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { FEED_POSTS_MODULE } from "../../../../modules/feed-posts"
import type FeedPostsModuleService from "../../../../modules/feed-posts/service"
import { mauritiusToday } from "../../../../lib/mauritius-date"
import { planFeedPostForDate } from "../../../../lib/feed-planner"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DEFAULT_DEDUP_DAYS = 30

/** POST /admin/feed-posts/plan { date, product_id } — schedule (no publish). */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as { date?: unknown; product_id?: unknown }
  const date = typeof body.date === "string" ? body.date : ""
  const productId = typeof body.product_id === "string" ? body.product_id : ""
  if (!DATE_RE.test(date) || !productId) {
    res.status(400).json({ ok: false, reason: "bad_input" })
    return
  }
  const dedupDays = Number(process.env.FEED_DEDUP_DAYS) || DEFAULT_DEDUP_DAYS
  const result = await planFeedPostForDate({
    scope: req.scope,
    postDate: date,
    productId,
    today: mauritiusToday(),
    dedupDays,
  })
  if (!result.ok) {
    const status =
      result.reason === "posted" ? 409 : result.reason === "past" ? 422 : 422
    res.status(status).json({ ok: false, reason: result.reason })
    return
  }
  res.json({ ok: true, feed_post: result.row })
}

/** DELETE /admin/feed-posts/plan { date } — unschedule (remove planned row). */
export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as { date?: unknown }
  const date = typeof body.date === "string" ? body.date : ""
  if (!DATE_RE.test(date)) {
    res.status(400).json({ ok: false, reason: "bad_input" })
    return
  }
  const feed = req.scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const deleted = await feed.deletePlannedByDate(date)
  res.json({ ok: true, deleted })
}
```

- [ ] **Step 4: Build**

Run: `yarn build`
Expected: build succeeds; routes compile.

- [ ] **Step 5: Manual smoke (dev server)**

Run: `yarn dev` (separate terminal). Log into `/app`. In the browser devtools
console (authenticated session), verify:

```js
await (await fetch("/admin/feed-posts/pool", { credentials: "include" })).json()
// → { pushed_at, products: [...] } with the latest push's products

await (await fetch("/admin/feed-posts/calendar?from=2026-06-01&to=2026-06-30", { credentials: "include" })).json()
// → { feed_posts: [...] }
```

Pick a published product id from the pool, a future date, then:

```js
await (await fetch("/admin/feed-posts/plan", {
  method: "POST", credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ date: "2026-07-15", product_id: "<published_id>" }),
})).json()
// → { ok: true, feed_post: { post_date: "2026-07-15", status: "planned", ... } }
```

Confirm a `planned` row exists, then unplan:

```js
await (await fetch("/admin/feed-posts/plan", {
  method: "DELETE", credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ date: "2026-07-15" }),
})).json()
// → { ok: true, deleted: 1 }
```

Also confirm a draft (not-live) product id returns `{ ok:false, reason:"not_published" }`.

- [ ] **Step 6: Commit**

```bash
git add src/api/admin/feed-posts/pool/route.ts src/api/admin/feed-posts/calendar/route.ts src/api/admin/feed-posts/plan/route.ts
git commit -m "feat(feed-posts): admin pool/calendar/plan endpoints for the planner"
```

---

## Task 6: Admin page — drag-and-drop month planner

**Files:**
- Create: `src/admin/routes/feed-planner/page.tsx`

**Interfaces:**
- Consumes: the four HTTP contracts from Task 5; `defineRouteConfig` from `@medusajs/admin-sdk`; `@medusajs/ui` (`Container`, `Heading`, `Text`, `Badge`, `Button`, `toast`); an icon from `@medusajs/icons` (e.g. `CalendarSolid`).

- [ ] **Step 1: Scaffold the route with data loading**

Create `src/admin/routes/feed-planner/page.tsx`. Native HTML5 DnD; month grid;
all fetches `credentials:"include"`. Full file:

```tsx
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { CalendarSolid } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { useCallback, useEffect, useMemo, useState } from "react"

type PoolProduct = {
  id: string
  title: string
  ref: string | null
  thumbnail: string | null
  status: string
  scheduled_date: string | null
}
type FeedPostRow = {
  id: string
  post_date: string
  product_id: string | null
  status: "planned" | "posted" | "failed" | "skipped"
  image_urls: string[] | null
  product_snapshot: { name?: string } | null
}

const pad = (n: number) => String(n).padStart(2, "0")
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}

function monthRange(year: number, month: number) {
  const from = ymd(year, month, 1)
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const to = ymd(year, month, last)
  return { from, to, last }
}

const FeedPlannerPage = () => {
  const now = new Date()
  const todayStr = ymd(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const [year, setYear] = useState(now.getUTCFullYear())
  const [month, setMonth] = useState(now.getUTCMonth()) // 0-based
  const [pool, setPool] = useState<PoolProduct[]>([])
  const [pushedAt, setPushedAt] = useState<string | null>(null)
  const [rowsByDate, setRowsByDate] = useState<Record<string, FeedPostRow>>({})
  const [loading, setLoading] = useState(true)

  const { from, to, last } = useMemo(() => monthRange(year, month), [year, month])

  const loadPool = useCallback(async () => {
    const { ok, json } = await api("/admin/feed-posts/pool")
    if (ok) {
      setPool(json.products ?? [])
      setPushedAt(json.pushed_at ?? null)
    }
  }, [])

  const loadCalendar = useCallback(async () => {
    const { ok, json } = await api(
      `/admin/feed-posts/calendar?from=${from}&to=${to}`,
    )
    if (ok) {
      const map: Record<string, FeedPostRow> = {}
      for (const r of json.feed_posts as FeedPostRow[]) map[r.post_date] = r
      setRowsByDate(map)
    }
  }, [from, to])

  useEffect(() => {
    setLoading(true)
    Promise.all([loadPool(), loadCalendar()]).finally(() => setLoading(false))
  }, [loadPool, loadCalendar])

  const plan = async (date: string, productId: string) => {
    const { ok, json } = await api("/admin/feed-posts/plan", {
      method: "POST",
      body: JSON.stringify({ date, product_id: productId }),
    })
    if (!ok) {
      const reason = json?.reason ?? "error"
      toast.error(
        reason === "not_published"
          ? "That product isn't live yet — Go Live first."
          : reason === "past"
            ? "Can't schedule a past day."
            : reason === "posted"
              ? "That day is already posted."
              : "Could not schedule.",
      )
      return
    }
    toast.success("Scheduled.")
    await Promise.all([loadPool(), loadCalendar()])
  }

  const unplan = async (date: string) => {
    const { ok } = await api("/admin/feed-posts/plan", {
      method: "DELETE",
      body: JSON.stringify({ date }),
    })
    if (!ok) {
      toast.error("Could not unschedule.")
      return
    }
    toast.success("Unscheduled.")
    await Promise.all([loadPool(), loadCalendar()])
  }

  const onDropDay = (date: string) => (e: React.DragEvent) => {
    e.preventDefault()
    const productId = e.dataTransfer.getData("text/plain")
    if (productId) void plan(date, productId)
  }

  const prevMonth = () => {
    const d = new Date(Date.UTC(year, month - 1, 1))
    setYear(d.getUTCFullYear())
    setMonth(d.getUTCMonth())
  }
  const nextMonth = () => {
    const d = new Date(Date.UTC(year, month + 1, 1))
    setYear(d.getUTCFullYear())
    setMonth(d.getUTCMonth())
  }

  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay() // 0=Sun
  const cells: Array<number | null> = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: last }, (_, i) => i + 1),
  ]
  const monthLabel = new Date(Date.UTC(year, month, 1)).toLocaleString("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <Heading level="h1">Feed Planner</Heading>
        <Text className="text-ui-fg-subtle" size="small">
          {pushedAt
            ? `Latest push: ${new Date(pushedAt).toLocaleDateString()}`
            : "No recent push"}
        </Text>
      </div>

      <div className="grid grid-cols-[280px_1fr] gap-4 p-6">
        {/* Pool */}
        <div className="flex flex-col gap-2">
          <Heading level="h3">Latest import</Heading>
          {pool.length === 0 && !loading && (
            <Text size="small" className="text-ui-fg-subtle">
              No products in the latest push.
            </Text>
          )}
          {pool.map((p) => {
            const live = p.status === "published"
            return (
              <div
                key={p.id}
                draggable={live}
                onDragStart={(e) => e.dataTransfer.setData("text/plain", p.id)}
                className={`flex gap-2 items-center rounded-lg border p-2 ${
                  live ? "cursor-grab bg-ui-bg-base" : "opacity-50 bg-ui-bg-disabled"
                }`}
                title={live ? "Drag onto a day" : "Not live — Go Live first"}
              >
                {p.thumbnail ? (
                  <img src={p.thumbnail} alt="" className="w-10 h-10 rounded object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded bg-ui-bg-component" />
                )}
                <div className="min-w-0 flex-1">
                  <Text size="small" weight="plus" className="truncate">
                    {p.title}
                  </Text>
                  <div className="flex gap-1 items-center">
                    {p.ref && <Text size="xsmall" className="text-ui-fg-subtle">{p.ref}</Text>}
                    {!live && <Badge size="2xsmall" color="orange">draft</Badge>}
                    {p.scheduled_date && (
                      <Badge size="2xsmall" color="green">{p.scheduled_date.slice(5)}</Badge>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Calendar */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Button variant="secondary" size="small" onClick={prevMonth}>‹</Button>
            <Heading level="h3">{monthLabel}</Heading>
            <Button variant="secondary" size="small" onClick={nextMonth}>›</Button>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <Text key={d} size="xsmall" className="text-ui-fg-subtle text-center">{d}</Text>
            ))}
            {cells.map((day, idx) => {
              if (day === null) return <div key={`e${idx}`} />
              const date = ymd(year, month, day)
              const row = rowsByDate[date]
              const isPast = date < todayStr
              const isPosted = row?.status === "posted"
              const name = row?.product_snapshot?.name ?? row?.product_id ?? ""
              return (
                <div
                  key={date}
                  onDragOver={(e) => !isPast && !isPosted && e.preventDefault()}
                  onDrop={!isPast && !isPosted ? onDropDay(date) : undefined}
                  className={`min-h-[84px] rounded-lg border p-1 flex flex-col ${
                    isPast ? "bg-ui-bg-disabled opacity-60" : "bg-ui-bg-subtle"
                  } ${date === todayStr ? "border-ui-fg-interactive" : ""}`}
                >
                  <Text size="xsmall" className="text-ui-fg-subtle">{day}</Text>
                  {row ? (
                    <div className="mt-1 flex-1 rounded bg-ui-bg-base p-1">
                      <Text size="xsmall" weight="plus" className="truncate">{name}</Text>
                      <Badge size="2xsmall" color={isPosted ? "green" : "blue"}>
                        {row.status}
                      </Badge>
                      {!isPosted && !isPast && (
                        <Button
                          variant="transparent"
                          size="small"
                          onClick={() => void unplan(date)}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  ) : (
                    !isPast && (
                      <Text size="xsmall" className="text-ui-fg-muted mt-auto">auto</Text>
                    )
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Feed Planner",
  icon: CalendarSolid,
})

export default FeedPlannerPage
```

- [ ] **Step 2: Build the admin bundle**

Run: `yarn build`
Expected: build succeeds; the route is bundled (Medusa picks up `src/admin/routes/**/page.tsx`).

- [ ] **Step 3: Manual verification in the admin**

Run: `yarn dev`. Open `/app`, click **Feed Planner** in the sidebar.
- Left shows the latest-push products; draft ones are dimmed and not draggable.
- Drag a live product onto a future day → cell shows it as `planned`, toast "Scheduled.", and the product gets a green date badge in the pool.
- Click **Remove** on a planned day → cell reverts to "auto", toast "Unscheduled."
- Prev/next month navigates and reloads rows.
- Past days are dimmed and reject drops.

- [ ] **Step 4: Commit**

```bash
git add src/admin/routes/feed-planner/page.tsx
git commit -m "feat(admin): Feed Planner drag-and-drop scheduling page"
```

---

## Final verification

- [ ] Run unit + module tests: `yarn test:unit && yarn test:integration:modules`
- [ ] `yarn build` clean.
- [ ] Manual end-to-end: plan a product for tomorrow in the UI; confirm a `planned` FeedPost row in the DB; (optional) temporarily set tomorrow as today / use the existing publish-now path to confirm the planned row publishes rather than being skipped.
- [ ] Confirm empty days still auto-pick (cron decision unit tests + reading `daily-feed-post.ts`).
