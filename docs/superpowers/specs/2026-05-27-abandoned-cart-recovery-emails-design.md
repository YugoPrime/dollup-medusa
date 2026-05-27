# Abandoned-cart recovery emails

**Date:** 2026-05-27
**Status:** Design — pending user review
**Owner:** rahvi
**Related:**
- Existing `/abandoned-carts` admin page — see memory `abandoned-carts-admin-2026-05-22`
- Resend notification module — `Backend/dollup-medusa/src/modules/notification-resend/`
- Manual-trigger model only; no cron, no auto follow-up

---

## Goal

Let the operator send recovery emails to shoppers who abandoned their cart with an email address on file, directly from the existing `/abandoned-carts` admin page. Two templates: a friendly check-in, and a 5%-off coupon. Manual per-row trigger, single-use unique coupon codes, "already sent" state visible in the UI.

## Non-goals

- Cron / auto-send follow-ups (deferred — would need reply tracking).
- Coupon redemption analytics / open-rate dashboards.
- A dedicated `cart_recovery_email` table or module (deferred — `cart.metadata` is sufficient at current volume).
- SMS / WhatsApp recovery (already covered by existing WhatsApp button).
- Tracking which template converts better (deferred).

## User flow

1. Operator opens `/abandoned-carts` in dollup-admin.
2. For any row with an email, two new buttons are visible: **Check-in email** and **Send 5% coupon**.
3. Operator clicks one. A confirmation toast appears: "Check-in email sent" or "Coupon RECOVER-XK7P9 sent (expires 2026-06-10)".
4. The clicked button becomes disabled with the label "Check-in sent 2h ago" (or "Coupon sent 2h ago"). The other button remains clickable.
5. WhatsApp and Copy-link buttons keep working as before.
6. If the customer comes back and converts, the cart drops off the list naturally (it gets a `completed_at`).

## Architecture

```
[dollup-admin /abandoned-carts page]
        │
        │ POST /admin/abandoned-carts/:cart_id/email
        │ body: { template: "checkin" | "coupon" }
        ▼
[Backend route: src/api/admin/abandoned-carts/[id]/email/route.ts]
        │
        ├─ load cart (query.graph entity=cart, id=:id), validate email exists
        ├─ check cart.metadata.recovery_emails for duplicate template
        │     └─ if found → 409 Conflict
        │
        ├─ if template = "coupon":
        │     └─ create Promotion (5% off, code=RECOVER-<rand5>, single-use,
        │        expires +14d, currency MUR, region mu)
        │        on failure → 500, no email sent
        │
        ├─ resolve notification module service
        │     └─ createNotifications({
        │           to: cart.email,
        │           channel: "email",
        │           template: "cart-recovery-checkin" | "cart-recovery-coupon",
        │           data: { first_name, items[], cart_resume_url, code?, expires_at? }
        │        })
        │     └─ on Resend failure: if coupon was created, leave it (single-use,
        │        14d expiry — low risk); return 500 with reason
        │
        ├─ append to cart.metadata.recovery_emails:
        │     { template, sent_at: ISO, code?, resend_id? }
        │
        └─ return 200 { sent_at, code?, resend_id? }
```

## Backend

### New route

**File:** `src/api/admin/abandoned-carts/[id]/email/route.ts`
**Method:** `POST`
**Auth:** `AuthenticatedMedusaRequest` (admin only, same as the existing list route).

**Request body:**
```ts
{ template: "checkin" | "coupon" }
```

**Response (200):**
```ts
{
  sent_at: string,        // ISO timestamp
  code?: string,          // only on coupon template
  expires_at?: string,    // only on coupon template, ISO
  resend_id?: string
}
```

**Errors:**
- `400` — invalid template, cart has no email
- `404` — cart not found
- `409` — same template already sent for this cart (`metadata.recovery_emails` contains it)
- `500` — promotion creation failed / Resend failed / unexpected

**Notes:**
- Same try/catch + logger pattern as the existing list route.
- Uses `req.scope.resolve(Modules.NOTIFICATION)` to get the notification module service, then `createNotifications([...])`.
- For coupon: use `@medusajs/medusa/core-flows` → `createPromotionsWorkflow` (verify exact name during plan phase via `find-docs` if needed).

### Coupon code generation

- Code format: `RECOVER-XXXXX` where `XXXXX` = 5 chars from base32 alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no ambiguous chars 0/O/1/I).
- Single-use, customer-restricted is NOT enforced server-side at v1 (Medusa promo customer restrictions add complexity). Single-use + 14d expiry is enough deterrence.
- Applies to cart subtotal, 5% off, currency MUR, region `mu`.
- If duplicate code collision on insert (vanishingly rare at 32^5 ≈ 33M), retry once with a fresh code.

### New email templates

**File:** `src/modules/notification-resend/templates/cart-recovery-checkin.tsx`
- Subject: `Did something go wrong with your order? 💭`
- Body: greeting with first_name (fallback "there"), short empathetic line, 2-column thumbnail+name list of cart items (max 4, then "+N more"), Resume Cart CTA → `${NEXT_PUBLIC_STOREFRONT_URL}/cart?cart_id=<id>`.
- Footer: standard Doll Up footer (re-use from `_layout.tsx`).

**File:** `src/modules/notification-resend/templates/cart-recovery-coupon.tsx`
- Subject: `Here's 5% off to come back 🎁`
- Body: greeting, "Still thinking it over? Here's a small thank-you" line, **{code}** in a bordered box with "expires {date}", same thumbnail list, Resume Cart CTA appends `?cart_id=<id>&promo=<code>` (so the storefront can auto-apply if implemented; if not, the customer pastes the code at checkout).
- Footer: standard.

Both templates extend `_layout.tsx` (cream background, sage accent, matches existing order-placed style).

### Template registration

The notification-resend service has a switch on `notification.template` (per memory + grep on `unknown template`). Add the two new keys to the allowed set.

### Cart metadata shape

Append-only array on `cart.metadata.recovery_emails`:

```ts
cart.metadata.recovery_emails: Array<{
  template: "checkin" | "coupon"
  sent_at: string  // ISO
  code?: string
  resend_id?: string
}>
```

**Write path:** after Resend succeeds, call the cart module's update method via the container — `req.scope.resolve(Modules.CART).updateCarts(cart_id, { metadata: { ...existing, recovery_emails: [...existing, newEntry] } })`. Confirm exact method during plan phase.

**Risk:** writing to `cart.metadata` from a custom admin route is unverified in this codebase. Plan phase must include a smoke test confirming the metadata persists. If it doesn't, fallback is to promote to a new `cart_recovery_email` table (Approach B from brainstorming).

## Frontend (dollup-admin)

### Existing page

`/abandoned-carts` already exists with WhatsApp + Copy-link actions per row. See `dollup-admin/src/app/abandoned-carts/` (page + client component).

### Changes

**`dollup-admin/src/lib/admin-abandoned-carts.ts`**
- Extend `AbandonedCartRow` with `recovery_emails: Array<{template, sent_at, code?}> | null` from `cart.metadata.recovery_emails`.
- Add `sendRecoveryEmail(cart_id: string, template: "checkin" | "coupon"): Promise<{sent_at, code?}>`.

**`dollup-admin/src/app/abandoned-carts/AbandonedCartsClient.tsx`** (or equivalent client file)
- Two new buttons per row, placed to the LEFT of WhatsApp:
  - **Check-in email** — disabled if no `cart.email` OR if `recovery_emails` contains `template: "checkin"`. Disabled label reads `Check-in sent <relative time>` (e.g., "Check-in sent 2h ago").
  - **Send 5% coupon** — disabled if no `cart.email` OR if `recovery_emails` contains `template: "coupon"`. Disabled label reads `Coupon sent <relative time>`.
- On click → call `sendRecoveryEmail`, optimistically update the row's `recovery_emails`, show toast.
- On error → revert optimistic update, show toast with reason.
- Tooltip on disabled-no-email state: "no email on cart".

### Button styling

Match the existing WhatsApp / Copy link button style (outline, rounded, monochrome icon). Use a small mail icon (lucide-react `Mail`) for check-in, a ticket icon (`Ticket` or `BadgePercent`) for coupon.

## Data flow / dependencies

- **Notification module** — already configured (Resend, `RESEND_API_KEY` set in Coolify env).
- **Promotion module** — Medusa core, no setup needed.
- **`NEXT_PUBLIC_STOREFRONT_URL`** — already used by the existing Copy-link feature; required for the email CTA links.
- **`?cart_id=` query parameter restore** — unverified per memory `abandoned-carts-admin-2026-05-22`. The plan phase should include a smoke test (open the link in incognito; confirm cart restores). If it doesn't restore, the email still has value — customer recognizes the items and starts a new cart. File a follow-up but don't block v1.

## Error handling

| Scenario | Behavior |
|---|---|
| Cart has no email | Button disabled with tooltip; route returns 400 if called anyway |
| Same template already sent | Button disabled; route returns 409 if called anyway |
| Resend API error | Toast `Failed to send: <error.message>`; no metadata write; if coupon code was created, it stays (single-use, 14d expiry — acceptable leak) |
| Promotion creation fails | Toast `Failed to create coupon: <reason>`; no email sent; no metadata write |
| Network failure on frontend | Toast `Network error — try again`; row state unchanged |
| Cart metadata write fails after Resend succeeds | Log error; return 200 with `sent_at` anyway (email already went out — false negative is worse than false positive). Flag for follow-up. |

## Testing

### Manual smoke (before declaring done)

1. Open `/abandoned-carts`, pick a row with an email (or seed a test cart with your own email).
2. Click **Check-in email** → confirm Resend dashboard shows the send, confirm email arrives, confirm cart-resume link opens the storefront with the cart.
3. Refresh `/abandoned-carts` → button now reads "Check-in sent Xm ago" and is disabled. Coupon button still clickable.
4. Click **Send 5% coupon** → confirm email arrives with code, confirm code is visible in Medusa admin → Promotions, confirm code works at storefront checkout.
5. Refresh → both buttons disabled.
6. Try to call the route again with same template via curl → 409.
7. Try a cart with no email → button disabled; calling route directly → 400.

### Unit / integration

- One integration test for the new route covering: happy path checkin, happy path coupon, 400 no email, 404 cart not found, 409 duplicate, 500 Resend mock failure.
- Template snapshot tests for `cart-recovery-checkin.tsx` and `cart-recovery-coupon.tsx` against `previews/` directory (matches existing pattern).

## Rollout

- Backend deploy is the gating step (Coolify auto-deploys `master`).
- No env vars to add — Resend + storefront URL already set.
- No migration — `cart.metadata` is a JSONB column with no schema change.
- Frontend deploy after backend is live; manual smoke per checklist above.
- Rollback: revert both frontend and backend commits. No data cleanup needed (orphaned `recovery_emails` metadata entries are harmless).

## Open questions resolved during brainstorming

- **Trigger model:** Manual per-row buttons (not cron).
- **Buttons:** Two separate buttons (Check-in + Coupon), not one with a picker.
- **Coupon mechanics:** Generated unique single-use code, 14-day expiry.
- **Post-send state:** Row stays visible; clicked button shows "Sent Xh ago" and disables; other button still clickable.
- **Storage:** `cart.metadata.recovery_emails` (Approach A), not a new module. Promote to a table only if metadata writes prove unreliable.

## Future work (explicitly deferred)

- Cron-based auto follow-up (7-day no-reply → coupon).
- Reply tracking (would require Resend inbound or shared inbox integration).
- Redemption analytics / dashboards.
- A/B testing copy variants.
- WhatsApp message templates for the same flows (mirror the email templates).
- Customer-restricted promotion codes (tied to email).
