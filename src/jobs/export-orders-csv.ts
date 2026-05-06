import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { Readable } from "node:stream"
import { JWT } from "google-auth-library"
import { drive as driveClient } from "@googleapis/drive"

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID
const SA_KEY = process.env.GOOGLE_DRIVE_SA_KEY
const RETENTION_DAYS = 30
const LOOKBACK_DAYS = 90
const FILE_PREFIX = "dollup-orders-"

type SkuItem = { sku: string; size: string; color: string; quantity: number; title: string }

function csvEscape(v: unknown): string {
  if (v == null) return ""
  const s = String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

// MU is UTC+4 fixed.
function muDate(d: Date): string {
  const muMs = d.getTime() + 4 * 60 * 60 * 1000
  return new Date(muMs).toISOString().slice(0, 10)
}

// Variants store title as "Color / Size" in this codebase. Output as
// "${SKU} ${size} ${color}" to match the Google Sheet convention
// (e.g. "IS2316 S Blue").
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

export default async function exportOrdersCsv(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  if (!FOLDER_ID || !SA_KEY) {
    logger.warn(
      "[export-orders-csv] missing GOOGLE_DRIVE_FOLDER_ID or GOOGLE_DRIVE_SA_KEY — skipping run",
    )
    return
  }

  let credentials: { client_email?: string; private_key?: string }
  try {
    credentials = JSON.parse(SA_KEY)
  } catch {
    logger.error(
      "[export-orders-csv] GOOGLE_DRIVE_SA_KEY is not valid JSON — skipping run",
    )
    return
  }
  if (!credentials.client_email || !credentials.private_key) {
    logger.error(
      "[export-orders-csv] SA key missing client_email or private_key — skipping run",
    )
    return
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

  const rows: string[][] = [HEADERS as unknown as string[]]

  for (const o of orders ?? []) {
    if (!o) continue
    const meta = (o.metadata ?? {}) as Record<string, unknown>
    const items = (o.items ?? []).filter((i): i is NonNullable<typeof i> => i != null)

    const variantItems = items.filter((i) => i.variant_id != null)
    const manualItems = items.filter((i) => i.variant_id == null)

    const variantSlots = variantItems
      .slice(0, 6)
      .map((i) => formatVariantSku(i))
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
      String(shipping),
      String(discount),
      String(total),
      paymentMethod,
      pointOfSale,
      saleType,
      status,
    ])
  }

  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n"

  const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  })
  const drive = driveClient({ version: "v3", auth })

  const today = muDate(new Date())
  const filename = `${FILE_PREFIX}${today}.csv`

  // Same-day re-run replaces the existing file rather than creating duplicates.
  const existing = await drive.files.list({
    q: `'${FOLDER_ID}' in parents and name='${filename}' and trashed=false`,
    fields: "files(id, name)",
    pageSize: 10,
    spaces: "drive",
  })
  const existingId = existing.data.files?.[0]?.id

  const media = { mimeType: "text/csv", body: Readable.from(csv) }

  if (existingId) {
    await drive.files.update({
      fileId: existingId,
      media,
    })
  } else {
    await drive.files.create({
      requestBody: {
        name: filename,
        parents: [FOLDER_ID],
        mimeType: "text/csv",
      },
      media,
    })
  }

  // Retention: drop files older than RETENTION_DAYS days.
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS)
  const cutoffMs = cutoff.getTime()

  const allFiles = await drive.files.list({
    q: `'${FOLDER_ID}' in parents and name contains '${FILE_PREFIX}' and trashed=false`,
    fields: "files(id, name, createdTime)",
    pageSize: 200,
    spaces: "drive",
  })

  let pruned = 0
  for (const f of allFiles.data.files ?? []) {
    if (!f.id || !f.createdTime) continue
    if (new Date(f.createdTime).getTime() < cutoffMs) {
      try {
        await drive.files.delete({ fileId: f.id })
        pruned += 1
      } catch (err) {
        logger.warn(
          `[export-orders-csv] failed to delete ${f.name}: ${(err as Error).message}`,
        )
      }
    }
  }

  logger.info(
    `[export-orders-csv] uploaded ${filename} — ${(orders ?? []).length} orders, ${csv.length} bytes${
      pruned > 0 ? `, pruned ${pruned} old file(s)` : ""
    }`,
  )
}

export const config = {
  name: "export-orders-csv",
  // 22:00 UTC daily = 02:00 Mauritius time (UTC+4).
  schedule: "0 22 * * *",
}
