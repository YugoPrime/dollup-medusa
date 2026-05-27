# Abandoned-Cart Recovery Emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator manually send one of two recovery emails (check-in or 5%-coupon) to each abandoned cart with an email, with per-row "already sent" state.

**Architecture:** New backend route `POST /admin/abandoned-carts/[id]/email` that (a) optionally creates a Medusa Promotion via `createPromotionsWorkflow`, (b) sends the email via the existing `notification-resend` provider, (c) appends to `cart.metadata.recovery_emails`. Two new React-email templates extend the existing `_layout.tsx`. Two new buttons in `AbandonedCartsClient.tsx` with disabled state derived from cart metadata.

**Tech Stack:** Medusa v2 (`@medusajs/medusa@2.13.1`), `@medusajs/medusa/core-flows` (`createPromotionsWorkflow`), `notification-resend` custom module (Resend), React Email templates, Next.js 16 + React 19 admin (dollup-admin), Jest for backend tests.

**Spec:** `Backend/dollup-medusa/docs/superpowers/specs/2026-05-27-abandoned-cart-recovery-emails-design.md`

---

## File Structure

### Backend (`Backend/dollup-medusa/`)
- **Create:** `src/api/admin/abandoned-carts/[id]/email/route.ts` — new POST route, the orchestrator (cart load → optional promo → send email → metadata write).
- **Create:** `src/modules/notification-resend/templates/cart-recovery-checkin.tsx` — check-in email template.
- **Create:** `src/modules/notification-resend/templates/cart-recovery-coupon.tsx` — coupon email template.
- **Create:** `src/modules/notification-resend/templates/previews/cart-recovery-checkin.preview.tsx` — preview fixture.
- **Create:** `src/modules/notification-resend/templates/previews/cart-recovery-coupon.preview.tsx` — preview fixture.
- **Create:** `src/lib/recovery-coupon.ts` — pure helpers: `generateCouponCode()`, `couponExpiryISO(days)`.
- **Create:** `src/lib/recovery-coupon.test.ts` — unit tests for the helpers.
- **Create:** `integration-tests/http/admin-abandoned-cart-email.spec.ts` — integration test for the route.
- **Modify:** `src/modules/notification-resend/service.ts` — register the two new templates in `EmailTemplate` enum + `renderers` + `defaultSubjects`.

### Frontend (`dollup-admin/`)
- **Modify:** `src/lib/admin-abandoned-carts.ts` — extend `AbandonedCartRow` with `recoveryEmails`, add `sendRecoveryEmail()` client function.
- **Modify:** `src/app/(app)/abandoned-carts/components/AbandonedCartsClient.tsx` — add two buttons per row + optimistic state + toast handling.

---

## Pre-flight

- [ ] **Step 0: Confirm working tree is clean before starting**

Run:
```bash
cd "Backend/dollup-medusa" && git status --short
cd "dollup-admin" && git status --short
```
Expected: both empty (or only the in-flight spec commit on backend). If dirty, stash or ask.

- [ ] **Step 0b: Verify Resend env vars are present locally for the dev server**

Run (in `Backend/dollup-medusa/`):
```bash
grep -E "^RESEND_API_KEY|^RESEND_FROM_EMAIL" .env
```
Expected: both keys present (you have `notification-resend` running on prod; if missing locally, copy from Coolify). If missing, the integration test still passes (Resend is mocked), but the live smoke at the end requires them.

---

## Task 1: Coupon-code helpers (TDD)

**Files:**
- Create: `Backend/dollup-medusa/src/lib/recovery-coupon.ts`
- Test: `Backend/dollup-medusa/src/lib/recovery-coupon.test.ts`

- [ ] **Step 1: Write failing tests**

Write `Backend/dollup-medusa/src/lib/recovery-coupon.test.ts`:

```ts
import {
  generateCouponCode,
  couponExpiryISO,
  RECOVERY_COUPON_PREFIX,
  RECOVERY_COUPON_ALPHABET,
} from "./recovery-coupon"

describe("recovery-coupon", () => {
  describe("generateCouponCode", () => {
    it("returns codes prefixed with RECOVER-", () => {
      const code = generateCouponCode()
      expect(code.startsWith(`${RECOVERY_COUPON_PREFIX}-`)).toBe(true)
    })

    it("returns a 5-char suffix from the no-ambiguous alphabet", () => {
      const code = generateCouponCode()
      const suffix = code.slice(RECOVERY_COUPON_PREFIX.length + 1)
      expect(suffix.length).toBe(5)
      for (const ch of suffix) {
        expect(RECOVERY_COUPON_ALPHABET).toContain(ch)
      }
    })

    it("does not include ambiguous chars 0/O/1/I in the alphabet", () => {
      expect(RECOVERY_COUPON_ALPHABET).not.toMatch(/[0O1I]/)
    })

    it("returns different codes across many calls (~no immediate collisions)", () => {
      const codes = new Set<string>()
      for (let i = 0; i < 500; i++) codes.add(generateCouponCode())
      expect(codes.size).toBeGreaterThan(495)
    })
  })

  describe("couponExpiryISO", () => {
    it("returns an ISO timestamp N days in the future", () => {
      const now = Date.now()
      const iso = couponExpiryISO(14, new Date(now))
      const ms = new Date(iso).getTime()
      const fourteenDays = 14 * 24 * 60 * 60 * 1000
      expect(ms - now).toBe(fourteenDays)
    })
  })
})
```

- [ ] **Step 2: Run test, expect failure**

Run:
```bash
cd "Backend/dollup-medusa" && yarn test:unit src/lib/recovery-coupon.test.ts
```
Expected: FAIL with "Cannot find module './recovery-coupon'".

- [ ] **Step 3: Implement**

Create `Backend/dollup-medusa/src/lib/recovery-coupon.ts`:

```ts
import { randomBytes } from "node:crypto"

export const RECOVERY_COUPON_PREFIX = "RECOVER"
// Base32-ish, ambiguous chars (0/O/1/I) removed.
export const RECOVERY_COUPON_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export function generateCouponCode(suffixLength = 5): string {
  const bytes = randomBytes(suffixLength)
  let suffix = ""
  for (let i = 0; i < suffixLength; i++) {
    suffix += RECOVERY_COUPON_ALPHABET[bytes[i]! % RECOVERY_COUPON_ALPHABET.length]
  }
  return `${RECOVERY_COUPON_PREFIX}-${suffix}`
}

export function couponExpiryISO(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}
```

- [ ] **Step 4: Run test, expect pass**

Run:
```bash
cd "Backend/dollup-medusa" && yarn test:unit src/lib/recovery-coupon.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd "Backend/dollup-medusa" && git add src/lib/recovery-coupon.ts src/lib/recovery-coupon.test.ts && git commit -m "feat(recovery): coupon-code helpers (RECOVER-XXXXX, expiry)"
```

---

## Task 2: Check-in email template

**Files:**
- Create: `Backend/dollup-medusa/src/modules/notification-resend/templates/cart-recovery-checkin.tsx`
- Create: `Backend/dollup-medusa/src/modules/notification-resend/templates/previews/cart-recovery-checkin.preview.tsx`

- [ ] **Step 1: Create the template**

Create `Backend/dollup-medusa/src/modules/notification-resend/templates/cart-recovery-checkin.tsx`:

```tsx
import { Section } from "@react-email/components"
import * as React from "react"

import {
  BRAND,
  Button,
  EmailLayout,
  Heading,
  Paragraph,
} from "./_layout"

export type CartRecoveryItem = {
  title: string
  thumbnail: string | null
  quantity: number
}

export type CartRecoveryCheckinData = {
  storefrontUrl: string
  customerFirstName: string
  cartResumeUrl: string
  items: CartRecoveryItem[]
}

export default function CartRecoveryCheckinEmail(
  data: CartRecoveryCheckinData,
) {
  const { storefrontUrl, customerFirstName, cartResumeUrl, items } = data
  const shown = items.slice(0, 4)
  const moreCount = items.length - shown.length

  return (
    <EmailLayout
      preview="Anything we can help with?"
      storefrontUrl={storefrontUrl}
    >
      <Heading>Hi {customerFirstName || "babe"} 💭</Heading>
      <Paragraph>
        We noticed you left a few pieces in your cart. Did something go
        wrong with your order? If you have any question or hit a snag,
        just reply to this email — we're happy to help.
      </Paragraph>

      <Section
        style={{
          backgroundColor: BRAND.cream,
          borderRadius: "8px",
          padding: "16px",
          margin: "8px 0 16px 0",
        }}
      >
        {shown.map((item, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "6px 0",
            }}
          >
            {item.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.thumbnail}
                alt=""
                width={48}
                height={48}
                style={{ borderRadius: "6px", objectFit: "cover" }}
              />
            ) : (
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "6px",
                  backgroundColor: "#fff",
                }}
              />
            )}
            <div style={{ fontSize: "14px", color: BRAND.ink }}>
              {item.title}
              {item.quantity > 1 ? ` × ${item.quantity}` : ""}
            </div>
          </div>
        ))}
        {moreCount > 0 ? (
          <Paragraph>+ {moreCount} more</Paragraph>
        ) : null}
      </Section>

      <Section style={{ padding: "16px 0 8px 0" }}>
        <Button href={cartResumeUrl}>Resume your cart</Button>
      </Section>

      <Paragraph>
        Or browse the latest drops at{" "}
        <a href={storefrontUrl} style={{ color: BRAND.coral }}>
          dollupboutique.com
        </a>
        .
      </Paragraph>
    </EmailLayout>
  )
}
```

- [ ] **Step 2: Create the preview fixture**

Create `Backend/dollup-medusa/src/modules/notification-resend/templates/previews/cart-recovery-checkin.preview.tsx`:

```tsx
import * as React from "react"
import CartRecoveryCheckinEmail from "../cart-recovery-checkin"

export default function Preview() {
  return (
    <CartRecoveryCheckinEmail
      storefrontUrl="https://dollupboutique.com"
      customerFirstName="Emilie"
      cartResumeUrl="https://dollupboutique.com/cart?cart_id=cart_01H123"
      items={[
        {
          title: "PU Leather Lingerie Bodysuit",
          thumbnail: "https://placehold.co/96",
          quantity: 1,
        },
        {
          title: "Pink Neon Short Dress",
          thumbnail: "https://placehold.co/96",
          quantity: 2,
        },
      ]}
    />
  )
}
```

- [ ] **Step 3: Verify it compiles**

Run:
```bash
cd "Backend/dollup-medusa" && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "cart-recovery-checkin" || echo "no errors in template"
```
Expected: `no errors in template`.

- [ ] **Step 4: Commit**

```bash
cd "Backend/dollup-medusa" && git add src/modules/notification-resend/templates/cart-recovery-checkin.tsx src/modules/notification-resend/templates/previews/cart-recovery-checkin.preview.tsx && git commit -m "feat(emails): cart-recovery check-in template"
```

---

## Task 3: Coupon email template

**Files:**
- Create: `Backend/dollup-medusa/src/modules/notification-resend/templates/cart-recovery-coupon.tsx`
- Create: `Backend/dollup-medusa/src/modules/notification-resend/templates/previews/cart-recovery-coupon.preview.tsx`

- [ ] **Step 1: Create the template**

Create `Backend/dollup-medusa/src/modules/notification-resend/templates/cart-recovery-coupon.tsx`:

```tsx
import { Section, Text } from "@react-email/components"
import * as React from "react"

import {
  BRAND,
  Button,
  EmailLayout,
  Heading,
  Paragraph,
} from "./_layout"
import type { CartRecoveryItem } from "./cart-recovery-checkin"

export type CartRecoveryCouponData = {
  storefrontUrl: string
  customerFirstName: string
  cartResumeUrl: string
  items: CartRecoveryItem[]
  couponCode: string
  couponExpiresAt: string // ISO
  couponPercentage: number // e.g. 5
}

function formatExpiry(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

export default function CartRecoveryCouponEmail(
  data: CartRecoveryCouponData,
) {
  const {
    storefrontUrl,
    customerFirstName,
    cartResumeUrl,
    items,
    couponCode,
    couponExpiresAt,
    couponPercentage,
  } = data
  const shown = items.slice(0, 4)
  const moreCount = items.length - shown.length

  return (
    <EmailLayout
      preview={`Here's ${couponPercentage}% off to come back`}
      storefrontUrl={storefrontUrl}
    >
      <Heading>Still thinking it over?</Heading>
      <Paragraph>
        Hi {customerFirstName || "babe"} — a little something to help you
        come back. Use this code at checkout for {couponPercentage}% off
        your order.
      </Paragraph>

      <Section
        style={{
          backgroundColor: BRAND.coral,
          borderRadius: "8px",
          padding: "20px",
          margin: "8px 0 16px 0",
          textAlign: "center",
        }}
      >
        <Text
          style={{
            color: "#ffffff",
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.14em",
            margin: "0 0 4px 0",
            textTransform: "uppercase",
          }}
        >
          {couponPercentage}% off
        </Text>
        <Text
          style={{
            color: "#ffffff",
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: "28px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            margin: "0 0 4px 0",
          }}
        >
          {couponCode}
        </Text>
        <Text
          style={{
            color: "rgba(255,255,255,0.85)",
            fontSize: "12px",
            margin: 0,
          }}
        >
          Expires {formatExpiry(couponExpiresAt)}
        </Text>
      </Section>

      <Section
        style={{
          backgroundColor: BRAND.cream,
          borderRadius: "8px",
          padding: "16px",
          margin: "8px 0 16px 0",
        }}
      >
        {shown.map((item, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "6px 0",
            }}
          >
            {item.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.thumbnail}
                alt=""
                width={48}
                height={48}
                style={{ borderRadius: "6px", objectFit: "cover" }}
              />
            ) : (
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "6px",
                  backgroundColor: "#fff",
                }}
              />
            )}
            <div style={{ fontSize: "14px", color: BRAND.ink }}>
              {item.title}
              {item.quantity > 1 ? ` × ${item.quantity}` : ""}
            </div>
          </div>
        ))}
        {moreCount > 0 ? (
          <Paragraph>+ {moreCount} more</Paragraph>
        ) : null}
      </Section>

      <Section style={{ padding: "16px 0 8px 0" }}>
        <Button href={cartResumeUrl}>Resume your cart</Button>
      </Section>

      <Paragraph>
        Apply the code at checkout. Valid until{" "}
        {formatExpiry(couponExpiresAt)}.
      </Paragraph>
    </EmailLayout>
  )
}
```

- [ ] **Step 2: Create the preview fixture**

Create `Backend/dollup-medusa/src/modules/notification-resend/templates/previews/cart-recovery-coupon.preview.tsx`:

```tsx
import * as React from "react"
import CartRecoveryCouponEmail from "../cart-recovery-coupon"

export default function Preview() {
  return (
    <CartRecoveryCouponEmail
      storefrontUrl="https://dollupboutique.com"
      customerFirstName="Emilie"
      cartResumeUrl="https://dollupboutique.com/cart?cart_id=cart_01H123&promo=RECOVER-XK7P9"
      items={[
        {
          title: "PU Leather Lingerie Bodysuit",
          thumbnail: "https://placehold.co/96",
          quantity: 1,
        },
      ]}
      couponCode="RECOVER-XK7P9"
      couponExpiresAt={new Date(
        Date.now() + 14 * 24 * 60 * 60 * 1000,
      ).toISOString()}
      couponPercentage={5}
    />
  )
}
```

- [ ] **Step 3: Verify it compiles**

Run:
```bash
cd "Backend/dollup-medusa" && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "cart-recovery-coupon" || echo "no errors in template"
```
Expected: `no errors in template`.

- [ ] **Step 4: Commit**

```bash
cd "Backend/dollup-medusa" && git add src/modules/notification-resend/templates/cart-recovery-coupon.tsx src/modules/notification-resend/templates/previews/cart-recovery-coupon.preview.tsx && git commit -m "feat(emails): cart-recovery coupon template"
```

---

## Task 4: Register templates in notification-resend service

**Files:**
- Modify: `Backend/dollup-medusa/src/modules/notification-resend/service.ts`

- [ ] **Step 1: Add imports + extend `EmailTemplate` enum**

In `Backend/dollup-medusa/src/modules/notification-resend/service.ts`, find the existing import block (around lines 13–22) and add after the existing imports:

```ts
import CartRecoveryCheckinEmail, {
  type CartRecoveryCheckinData,
} from "./templates/cart-recovery-checkin"
import CartRecoveryCouponEmail, {
  type CartRecoveryCouponData,
} from "./templates/cart-recovery-coupon"
```

Then in the `EmailTemplate` enum (around lines 24–29), add two new members:

```ts
export enum EmailTemplate {
  ORDER_PLACED = "order-placed",
  ORDER_SHIPPED = "order-shipped",
  WELCOME = "welcome",
  PASSWORD_RESET = "password-reset",
  CART_RECOVERY_CHECKIN = "cart-recovery-checkin",
  CART_RECOVERY_COUPON = "cart-recovery-coupon",
}
```

- [ ] **Step 2: Register renderers**

In the `renderers` constant (around lines 54–63), add the two new entries:

```ts
const renderers: Record<EmailTemplate, TemplateRenderer> = {
  [EmailTemplate.ORDER_PLACED]: (data) =>
    React.createElement(OrderPlacedEmail, data as OrderPlacedEmailData),
  [EmailTemplate.ORDER_SHIPPED]: (data) =>
    React.createElement(OrderShippedEmail, data as OrderShippedEmailData),
  [EmailTemplate.WELCOME]: (data) =>
    React.createElement(WelcomeEmail, data as WelcomeEmailData),
  [EmailTemplate.PASSWORD_RESET]: (data) =>
    React.createElement(PasswordResetEmail, data as PasswordResetEmailData),
  [EmailTemplate.CART_RECOVERY_CHECKIN]: (data) =>
    React.createElement(
      CartRecoveryCheckinEmail,
      data as CartRecoveryCheckinData,
    ),
  [EmailTemplate.CART_RECOVERY_COUPON]: (data) =>
    React.createElement(
      CartRecoveryCouponEmail,
      data as CartRecoveryCouponData,
    ),
}
```

- [ ] **Step 3: Register default subjects**

In the `defaultSubjects` constant (around lines 65–85), add the two new entries before the closing `}`:

```ts
  [EmailTemplate.CART_RECOVERY_CHECKIN]: () =>
    "Did something go wrong with your order? 💭",
  [EmailTemplate.CART_RECOVERY_COUPON]: (data) => {
    const pct = (data as CartRecoveryCouponData).couponPercentage
    return `Here's ${pct}% off to come back 🎁`
  },
```

- [ ] **Step 4: Type-check**

Run:
```bash
cd "Backend/dollup-medusa" && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "notification-resend/service" || echo "no errors"
```
Expected: `no errors`.

- [ ] **Step 5: Commit**

```bash
cd "Backend/dollup-medusa" && git add src/modules/notification-resend/service.ts && git commit -m "feat(emails): register cart-recovery templates in resend provider"
```

---

## Task 5: Backend POST route — happy path (no promo)

**Files:**
- Create: `Backend/dollup-medusa/src/api/admin/abandoned-carts/[id]/email/route.ts`

This task only handles `template: "checkin"` — no promotion code path. Task 6 adds the coupon branch.

- [ ] **Step 1: Create the route with check-in only**

Create `Backend/dollup-medusa/src/api/admin/abandoned-carts/[id]/email/route.ts`:

```ts
import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import type { INotificationModuleService } from "@medusajs/framework/types"

import {
  generateCouponCode,
  couponExpiryISO,
} from "../../../../../lib/recovery-coupon"

const COUPON_PERCENTAGE = 5
const COUPON_EXPIRY_DAYS = 14
const ALLOWED_TEMPLATES = ["checkin", "coupon"] as const
type Template = (typeof ALLOWED_TEMPLATES)[number]

type RecoveryEmailEntry = {
  template: Template
  sent_at: string
  code?: string
  expires_at?: string
  resend_id?: string
}

type CartLike = {
  id: string
  email?: string | null
  currency_code?: string | null
  metadata?: Record<string, unknown> | null
  shipping_address?: { first_name?: string | null } | null
  billing_address?: { first_name?: string | null } | null
  customer?: { first_name?: string | null } | null
  items?: Array<{
    title?: string | null
    product_title?: string | null
    thumbnail?: string | null
    quantity?: number | null
  }> | null
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const cartId = req.params.id
    const body = (req.body ?? {}) as { template?: unknown }
    const template = body.template

    if (
      typeof template !== "string" ||
      !ALLOWED_TEMPLATES.includes(template as Template)
    ) {
      return res
        .status(400)
        .json({ message: `template must be one of: ${ALLOWED_TEMPLATES.join(", ")}` })
    }
    const tpl = template as Template

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: carts } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "email",
        "currency_code",
        "metadata",
        "items.*",
        "shipping_address.*",
        "billing_address.*",
        "customer.*",
      ],
      filters: { id: cartId },
    })
    const cart = (carts ?? [])[0] as CartLike | undefined
    if (!cart) {
      return res.status(404).json({ message: "cart not found" })
    }
    if (!cart.email) {
      return res.status(400).json({ message: "cart has no email" })
    }

    const existing = ((cart.metadata?.recovery_emails ?? []) as
      | RecoveryEmailEntry[]
      | undefined) ?? []
    if (existing.some((e) => e.template === tpl)) {
      return res
        .status(409)
        .json({ message: `${tpl} already sent for this cart` })
    }

    const firstName =
      cart.shipping_address?.first_name ??
      cart.billing_address?.first_name ??
      cart.customer?.first_name ??
      "babe"

    const storefrontUrl = (
      process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "https://dollupboutique.com"
    ).replace(/\/$/, "")
    const cartResumeUrl = `${storefrontUrl}/cart?cart_id=${cart.id}`

    const items = (cart.items ?? []).map((it) => ({
      title: it.product_title ?? it.title ?? "Item",
      thumbnail: it.thumbnail ?? null,
      quantity: it.quantity ?? 1,
    }))

    // ---- Coupon branch is added in Task 6. For now, only checkin works. ----
    if (tpl === "coupon") {
      return res
        .status(501)
        .json({ message: "coupon template not yet implemented" })
    }

    const notification = req.scope.resolve(
      Modules.NOTIFICATION,
    ) as INotificationModuleService

    const [notif] = await notification.createNotifications([
      {
        to: cart.email,
        channel: "email",
        template: "cart-recovery-checkin",
        data: {
          storefrontUrl,
          customerFirstName: firstName,
          cartResumeUrl,
          items,
        },
      },
    ])
    const resendId =
      (notif?.provider_id_returned as string | undefined) ?? undefined

    const sent_at = new Date().toISOString()
    const newEntry: RecoveryEmailEntry = {
      template: tpl,
      sent_at,
      ...(resendId ? { resend_id: resendId } : {}),
    }

    const cartModule = req.scope.resolve(Modules.CART)
    await cartModule.updateCarts(cart.id, {
      metadata: {
        ...(cart.metadata ?? {}),
        recovery_emails: [...existing, newEntry],
      },
    })

    return res.status(200).json({
      sent_at,
      ...(resendId ? { resend_id: resendId } : {}),
    })
  } catch (err) {
    const message =
      (err as Error)?.message ?? "Failed to send recovery email"
    logger.error(`[admin/abandoned-carts email] ${message}`)
    return res.status(500).json({ message })
  }
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
cd "Backend/dollup-medusa" && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "admin/abandoned-carts" || echo "no errors"
```
Expected: `no errors`. If you see `INotificationModuleService` not found, check `@medusajs/framework/types` — if absent, drop the cast and use `any` (note in commit message).

- [ ] **Step 3: Sanity-check the route boots**

Run (in a separate terminal):
```bash
cd "Backend/dollup-medusa" && yarn dev
```
Wait for `Server is ready` line. Then:
```bash
curl -s -X POST http://localhost:9000/admin/abandoned-carts/cart_nonexistent/email \
  -H "Content-Type: application/json" \
  -H "x-medusa-access-token: <your-admin-cookie-or-pat>" \
  -d '{"template":"checkin"}'
```
Expected: 404 `{"message":"cart not found"}`. Stop the dev server with Ctrl-C.

Note: if you don't have a quick admin auth path, skip the curl and rely on the integration test in Task 7.

- [ ] **Step 4: Commit**

```bash
cd "Backend/dollup-medusa" && git add src/api/admin/abandoned-carts/[id]/email/route.ts && git commit -m "feat(abandoned-carts): POST /email route — check-in branch only"
```

---

## Task 6: Backend route — coupon branch (promotion creation)

**Files:**
- Modify: `Backend/dollup-medusa/src/api/admin/abandoned-carts/[id]/email/route.ts`

- [ ] **Step 1: Add the imports**

Near the top of `Backend/dollup-medusa/src/api/admin/abandoned-carts/[id]/email/route.ts`, add:

```ts
import { createPromotionsWorkflow } from "@medusajs/medusa/core-flows"
```

- [ ] **Step 2: Replace the 501 stub with the coupon logic**

In the same file, find the block:

```ts
    if (tpl === "coupon") {
      return res
        .status(501)
        .json({ message: "coupon template not yet implemented" })
    }
```

Replace it with:

```ts
    let couponCode: string | undefined
    let couponExpiresAt: string | undefined

    if (tpl === "coupon") {
      const currencyCode = (cart.currency_code ?? "mur").toLowerCase()
      couponCode = generateCouponCode()
      couponExpiresAt = couponExpiryISO(COUPON_EXPIRY_DAYS)

      try {
        await createPromotionsWorkflow(req.scope).run({
          input: {
            promotionsData: [
              {
                code: couponCode,
                type: "standard",
                is_automatic: false,
                application_method: {
                  type: "percentage",
                  target_type: "items",
                  allocation: "across",
                  value: COUPON_PERCENTAGE,
                  currency_code: currencyCode,
                },
                rules: [],
              },
            ],
          },
        })
      } catch (err) {
        const m = (err as Error)?.message ?? "failed to create coupon"
        logger.error(
          `[admin/abandoned-carts email] coupon promo create failed for cart=${cart.id}: ${m}`,
        )
        return res
          .status(500)
          .json({ message: `failed to create coupon: ${m}` })
      }
    }
```

- [ ] **Step 3: Branch the notification call by template + pass coupon data**

Find the block:

```ts
    const [notif] = await notification.createNotifications([
      {
        to: cart.email,
        channel: "email",
        template: "cart-recovery-checkin",
        data: {
          storefrontUrl,
          customerFirstName: firstName,
          cartResumeUrl,
          items,
        },
      },
    ])
```

Replace with:

```ts
    const templateKey =
      tpl === "checkin" ? "cart-recovery-checkin" : "cart-recovery-coupon"

    const data =
      tpl === "checkin"
        ? {
            storefrontUrl,
            customerFirstName: firstName,
            cartResumeUrl,
            items,
          }
        : {
            storefrontUrl,
            customerFirstName: firstName,
            cartResumeUrl: `${cartResumeUrl}&promo=${couponCode}`,
            items,
            couponCode: couponCode!,
            couponExpiresAt: couponExpiresAt!,
            couponPercentage: COUPON_PERCENTAGE,
          }

    const [notif] = await notification.createNotifications([
      {
        to: cart.email,
        channel: "email",
        template: templateKey,
        data,
      },
    ])
```

- [ ] **Step 4: Persist code + expiry in metadata + response**

Find:

```ts
    const newEntry: RecoveryEmailEntry = {
      template: tpl,
      sent_at,
      ...(resendId ? { resend_id: resendId } : {}),
    }
```

Replace with:

```ts
    const newEntry: RecoveryEmailEntry = {
      template: tpl,
      sent_at,
      ...(couponCode ? { code: couponCode } : {}),
      ...(couponExpiresAt ? { expires_at: couponExpiresAt } : {}),
      ...(resendId ? { resend_id: resendId } : {}),
    }
```

And find the final response:

```ts
    return res.status(200).json({
      sent_at,
      ...(resendId ? { resend_id: resendId } : {}),
    })
```

Replace with:

```ts
    return res.status(200).json({
      sent_at,
      ...(couponCode ? { code: couponCode } : {}),
      ...(couponExpiresAt ? { expires_at: couponExpiresAt } : {}),
      ...(resendId ? { resend_id: resendId } : {}),
    })
```

- [ ] **Step 5: Type-check**

Run:
```bash
cd "Backend/dollup-medusa" && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "admin/abandoned-carts" || echo "no errors"
```
Expected: `no errors`.

- [ ] **Step 6: Commit**

```bash
cd "Backend/dollup-medusa" && git add src/api/admin/abandoned-carts/[id]/email/route.ts && git commit -m "feat(abandoned-carts): coupon branch — create promo, send coupon email"
```

---

## Task 7: Integration test for the route

**Files:**
- Create: `Backend/dollup-medusa/integration-tests/http/admin-abandoned-cart-email.spec.ts`

- [ ] **Step 1: Locate the existing integration-test conventions**

Run:
```bash
cd "Backend/dollup-medusa" && ls integration-tests/http/ 2>/dev/null && find integration-tests -name "*.spec.ts" | head -3
```
Expected: at least one example .spec.ts. Open one (e.g. via Read) to see the bootstrap pattern (`medusaIntegrationTestRunner`). If the folder does not exist, create it.

- [ ] **Step 2: Write the test**

Create `Backend/dollup-medusa/integration-tests/http/admin-abandoned-cart-email.spec.ts`:

```ts
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

jest.setTimeout(60_000)

const adminHeaders = { headers: { "x-medusa-access-token": "test_token" } }

medusaIntegrationTestRunner({
  inApp: true,
  env: {
    NEXT_PUBLIC_STOREFRONT_URL: "https://dollupboutique.test",
  },
  testSuite: ({ api, getContainer }) => {
    describe("POST /admin/abandoned-carts/[id]/email", () => {
      let cartId: string
      let regionId: string

      beforeAll(async () => {
        const container = getContainer()
        const region = await container.resolve(Modules.REGION).createRegions({
          name: "MU Test",
          currency_code: "mur",
          countries: ["mu"],
        })
        regionId = region.id

        const cart = await container.resolve(Modules.CART).createCarts({
          email: "babe@example.com",
          currency_code: "mur",
          region_id: regionId,
        })
        cartId = cart.id

        await container.resolve(Modules.CART).addLineItems({
          cart_id: cartId,
          title: "Test Dress",
          unit_price: 1500,
          quantity: 1,
        })
      })

      it("returns 400 when template is invalid", async () => {
        const res = await api
          .post(
            `/admin/abandoned-carts/${cartId}/email`,
            { template: "bogus" },
            adminHeaders,
          )
          .catch((e) => e.response)
        expect(res.status).toBe(400)
      })

      it("returns 404 when cart does not exist", async () => {
        const res = await api
          .post(
            "/admin/abandoned-carts/cart_does_not_exist/email",
            { template: "checkin" },
            adminHeaders,
          )
          .catch((e) => e.response)
        expect(res.status).toBe(404)
      })

      it("sends a check-in email and records it in metadata", async () => {
        const res = await api.post(
          `/admin/abandoned-carts/${cartId}/email`,
          { template: "checkin" },
          adminHeaders,
        )
        expect(res.status).toBe(200)
        expect(res.data.sent_at).toBeTruthy()
        expect(res.data.code).toBeUndefined()

        const container = getContainer()
        const { data: refreshed } = await container
          .resolve(ContainerRegistrationKeys.QUERY)
          .graph({
            entity: "cart",
            fields: ["id", "metadata"],
            filters: { id: cartId },
          })
        const entries = (refreshed[0]?.metadata?.recovery_emails ??
          []) as Array<{ template: string }>
        expect(entries.some((e) => e.template === "checkin")).toBe(true)
      })

      it("returns 409 if the same template was already sent", async () => {
        const res = await api
          .post(
            `/admin/abandoned-carts/${cartId}/email`,
            { template: "checkin" },
            adminHeaders,
          )
          .catch((e) => e.response)
        expect(res.status).toBe(409)
      })

      it("sends a coupon email, creates a promotion, returns code+expires_at", async () => {
        const res = await api.post(
          `/admin/abandoned-carts/${cartId}/email`,
          { template: "coupon" },
          adminHeaders,
        )
        expect(res.status).toBe(200)
        expect(res.data.code).toMatch(/^RECOVER-[A-Z2-9]{5}$/)
        expect(res.data.expires_at).toBeTruthy()

        const container = getContainer()
        const promo = await container.resolve(Modules.PROMOTION).listPromotions({
          code: res.data.code,
        })
        expect(promo.length).toBe(1)
      })

      it("returns 400 if the cart has no email", async () => {
        const container = getContainer()
        const cart = await container.resolve(Modules.CART).createCarts({
          currency_code: "mur",
          region_id: regionId,
        })
        await container.resolve(Modules.CART).addLineItems({
          cart_id: cart.id,
          title: "X",
          unit_price: 100,
          quantity: 1,
        })

        const res = await api
          .post(
            `/admin/abandoned-carts/${cart.id}/email`,
            { template: "checkin" },
            adminHeaders,
          )
          .catch((e) => e.response)
        expect(res.status).toBe(400)
      })
    })
  },
})
```

Note: if `adminHeaders` doesn't authenticate in the test runner, look at how a sibling spec (e.g. one under `integration-tests/http/`) sets up auth and mirror its pattern. The functional assertions stay the same.

- [ ] **Step 3: Run the test**

Run:
```bash
cd "Backend/dollup-medusa" && yarn test:integration:http -t "POST /admin/abandoned-carts"
```
Expected: 6 tests pass. If `notification-resend` is the live provider and tries to call Resend, configure the test env to use a mock provider OR `RESEND_API_KEY="re_test"` — Resend will return an error which the route swallows (still returns 200 because the email *attempt* was made, just no `resend_id`). The metadata write still happens. Verify behavior matches.

If the integration test framework cannot easily isolate the notification provider, the route will still log "Resend rejected email" but won't fail — the test should still pass because metadata is written even when Resend returns no id.

- [ ] **Step 4: Commit**

```bash
cd "Backend/dollup-medusa" && git add integration-tests/http/admin-abandoned-cart-email.spec.ts && git commit -m "test(abandoned-carts): integration tests for /email route"
```

---

## Task 8: Frontend — extend lib types + add `sendRecoveryEmail`

**Files:**
- Modify: `dollup-admin/src/lib/admin-abandoned-carts.ts`

- [ ] **Step 1: Extend `AbandonedCartRow` and `RawCart`**

In `dollup-admin/src/lib/admin-abandoned-carts.ts`, find the `AbandonedCartRow` type (lines 4–19) and add the `recoveryEmails` field:

```ts
export type RecoveryEmailEntry = {
  template: "checkin" | "coupon";
  sent_at: string;
  code?: string;
  expires_at?: string;
};

export type AbandonedCartRow = {
  id: string;
  email: string | null;
  phone: string | null;
  rawPhone: string | null;
  customerName: string | null;
  itemCount: number;
  firstItemThumbnail: string | null;
  firstItemTitle: string | null;
  total: number;
  currencyCode: string;
  createdAt: string;
  updatedAt: string;
  ageHours: number;
  storefrontCartUrl: string | null;
  recoveryEmails: RecoveryEmailEntry[];
};
```

Then in `RawCart` (lines 34–63), add:

```ts
  metadata?: { recovery_emails?: RecoveryEmailEntry[] | null } | null;
```

- [ ] **Step 2: Populate `recoveryEmails` in `shapeRow`**

In `shapeRow` (line 74-onwards), just before the final `return { ... }`, compute:

```ts
  const recoveryEmails = (cart.metadata?.recovery_emails ?? []) as
    | RecoveryEmailEntry[]
    | RecoveryEmailEntry[];
```

(Note: the runtime shape from the backend may be `null` — the `?? []` guard is sufficient.)

Then add `recoveryEmails` to the returned object:

```ts
  return {
    id: cart.id,
    // ... existing fields
    recoveryEmails,
  };
```

- [ ] **Step 3: Add `sendRecoveryEmail`**

At the bottom of `dollup-admin/src/lib/admin-abandoned-carts.ts` (after `prettyMu`), add:

```ts
export type SendRecoveryEmailResult = {
  sent_at: string;
  code?: string;
  expires_at?: string;
};

export async function sendRecoveryEmail(
  cartId: string,
  template: "checkin" | "coupon",
): Promise<SendRecoveryEmailResult> {
  const sdk = await getAdminSdk();
  return sdk.client.fetch<SendRecoveryEmailResult>(
    `/admin/abandoned-carts/${cartId}/email`,
    {
      method: "POST",
      body: { template },
    },
  );
}
```

- [ ] **Step 4: Type-check**

Run:
```bash
cd "dollup-admin" && npx tsc --noEmit
```
Expected: no errors related to `admin-abandoned-carts.ts`.

- [ ] **Step 5: Commit**

```bash
cd "dollup-admin" && git add src/lib/admin-abandoned-carts.ts && git commit -m "feat(abandoned-carts): lib types + sendRecoveryEmail client"
```

---

## Task 9: Frontend — two new row buttons + state

**Files:**
- Modify: `dollup-admin/src/app/(app)/abandoned-carts/components/AbandonedCartsClient.tsx`

- [ ] **Step 1: Add the new imports**

In `dollup-admin/src/app/(app)/abandoned-carts/components/AbandonedCartsClient.tsx`, at the top change:

```ts
import { RefreshCw, MessageCircle, Link as LinkIcon } from "lucide-react";
import type { AbandonedCartRow } from "@/lib/admin-abandoned-carts";
```

to:

```ts
import {
  RefreshCw,
  MessageCircle,
  Link as LinkIcon,
  Mail,
  BadgePercent,
} from "lucide-react";
import {
  sendRecoveryEmail,
  type AbandonedCartRow,
  type RecoveryEmailEntry,
} from "@/lib/admin-abandoned-carts";
```

- [ ] **Step 2: Track per-row state at the page level**

In the `AbandonedCartsClient` component body (around line 11), after the existing `useState` hooks, add a row-local recovery state:

```ts
  const [rowRecovery, setRowRecovery] = useState<
    Record<string, RecoveryEmailEntry[]>
  >(() => {
    const map: Record<string, RecoveryEmailEntry[]> = {};
    for (const r of initialRows) {
      map[r.id] = r.recoveryEmails;
    }
    return map;
  });

  const [pendingSends, setPendingSends] = useState<
    Record<string, "checkin" | "coupon" | null>
  >({});

  const onSendRecovery = useCallback(
    async (cartId: string, template: "checkin" | "coupon") => {
      setPendingSends((p) => ({ ...p, [cartId]: template }));
      try {
        const res = await sendRecoveryEmail(cartId, template);
        setRowRecovery((m) => ({
          ...m,
          [cartId]: [
            ...(m[cartId] ?? []),
            {
              template,
              sent_at: res.sent_at,
              code: res.code,
              expires_at: res.expires_at,
            },
          ],
        }));
        if (template === "coupon" && res.code) {
          setToast(`Coupon ${res.code} sent`);
        } else {
          setToast(template === "checkin" ? "Check-in email sent" : "Coupon sent");
        }
        setTimeout(() => setToast(null), 3000);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to send email";
        setToast(`Failed: ${msg}`);
        setTimeout(() => setToast(null), 4000);
      } finally {
        setPendingSends((p) => ({ ...p, [cartId]: null }));
      }
    },
    [],
  );
```

- [ ] **Step 3: Pass state down to `CartRow`**

Change the `CartRow` render call (around line 82):

```tsx
              {rows.map((row) => (
                <CartRow key={row.id} row={row} onCopy={onCopy} />
              ))}
```

to:

```tsx
              {rows.map((row) => (
                <CartRow
                  key={row.id}
                  row={row}
                  onCopy={onCopy}
                  recoveryEmails={rowRecovery[row.id] ?? []}
                  pendingTemplate={pendingSends[row.id] ?? null}
                  onSendRecovery={onSendRecovery}
                />
              ))}
```

- [ ] **Step 4: Update `CartRow` props + render**

In `CartRow` (around line 101), change the signature:

```tsx
function CartRow({
  row,
  onCopy,
  recoveryEmails,
  pendingTemplate,
  onSendRecovery,
}: {
  row: AbandonedCartRow;
  onCopy: (url: string) => void;
  recoveryEmails: RecoveryEmailEntry[];
  pendingTemplate: "checkin" | "coupon" | null;
  onSendRecovery: (cartId: string, template: "checkin" | "coupon") => void;
}) {
```

Then inside `CartRow`, after the existing `firstName`/`message`/`waHref` block (around line 110), compute:

```tsx
  const checkinEntry = recoveryEmails.find((e) => e.template === "checkin");
  const couponEntry = recoveryEmails.find((e) => e.template === "coupon");
  const hasEmail = Boolean(row.email);
  const checkinSending = pendingTemplate === "checkin";
  const couponSending = pendingTemplate === "coupon";
```

Then in the `<td>` Actions cell (the one with `<div className="flex flex-wrap gap-2">`), add two buttons BEFORE the WhatsApp/Copy-link buttons:

```tsx
          {/* Check-in email button */}
          <button
            type="button"
            onClick={() => onSendRecovery(row.id, "checkin")}
            disabled={!hasEmail || Boolean(checkinEntry) || checkinSending}
            title={
              !hasEmail
                ? "no email on cart"
                : checkinEntry
                  ? `Check-in sent ${formatAge(
                      (Date.now() - new Date(checkinEntry.sent_at).getTime()) /
                        (60 * 60 * 1000),
                    )}`
                  : "Send check-in email"
            }
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#F1E5E0] bg-white px-3 py-1.5 text-xs font-semibold text-[#332C7D] transition hover:bg-[#FFF5F2] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-100 dark:hover:bg-white/10"
          >
            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
            {checkinEntry
              ? `Check-in sent ${formatAge(
                  (Date.now() - new Date(checkinEntry.sent_at).getTime()) /
                    (60 * 60 * 1000),
                )}`
              : checkinSending
                ? "Sending…"
                : "Check-in"}
          </button>

          {/* 5% coupon button */}
          <button
            type="button"
            onClick={() => onSendRecovery(row.id, "coupon")}
            disabled={!hasEmail || Boolean(couponEntry) || couponSending}
            title={
              !hasEmail
                ? "no email on cart"
                : couponEntry
                  ? `Coupon ${couponEntry.code ?? ""} sent ${formatAge(
                      (Date.now() - new Date(couponEntry.sent_at).getTime()) /
                        (60 * 60 * 1000),
                    )}`
                  : "Send 5% coupon"
            }
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#F1E5E0] bg-white px-3 py-1.5 text-xs font-semibold text-[#332C7D] transition hover:bg-[#FFF5F2] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-100 dark:hover:bg-white/10"
          >
            <BadgePercent className="h-3.5 w-3.5" aria-hidden="true" />
            {couponEntry
              ? `Coupon sent ${formatAge(
                  (Date.now() - new Date(couponEntry.sent_at).getTime()) /
                    (60 * 60 * 1000),
                )}`
              : couponSending
                ? "Sending…"
                : "5% coupon"}
          </button>
```

- [ ] **Step 5: Type-check**

Run:
```bash
cd "dollup-admin" && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Visual smoke**

Run:
```bash
cd "dollup-admin" && yarn dev
```
Open `http://localhost:3001/abandoned-carts`. Confirm:
- Two new buttons appear per row.
- For a row without an email: both buttons disabled with tooltip "no email on cart".
- For a row with an email: both buttons clickable; clicking "Check-in" shows "Sending…" then "Check-in sent <m> ago" and toast "Check-in email sent".
- After Check-in is sent, the Coupon button is still clickable.

If you don't want to send real emails during smoke, point the dev frontend at a backend dev server with a no-op Resend key — the route still writes metadata and returns 200.

- [ ] **Step 7: Commit**

```bash
cd "dollup-admin" && git add src/app/\(app\)/abandoned-carts/components/AbandonedCartsClient.tsx && git commit -m "feat(abandoned-carts): per-row check-in + 5% coupon buttons"
```

---

## Task 10: Backend build + final type-check across both repos

- [ ] **Step 1: Backend build**

Run:
```bash
cd "Backend/dollup-medusa" && yarn build 2>&1 | tail -30
```
Expected: clean build. If any TS error references our new files, fix inline. Pre-existing unrelated TS errors (e.g. `stories/service.ts:447` flagged in past sessions) are NOT in scope.

- [ ] **Step 2: Frontend build**

Run:
```bash
cd "dollup-admin" && yarn build 2>&1 | tail -30
```
Expected: clean build.

- [ ] **Step 3: Run all unit tests**

Run:
```bash
cd "Backend/dollup-medusa" && yarn test:unit
```
Expected: PASS.

- [ ] **Step 4: Commit any small fixes**

If steps 1–3 needed small adjustments:

```bash
cd "Backend/dollup-medusa" && git add -p && git commit -m "fix(abandoned-carts): build/type fixes from full build"
cd "dollup-admin" && git add -p && git commit -m "fix(abandoned-carts): build/type fixes from full build"
```

Skip this step if no fixes were needed.

---

## Task 11: Push + live smoke

- [ ] **Step 1: Push both repos**

```bash
cd "Backend/dollup-medusa" && git push origin master
cd "dollup-admin" && git push origin master
```

- [ ] **Step 2: Wait for Coolify to deploy backend, then frontend**

Watch Coolify UI for both `dollup-medusa` and `dollup-admin` to finish deploying. Backend MUST be live before testing the frontend.

- [ ] **Step 3: Live smoke — check-in template**

1. Open `https://admin.dollupboutique.com/abandoned-carts` (or wherever your admin is deployed).
2. Find a row with your own test email (or seed a cart by adding items to your own cart on dollupboutique.com without checking out).
3. Click **Check-in**.
4. Confirm toast "Check-in email sent".
5. Open Resend dashboard → confirm the send went out.
6. Open your inbox → confirm email arrives, items render, click "Resume your cart" → confirm storefront loads with the cart (if cart-resume isn't wired, file follow-up but DON'T regress — the email still has value).
7. Refresh `/abandoned-carts` → button now reads "Check-in sent <time> ago" and is disabled.
8. Try clicking it again — disabled, no-op.

- [ ] **Step 4: Live smoke — coupon template**

1. Same row. Click **5% coupon**.
2. Toast shows "Coupon RECOVER-XXXXX sent".
3. Resend dashboard shows the coupon email send.
4. Inbox → coupon email renders with the code in a coral box, expiry date visible.
5. Click "Resume your cart" → storefront opens with cart restored.
6. At checkout, paste/apply the code → 5% discount applied.
7. Open Medusa admin → Promotions → confirm `RECOVER-XXXXX` exists.
8. Refresh `/abandoned-carts` → both buttons now disabled.

- [ ] **Step 5: Live smoke — error paths**

1. Find a cart with no email (or pick one). Confirm both buttons are disabled with tooltip "no email on cart".
2. Use `curl` against the live backend to try `template: "bogus"` and confirm 400 (only if admin auth is straightforward; otherwise skip).

- [ ] **Step 6: Record outcome in memory**

If everything passes, update `MEMORY.md` with a new entry pointing to a short status file documenting: route, templates, commit SHAs, smoke results, and any deferred items (cart-resume not wired, etc.).

Format:
```
- [Abandoned cart recovery emails SHIPPED 2026-05-27](abandoned-cart-recovery-emails-2026-05-27.md) — manual /abandoned-carts buttons send check-in + 5% coupon. Backend @ <sha>, dollup-admin @ <sha>. State tracked in cart.metadata.recovery_emails.
```

If anything failed, capture details in the same memory file as open follow-ups before declaring the task done.

---

## Risks called out in spec & how this plan handles them

- **`cart.metadata` write may not persist (per `abandoned-carts-admin-2026-05-22` memory).** Task 7's integration test reads metadata back after the write — if that test fails, do NOT continue to frontend tasks. Promote to Approach B (new `cart_recovery_email` table) and re-plan from Task 5 onward.
- **`?cart_id=` storefront resume is unverified.** Task 11 step 3 confirms it. If it doesn't restore, file a DUB-front follow-up but ship the rest — the email still drives a return visit.
- **Resend failure after promo creation.** Per spec, leaves the promo alive. Route returns 500. Frontend toasts the error; row state unchanged so operator can retry.
- **Promotion expiry & single-use are NOT enforced server-side in v1.** In Medusa v2, `starts_at`/`ends_at` live on the *campaign* entity, and there is no per-promotion `usage_limit` field. Creating a one-off campaign per coupon is overkill for v1. The email tells the customer the code expires in 14 days, and `expires_at` is stored in `cart.metadata.recovery_emails` for the operator's reference. **Trade-off:** the code technically remains usable past the displayed expiry and re-usable across orders until manually deleted. Acceptable risk at current scale (handful of coupons/day to known emails). Follow-up: add a weekly cron that deletes promotions whose code starts with `RECOVER-` and whose stored `expires_at` < now — file this AFTER live smoke if any abuse is observed.

---

## Out of scope (don't expand)

- Cron / auto follow-up.
- Reply/open tracking.
- Redemption analytics.
- Customer-restricted promo codes.
- SMS / WhatsApp recovery templates.
- A new `cart_recovery_email` table (fallback path, see risks above).
