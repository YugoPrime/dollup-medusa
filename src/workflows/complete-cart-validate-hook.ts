import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import { assertCartHasLoyaltyDiscount } from "./apply-loyalty-discount"
import { assertCartHasMysteryBoxDiscount } from "./apply-mystery-box-discount"

// Medusa allows a single handler per workflow hook. Both the loyalty and
// mystery-box features need a guard at cart completion, so they share this
// one registration and run their assertions in sequence.
completeCartWorkflow.hooks.validate(async ({ cart }) => {
  assertCartHasLoyaltyDiscount(
    cart as Parameters<typeof assertCartHasLoyaltyDiscount>[0],
  )
  assertCartHasMysteryBoxDiscount(
    cart as Parameters<typeof assertCartHasMysteryBoxDiscount>[0],
  )
})
