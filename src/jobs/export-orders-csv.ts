import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { JWT } from "google-auth-library"
import { sheets as sheetsClient } from "@googleapis/sheets"

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
const SA_KEY = process.env.GOOGLE_DRIVE_SA_KEY
const LOOKBACK_DAYS = 90
// Hardcoded so we can clear with confidence regardless of how big the sheet
// has grown. Bump if we ever exceed it.
const CLEAR_RANGE = "A1:Z10000"

// MU is UTC+4 fixed.
function muDate(d: Date): string {
  const muMs = d.getTime() + 4 * 60 * 60 * 1000
  return new Date(muMs).toISOString().slice(0, 10)
}

function muDateTime(d: Date): string {
  const muMs = d.getTime() + 4 * 60 * 60 * 1000
  return new Date(muMs).toISOString().replace("T", " ").slice(0, 19)
}

// Accepts the SA credential as either:
//   - raw JSON (works only if your hosting can pass multiline env vars cleanly)
//   - base64-encoded JSON (single-line, recommended for Coolify / docker .env)
function parseServiceAccountKey(raw: string): {
  client_email?: string
  private_key?: string
} | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return null
    }
  }
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8")
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

// Variants store title as "Color / Size" in this codebase. Output as
// "${SKU} ${size} ${color}" to match the existing operations sheet
// convention (e.g. "IS2316 S Blue").
function formatVariantSku(item: {
  variant_sku?: string | null
  variant_title?: string | null
  product_handle?: string | null
  title?: string | null
  quantity?: number
}): string {
  const sku = (item.variant_sku ?? item.product_handle ?? "").trim()
  const title = (item.variant_title ?? "").trim()
  const qtyTag = item.quantity && item.quantity > 1 ? ` x${item.quantity}` : ""
  if (!title) return `${sku || item.title || ""}${qtyTag}`.trim()
  const parts = title.split(" / ").map((p) => p.trim()).filter(Boolean)
  if (parts.length === 2) {
    const [color, size] = parts
    return `${sku} ${size} ${color}${qtyTag}`.trim()
  }
  return `${sku} ${title}${qtyTag}`.trim()
}

function formatManualLabel(item: {
  title?: string | null
  quantity?: number
}): string {
  const t = (item.title ?? "Manual").trim()
  return item.quantity && item.quantity > 1 ? `${t} x${item.quantity}` : t
}

const HEADERS = [
  "Entry Date",
  "Delivery Date",
  "Way of Delivery",
  "GSheet Order#",
  "Buyer Name",
  "Buyer Address",
  "Buyer Address Details",
  "Buyer Contact",
  "1st Product SKU",
  "2nd Product SKU",
  "3rd Product SKU",
  "4th Product SKU",
  "5th Product SKU",
  "6th Product SKU",
  "Manual Product",
  "Delivery Cost",
  "Discount",
  "Total Sales Price",
  "Method of Payment",
  "Point of Sale",
  "Sale Type",
  "Status",
] as const

export type ExportResult = {
  ok: boolean
  spreadsheetId?: string
  rowsWritten?: number
  ordersExported?: number
  lastUpdatedAtMu?: string
  error?: string
}

export async function runExport(container: MedusaContainer): Promise<ExportResult> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  if (!SPREADSHEET_ID || !SA_KEY) {
    const msg =
      "missing GOOGLE_SHEETS_SPREADSHEET_ID or GOOGLE_DRIVE_SA_KEY — skipping run"
    logger.warn(`[export-orders-csv] ${msg}`)
    return { ok: false, error: msg }
  }

  const credentials = parseServiceAccountKey(SA_KEY)
  if (!credentials) {
    const msg =
      "GOOGLE_DRIVE_SA_KEY is not valid JSON or base64-encoded JSON — skipping run"
    logger.error(`[export-orders-csv] ${msg}`)
    return { ok: false, error: msg }
  }
  if (!credentials.client_email || !credentials.private_key) {
    const msg = "SA key missing client_email or private_key — skipping run"
    logger.error(`[export-orders-csv] ${msg}`)
    return { ok: false, error: msg }
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const since = new Date()
  since.setDate(since.getDate() - LOOKBACK_DAYS)

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "created_at",
      "metadata",
      "discount_total",
      "shipping_total",
      "total",
      "items.id",
      "items.title",
      "items.quantity",
      "items.variant_id",
      "items.variant_sku",
      "items.variant_title",
      "items.product_handle",
      "items.product_title",
      "shipping_address.first_name",
      "shipping_address.last_name",
      "shipping_address.phone",
      "shipping_address.city",
      "shipping_address.address_1",
      "shipping_address.address_2",
    ],
    filters: { created_at: { $gte: since.toISOString() } },
  })

  // Newest orders first matches the operator's existing sheet ordering.
  const sortedOrders = [...(orders ?? [])].sort((a, b) => {
    const ta = a?.created_at ? new Date(a.created_at).getTime() : 0
    const tb = b?.created_at ? new Date(b.created_at).getTime() : 0
    return tb - ta
  })

  const rows: (string | number)[][] = [HEADERS as unknown as string[]]

  for (const o of sortedOrders) {
    if (!o) continue
    const meta = (o.metadata ?? {}) as Record<string, unknown>
    const items = (o.items ?? []).filter(
      (i): i is NonNullable<typeof i> => i != null,
    )

    const variantItems = items.filter((i) => i.variant_id != null)
    const manualItems = items.filter((i) => i.variant_id == null)

    const variantSlots = variantItems.slice(0, 6).map((i) => formatVariantSku(i))
    while (variantSlots.length < 6) variantSlots.push("")

    const overflow = variantItems.slice(6).map((i) => formatVariantSku(i))
    const manualLabels = manualItems.map((i) => formatManualLabel(i))
    const manualCol = [...overflow, ...manualLabels].join(" | ")

    const addr = o.shipping_address ?? null
    const buyerName = addr
      ? `${addr.first_name ?? ""} ${addr.last_name ?? ""}`.trim()
      : ""
    const buyerCity = (addr?.city as string | null) ?? ""
    const addrDetails = [addr?.address_1, addr?.address_2]
      .filter((s) => typeof s === "string" && s.trim().length > 0)
      .join(", ")
    const buyerPhone = (addr?.phone as string | null) ?? ""

    const totalOverride =
      typeof meta.total_override_mur === "number"
        ? meta.total_override_mur
        : null
    const total = totalOverride ?? Number(o.total ?? 0)
    const shipping = Number(o.shipping_total ?? 0)
    const discount = Number(o.discount_total ?? 0)

    const entryDate = o.created_at ? muDate(new Date(o.created_at)) : ""
    const deliveryDate =
      typeof meta.delivery_date === "string" ? meta.delivery_date : ""
    const wayOfDelivery =
      typeof meta.delivery_method === "string" ? meta.delivery_method : ""
    const paymentMethod =
      typeof meta.payment_method === "string" ? meta.payment_method : ""
    const pointOfSale =
      typeof meta.point_of_sale === "string" ? meta.point_of_sale : ""
    const saleType = meta.sale_type === "paid" ? "Paid" : ""
    const status = typeof meta.dm_status === "string" ? meta.dm_status : ""
    const orderNumber =
      o.display_id != null ? `#${o.display_id}` : `#${o.id}`

    rows.push([
      entryDate,
      deliveryDate,
      wayOfDelivery,
      orderNumber,
      buyerName,
      buyerCity,
      addrDetails,
      buyerPhone,
      ...variantSlots,
      manualCol,
      shipping,
      discount,
      total,
      paymentMethod,
      pointOfSale,
      saleType,
      status,
    ])
  }

  const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  })
  const sheets = sheetsClient({ version: "v4", auth })

  // 1. Clear out everything in the canonical range so stale rows from the
  //    previous run don't linger if the order count shrank.
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: CLEAR_RANGE,
  })

  // 2. Write headers + all rows starting at A1.
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "A1",
    valueInputOption: "RAW",
    requestBody: { values: rows },
  })

  const updatedAt = muDateTime(new Date())
  const ordersCount = sortedOrders.length

  logger.info(
    `[export-orders-csv] wrote ${rows.length} rows (${ordersCount} orders) to spreadsheet ${SPREADSHEET_ID} at ${updatedAt}`,
  )

  return {
    ok: true,
    spreadsheetId: SPREADSHEET_ID,
    rowsWritten: rows.length,
    ordersExported: ordersCount,
    lastUpdatedAtMu: updatedAt,
  }
}

export default async function exportOrdersCsv(
  container: MedusaContainer,
): Promise<void> {
  await runExport(container)
}

export const config = {
  name: "export-orders-csv",
  // 22:00 UTC daily = 02:00 Mauritius time (UTC+4).
  schedule: "0 22 * * *",
}
