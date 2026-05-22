import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const now = Date.now();
  const upper = new Date(now - ONE_HOUR_MS).toISOString();
  const lower = new Date(now - SEVEN_DAYS_MS).toISOString();

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "email",
      "completed_at",
      "created_at",
      "updated_at",
      "currency_code",
      "summary.*",
      "items.*",
      "shipping_address.*",
      "billing_address.*",
      "customer.*",
    ],
    filters: {
      completed_at: null,
      updated_at: { $gte: lower, $lte: upper },
    },
    pagination: { take: 500, order: { updated_at: "DESC" } },
  });

  const shaped = (carts ?? []).map((c: any) => ({
    ...c,
    total: c.summary?.current_order_total ?? c.summary?.original_order_total ?? 0,
  }));
  res.json({ carts: shaped });
}
