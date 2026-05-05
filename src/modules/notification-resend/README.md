# notification-resend

Resend email provider for the Medusa Notification Module.

## Required env vars (Coolify)

- `RESEND_API_KEY` — `re_...` from https://resend.com/api-keys (Full Access scope)
- `RESEND_FROM_EMAIL` — must match a verified Resend domain. Default: `hello@dollupboutique.com`

## Optional env vars

- `RESEND_FROM_NAME` — display name (default `Doll Up Team`)
- `RESEND_REPLY_TO` — reply-to address (default = same as FROM_EMAIL)
- `STOREFRONT_URL` — used in email links + logo (default `https://shop.dollupboutique.com`)

When `RESEND_API_KEY` or `RESEND_FROM_EMAIL` is missing, the provider is **not registered** — Medusa boots cleanly without email and the local `feed` provider still drives admin notifications.

## Templates

| key | trigger event | sent to |
|---|---|---|
| `order-placed` | `order.placed` | customer email on the order |
| `order-shipped` | `dm.order.shipped` (custom) | customer email on the order |
| `welcome` | `customer.created` (only when `has_account=true`) | new customer |
| `password-reset` | `auth.password_reset` (only `actor_type="customer"`) | the email requesting reset |

The shipped email's body adapts to `order.metadata.delivery_method`:
- `Pick Up` → "Ready for pickup at Pereybere"
- `Home Delivery` → "Scheduled for delivery on [date]"
- `Postage` / `Express Postage` / `Rodrigues Postage` → "Shipped via post" + tracking number

## Triggering the shipped email

The DM admin calls `POST /admin/orders/{id}/notify-shipped` after marking shipped.
- Sets `metadata.dm_status = "shipped"` and `metadata.shipped_at`
- Optional body: `{ "tracking_number": "..." }` to set tracking at the same time
- Emits `dm.order.shipped` → email fires once

To re-send the email manually:

```bash
curl -X POST https://api.dollupboutique.com/admin/orders/<id>/notify-shipped \
  -H "Cookie: <admin session>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Testing locally

1. Set env vars in `.env`
2. `yarn dev`
3. Trigger via:
   - Place a test order on the storefront → expect "Order placed" email
   - Register a new customer → expect "Welcome" email
   - Hit `POST /admin/orders/{id}/notify-shipped` → expect shipped email
   - Hit `POST /auth/customer/emailpass/reset-password` (storefront) → expect reset email

Logs from the provider include the Resend message id on success and the Resend error name/message on failure.
