/**
 * Configures the FREE promotion to auto-apply free shipping when item_total >= 1500.
 *
 * Two things this script enforces, both invisible in the Medusa admin UI:
 *   1. Cart rule `item_total >= 1500` — gate so the promo only fires above
 *      the threshold. Cart-attribute rules aren't in the admin form.
 *   2. `is_automatic: true` — promotion fires without the customer typing the
 *      "FREE" code. The admin form has the toggle, but we re-assert it here so
 *      a fresh-install re-run leaves the promo automatic.
 *
 * Run: yarn medusa exec ./src/scripts/setup-free-shipping-promo.ts
 *
 * Idempotent — safe to re-run.
 */
import { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

const PROMO_CODE = "FREE";
const RULE_ATTRIBUTE = "item_total";
const RULE_OPERATOR = "gte";
const RULE_VALUE = "1500"; // raw MUR (Medusa stores MUR as integer, no decimals)

export default async function setupFreeShippingPromo({ container }: ExecArgs) {
  const logger = container.resolve("logger" as any) as any;
  const promotionModuleService = container.resolve(Modules.PROMOTION);

  logger.info(`Looking up promotion with code="${PROMO_CODE}"...`);
  const [promo] = await promotionModuleService.listPromotions(
    { code: PROMO_CODE },
    { relations: ["rules", "rules.values"] },
  );

  if (!promo) {
    throw new Error(
      `No promotion found with code="${PROMO_CODE}". Create it in admin first, then re-run this script.`,
    );
  }

  logger.info(`Found promotion ${promo.id} (${promo.code}).`);

  // 1. is_automatic — flip if needed.
  if (!promo.is_automatic) {
    logger.info("Promo is not automatic. Setting is_automatic=true...");
    await promotionModuleService.updatePromotions([
      { id: promo.id, is_automatic: true },
    ]);
    logger.info("is_automatic ✅");
  } else {
    logger.info("Promo already is_automatic=true.");
  }

  // 2. item_total >= 1500 cart rule.
  const existingRule = promo.rules?.find(
    (r: any) =>
      r.attribute === RULE_ATTRIBUTE && r.operator === RULE_OPERATOR,
  );

  if (existingRule) {
    const values = (existingRule.values ?? []).map((v: any) => v.value);
    if (values.includes(RULE_VALUE)) {
      logger.info(
        `Rule already present (${RULE_ATTRIBUTE} ${RULE_OPERATOR} ${RULE_VALUE}). Nothing else to do.`,
      );
      return;
    }
    logger.info(
      `Found existing ${RULE_ATTRIBUTE} ${RULE_OPERATOR} rule with values=${JSON.stringify(values)}. Updating to ${RULE_VALUE}.`,
    );
    await promotionModuleService.updatePromotionRules([
      {
        id: existingRule.id,
        values: [RULE_VALUE],
      },
    ]);
    logger.info("Rule updated ✅");
    return;
  }

  logger.info(
    `Adding cart rule: ${RULE_ATTRIBUTE} ${RULE_OPERATOR} ${RULE_VALUE}`,
  );
  await promotionModuleService.addPromotionRules(promo.id, [
    {
      attribute: RULE_ATTRIBUTE,
      operator: RULE_OPERATOR,
      values: [RULE_VALUE],
    },
  ]);
  logger.info("Rule added ✅");
  logger.info(
    "Verify by adding a Rs 1500+ cart on the storefront — Home/Office Delivery should drop to Free without typing FREE.",
  );
}
