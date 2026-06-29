# Rapido Auto-Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click "Send to Rapido" button to the dollup-admin prep card (Home Delivery orders only) that creates a Rapido delivery, stores the Rapido order number + tracking on the Medusa order, and auto-updates delivery status via a signed webhook.

**Architecture:** Two services. **dollup-admin** owns the order→Rapido payload mapping (incl. COD math, which already lives on the prep card) and exposes a server action + button. The **Medusa backend** owns the Rapido API key + webhook secret: a thin `POST /admin/rapido/dispatch` route validates the payload, calls Rapido (with an idempotency key), and writes `rapido_*` to order metadata; a `POST /hooks/rapido` route verifies the HMAC signature and updates status. Each secret lives in exactly one service.

**Tech Stack:** Medusa v2 (custom API routes, `defineMiddlewares`, `express.raw`), `@medusajs/js-sdk` (admin client in dollup-admin), Next.js 16 App Router server actions, Node `crypto` for HMAC. Backend tests: **Jest** via `npm run test:unit` (files `src/**/__tests__/**/*.unit.spec.ts`, Jest globals — no import). Admin tests: **vitest** (added in Task 7).

## Global Constraints

- Rapido base URL: `https://wktlwrxxgnsirrkkkric.supabase.co/functions/v1/merchant-api` (from `RAPIDO_BASE_URL`).
- Auth header on every outbound call: `x-api-key: <RAPIDO_API_KEY>`.
- Idempotency header on create: `x-idempotency-key: <Medusa order.id>`.
- Webhook signature header: `X-Rapido-Signature: sha256=<hex>`, HMAC-SHA256 of the **raw** request body keyed by `RAPIDO_WEBHOOK_SECRET`.
- Secrets are **backend-only** (`RAPIDO_API_KEY`, `RAPIDO_WEBHOOK_SECRET`, `RAPIDO_BASE_URL`). Never imported into any client bundle.
- Button shows only when `order.metadata.delivery_method === "Home Delivery"`.
- `deliveryFeeBearer` is always `"merchant"`.
- COD: paid order → `0`; unpaid → `totalMur − depositMur − exchangeCreditMur` (floor at 0). "Paid" = NOT (`saleType === "unpaid"` OR (`saleType == null` AND `paymentStatus !== "captured"`)).
- `recipientPhone` must be exactly 8 digits after stripping non-digits, else dispatch is blocked before any network call.
- Single store — no `storeId` in the payload.
- Rapido money fields are whole Rupees (integers), matching `OrderRow`'s `*Mur` fields.
- Metadata keys written: `rapido_order_number`, `rapido_tracking`, `rapido_status`, `rapido_dispatched_at`, `rapido_fee_bearer`.
- Metadata writes MUST merge with existing metadata (Medusa replaces the whole object on update).
- Backend unit test files: `__tests__/<name>.unit.spec.ts`, use bare `describe`/`it`/`expect` (Jest globals — do NOT `import` them).

---

## File Structure

**Medusa backend (`Backend/dollup-medusa/`):**
- Create `src/modules/rapido/rapido-payload.ts` — shared `RapidoOrderPayload` type + `validateRapidoPayload()`.
- Create `src/modules/rapido/__tests__/rapido-payload.unit.spec.ts` — validator tests.
- Create `src/modules/rapido/verify-rapido-signature.ts` — HMAC verifier.
- Create `src/modules/rapido/__tests__/verify-rapido-signature.unit.spec.ts` — verifier tests.
- Create `src/modules/rapido/client.ts` — `RapidoClient` (outbound `createOrder`).
- Create `src/api/admin/rapido/dispatch/route.ts` — `POST` dispatch route.
- Create `src/api/hooks/rapido/route.ts` — `POST` webhook receiver.
- Modify `src/api/middlewares.ts` — add `/hooks/rapido` raw-body matcher.
- Modify `.env.template` — add the three `RAPIDO_*` names.

**dollup-admin (`dollup-admin/`):**
- Modify `package.json` + create `vitest.config.ts` — add vitest (Task 7).
- Create `src/lib/rapido-payload.ts` — **pure**: `RapidoOrderPayload` type + `buildRapidoPayload(order)` + `RapidoPayloadError`. No `server-only`, no I/O.
- Create `src/lib/rapido-payload.test.ts` — vitest tests for the builder.
- Create `src/lib/rapido-dispatch.ts` — `server-only`; `dispatchRapido()` calls the backend route.
- Modify `src/app/(app)/prep/actions.ts` — add `dispatchToRapidoAction`.
- Modify `src/app/(app)/prep/components/PrepOrderCard.tsx` — add button + status pill.

> **Why the admin split:** `buildRapidoPayload` must be unit-testable under vitest (plain Node), but `server-only` throws outside the Next runtime. Keeping the pure builder free of `server-only` and isolating the SDK call in `rapido-dispatch.ts` lets the money-sensitive COD math be tested without booting Next.

> **Duplicated `RapidoOrderPayload` type:** the two services don't share a package, so the shape is declared in both `src/lib/rapido-payload.ts` (admin) and `src/modules/rapido/rapido-payload.ts` (backend). They must stay structurally identical; the backend's `validateRapidoPayload` is the runtime guard against drift.

---

## Task 1: Backend — Rapido payload type + validator

**Files:**
- Create: `Backend/dollup-medusa/src/modules/rapido/rapido-payload.ts`
- Test: `Backend/dollup-medusa/src/modules/rapido/__tests__/rapido-payload.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type RapidoItem = { productName: string; unitPrice: number; quantity: number }`
  - `type RapidoOrderPayload = { recipientName: string; recipientPhone: string; deliveryAddress: string; zone: string; parcelCount: number; codAmount: number; deliveryFeeBearer: "merchant" | "customer"; externalOrderRef: string; items: RapidoItem[] }`
  - `function validateRapidoPayload(payload: unknown): { ok: true; value: RapidoOrderPayload } | { ok: false; error: string }`

- [ ] **Step 1: Write the failing test** (Jest globals — no import of `describe`/`it`/`expect`)

```ts
// src/modules/rapido/__tests__/rapido-payload.unit.spec.ts
import { validateRapidoPayload, type RapidoOrderPayload } from "../rapido-payload"

const valid: RapidoOrderPayload = {
  recipientName: "Jane Doe",
  recipientPhone: "58123456",
  deliveryAddress: "12 Royal Road",
  zone: "Quatre Bornes",
  parcelCount: 1,
  codAmount: 1500,
  deliveryFeeBearer: "merchant",
  externalOrderRef: "order_123",
  items: [{ productName: "Lip gloss", unitPrice: 350, quantity: 2 }],
}

describe("validateRapidoPayload", () => {
  it("accepts a well-formed payload", () => {
    expect(validateRapidoPayload(valid).ok).toBe(true)
  })
  it("rejects a phone that is not 8 digits", () => {
    expect(validateRapidoPayload({ ...valid, recipientPhone: "5812345" })).toEqual({
      ok: false,
      error: "recipientPhone must be 8 digits",
    })
  })
  it("rejects an empty zone", () => {
    expect(validateRapidoPayload({ ...valid, zone: "  " })).toEqual({
      ok: false,
      error: "zone is required",
    })
  })
  it("rejects a negative codAmount", () => {
    expect(validateRapidoPayload({ ...valid, codAmount: -5 })).toEqual({
      ok: false,
      error: "codAmount must be >= 0",
    })
  })
  it("rejects a non-object", () => {
    expect(validateRapidoPayload(null)).toEqual({
      ok: false,
      error: "payload must be an object",
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Backend/dollup-medusa && npm run test:unit -- src/modules/rapido`
Expected: FAIL — cannot find module `../rapido-payload`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/rapido/rapido-payload.ts
export type RapidoItem = {
  productName: string
  unitPrice: number
  quantity: number
}

export type RapidoOrderPayload = {
  recipientName: string
  recipientPhone: string
  deliveryAddress: string
  zone: string
  parcelCount: number
  codAmount: number
  deliveryFeeBearer: "merchant" | "customer"
  externalOrderRef: string
  items: RapidoItem[]
}

export function validateRapidoPayload(
  payload: unknown,
): { ok: true; value: RapidoOrderPayload } | { ok: false; error: string } {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, error: "payload must be an object" }
  }
  const p = payload as Record<string, unknown>
  if (typeof p.recipientName !== "string" || p.recipientName.trim() === "") {
    return { ok: false, error: "recipientName is required" }
  }
  if (typeof p.recipientPhone !== "string" || !/^\d{8}$/.test(p.recipientPhone)) {
    return { ok: false, error: "recipientPhone must be 8 digits" }
  }
  if (typeof p.deliveryAddress !== "string" || p.deliveryAddress.trim() === "") {
    return { ok: false, error: "deliveryAddress is required" }
  }
  if (typeof p.zone !== "string" || p.zone.trim() === "") {
    return { ok: false, error: "zone is required" }
  }
  if (typeof p.codAmount !== "number" || p.codAmount < 0) {
    return { ok: false, error: "codAmount must be >= 0" }
  }
  if (p.deliveryFeeBearer !== "merchant" && p.deliveryFeeBearer !== "customer") {
    return { ok: false, error: "deliveryFeeBearer is invalid" }
  }
  if (typeof p.externalOrderRef !== "string" || p.externalOrderRef.trim() === "") {
    return { ok: false, error: "externalOrderRef is required" }
  }
  if (!Array.isArray(p.items) || p.items.length === 0) {
    return { ok: false, error: "items must be a non-empty array" }
  }
  return { ok: true, value: p as unknown as RapidoOrderPayload }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Backend/dollup-medusa && npm run test:unit -- src/modules/rapido`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/rapido/rapido-payload.ts src/modules/rapido/__tests__/rapido-payload.unit.spec.ts
git commit -m "feat(rapido): payload type + validator"
```

---

## Task 2: Backend — webhook signature verifier

**Files:**
- Create: `Backend/dollup-medusa/src/modules/rapido/verify-rapido-signature.ts`
- Test: `Backend/dollup-medusa/src/modules/rapido/__tests__/verify-rapido-signature.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `function verifyRapidoSignature(rawBody: string | Buffer, signatureHeader: string | undefined, secret: string): boolean`

Mirrors `src/modules/chat/lib/verify-meta-signature.ts` (same `sha256=` prefix, constant-time compare).

- [ ] **Step 1: Write the failing test** (Jest globals — no import of `describe`/`it`/`expect`)

```ts
// src/modules/rapido/__tests__/verify-rapido-signature.unit.spec.ts
import crypto from "crypto"
import { verifyRapidoSignature } from "../verify-rapido-signature"

const secret = "test_secret"
const body = JSON.stringify({ orderNumber: "RPD-1", status: "DELIVERED" })
const goodSig =
  "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex")

describe("verifyRapidoSignature", () => {
  it("accepts a correct signature", () => {
    expect(verifyRapidoSignature(body, goodSig, secret)).toBe(true)
  })
  it("rejects a wrong signature", () => {
    expect(verifyRapidoSignature(body, "sha256=deadbeef", secret)).toBe(false)
  })
  it("rejects a missing header", () => {
    expect(verifyRapidoSignature(body, undefined, secret)).toBe(false)
  })
  it("rejects a header without the sha256= prefix", () => {
    expect(verifyRapidoSignature(body, "abc123", secret)).toBe(false)
  })
  it("rejects when secret is empty", () => {
    expect(verifyRapidoSignature(body, goodSig, "")).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Backend/dollup-medusa && npm run test:unit -- src/modules/rapido`
Expected: the new file FAILs — cannot find module `../verify-rapido-signature`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/rapido/verify-rapido-signature.ts
import crypto from "crypto"

/**
 * Verify Rapido's `X-Rapido-Signature` header (`sha256=<hex>`) against the
 * webhook signing secret. Operates on the RAW request body — never parsed JSON,
 * or the re-serialized bytes won't match Rapido's HMAC.
 */
export function verifyRapidoSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false
  if (!secret) return false

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex")
  const got = signatureHeader.slice("sha256=".length)
  if (got.length !== expected.length) return false

  try {
    return crypto.timingSafeEqual(
      Buffer.from(got, "hex"),
      Buffer.from(expected, "hex"),
    )
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Backend/dollup-medusa && npm run test:unit -- src/modules/rapido`
Expected: PASS (10 tests total across the two rapido spec files).

- [ ] **Step 5: Commit**

```bash
git add src/modules/rapido/verify-rapido-signature.ts src/modules/rapido/__tests__/verify-rapido-signature.unit.spec.ts
git commit -m "feat(rapido): webhook HMAC signature verifier"
```

---

## Task 3: Backend — RapidoClient (outbound create)

**Files:**
- Create: `Backend/dollup-medusa/src/modules/rapido/client.ts`

**Interfaces:**
- Consumes: `RapidoOrderPayload` from Task 1.
- Produces:
  - `type RapidoCreateResult = { orderNumber: string; status: string; trackingNumbers: string[]; warnings: string[] }`
  - `class RapidoClient { constructor(opts?: { apiKey?: string; baseUrl?: string }); createOrder(payload: RapidoOrderPayload, idempotencyKey: string): Promise<RapidoCreateResult> }`

No unit test — thin `fetch` wrapper, exercised end-to-end in Task 10. (Mocking `fetch` here would only test the mock.)

- [ ] **Step 1: Write the implementation**

```ts
// src/modules/rapido/client.ts
import type { RapidoOrderPayload } from "./rapido-payload"

export type RapidoCreateResult = {
  orderNumber: string
  status: string
  trackingNumbers: string[]
  warnings: string[]
}

const DEFAULT_BASE_URL =
  "https://wktlwrxxgnsirrkkkric.supabase.co/functions/v1/merchant-api"

export class RapidoClient {
  private apiKey: string
  private baseUrl: string

  constructor(opts?: { apiKey?: string; baseUrl?: string }) {
    this.apiKey = opts?.apiKey ?? process.env.RAPIDO_API_KEY ?? ""
    this.baseUrl = opts?.baseUrl ?? process.env.RAPIDO_BASE_URL ?? DEFAULT_BASE_URL
    if (!this.apiKey) throw new Error("RAPIDO_API_KEY is not set")
  }

  async createOrder(
    payload: RapidoOrderPayload,
    idempotencyKey: string,
  ): Promise<RapidoCreateResult> {
    const res = await fetch(`${this.baseUrl}/orders`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "x-idempotency-key": idempotencyKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    let json: unknown
    try {
      json = await res.json()
    } catch {
      throw new Error(`Rapido returned non-JSON (HTTP ${res.status})`)
    }

    const body = json as {
      success?: boolean
      error?: string
      data?: {
        orderNumber?: string
        status?: string
        trackingNumbers?: string[]
        warnings?: string[]
      }
    }

    if (!res.ok || !body.success || !body.data) {
      throw new Error(body.error || `Rapido create failed (HTTP ${res.status})`)
    }

    return {
      orderNumber: body.data.orderNumber ?? "",
      status: body.data.status ?? "READY_FOR_PICKUP",
      trackingNumbers: body.data.trackingNumbers ?? [],
      warnings: body.data.warnings ?? [],
    }
  }
}
```

- [ ] **Step 2: Type-check**

Run: `cd Backend/dollup-medusa && npx tsc --noEmit`
Expected: no new errors from `src/modules/rapido/client.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/rapido/client.ts
git commit -m "feat(rapido): outbound RapidoClient.createOrder"
```

---

## Task 4: Backend — `POST /admin/rapido/dispatch` route

**Files:**
- Create: `Backend/dollup-medusa/src/api/admin/rapido/dispatch/route.ts`

**Interfaces:**
- Consumes: `validateRapidoPayload` (Task 1), `RapidoClient` (Task 3).
- Produces: `POST /admin/rapido/dispatch` body `{ orderId: string, payload: RapidoOrderPayload }` → `200 { ok: true, orderNumber, status, trackingNumbers, warnings }` | `400/500/502 { ok: false, message }`.
- Writes order metadata: `rapido_order_number`, `rapido_tracking`, `rapido_status`, `rapido_dispatched_at`, `rapido_fee_bearer`.

Follow the admin-route style in `src/api/admin/feed-posts/plan/route.ts` (typed `AuthenticatedMedusaRequest`, `res.status().json(...)`).

- [ ] **Step 1: Confirm the order-module method names for this Medusa version**

Run: `cd Backend/dollup-medusa && grep -rn "Modules.ORDER\|resolve(Modules.ORDER)\|retrieveOrder\|updateOrders" src/ | head`
Use whatever retrieve/update method the codebase already calls on the order module service. If none exists, check the installed `@medusajs` order module service typings. Do NOT invent method names. The implementation below assumes `retrieveOrder(id, { select })` and `updateOrders(id, { metadata })` — adjust to match the confirmed signatures, and use the SAME calls in Task 5.

- [ ] **Step 2: Write the implementation**

```ts
// src/api/admin/rapido/dispatch/route.ts
import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { validateRapidoPayload } from "../../../../modules/rapido/rapido-payload"
import { RapidoClient } from "../../../../modules/rapido/client"

/** POST /admin/rapido/dispatch { orderId, payload } */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as { orderId?: unknown; payload?: unknown }
  const orderId = typeof body.orderId === "string" ? body.orderId : ""
  if (!orderId) {
    res.status(400).json({ ok: false, message: "orderId is required" })
    return
  }
  const validation = validateRapidoPayload(body.payload)
  if (!validation.ok) {
    res.status(400).json({ ok: false, message: validation.error })
    return
  }

  const orderModule = req.scope.resolve(Modules.ORDER)

  let result
  try {
    result = await new RapidoClient().createOrder(validation.value, orderId)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Rapido dispatch failed"
    console.error("[admin/rapido/dispatch] Rapido call failed:", err)
    res.status(502).json({ ok: false, message })
    return
  }

  // Merge metadata — Medusa replaces the whole object on update.
  try {
    const order = await orderModule.retrieveOrder(orderId, {
      select: ["id", "metadata"],
    })
    const meta = { ...((order.metadata ?? {}) as Record<string, unknown>) }
    meta.rapido_order_number = result.orderNumber
    meta.rapido_tracking = result.trackingNumbers[0] ?? null
    meta.rapido_status = result.status
    meta.rapido_dispatched_at = new Date().toISOString()
    meta.rapido_fee_bearer = "merchant"
    await orderModule.updateOrders(orderId, { metadata: meta })
  } catch (err) {
    // Rapido order WAS created (idempotency key = orderId protects a retry).
    // Surface the persistence failure but report the order number so it's not lost.
    console.error("[admin/rapido/dispatch] metadata write failed:", err)
    res.status(500).json({
      ok: false,
      message: `Rapido order ${result.orderNumber} created but saving to the order failed — retry to re-sync.`,
    })
    return
  }

  res.json({
    ok: true,
    orderNumber: result.orderNumber,
    status: result.status,
    trackingNumbers: result.trackingNumbers,
    warnings: result.warnings,
  })
}
```

- [ ] **Step 3: Type-check + build**

Run: `cd Backend/dollup-medusa && npx tsc --noEmit && npm run build`
Expected: compiles; route registered.

- [ ] **Step 4: Commit**

```bash
git add src/api/admin/rapido/dispatch/route.ts
git commit -m "feat(rapido): admin dispatch route"
```

---

## Task 5: Backend — webhook route + middleware

**Files:**
- Create: `Backend/dollup-medusa/src/api/hooks/rapido/route.ts`
- Modify: `Backend/dollup-medusa/src/api/middlewares.ts`

**Interfaces:**
- Consumes: `verifyRapidoSignature` (Task 2).
- Produces: `POST /hooks/rapido` → `200 "ok"` accepted, `401 "bad signature"` bad HMAC. Reads `event.externalOrderRef` (= `order.id`), updates `rapido_status` + `rapido_tracking`.

- [ ] **Step 1: Add the raw-body matcher to middlewares.ts**

In `src/api/middlewares.ts`, add this entry to the `routes` array (copy the shape of the existing `/hooks/meta/*` entry; `raw` is already imported from `express`):

```ts
    {
      // Rapido webhook: HMAC over the raw body, so disable Medusa's JSON parser
      // and read the body as a Buffer (same reasoning as /hooks/meta/*).
      matcher: "/hooks/rapido",
      methods: ["POST"],
      bodyParser: false,
      middlewares: [raw({ type: "*/*", limit: "1mb" })],
    },
```

- [ ] **Step 2: Write the webhook route** (use the SAME order-module calls confirmed in Task 4)

```ts
// src/api/hooks/rapido/route.ts
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { verifyRapidoSignature } from "../../../modules/rapido/verify-rapido-signature"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const rawBody = req.body as Buffer
  const signature = req.headers["x-rapido-signature"] as string | undefined
  const secret = process.env.RAPIDO_WEBHOOK_SECRET || ""
  if (!verifyRapidoSignature(rawBody, signature, secret)) {
    res.status(401).send("bad signature")
    return
  }

  let event: {
    externalOrderRef?: string
    orderNumber?: string
    status?: string
    trackingNumber?: string
  }
  try {
    event = JSON.parse(rawBody.toString("utf8"))
  } catch {
    res.status(400).send("invalid json")
    return
  }

  const orderId = event.externalOrderRef
  if (!orderId || !event.status) {
    // Nothing actionable; ack so Rapido doesn't retry a malformed event forever.
    res.status(200).send("ignored")
    return
  }

  try {
    const orderModule = req.scope.resolve(Modules.ORDER)
    const order = await orderModule.retrieveOrder(orderId, {
      select: ["id", "metadata"],
    })
    const meta = { ...((order.metadata ?? {}) as Record<string, unknown>) }
    meta.rapido_status = event.status
    if (event.trackingNumber) meta.rapido_tracking = event.trackingNumber
    await orderModule.updateOrders(orderId, { metadata: meta })
  } catch (err) {
    console.error("[hooks/rapido] failed to apply event:", err)
    res.status(500).send("apply failed") // 500 → Rapido retries; status converges
    return
  }

  res.status(200).send("ok")
}
```

- [ ] **Step 3: Type-check + build**

Run: `cd Backend/dollup-medusa && npx tsc --noEmit && npm run build`
Expected: compiles, both routes registered.

- [ ] **Step 4: Commit**

```bash
git add src/api/hooks/rapido/route.ts src/api/middlewares.ts
git commit -m "feat(rapido): signed webhook receiver for status updates"
```

---

## Task 6: Backend — document env vars

**Files:**
- Modify: `Backend/dollup-medusa/.env.template`

- [ ] **Step 1: Append the Rapido vars (names only, no values)**

Add to the end of `.env.template`:

```
# Rapido delivery (Mauritius courier) — see docs/superpowers/specs/2026-06-29-rapido-dispatch-design.md
RAPIDO_API_KEY=
RAPIDO_WEBHOOK_SECRET=
RAPIDO_BASE_URL=https://wktlwrxxgnsirrkkkric.supabase.co/functions/v1/merchant-api
```

- [ ] **Step 2: Commit**

```bash
git add .env.template
git commit -m "docs(rapido): document RAPIDO_* env vars in template"
```

---

## Task 7: dollup-admin — add vitest

**Files:**
- Modify: `dollup-admin/package.json`
- Create: `dollup-admin/vitest.config.ts`

- [ ] **Step 1: Add vitest dev dependency**

Run: `cd dollup-admin && npm install -D vitest@^3`
Expected: `vitest` appears under `devDependencies`; `package-lock.json` updates.

- [ ] **Step 2: Add a test script**

In `dollup-admin/package.json`, add to `"scripts"`:

```json
    "test": "vitest run"
```

- [ ] **Step 3: Add a minimal vitest config (node env)**

```ts
// dollup-admin/vitest.config.ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
```

- [ ] **Step 4: Sanity-check the runner with a throwaway spec**

Create `dollup-admin/src/lib/_vitest-smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest"
describe("smoke", () => {
  it("runs", () => expect(1 + 1).toBe(2))
})
```

Run: `cd dollup-admin && npm test`
Expected: PASS (1 test). Then delete the smoke file: `rm src/lib/_vitest-smoke.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore(admin): add vitest for unit tests"
```

---

## Task 8: dollup-admin — payload builder (pure) + dispatch call

**Files:**
- Create: `dollup-admin/src/lib/rapido-payload.ts` (pure)
- Test: `dollup-admin/src/lib/rapido-payload.test.ts`
- Create: `dollup-admin/src/lib/rapido-dispatch.ts` (server-only)

**Interfaces:**
- Consumes: `OrderRow` (type-only) from `@/lib/admin-orders`; `getAdminSdk` from `@/lib/medusa-admin`.
- Produces:
  - `rapido-payload.ts`: `type RapidoOrderPayload`, `class RapidoPayloadError extends Error`, `function buildRapidoPayload(order: OrderRow): RapidoOrderPayload`.
  - `rapido-dispatch.ts`: `function dispatchRapido(orderId: string, payload: RapidoOrderPayload): Promise<{ orderNumber: string; status: string; trackingNumbers: string[]; warnings: string[] }>`.

COD/paid rule must match `PrepOrderCard`'s `isOrderPaid` + amount-due math exactly.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/rapido-payload.test.ts
import { describe, it, expect } from "vitest"
import { buildRapidoPayload, RapidoPayloadError } from "./rapido-payload"
import type { OrderRow } from "./admin-orders"

function makeOrder(over: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "order_1",
    displayId: 42,
    buyerName: "Jane Doe",
    phone: "5812 3456",
    city: "Quatre Bornes",
    addressDetails: "12 Royal Road",
    totalMur: 1500,
    depositMur: null,
    exchangeCreditMur: null,
    saleType: null,
    paymentStatus: "awaiting",
    deliveryMethod: "Home Delivery",
    items: [
      {
        id: "li_1",
        lineId: "li_1",
        variantId: null,
        sku: null,
        title: "Lip gloss",
        variantTitle: null,
        thumbnail: null,
        quantity: 2,
        qty: 2,
        unitPriceMur: 350,
      },
    ],
  } as unknown as OrderRow
  // NOTE: cast through unknown — OrderRow has many more fields irrelevant to the
  // payload. Merge `over` last:
}

describe("buildRapidoPayload", () => {
  it("maps a basic unpaid order, collecting the full total as COD", () => {
    const p = buildRapidoPayload({ ...makeOrder(), } as OrderRow)
    expect(p).toMatchObject({
      recipientName: "Jane Doe",
      recipientPhone: "58123456",
      deliveryAddress: "12 Royal Road",
      zone: "Quatre Bornes",
      parcelCount: 1,
      codAmount: 1500,
      deliveryFeeBearer: "merchant",
      externalOrderRef: "order_1",
      items: [{ productName: "Lip gloss", unitPrice: 350, quantity: 2 }],
    })
  })
  it("collects 0 COD when already paid", () => {
    expect(
      buildRapidoPayload({ ...makeOrder(), paymentStatus: "captured" } as OrderRow).codAmount,
    ).toBe(0)
  })
  it("subtracts deposit and exchange credit when unpaid", () => {
    expect(
      buildRapidoPayload({
        ...makeOrder(),
        depositMur: 200,
        exchangeCreditMur: 300,
      } as OrderRow).codAmount,
    ).toBe(1000)
  })
  it("treats sale_type 'unpaid' as unpaid even if payment captured", () => {
    expect(
      buildRapidoPayload({
        ...makeOrder(),
        saleType: "unpaid",
        paymentStatus: "captured",
      } as OrderRow).codAmount,
    ).toBe(1500)
  })
  it("throws when phone is not 8 digits", () => {
    expect(() =>
      buildRapidoPayload({ ...makeOrder(), phone: "5812345" } as OrderRow),
    ).toThrow(RapidoPayloadError)
  })
  it("throws when zone/city is missing", () => {
    expect(() =>
      buildRapidoPayload({ ...makeOrder(), city: null } as OrderRow),
    ).toThrow(RapidoPayloadError)
  })
})
```

> **Implementer note:** the `makeOrder` helper casts a partial through `unknown` to `OrderRow` because `OrderRow` has ~40 fields, none of the others affecting the payload. Keep the cast; do not enumerate every field.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dollup-admin && npm test -- src/lib/rapido-payload.test.ts`
Expected: FAIL — cannot find module `./rapido-payload`.

- [ ] **Step 3: Write the pure builder**

```ts
// src/lib/rapido-payload.ts
import type { OrderRow } from "./admin-orders"

export type RapidoItem = {
  productName: string
  unitPrice: number
  quantity: number
}

export type RapidoOrderPayload = {
  recipientName: string
  recipientPhone: string
  deliveryAddress: string
  zone: string
  parcelCount: number
  codAmount: number
  deliveryFeeBearer: "merchant" | "customer"
  externalOrderRef: string
  items: RapidoItem[]
}

export class RapidoPayloadError extends Error {}

/** Mirrors PrepOrderCard's isOrderPaid. */
function isOrderPaid(order: OrderRow): boolean {
  if (order.saleType === "unpaid") return false
  if (order.saleType == null && order.paymentStatus !== "captured") return false
  return true
}

export function buildRapidoPayload(order: OrderRow): RapidoOrderPayload {
  const phone = (order.phone ?? "").replace(/\D/g, "")
  if (!/^\d{8}$/.test(phone)) {
    throw new RapidoPayloadError(
      `Phone must be 8 digits (got "${order.phone ?? ""}")`,
    )
  }
  const zone = (order.city ?? "").trim()
  if (!zone) throw new RapidoPayloadError("Delivery zone (city/town) is missing")

  const credit = (order.depositMur ?? 0) + (order.exchangeCreditMur ?? 0)
  const codAmount = isOrderPaid(order) ? 0 : Math.max(0, order.totalMur - credit)

  const items: RapidoItem[] = order.items
    .filter((it) => !/^Delivery\b|^Delivery —/i.test(it.title))
    .map((it) => ({
      productName: it.title,
      unitPrice: it.unitPriceMur,
      quantity: it.quantity,
    }))

  return {
    recipientName: order.buyerName || "Customer",
    recipientPhone: phone,
    deliveryAddress: (order.addressDetails ?? order.city ?? "").trim(),
    zone,
    parcelCount: 1,
    codAmount,
    deliveryFeeBearer: "merchant",
    externalOrderRef: order.id,
    items,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dollup-admin && npm test -- src/lib/rapido-payload.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the server-only dispatch call**

```ts
// src/lib/rapido-dispatch.ts
import "server-only"
import { getAdminSdk } from "./medusa-admin"
import type { RapidoOrderPayload } from "./rapido-payload"

export async function dispatchRapido(
  orderId: string,
  payload: RapidoOrderPayload,
): Promise<{
  orderNumber: string
  status: string
  trackingNumbers: string[]
  warnings: string[]
}> {
  const sdk = await getAdminSdk()
  return sdk.client.fetch("/admin/rapido/dispatch", {
    method: "POST",
    body: { orderId, payload },
  })
}
```

- [ ] **Step 6: Type-check**

Run: `cd dollup-admin && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rapido-payload.ts src/lib/rapido-payload.test.ts src/lib/rapido-dispatch.ts
git commit -m "feat(rapido): admin payload builder + backend dispatch call"
```

---

## Task 9: dollup-admin — server action + prep card button

**Files:**
- Modify: `dollup-admin/src/app/(app)/prep/actions.ts`
- Modify: `dollup-admin/src/app/(app)/prep/components/PrepOrderCard.tsx`

**Interfaces:**
- Consumes: `buildRapidoPayload`, `RapidoPayloadError` (Task 8, `rapido-payload.ts`); `dispatchRapido` (Task 8, `rapido-dispatch.ts`); existing `requireAdmin`, `toError`, `ActionResult` (in `actions.ts`); `getOrdersByIds` (in `admin-orders.ts`); `OrderRow` (card already receives it, incl. `metadata`).
- Produces: `dispatchToRapidoAction(orderId: string): Promise<ActionResult & { data?: { orderNumber: string; status: string; warnings: string[] } }>`.

- [ ] **Step 1: Add the server action**

In `src/app/(app)/prep/actions.ts`, add imports:

```ts
import { getOrdersByIds } from "@/lib/admin-orders";
import { buildRapidoPayload, RapidoPayloadError } from "@/lib/rapido-payload";
import { dispatchRapido } from "@/lib/rapido-dispatch";
```

Add the action:

```ts
export async function dispatchToRapidoAction(
  orderId: string,
): Promise<ActionResult & { data?: { orderNumber: string; status: string; warnings: string[] } }> {
  try {
    await requireAdmin();
    const [order] = await getOrdersByIds([orderId]);
    if (!order) return { ok: false, error: "Order not found" };

    let payload;
    try {
      payload = buildRapidoPayload(order);
    } catch (err) {
      if (err instanceof RapidoPayloadError) return { ok: false, error: err.message };
      throw err;
    }

    const result = await dispatchRapido(orderId, payload);
    revalidatePath("/prep");
    return {
      ok: true,
      data: {
        orderNumber: result.orderNumber,
        status: result.status,
        warnings: result.warnings,
      },
    };
  } catch (err) {
    return toError("dispatchToRapidoAction", err);
  }
}
```

- [ ] **Step 2: Add the button + status to PrepOrderCard**

In `src/app/(app)/prep/components/PrepOrderCard.tsx`:

(a) Add to the existing action imports:

```ts
import { dispatchToRapidoAction } from "../actions";
```

(b) Inside the component, after the existing derived flags (e.g. after `const paid = ...`):

```ts
  const isHomeDelivery = order.deliveryMethod === "Home Delivery";
  const rapidoMeta = (order.metadata ?? {}) as Record<string, unknown>;
  const rapidoOrderNumber =
    typeof rapidoMeta.rapido_order_number === "string"
      ? rapidoMeta.rapido_order_number
      : null;
  const rapidoStatus =
    typeof rapidoMeta.rapido_status === "string" ? rapidoMeta.rapido_status : null;
  const [rapidoError, setRapidoError] = useState<string | null>(null);
  const [rapidoBusy, startRapido] = useTransition();

  function handleDispatchRapido() {
    setRapidoError(null);
    startRapido(async () => {
      const r = await dispatchToRapidoAction(order.id);
      if (!r.ok) {
        setRapidoError(r.error);
        return;
      }
      if (r.data?.warnings?.length) {
        setRapidoError("Sent with warnings: " + r.data.warnings.join("; "));
      }
    });
  }
```

(c) In the action row (`<div className="flex items-center gap-2">` holding print + ready), add — for Home Delivery only:

```tsx
        {isHomeDelivery &&
          (rapidoOrderNumber ? (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-coral-300 bg-coral-50 px-2 py-1 text-xs font-medium text-coral-800"
              title={`Rapido ${rapidoOrderNumber}`}
            >
              Rapido · {rapidoStatus ?? "SENT"}
            </span>
          ) : (
            <button
              type="button"
              onClick={handleDispatchRapido}
              disabled={rapidoBusy}
              className="inline-flex items-center justify-center rounded-md border border-coral-400 bg-white px-3 py-2 text-sm font-semibold text-coral-700 hover:bg-coral-50 disabled:opacity-50"
            >
              {rapidoBusy ? "Sending…" : "Send to Rapido"}
            </button>
          ))}
```

(d) Near the existing `{error && ...}` line, add:

```tsx
      {rapidoError && <p className="mb-2 text-sm text-red-700">{rapidoError}</p>}
```

> **Implementer note:** `OrderRow.metadata` is already in the prep-orders field list (confirmed), so `rapido_*` keys hydrate with no fetch change. Match the Tailwind tokens already used in this file (`coral-*`, `ink`, `cream`).

- [ ] **Step 3: Type-check + lint + build**

Run: `cd dollup-admin && npx tsc --noEmit && npm run lint && npm run build`
Expected: no new errors; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/prep/actions.ts" "src/app/(app)/prep/components/PrepOrderCard.tsx"
git commit -m "feat(rapido): Send to Rapido button + status on prep card"
```

---

## Task 10: End-to-end manual verification

**Prerequisites (owner-supplied):**
- `RAPIDO_API_KEY`, `RAPIDO_WEBHOOK_SECRET`, `RAPIDO_BASE_URL` set in the backend env (local `.env` and Coolify).
- Webhook URL `https://api.dollupboutique.com/hooks/rapido` registered in the Rapido dashboard (owner confirmed done).

- [ ] **Step 1: Pick a real Home Delivery order** in dollup-admin prep with a valid 8-digit phone and a town in `city`.

- [ ] **Step 2: Click "Send to Rapido."**
Expected: button → "Sending…" → replaced by a `Rapido · READY_FOR_PICKUP` pill. `metadata.rapido_order_number` is populated (verify in Medusa admin or DB).

- [ ] **Step 3: Verify idempotency.**
Re-send the same order via a direct API retry with the same `x-idempotency-key` — Rapido should not create a second delivery. (In the UI the button is already replaced by the pill.)

- [ ] **Step 4: Trigger a status change in Rapido** (mark picked up / delivered in their dashboard).
Expected: within seconds the prep card's pill reflects the new status after a refresh, and `metadata.rapido_status` updates. Backend logs show `[hooks/rapido]` with no `bad signature`.

- [ ] **Step 5: Negative check.**
Try an order with a malformed phone — the button click returns an inline error and never reaches Rapido.

- [ ] **Step 6: Update CLAUDE.md** with a one-line note that Home Delivery orders dispatch to Rapido (button on prep page; webhook `/hooks/rapido`). Commit.

```bash
git add CLAUDE.md
git commit -m "docs: note Rapido dispatch integration"
```

---

## Self-Review

**Spec coverage:**
- Manual button, Home Delivery only → Task 9. ✓
- Merchant fee bearer → Global Constraints + Tasks 4/8. ✓
- Auto COD (amount due) → Task 8 builder + tests. ✓
- Webhook receiver + signature → Tasks 2, 5. ✓
- Store Rapido order number/tracking/status in metadata → Tasks 4, 5. ✓
- Idempotency by order.id → Global Constraints + Tasks 3, 4. ✓
- Pre-flight phone/zone validation → Task 8 (throws) + Task 1 (backend guard). ✓
- Env backend-only + template → Task 6. ✓
- Single store, no storeId → Global Constraints + Task 8 (omitted). ✓
- Admin test infra → Task 7 (vitest). ✓

**Placeholder scan:** no TBD/TODO; every code step shows full code. Two version-specific unknowns (order-module method names) are explicit verification steps in Task 4 Step 1 with instructions to grep rather than guess.

**Type consistency:** `RapidoOrderPayload` identical across `src/modules/rapido/rapido-payload.ts` (backend) and `src/lib/rapido-payload.ts` (admin); backend `validateRapidoPayload` guards drift at runtime. `RapidoCreateResult` (Task 3) ↔ dispatch route response (Task 4) ↔ `dispatchRapido` return (Task 8) ↔ action `data` (Task 9) all use `{ orderNumber, status, trackingNumbers, warnings }`. Metadata keys (`rapido_order_number`, `rapido_tracking`, `rapido_status`, `rapido_dispatched_at`, `rapido_fee_bearer`) written in Tasks 4/5, read in Task 9 — consistent. Backend tests are Jest (`__tests__/*.unit.spec.ts`, no imports of test globals); admin tests are vitest (`*.test.ts`, explicit imports).
