# Rapido auto-dispatch — design

**Date:** 2026-06-29
**Status:** Approved (brainstorm) → ready for implementation plan

## Goal

Add a "Send to Rapido" button to the prep card in `dollup-admin` (Home Delivery
orders only), next to "Mark Ready". One click creates a Rapido delivery order,
stores the Rapido order number + tracking on the Medusa order, and the order's
live status (picked up → delivered) flows back automatically via a signed
webhook.

Rapido is a Mauritius delivery company. Its merchant API is a Supabase edge
function (`https://wktlwrxxgnsirrkkkric.supabase.co/functions/v1/merchant-api`),
authenticated with an `x-api-key` header.

## Decisions (locked)

- **Trigger:** manual button on the prep card. Not automatic on `order.placed` —
  fashion orders need a pack/verify step and a courier dispatch is hard to reverse.
- **Which orders:** `metadata.delivery_method === "Home Delivery"` only. Postage /
  Express / Rodrigues already ship by post with their own tracking flow; pickup is
  excluded.
- **Fee bearer:** `deliveryFeeBearer: "merchant"` (Doll Up absorbs the fee).
- **COD amount:** auto. Unpaid → amount still due (`total − deposit −
  exchangeCredit`); already-paid → `0`. No manual entry.
- **Webhook:** built now (status updates flow back into admin).
- **Code location:** the Rapido API key + webhook secret + outbound call + webhook
  receiver all live in the Medusa backend (`api.dollupboutique.com`). The
  **order→Rapido payload mapping (incl. COD math) lives in `dollup-admin`**, because
  `OrderRow` already carries every field and the prep card already computes the
  paid/deposit/exchange-credit logic. The backend `/admin/rapido/dispatch` route is
  **thin**: it receives a ready payload, adds the secret, calls Rapido, writes
  metadata. This keeps money-sensitive COD logic in one place (admin) and each
  secret in one service (backend).

### Rejected alternative

Re-derive the COD amount and full payload server-side in the backend (spec's
original Approach A). Rejected during planning: it duplicates the admin's
paid/deposit/exchange-credit rules in a second service, risking drift where the
card shows one COD figure and Rapido collects another.

## Components

### 1. Backend — `src/modules/rapido/`

- **`RapidoClient`** — thin `fetch` wrapper over the base URL. `createOrder(payload,
  idempotencyKey)` sends `x-api-key`, `x-idempotency-key`, `Content-Type:
  application/json`. Reads `RAPIDO_API_KEY`, `RAPIDO_BASE_URL`.
- **`verify-rapido-signature.ts`** — HMAC-SHA256 of the raw request body compared
  against the `X-Rapido-Signature` header (`sha256=<hex>`). Mirrors the existing
  `src/modules/chat/lib/verify-meta-signature.ts`.
- **`rapido-payload.ts`** — shared `RapidoOrderPayload` TypeScript type + a
  lightweight server-side validator (`recipientPhone` is 8 digits, `zone`
  non-empty, `codAmount >= 0`). The payload itself is *built in dollup-admin*; the
  backend only validates and forwards.

### 2. Backend — `POST /admin/rapido/dispatch`

- Body: `{ orderId: string, payload: RapidoOrderPayload }`.
- Validates the payload (`rapido-payload.ts`) → `400` on bad input.
- Calls Rapido with `x-idempotency-key: <orderId>` — safe to retry, no duplicate
  delivery.
- On success, read-modify-write the order's `metadata` (Medusa replaces metadata
  wholesale, so merge with existing):
  - `rapido_order_number` — e.g. `RPD-2026-000123`
  - `rapido_tracking` — first of `trackingNumbers[]`
  - `rapido_status` — `READY_FOR_PICKUP` initially
  - `rapido_dispatched_at` — ISO timestamp
  - `rapido_fee_bearer` — `"merchant"`
- Returns `{ orderNumber, status, trackingNumbers, warnings }`.

### 3. Backend — `POST /hooks/rapido` (raw-body route)

- Registered in `src/api/middlewares.ts` with `bodyParser: false` +
  `raw({ type: "*/*" })` so HMAC sees the raw bytes (same as the meta messenger
  hook).
- Verifies `X-Rapido-Signature` against `RAPIDO_WEBHOOK_SECRET` → `401` on mismatch.
- Looks up the order by `event.externalOrderRef` (= our `order.id`), updates
  `rapido_status` (and `rapido_tracking` if newly present). Returns `200` fast.

### 4. dollup-admin — payload builder, button + status

- **`buildRapidoPayload(order: OrderRow)`** pure function (new
  `src/lib/rapido-payload.ts`) → maps `OrderRow` to the Rapido payload, including
  COD (`isOrderPaid` ? 0 : `totalMur − depositMur − exchangeCreditMur`) and
  digits-only phone. Unit-testable, no I/O. Throws a typed error on invalid phone
  (≠ 8 digits) or missing zone so the action can surface it before any network call.
- **`dispatchToRapidoAction(orderId)`** server action in
  `src/app/(app)/prep/actions.ts` → loads the order, calls `buildRapidoPayload`,
  POSTs `{ orderId, payload }` to the backend route via `getAdminSdk().client.fetch`,
  then `revalidatePath("/prep")`. Returns the structured `ActionResult` shape
  already used in that file.
- **`PrepOrderCard`** — when `deliveryMethod === "Home Delivery"` and not yet
  dispatched (`!order.metadata.rapido_order_number`), show a **Send to Rapido**
  button. Once dispatched, show the Rapido order number + a status pill read from
  `order.metadata.rapido_status`. Surface any `warnings` returned by dispatch.
- `OrderRow` already exposes raw `metadata`, so no new fetch fields are needed for
  reading Rapido state.

## Field mapping (order → Rapido)

| Rapido field        | Source                                                        |
|---------------------|--------------------------------------------------------------|
| `recipientName`     | shipping name (`buyerName`)                                   |
| `recipientPhone`    | `phone`, digits-only, must be 8 digits                        |
| `deliveryAddress`   | `addressDetails` (`shipping_address.address_1`)              |
| `zone`              | `city` (village/town)                                        |
| `parcelCount`       | `1`                                                          |
| `codAmount`         | unpaid → `total − deposit − exchangeCredit`; paid → `0`      |
| `deliveryFeeBearer` | `"merchant"`                                                 |
| `externalOrderRef`  | `order.id` (echoed back in webhooks)                         |
| `items[]`           | line items → `{ productName, unitPrice, quantity }`; **`productName` is masked to `"Fashion item"` — the real title is never sent, to keep sensitive items (toys/intimates) off the courier side** |

COD "paid" rule reuses the prep card's `isOrderPaid` logic: paid unless
`saleType === "unpaid"` or (`saleType == null` and `payment_status !== "captured"`).

## Error handling

- **Pre-flight validation** (before calling Rapido): missing/invalid phone (≠ 8
  digits) or missing zone → block with a clear inline error on the card.
- **Rapido failure** (`{ success: false }` or non-2xx) → show `error` text on the
  card, write nothing to metadata, button stays available to retry.
- **Idempotency:** key = `order.id`. A retry after a network blip will not create a
  second delivery.
- **Webhook bad/missing signature** → `401`, no state change.
- Server actions return the structured `ActionResult` (`{ ok: false, error }`)
  pattern so staff see the real error (this app is staff-only).

## Env / secrets

New, **backend only** (never in storefront or admin client bundle):

- `RAPIDO_API_KEY`
- `RAPIDO_WEBHOOK_SECRET`
- `RAPIDO_BASE_URL` (`https://wktlwrxxgnsirrkkkric.supabase.co/functions/v1/merchant-api`)

Names (no values) added to `.env.template`. API key + webhook secret supplied
separately by the owner and set in Coolify. Single store confirmed — no
`storeId` / `RAPIDO_STORE_ID`.

## Testing

- **Unit:** `buildRapidoPayload` in dollup-admin (paid vs unpaid COD,
  deposit/exchange-credit cases, phone normalization, bad zone throws),
  `verify-rapido-signature` + `validateRapidoPayload` in the backend (good / bad /
  missing).
- **Manual end-to-end:** one real Home Delivery order, once the key + webhook
  secret are set and the webhook URL `https://api.dollupboutique.com/hooks/rapido`
  is registered in the Rapido dashboard.

## Assumptions

- **Single store** (confirmed) — `storeId` omitted from the payload.
- **`"Home Delivery"`** is the exact `metadata.delivery_method` string — verified
  against a live order during build.
- **Status values** — store whatever string the webhook sends (`READY_FOR_PICKUP`,
  `PICKED_UP`, `DELIVERED`, …) and display it; no hardcoded enum.

## Out of scope

- Auto-dispatch on order placement.
- Rapido for postage / pickup methods.
- Cancelling a Rapido order from admin (no cancel endpoint documented yet).
- Live delivery-rate quote at checkout (no rates endpoint documented).
