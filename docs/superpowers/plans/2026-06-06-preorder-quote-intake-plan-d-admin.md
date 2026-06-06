# Pre-order Quote Intake — Plan D: Admin Requests Surface

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the admin `/preorder/requests` page where the owner sees all client quote requests and resolves the `needs_manual` ones (which, given SHEIN's 909 captcha blocks auto-scrape, is currently EVERY request) by typing the SHEIN USD price → live all-in MUR → push the quote to the client.

**Architecture:** Backend adds a `listQuoteRequests` service method + two admin-authed HTTP routes (list, manual-quote) in `dollup-medusa`. Frontend adds a `/preorder/requests` page + a "Requests" tab in `dollup-admin`, cloning the existing `preorder/orders` page pattern exactly (server component + `lib/admin-preorder-*` data layer + `"use server"` actions + client component for interactivity).

**Tech Stack:** Medusa v2 admin routes (`AuthenticatedMedusaRequest`), Next.js 16 App Router + React 19 (dollup-admin), server actions, the repos' existing design tokens.

**Spec:** `docs/superpowers/specs/2026-06-06-preorder-quote-intake-design.md` (§7)
**Depends on:** Plan A (service methods `getQuoteRequest`, `setManualQuote`, `previewPrice` — shipped) + Plan B (the daemon — shipped; D resolves what it routes to `needs_manual`). Why D before C: with auto-scrape blocked by 909, the admin manual-quote path is the PRIMARY way quotes happen, not a fallback.

> **Two repos.** Tasks 1–4 are in `Backend/dollup-medusa`. Tasks 5–10 are in `dollup-admin`. They ship as two commits-streams; the admin UI calls the backend routes. Build backend first.

---

## File Structure

**Backend (`dollup-medusa`):**
- Modify: `src/modules/preorder/service.ts` — add `listQuoteRequests({status?, limit?})`
- Create: `src/api/admin/preorder/requests/route.ts` — `GET` list (admin-authed)
- Create: `src/api/admin/preorder/requests/[id]/route.ts` — `GET` one request + items (admin-authed)
- Create: `src/api/admin/preorder/requests/[id]/items/[itemId]/manual-quote/route.ts` — `POST` set manual quote

**Frontend (`dollup-admin`):**
- Create: `src/lib/admin-preorder-requests.ts` — data layer (`listQuoteRequests`, `getQuoteRequest` via SDK)
- Modify: `src/app/(app)/preorder/layout.tsx` — add "Requests" tab
- Create: `src/app/(app)/preorder/requests/page.tsx` — server component (fetch + group by status)
- Create: `src/app/(app)/preorder/requests/PreorderRequestsClient.tsx` — master-detail UI
- Create: `src/app/(app)/preorder/requests/actions.ts` — `"use server"` setManualQuote action

> **Conventions:** admin routes use `AuthenticatedMedusaRequest` (real admin auth, NOT the bookmarklet token — the quote-jobs routes use the token because the daemon isn't a logged-in admin; these pages ARE). Mirror `src/api/admin/preorder/products/route.ts` for the admin-auth route shape. Frontend mirrors `preorder/orders/` exactly (page + client + actions + lib).
>
> **⚠️ DESIGN TOKENS — dollup-admin has NO `sage-*` palette** (that's the preorder *storefront*). The admin palette is `coral-{300..900}`, `blush-{100..400}`, `cream-{50,100}`, `ink`/`ink-muted`, plus semantic `success-{50,500,700}` (green), `danger-{50,500,700}` (red), `info-{50,500,700}`. The code blocks below were drafted with `sage-*` — **the implementer MUST substitute before writing**: `sage-700`→`success-700`, `sage-100`→`success-50`, `bg-sage-700`(buttons/CTAs)→`bg-coral-700` with `text-cream-50`, quoted-price green text→`text-success-700`. Verify each class exists in `dollup-admin/src/app/globals.css` (it defines tokens as `--color-*`); if a class doesn't resolve, pick the nearest admin token. Match the existing `preorder/orders/PreorderOrdersClient.tsx` for the real class vocabulary.

---

### Task 1: Backend — `listQuoteRequests` service method

**Files:**
- Modify: `src/modules/preorder/service.ts`

- [ ] **Step 1: Add the method**

After `getQuoteRequest` in the class, add:

```ts
  /** Admin list: requests, newest first, optionally filtered by status. */
  async listQuoteRequests(
    opts: { status?: string | string[]; limit?: number } = {},
  ): Promise<any[]> {
    const filters: Record<string, unknown> = {}
    if (opts.status) filters.status = opts.status
    return (this as any).listPreorderQuoteRequests(filters, {
      take: opts.limit ?? 200,
      order: { created_at: "DESC" },
    })
  }
```

- [ ] **Step 2: Type-check + commit**

Run: `yarn tsc --noEmit 2>&1 | grep "service.ts" | grep -iv "chat|stories" || echo "ok"` → `ok`.

```bash
git add src/modules/preorder/service.ts
git commit -m "feat(preorder): listQuoteRequests service method for admin"
```

---

### Task 2: Backend — admin list route

**Files:**
- Create: `src/api/admin/preorder/requests/route.ts`

- [ ] **Step 1: Write the route**

Mirror `src/api/admin/preorder/products/route.ts` for the admin-auth shape (it uses `AuthenticatedMedusaRequest` — Medusa's admin middleware enforces the session, no manual token check needed). Create `src/api/admin/preorder/requests/route.ts`:

```ts
import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { PREORDER_MODULE } from "../../../../modules/preorder"
import type PreorderModuleService from "../../../../modules/preorder/service"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  const status = req.query?.status as string | undefined
  const requests = await svc.listQuoteRequests(status ? { status } : {})
  res.json({ requests })
}
```

- [ ] **Step 2: Type-check + commit**

Run: `yarn tsc --noEmit 2>&1 | grep "requests/route" || echo "ok"` → `ok`.

```bash
git add src/api/admin/preorder/requests/route.ts
git commit -m "feat(preorder): admin route to list quote requests"
```

---

### Task 3: Backend — admin single-request route

**Files:**
- Create: `src/api/admin/preorder/requests/[id]/route.ts`

- [ ] **Step 1: Write the route**

Create `src/api/admin/preorder/requests/[id]/route.ts` (depth: `requests/[id]/` is one deeper than `requests/` → five `../`):

```ts
import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { PREORDER_MODULE } from "../../../../../modules/preorder"
import type PreorderModuleService from "../../../../../modules/preorder/service"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  try {
    const request = await svc.getQuoteRequest(req.params.id, { withItems: true })
    res.json({ request })
  } catch {
    res.status(404).json({ message: "request not found" })
  }
}
```

> `../` depth: this file is `src/api/admin/preorder/requests/[id]/route.ts`. Count up to `src/`: `[id]`→requests→preorder→admin→api = 5 ups, then `modules/preorder`. So **five** `../` as written above. (Don't mirror the products `[id]` route — it imports a core workflow, not the module, so its import count differs.)

- [ ] **Step 2: Type-check + commit**

Run: `yarn tsc --noEmit 2>&1 | grep "requests/\[id\]" || echo "ok"` → `ok`.

```bash
git add "src/api/admin/preorder/requests/[id]/route.ts"
git commit -m "feat(preorder): admin route to fetch one quote request with items"
```

---

### Task 4: Backend — manual-quote route

**Files:**
- Create: `src/api/admin/preorder/requests/[id]/items/[itemId]/manual-quote/route.ts`

- [ ] **Step 1: Write the route**

Create the file (deep path — count the `../` carefully: `requests/[id]/items/[itemId]/manual-quote/route.ts` is 5 segments below `api/admin/preorder`, and `modules/preorder` is reached from `src/api/.../route.ts`. The `price-preview` route at `admin/preorder/price-preview/` uses 4 `../`; this file is 4 segments deeper, so 4+4 = EIGHT `../`. VERIFY by counting to `src/`):

```ts
import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { PREORDER_MODULE } from "../../../../../../../../modules/preorder"
import type PreorderModuleService from "../../../../../../../../modules/preorder/service"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  const body = (req.body ?? {}) as { priceUsd?: unknown }
  const priceUsd =
    typeof body.priceUsd === "number" ? body.priceUsd : Number(body.priceUsd)
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    res.status(400).json({ message: "priceUsd must be a positive number" })
    return
  }
  try {
    await svc.setManualQuote(req.params.itemId, { priceUsd })
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ message: (err as Error)?.message ?? "failed" })
  }
}
```

- [ ] **Step 2: Type-check**

Run: `yarn tsc --noEmit 2>&1 | grep "manual-quote" || echo "ok"` → `ok`.
If it reports "Cannot find module", the `../` count is wrong — adjust until clean. (Count: from `manual-quote/` go up through `[itemId]`, `items`, `[id]`, `requests`, `preorder`, `admin`, `api` = 8 ups to reach `src/`, then `modules/preorder`.)

- [ ] **Step 3: Commit + push backend**

```bash
git add "src/api/admin/preorder/requests"
git commit -m "feat(preorder): admin route to set manual quote on an item"
git push origin master
```

> Backend ships first so the admin UI (next tasks) can call live routes. Coolify auto-deploys.

---

### Task 5: Frontend — data layer

**Files:**
- Create: `src/lib/admin-preorder-requests.ts` (in `dollup-admin`)

> **Switch repos: all remaining tasks are in `c:/Users/rahvi/projects/DOLL UP BOUTIQUE/dollup-admin`.**

- [ ] **Step 1: Write the data layer**

Mirror `src/lib/admin-preorder-orders.ts`. Create `src/lib/admin-preorder-requests.ts`:

```ts
import "server-only";
import { getAdminSdk } from "./medusa-admin";

export type QuoteItem = {
  id: string;
  position: number;
  shein_url: string;
  status: string;
  scraped_title: string | null;
  scraped_thumbnail: string | null;
  scraped_price_usd: number | null;
  all_in_price_mur: number | null;
  selected_size: string | null;
  last_error_kind: string | null;
};

export type QuoteRequest = {
  id: string;
  contact: { whatsapp?: string; name?: string } | null;
  status: string;
  items_count: number;
  created_at: string;
  expires_at: string | null;
  items?: QuoteItem[];
};

export async function listQuoteRequests(): Promise<QuoteRequest[]> {
  const sdk = await getAdminSdk();
  const r = await sdk.client.fetch<{ requests: QuoteRequest[] }>(
    "/admin/preorder/requests",
    { method: "GET" },
  );
  return r.requests ?? [];
}

export async function getQuoteRequest(id: string): Promise<QuoteRequest | null> {
  const sdk = await getAdminSdk();
  const r = await sdk.client.fetch<{ request: QuoteRequest }>(
    `/admin/preorder/requests/${id}`,
    { method: "GET" },
  );
  return r.request ?? null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/admin-preorder-requests.ts
git commit -m "feat(preorder): admin data layer for quote requests"
```

---

### Task 6: Frontend — "Requests" tab in the preorder layout

**Files:**
- Modify: `src/app/(app)/preorder/layout.tsx`

- [ ] **Step 1: Add the tab**

In the `TABS` array, add a Requests entry:

```ts
const TABS = [
  { href: "/preorder", label: "Products" },
  { href: "/preorder/requests", label: "Requests" },
  { href: "/preorder/orders", label: "Orders" },
] as const;
```

And update `isActive` so Requests is matched and Products doesn't claim it:

```ts
  function isActive(href: string): boolean {
    if (href === "/preorder/orders") return pathname.startsWith("/preorder/orders");
    if (href === "/preorder/requests") return pathname.startsWith("/preorder/requests");
    // Products tab: active on /preorder and /preorder/new only
    return (
      !pathname.startsWith("/preorder/orders") &&
      !pathname.startsWith("/preorder/requests")
    );
  }
```

- [ ] **Step 2: Commit**

```bash
git add "src/app/(app)/preorder/layout.tsx"
git commit -m "feat(preorder): add Requests tab to preorder admin nav"
```

---

### Task 7: Frontend — manual-quote server action

**Files:**
- Create: `src/app/(app)/preorder/requests/actions.ts`

- [ ] **Step 1: Write the action**

Mirror `src/app/(app)/preorder/orders/actions.ts` (auth guard + SDK fetch + revalidate). Create `src/app/(app)/preorder/requests/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  verifySessionToken,
} from "@/lib/admin-session";
import { getAdminSdk } from "@/lib/medusa-admin";

async function requireAdmin(): Promise<boolean> {
  const store = await cookies();
  const token = store.get(ADMIN_SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}

export type SetManualQuoteResponse = { ok: true } | { ok: false; error: string };

export async function setManualQuote(
  requestId: string,
  itemId: string,
  priceUsd: number,
): Promise<SetManualQuoteResponse> {
  if (!(await requireAdmin())) return { ok: false, error: "Unauthorized" };
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    return { ok: false, error: "Enter a USD price greater than 0" };
  }
  try {
    const sdk = await getAdminSdk();
    await sdk.client.fetch(
      `/admin/preorder/requests/${requestId}/items/${itemId}/manual-quote`,
      { method: "POST", body: { priceUsd } },
    );
    revalidatePath("/preorder/requests");
    return { ok: true };
  } catch (err) {
    const error =
      err instanceof Error && err.message ? err.message : "Failed to set quote";
    return { ok: false, error };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add "src/app/(app)/preorder/requests/actions.ts"
git commit -m "feat(preorder): admin setManualQuote server action"
```

---

### Task 8: Frontend — requests page (server component)

**Files:**
- Create: `src/app/(app)/preorder/requests/page.tsx`

- [ ] **Step 1: Write the page**

Mirror `preorder/orders/page.tsx` (force-dynamic, fetch, group by status, error + empty states). Create `src/app/(app)/preorder/requests/page.tsx`:

```tsx
import { listQuoteRequests, type QuoteRequest } from "@/lib/admin-preorder-requests";
import { PreorderRequestsClient } from "./PreorderRequestsClient";

export const dynamic = "force-dynamic";

function needsMe(r: QuoteRequest): boolean {
  return r.status === "needs_manual" || r.status === "partial";
}

export default async function PreorderRequestsPage() {
  let requests: QuoteRequest[] = [];
  let loadError: string | null = null;
  try {
    requests = await listQuoteRequests();
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Could not load quote requests";
  }

  const mine = requests.filter(needsMe);
  const reserved = requests.filter((r) => r.status === "reserved");

  return (
    <div className="space-y-5">
      <header>
        <h2 className="font-display text-xl">Quote requests</h2>
        <p className="mt-1 text-[12px] text-ink-muted">
          {requests.length} total · {mine.length} need a manual quote ·{" "}
          {reserved.length} reserved
        </p>
      </header>

      {loadError && (
        <div className="rounded-md border border-coral-500/40 bg-coral-300/30 px-3 py-2 text-[12px] text-coral-700">
          Could not load quote requests: {loadError}
        </div>
      )}

      {!loadError && requests.length === 0 ? (
        <div className="rounded-lg border border-dashed border-blush-400 bg-cream/40 p-10 text-center">
          <p className="font-display text-base text-ink-muted">
            No quote requests yet
          </p>
          <p className="mt-1 text-[12px] text-ink-muted">
            When a client pastes SHEIN links on /preorder/request, they appear here.
          </p>
        </div>
      ) : (
        <PreorderRequestsClient requests={requests} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "src/app/(app)/preorder/requests/page.tsx"
git commit -m "feat(preorder): admin quote-requests page"
```

---

### Task 9: Frontend — master-detail client component

**Files:**
- Create: `src/app/(app)/preorder/requests/PreorderRequestsClient.tsx`

- [ ] **Step 1: Write the client component**

Master-detail: left = request list (status chips), right = selected request's items with the inline manual-quote control. Uses the `getQuoteRequest` data fetch lazily? No — keep it simple: the list payload already includes top-level request fields; fetch item detail on select via a server action OR include items in the list. To avoid an extra round-trip, this component fetches one request's items on selection through a small client call to the `[id]` route via the SDK is NOT available client-side — so instead, pass a server action to load items. Simplest: add a `loadRequest` server action. Create the component:

```tsx
"use client";

import { useState, useTransition } from "react";
import type { QuoteRequest, QuoteItem } from "@/lib/admin-preorder-requests";
import { setManualQuote, loadRequestItems } from "./actions";

function waLink(whatsapp?: string): string | null {
  if (!whatsapp) return null;
  const digits = whatsapp.replace(/[^0-9]/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

export function PreorderRequestsClient({
  requests,
}: {
  requests: QuoteRequest[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    requests[0]?.id ?? null,
  );
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [loading, startLoad] = useTransition();

  function select(id: string) {
    setSelectedId(id);
    startLoad(async () => {
      const res = await loadRequestItems(id);
      setItems(res.ok ? res.items : []);
    });
  }

  // Load the first request's items on mount.
  if (selectedId && items.length === 0 && !loading) {
    // fire once
  }

  const selected = requests.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="grid grid-cols-[300px_1fr] gap-4">
      {/* LEFT: request list */}
      <div className="rounded-lg border border-blush-400 bg-white">
        {requests.map((r) => {
          const active = r.id === selectedId;
          return (
            <button
              key={r.id}
              onClick={() => select(r.id)}
              className={
                "block w-full border-b border-blush-400/50 px-3 py-2.5 text-left transition " +
                (active ? "bg-cream" : "hover:bg-cream/50")
              }
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-ink">
                  {r.contact?.name || r.contact?.whatsapp || "Unknown"}
                </span>
                <StatusChip status={r.status} />
              </div>
              <div className="mt-0.5 text-[11px] text-ink-muted">
                {r.items_count} item{r.items_count === 1 ? "" : "s"}
              </div>
            </button>
          );
        })}
      </div>

      {/* RIGHT: detail */}
      <div className="rounded-lg border border-blush-400 bg-white p-4">
        {!selected ? (
          <p className="text-[12px] text-ink-muted">Select a request.</p>
        ) : (
          <RequestDetail
            request={selected}
            items={items}
            loading={loading}
          />
        )}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    needs_manual: "bg-coral-300/40 text-coral-700",
    partial: "bg-coral-300/30 text-coral-700",
    quoted: "bg-sage-100 text-sage-700",
    reserved: "bg-blush-100 text-ink",
    pending: "bg-cream text-ink-muted",
    expired: "bg-cream text-ink-muted",
  };
  return (
    <span
      className={
        "rounded-full px-2 py-0.5 text-[10px] font-semibold " +
        (map[status] ?? "bg-cream text-ink-muted")
      }
    >
      {status.replace("_", " ")}
    </span>
  );
}

function RequestDetail({
  request,
  items,
  loading,
}: {
  request: QuoteRequest;
  items: QuoteItem[];
  loading: boolean;
}) {
  const wa = waLink(request.contact?.whatsapp);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-display text-base text-ink">
          {request.contact?.name || request.contact?.whatsapp || "Unknown"}
        </span>
        {wa && (
          <a
            href={wa}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] text-sage-700 hover:underline"
          >
            WhatsApp →
          </a>
        )}
      </div>
      {loading ? (
        <p className="text-[12px] text-ink-muted">Loading items…</p>
      ) : (
        items.map((it) => <ItemRow key={it.id} requestId={request.id} item={it} />)
      )}
    </div>
  );
}

function ItemRow({ requestId, item }: { requestId: string; item: QuoteItem }) {
  const [usd, setUsd] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const n = Number(usd);
    setError(null);
    startTransition(async () => {
      const res = await setManualQuote(requestId, item.id, n);
      if (!res.ok) setError(res.error);
    });
  }

  const quoted = item.status === "quoted" || item.status === "reserved";

  return (
    <div className="rounded-md border border-blush-400 p-3">
      <div className="flex items-start gap-3">
        {item.scraped_thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.scraped_thumbnail}
            alt=""
            className="h-14 w-11 flex-shrink-0 rounded object-cover"
          />
        ) : (
          <div className="h-14 w-11 flex-shrink-0 rounded bg-cream" />
        )}
        <div className="min-w-0 flex-1">
          <a
            href={item.shein_url}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-[12px] font-medium text-ink hover:underline"
          >
            {item.scraped_title || item.shein_url}
          </a>
          {quoted ? (
            <p className="mt-1 text-[12px] text-sage-700">
              Quoted Rs {item.all_in_price_mur?.toLocaleString("en-MU")}{" "}
              {item.scraped_price_usd ? `(from $${item.scraped_price_usd})` : ""}
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-ink-muted">SHEIN USD:</span>
              <input
                value={usd}
                onChange={(e) => setUsd(e.target.value)}
                inputMode="decimal"
                placeholder="22.50"
                className="w-20 rounded border border-blush-400 px-2 py-1 text-[12px]"
              />
              <button
                onClick={submit}
                disabled={pending || !usd}
                className="rounded-full bg-sage-700 px-3 py-1 text-[11px] font-semibold text-cream disabled:opacity-50"
              >
                {pending ? "Pushing…" : "Push quote"}
              </button>
              <a
                href={item.shein_url}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-sage-700 hover:underline"
              >
                Open in SHEIN
              </a>
            </div>
          )}
          {error && <p className="mt-1 text-[11px] text-coral-700">{error}</p>}
        </div>
      </div>
    </div>
  );
}
```

> NOTE: this references `loadRequestItems` — add it to `actions.ts` in the next step. The "fire once on mount" comment block is a placeholder — replace the lazy-load with a proper `useEffect` in Step 2's review, OR simpler: have the page pass the first request's items in already. Implementer: use a `useEffect(() => { select(requests[0].id) }, [])` to load the initial selection's items. Remove the dead "fire once" comment.

- [ ] **Step 2: Add `loadRequestItems` to actions.ts + fix initial load**

Append to `src/app/(app)/preorder/requests/actions.ts`:

```ts
import { getQuoteRequest } from "@/lib/admin-preorder-requests";
import type { QuoteItem } from "@/lib/admin-preorder-requests";

export type LoadItemsResponse =
  | { ok: true; items: QuoteItem[] }
  | { ok: false; items: []; error: string };

export async function loadRequestItems(
  requestId: string,
): Promise<LoadItemsResponse> {
  if (!(await requireAdmin())) return { ok: false, items: [], error: "Unauthorized" };
  try {
    const req = await getQuoteRequest(requestId);
    return { ok: true, items: req?.items ?? [] };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to load items";
    return { ok: false, items: [], error };
  }
}
```

In `PreorderRequestsClient.tsx`, replace the dead "fire once" comment with a real initial load:

```tsx
import { useEffect } from "react";
// ...inside the component, after the useState/useTransition declarations:
  useEffect(() => {
    if (requests[0]?.id) select(requests[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 3: Type-check + commit**

Run (in dollup-admin): `npx tsc --noEmit 2>&1 | grep -iE "requests" || echo "ok"` → `ok`.

```bash
git add "src/app/(app)/preorder/requests/PreorderRequestsClient.tsx" "src/app/(app)/preorder/requests/actions.ts"
git commit -m "feat(preorder): admin requests master-detail with inline manual quote"
```

---

### Task 10: Verify + push frontend

**Files:** none

- [ ] **Step 1: Type-check + build**

Run (in dollup-admin): `npx tsc --noEmit 2>&1 | grep -iv "node_modules" | head` (expect no errors in the new files) then `npm run build` (must compile).

- [ ] **Step 2: Manual browser smoke**

With the backend deployed (Task 4 pushed), run dollup-admin (`npm run dev`), log in, go to `/preorder/requests`. Since there are no real requests yet (Plan C builds the storefront), verify: the page loads, shows the empty state, the Requests tab is active/highlighted. (Full data smoke happens once Plan C can create a request — note this.)

- [ ] **Step 3: Commit (if build produced lockfile changes) + push**

```bash
git push origin master
```

Expected: admin UI on origin/master. Coolify auto-deploys dollup-admin.

---

## Self-Review Notes

- **Spec §7 (admin master-detail, status filters, per-item quoted-readonly vs needs_manual inline USD entry → push):** list w/ status chips (T8/T9), inline USD entry running `setManualQuote` → `pricing.ts` → push (T4 route + T7 action + T9 ItemRow). ✓
- **Admin auth:** routes use `AuthenticatedMedusaRequest` (T2-T4); frontend actions use `requireAdmin()` cookie guard (T7/T9). Two layers, both correct — NOT the bookmarklet token (that's the daemon's). ✓
- **"Open in SHEIN + extension" path (spec §7):** the ItemRow has an "Open in SHEIN" link; the bookmarklet extension already works on that page. Inline USD entry is the faster path; both present. ✓
- **Reuse:** clones `preorder/orders/` page+client+actions+lib pattern exactly; backend mirrors `admin/preorder/products` auth shape. `setManualQuote`/`getQuoteRequest`/`listQuoteRequests` are service methods (Plan A + T1). ✓
- **Why D before C:** noted in Goal — 909 makes manual quoting the primary path.
- **Deferred to Plan C (not gaps):** the storefront `/preorder/request` form + result cards + simulator + reserve→cart. D only handles the owner side.
- **Thumbnail:** uses plain `<img>` (not next/image) for SHEIN CDN hosts — matches the memory note about preorder thumbnails + the custom-loader 404 issue.
- **Placeholder scan:** the one risky spot (T9 "fire once" dead comment) is explicitly resolved in T9 Step 2 (useEffect). No TBD/TODO remain.
- **Type consistency:** `QuoteItem`/`QuoteRequest` (T5) used across page (T8), client (T9), actions (T7/T9). `setManualQuote(requestId, itemId, priceUsd)` signature consistent T7↔T9. Route param names `id`/`itemId` match the file structure `[id]/items/[itemId]`.
