# Feed Planner — drag-and-drop scheduling for daily feed posts

**Date:** 2026-06-27
**Repo:** `Backend/dollup-medusa` (Medusa v2.13.1)
**Status:** Approved design, pre-implementation

## Problem

The `feed-posts` module posts one product per day to IG/FB via a daily 18:00
Mauritius cron (`jobs/daily-feed-post.ts`). Product selection is fully
automatic (newest-collection weighting + 30-day dedup). There is no way for the
owner to visually decide which product posts on which day.

Goal: an admin page where the owner sees the products from the most recent
sourcing push and drags each onto a calendar day to schedule its feed post.

## Decisions (locked)

1. **Pool = most recent sourcing push.** The products created by the latest
   `pushDraftToMedusa` run — i.e. the draft order whose items have the newest
   `published_at`, returning those items' `published_product_id`s. No product
   schema change; `DraftItem` already carries `published_product_id` +
   `published_at`.
2. **Drop = plan, cron = publish.** Dropping a product on a day creates a
   `planned` FeedPost row for that date (full snapshot + carousel images +
   caption built at drop time). The existing daily cron publishes it at 18:00 MU.
3. **Empty days auto-fill.** A day with no planned row is auto-picked by the
   cron exactly as today. The board is an override layer, not a replacement.
4. **One post per day.** Matches the date-keyed `FeedPost` model.
5. **No new dependencies.** Native HTML5 drag-and-drop + `@medusajs/ui`.

## Architecture

### Required cron fix (`jobs/daily-feed-post.ts`)

Today the job calls `buildFeedPostForDate` (no `force`); if a row already exists
for the date with status `!= failed` it returns `{ok:false, reason:"exists"}`
and the job **logs "already has a feed post — skipping" and returns without
publishing**. That means a pre-planned row would never go out.

New behavior for the day's date:

- `planned` row exists → **publish it** (`publishFeedPostRow`), then Telegram.
- no row → auto-pick (`buildFeedPostForDate`) then publish (unchanged).
- `posted` row exists → skip (already done).
- `failed` row exists → retry publish of the existing row.
- `skipped` row exists → skip.

This keeps auto-fill (decision 3) and makes manual plans actually publish.

### Backend module/lib changes (`src/modules/feed-posts`, `src/lib`)

**Service (`service.ts`)**
- `listByDateRange(from, to)` — `listFeedPosts({ post_date: { $gte, $lte } })`.
- `deletePlannedByDate(date)` — delete rows where `post_date = date` AND
  `status = "planned"` (never touch `posted`/`failed`).

**Lib (`lib/feed-post-pipeline.ts`)**
- Reuse `buildFeedPostForDate({ scope, postDate, dedupDays, productId, force:true })`
  for the "plan" action: it already builds snapshot+images+caption and persists a
  `planned` row for a forced product, **without publishing**. The plan endpoint
  deletes any existing planned row for that date first (so re-dropping replaces),
  then calls it. Guard: if a `posted` row exists for that date, reject.

### API routes (`src/api/admin/feed-posts/`)

- `GET pool/route.ts` → `GET /admin/feed-posts/pool`
  Resolve sourcing service; find the draft order with the max item
  `published_at`; collect its items' `published_product_id`s; fetch those
  products (title, handle, thumbnail, ref) via `query.graph`. Cross-reference
  planned FeedPost rows so each product reports `scheduled_date | null`.
  Response: `{ push_id, pushed_at, products: [{ id, title, ref, thumbnail, scheduled_date }] }`.
- `GET calendar/route.ts` → `GET /admin/feed-posts/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD`
  Response: `{ feed_posts: FeedPostDTO[] }` in range.
- `POST plan/route.ts` → `POST /admin/feed-posts/plan` `{ date, product_id }`
  Validate `date` (`^\d{4}-\d{2}-\d{2}$`) and not in the past. If a `posted` row
  exists for `date` → 409. Delete existing `planned` row for `date`. Build the
  planned row (forced product, no publish). Response: the created `FeedPostDTO`.
- `DELETE plan/route.ts` → `DELETE /admin/feed-posts/plan` `{ date }`
  Remove the `planned` row for `date`. No-op if none / if `posted`.

(The existing `GET/POST /admin/feed-posts/route.ts` — list + publish-now — stays.)

### Admin page (`src/admin/routes/feed-planner/page.tsx`)

New sidebar route via `defineRouteConfig({ label: "Feed Planner", icon: ... })`.
Data fetched with the admin SDK fetch (authenticated, same-origin).

Layout (two columns, `@medusajs/ui` `Container`/`Heading`/`Badge`/`Button`/toast):

- **Left — Pool.** Cards for each product from `GET pool`: thumbnail, name, ref.
  `draggable`, sets `dataTransfer` product_id. Badge "Scheduled <date>" when
  `scheduled_date` set.
- **Right — Calendar.** Month grid (7-col), prev/next month nav, current month
  default, today highlighted. Each day cell is a drop target
  (`onDragOver`/`onDrop`):
  - planned → product thumbnail + name + remove ✕.
  - posted → product thumbnail, read-only, "Posted" badge.
  - empty future day → faint "auto" hint (cron will auto-pick).
  - past day → disabled.
  Drop → `POST plan`, optimistic cell update + success/error toast; on error,
  revert. Remove ✕ → `DELETE plan`.

State: pool list + calendar rows for the visible month, refetched on month nav.
A successful plan/unplan also updates the dropped product's `scheduled_date`
badge in the pool.

## Data flow

1. Page load → `GET pool` (latest push) + `GET calendar` (visible month).
2. Drag product card → drop on day cell → `POST plan {date, product_id}`.
3. Backend deletes existing planned row for that date, builds a fresh `planned`
   FeedPost (snapshot + images + caption), returns it. UI updates cell + badge.
4. 18:00 MU daily cron: for today, publishes the `planned` row if present, else
   auto-picks. Result pinged to Telegram (existing behavior).

## Error handling

- `POST plan` on a past date or a `posted` date → 4xx, toast, no cell change.
- Build failure (forced product not found / `no_images`) → 422, toast, revert.
- Pool empty (no pushed draft order) → friendly empty state on the left.
- All admin endpoints are `AuthenticatedMedusaRequest` (admin-only) like the
  existing feed-posts route.

## Testing

- **Unit (`lib/__tests__`)**: plan path builds a `planned` row for a forced
  product without publishing; re-dropping the same date replaces rather than
  duplicates; `posted` date is rejected.
- **Service**: `listByDateRange` and `deletePlannedByDate` filter by status/date
  correctly (only `planned` deleted).
- **Cron** (`daily-feed-post`): planned-row-exists path publishes the existing
  row; no-row path still auto-picks; posted path skips.
- **Manual**: drag in `/app/feed-planner`, confirm row in DB, confirm cron dry
  run publishes the planned product.

## Out of scope

- Per-post exact times (cron time is fixed 18:00 MU).
- Multiple posts per day.
- Editing caption/image order from the board (uses the auto-built content).
- A separate scheduler service.
