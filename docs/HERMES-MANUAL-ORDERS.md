# Hermes → Doll Up manual orders

How the Hermes agent creates a real, paid Messenger/WhatsApp order in Medusa.

## Auth

Hermes authenticates with a **Secret API key** tied to the dedicated `hermes@dollupboutique.com` admin user. Create it in the admin UI (Settings → Secret API keys), copy the `sk_...` value, and store it server-side as:

```
MEDUSA_ADMIN_API_KEY=sk_...    # the Secret API key from admin (never commit the real value)
MEDUSA_BACKEND_URL=https://api.dollupboutique.com
```

The key is the Basic-auth **username**, password empty (note the trailing colon):

```
Authorization: Basic base64(MEDUSA_ADMIN_API_KEY + ":")
```

Never put this key in client code. If leaked: revoke in admin, regenerate, or disable the `hermes` user.

## Endpoint

`POST {MEDUSA_BACKEND_URL}/admin/dollup/manual-orders`

### Payload (flat — the agent's natural shape)

| field | required | notes |
|---|---|---|
| `customer_name` | ✅ | or `first_name` + `last_name` |
| `phone` | recommended | stored on address + metadata |
| `address` | ✅ | street line |
| `city` | optional | defaults to "Mauritius" |
| `email` | optional | for order-confirmation email |
| `variant_id` | ✅ | the exact Medusa variant (agent already resolves this) |
| `sku` | optional | fallback label only |
| `quantity` | optional | defaults to 1 |
| `item_price` | ✅ | MUR integer, e.g. `1000` = Rs 1000 |
| `delivery_method` | ✅ | one of: `home_delivery`, `post_office`, `express`, `pickup`, `rodrigues` |
| `delivery_fee` | optional | MUR integer, e.g. `70`; defaults to 0 |
| `payment_status` | optional | `"paid"` marks it paid (sets `metadata.sale_type=paid`) |
| `delivery_date` | optional | free-text date string |
| `note` | optional | internal note |
| `external_id` | recommended | Messenger thread/message id — **idempotency key**, prevents duplicate orders on retry |

### Delivery-method mapping (handled server-side)

| agent sends | shipping option used | shows in admin/email as |
|---|---|---|
| `home_delivery` | Home/Office Delivery | Home Delivery |
| `post_office` | Registered Postage | Postage |
| `express` | Express Postage | Express Postage |
| `pickup` | Pick Up Pereybere | Pick Up |
| `rodrigues` | Rodrigues Postage | Rodrigues Postage |

### Responses

- `201` → `{ ok, order_id, display_id, total_charged, delivery_method, paid }`
- `200` + `duplicate:true` → an order with that `external_id` already exists (idempotent)
- `400` → `{ message, errors[] }` validation
- `404` → variant not found
- `409` → out of stock
- `500` → server error (detail included)

## Agent function (TypeScript / Node)

```ts
const BASE = process.env.MEDUSA_BACKEND_URL!
const KEY = process.env.MEDUSA_ADMIN_API_KEY!
const AUTH = "Basic " + Buffer.from(KEY + ":").toString("base64")

export type ManualOrder = {
  customer_name: string
  phone?: string
  address: string
  city?: string
  email?: string
  variant_id: string
  sku?: string
  quantity?: number
  item_price: number
  delivery_method:
    | "home_delivery"
    | "post_office"
    | "express"
    | "pickup"
    | "rodrigues"
  delivery_fee?: number
  payment_status?: "paid" | "unpaid"
  delivery_date?: string
  note?: string
  external_id?: string
}

export async function createDollUpOrder(order: ManualOrder) {
  const r = await fetch(`${BASE}/admin/dollup/manual-orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: AUTH },
    body: JSON.stringify(order),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    // 409 = out of stock, 404 = bad variant, 400 = validation
    throw new Error(
      `Order failed (${r.status}): ${data.message ?? "unknown"}${
        data.errors ? " — " + data.errors.join("; ") : ""
      }${data.detail ? " — " + data.detail : ""}`,
    )
  }
  return data as {
    ok: boolean
    duplicate?: boolean
    order_id: string
    display_id: number
    total_charged: number
    delivery_method: string
    paid: boolean
  }
}
```

### Example — the order from the screenshot

```ts
await createDollUpOrder({
  customer_name: "Damini Kariman",
  phone: "5702 2717",
  address: "Ave Dr Ross, Quatre Bornes",
  variant_id: "variant_01KQPN9Q8TG22HCKNGDNX9MXKV",
  sku: "IS2209-XL-Black",
  quantity: 1,
  item_price: 1000,
  delivery_method: "home_delivery",
  delivery_fee: 70,
  payment_status: "paid",
  external_id: "msgr_<thread-id>", // dedupe on retry
})
// → { ok:true, order_id, display_id, total_charged:1070, paid:true }
```

## What the order looks like in the system

- Real Medusa order, region Mauritius, currency MUR, default sales channel
- Inventory deducted (same as a storefront order)
- Appears in `/admin/prep` under the right delivery tab
- Reads as **paid** (because `metadata.sale_type=paid`) → correct shipped-email template
- Tagged `metadata.source=hermes` so agent orders are auditable
```
