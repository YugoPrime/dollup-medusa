import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"

import { classifyLink } from "../../../../../../modules/newsletter/lib/resend-event"
import {
  computeCampaignResults,
  SALES_WINDOW_DAYS,
  type ResultsOrder,
  type ResultsProduct,
} from "../../../../../../modules/newsletter/lib/results"
import { normalizeEmail } from "../../../../../../modules/newsletter/lib/email"
import { netRevenueMur } from "../../../../../../lib/daily-sales-report"
import { sendError } from "../../../../../../modules/newsletter/route-deps"
import { NEWSLETTER_MODULE } from "../../../../../../modules/newsletter"
import type NewsletterModuleService from "../../../../../../modules/newsletter/service"
import type { CampaignDTO } from "../../../../../../modules/newsletter/types"

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_ORDERS = 5000

type OrderService = {
  listOrders: (
    filters: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<
    Array<{
      id: string
      display_id?: number | null
      email?: string | null
      created_at: Date | string
      status?: string
      total?: unknown
      metadata?: Record<string, unknown> | null
    }>
  >
}
type ProductService = {
  listProducts: (
    filters: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<Array<{ id: string; handle: string; title: string; thumbnail: string | null }>>
}

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try {
    const service = req.scope.resolve<NewsletterModuleService>(NEWSLETTER_MODULE)
    const campaign = (await service.retrieveNewsletterCampaign(req.params.id)) as unknown as CampaignDTO
    if (!campaign.sent_at || (campaign.status !== "sent" && campaign.status !== "sending")) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Results show once the campaign is sent")
    }
    const sentAt = new Date(campaign.sent_at)
    const now = new Date()
    const storefrontUrl =
      (process.env.STOREFRONT_URL ?? "").trim().replace(/\/+$/, "") || "https://dollupboutique.com"

    const events = await service.listCampaignEvents(campaign.id)
    const hasDelivered = events.some((e) => e.type === "delivered")
    const recipientsFallback = hasDelivered ? [] : await service.recipientsAtSend(campaign.list, sentAt)
    const unsubscribedInWindow = await service.unsubscribedBetween(
      campaign.list,
      sentAt,
      new Date(sentAt.getTime() + SALES_WINDOW_DAYS * DAY_MS)
    )

    // Orders: `total` must be selected or the order module skips its totals calculator (Rs 0).
    const orderService = req.scope.resolve(Modules.ORDER) as OrderService
    // Read orders up to 7 days after the send AND 7 days after the latest click (a late click keeps its full window).
    const lastClick = events.reduce(
      (t, e) => (e.type === "clicked" ? Math.max(t, new Date(e.occurred_at).getTime()) : t),
      sentAt.getTime()
    )
    const until = new Date(Math.min(now.getTime(), lastClick + SALES_WINDOW_DAYS * DAY_MS))
    const rawOrders = (
      await orderService.listOrders(
        { created_at: { $gte: sentAt, $lte: until } },
        {
          select: ["id", "display_id", "email", "created_at", "status", "total", "metadata"],
          take: MAX_ORDERS,
        }
      )
    ).filter((o) => o.status !== "canceled" && o.status !== "draft")

    const productIdsByOrder = new Map<string, string[]>()
    if (rawOrders.length > 0) {
      const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "order",
        fields: ["id", "items.product_id"],
        filters: { id: rawOrders.map((o) => o.id) },
      })
      for (const o of data as Array<{ id: string; items?: Array<{ product_id?: string | null } | null> | null }>) {
        productIdsByOrder.set(
          o.id,
          (o.items ?? []).map((i) => i?.product_id).filter((id): id is string => !!id)
        )
      }
    }
    const orders: ResultsOrder[] = rawOrders.map((o) => ({
      id: o.id,
      display_id: o.display_id ?? null,
      email: normalizeEmail(o.email ?? ""),
      created_at: new Date(o.created_at),
      // Net of exchange credit, like the daily sales report (BigNumber read via valueOf, never `.value`).
      total: netRevenueMur({ id: o.id, created_at: o.created_at, total: o.total, metadata: o.metadata ?? null }),
      product_ids: productIdsByOrder.get(o.id) ?? [],
    }))

    // Products in the email, plus any other product page someone clicked.
    const clickedHandles = new Set<string>()
    for (const e of events) {
      if (e.type !== "clicked" || !e.link) continue
      const t = classifyLink(e.link, storefrontUrl)
      if (t.kind === "product") clickedHandles.add(t.handle)
    }
    const productService = req.scope.resolve(Modules.PRODUCT) as ProductService
    const select = { select: ["id", "handle", "title", "thumbnail"], take: null }
    const products: ResultsProduct[] = []
    if (campaign.product_ids.length > 0) {
      products.push(...(await productService.listProducts({ id: campaign.product_ids }, select)))
    }
    const missing = [...clickedHandles].filter((h) => !products.some((p) => p.handle === h))
    if (missing.length > 0) {
      products.push(...(await productService.listProducts({ handle: missing }, select)))
    }

    res.json({
      results: computeCampaignResults({
        campaign: {
          id: campaign.id,
          sent_at: sentAt,
          recipient_count: campaign.recipient_count,
          product_ids: campaign.product_ids,
        },
        events: events.map((e) => ({ ...e, occurred_at: new Date(e.occurred_at) })),
        recipientsFallback,
        orders,
        unsubscribedInWindow,
        products,
        storefrontUrl,
        now,
      }),
    })
  } catch (err) {
    sendError(res, err, req.scope.resolve("logger"))
  }
}
