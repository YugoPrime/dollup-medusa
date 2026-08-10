import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, QueryContext } from "@medusajs/framework/utils"

type VariantLike = {
  id?: string
  title?: string | null
  sku?: string | null
  manage_inventory?: boolean | null
  inventory_items?: Array<{
    inventory?: {
      location_levels?: Array<{
        stocked_quantity?: number | null
        reserved_quantity?: number | null
      }>
    } | null
  }> | null
  calculated_price?: { calculated_amount?: number | string | null } | null
  options?: Array<{ value?: string | null }> | null
}

type ProductLike = {
  id?: string
  title?: string | null
  handle?: string | null
  thumbnail?: string | null
  variants?: VariantLike[] | null
}

/**
 * Real stock, via inventory_items → inventory → location_levels.
 *
 * Do NOT switch this to `variants.inventory_quantity`. That virtual field does
 * not hydrate reliably through query.graph — see the comment at
 * src/api/store/mystery-box/create-cart/route.ts:183. Using it makes the agent
 * tell customers that in-stock items are sold out.
 */
export function summarizeStock(product: ProductLike): {
  inStock: number
  unlimited: boolean
} {
  let inStock = 0
  let unlimited = false
  for (const v of product.variants ?? []) {
    if (v.manage_inventory === false) {
      unlimited = true
      continue
    }
    let total = 0
    for (const item of v.inventory_items ?? []) {
      for (const level of item.inventory?.location_levels ?? []) {
        total += Number(level.stocked_quantity ?? 0) - Number(level.reserved_quantity ?? 0)
      }
    }
    inStock += Math.max(0, total)
  }
  return { inStock, unlimited }
}

/** MUR major units (1450 = Rs 1,450), matching how prices are stored. */
export function priceOf(product: ProductLike): number | null {
  const amount = product.variants?.[0]?.calculated_price?.calculated_amount
  if (amount === null || amount === undefined) return null
  const n = Number(amount)
  return Number.isFinite(n) ? n : null
}

const PRODUCT_FIELDS = [
  "id",
  "title",
  "handle",
  "thumbnail",
  "variants.id",
  "variants.title",
  "variants.sku",
  "variants.manage_inventory",
  "variants.options.value",
  "variants.inventory_items.inventory.location_levels.stocked_quantity",
  "variants.inventory_items.inventory.location_levels.reserved_quantity",
  "variants.calculated_price.*",
]

const MUR_CONTEXT = {
  variants: { calculated_price: QueryContext({ currency_code: "mur" }) },
}

/**
 * Tool list. ORDER IS LOAD-BEARING: tools render at the very front of the
 * prompt, before the system block, so reordering or conditionally including
 * one invalidates the entire prompt cache. Append new tools at the end.
 */
export const TOOL_DEFINITIONS = [
  {
    name: "search_products",
    description:
      "Cherche des articles publiés dans le catalogue Doll Up par mots-clés (nom, type, couleur). Renvoie titre, prix en roupies, lien et disponibilité. Utilise cet outil dès qu'une cliente évoque un article, avant de répondre quoi que ce soit sur le prix ou la disponibilité.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Mots-clés, par ex. « robe rouge » ou « IS1361 »" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_product_details",
    description:
      "Renvoie le détail d'un article : toutes ses tailles et couleurs avec le stock réel de chacune, et son prix. C'est la SEULE source légitime pour affirmer qu'une taille est disponible.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        handle: { type: "string", description: "Le handle renvoyé par search_products" },
      },
      required: ["handle"],
      additionalProperties: false,
    },
  },
  {
    name: "lookup_order",
    description:
      "Retrouve une commande à partir de son numéro ET du téléphone de la cliente. Les deux sont obligatoires : sans le téléphone correspondant, rien n'est renvoyé. Renvoie le statut et les articles, jamais l'adresse.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        order_number: { type: "string", description: "Numéro de commande, avec ou sans #" },
        phone: { type: "string", description: "Téléphone donné par la cliente" },
      },
      required: ["order_number", "phone"],
      additionalProperties: false,
    },
  },
  {
    name: "send_reply",
    description:
      "Envoie ta réponse à la cliente. Termine TOUJOURS par cet outil ou par escalate_to_human, jamais les deux, jamais aucun.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Le message, dans la langue de la cliente" },
        confidence: {
          type: "number",
          description:
            "0 à 1. Ta certitude que cette réponse est exacte et complète. Sois honnête : en dessous de 0,7 un humain reprend la main.",
        },
        intent: {
          type: "string",
          enum: ["product", "stock", "price", "order_status", "policy", "greeting", "other"],
        },
        language: { type: "string", enum: ["fr", "en", "kreol", "mixed"] },
      },
      required: ["text", "confidence", "intent", "language"],
      additionalProperties: false,
    },
  },
  {
    name: "escalate_to_human",
    description:
      "Passe la conversation à l'équipe. Utilise-le pour tout remboursement, réclamation, article abîmé, litige, ou dès que tu n'es pas sûre.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Une phrase : pourquoi un humain est nécessaire" },
        severity: { type: "string", enum: ["normal", "urgent"] },
      },
      required: ["reason", "severity"],
      additionalProperties: false,
    },
  },
] as const satisfies ReadonlyArray<{
  name: string
  description: string
  strict: true
  input_schema: {
    type: "object"
    properties: Record<string, unknown>
    required: string[]
    additionalProperties: false
  }
}>

export async function executeTool(
  scope: MedusaContainer,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)

  if (name === "search_products") {
    const q = String(input.query ?? "").trim()
    if (!q) return { results: [] }
    const { data } = await query.graph({
      entity: "product",
      fields: PRODUCT_FIELDS,
      // `q` is a real full-text filter Medusa's remote query accepts at
      // runtime; the generated RemoteQueryFilters<"product"> type just
      // doesn't know about it (same mistype documented on `display_id`
      // below and in src/api/store/orders/lookup/route.ts).
      filters: { status: "published", q } as never,
      pagination: { take: 8 },
      context: MUR_CONTEXT,
    })
    const results = ((data ?? []) as ProductLike[]).map((p) => {
      const stock = summarizeStock(p)
      return {
        title: p.title,
        handle: p.handle,
        price_mur: priceOf(p),
        available: stock.unlimited || stock.inStock > 0,
        url: `https://dollupboutique.com/products/${p.handle}`,
      }
    })
    return { results }
  }

  if (name === "get_product_details") {
    const handle = String(input.handle ?? "").trim()
    const { data } = await query.graph({
      entity: "product",
      fields: PRODUCT_FIELDS,
      filters: { status: "published", handle },
      pagination: { take: 1 },
      context: MUR_CONTEXT,
    })
    const product = ((data ?? []) as ProductLike[])[0]
    if (!product) return { found: false }
    return {
      found: true,
      title: product.title,
      price_mur: priceOf(product),
      url: `https://dollupboutique.com/products/${product.handle}`,
      variants: (product.variants ?? []).map((v) => {
        const stock = summarizeStock({ variants: [v] })
        return {
          label: v.title,
          sku: v.sku ?? null,
          options: (v.options ?? []).map((o) => o.value).filter(Boolean),
          available: stock.unlimited || stock.inStock > 0,
          quantity: stock.unlimited ? null : stock.inStock,
        }
      }),
    }
  }

  if (name === "lookup_order") {
    const raw = String(input.order_number ?? "").replace(/[^0-9]/g, "")
    const phone = String(input.phone ?? "").replace(/[^0-9]/g, "")
    // Both are mandatory. A web visitor has no linked customer record, so the
    // phone match is the ONLY thing standing between a guessed order number
    // and another customer's data.
    if (!raw || phone.length < 6) return { found: false }

    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "status",
        "fulfillment_status",
        "metadata",
        "items.title",
        "items.quantity",
        "shipping_address.phone",
      ],
      // Medusa's generated filter type mistypes the integer `display_id`
      // column as a string filter; the runtime accepts numbers. Same
      // documented workaround as src/api/store/orders/lookup/route.ts.
      filters: { display_id: Number(raw) } as never,
      pagination: { take: 1 },
    })
    const order = ((data ?? []) as unknown as Array<{
      display_id?: number
      status?: string
      fulfillment_status?: string
      metadata?: Record<string, unknown> | null
      items?: Array<{ title?: string; quantity?: number }>
      shipping_address?: { phone?: string | null } | null
    }>)[0]
    if (!order) return { found: false }

    const onFile = (order.shipping_address?.phone ?? "").replace(/[^0-9]/g, "")
    // Compare the last 7 digits so +230 / 230 / bare local all match.
    if (!onFile || onFile.slice(-7) !== phone.slice(-7)) return { found: false }

    return {
      found: true,
      order_number: order.display_id,
      status: order.status,
      fulfillment_status: order.fulfillment_status ?? "not_fulfilled",
      rapido_status: (order.metadata as Record<string, unknown>)?.rapido_status ?? null,
      item_count: (order.items ?? []).reduce((n, i) => n + Number(i.quantity ?? 0), 0),
      items: (order.items ?? []).map((i) => i.title).filter(Boolean),
      // Deliberately no address, email, or name.
    }
  }

  throw new Error(`Unknown tool: ${name}`)
}
