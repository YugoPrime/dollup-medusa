import { Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { EVENT_DRAW_MODULE } from "../modules/event-draw"
import { LOYALTY_MODULE } from "../modules/loyalty"
import type LoyaltyModuleService from "../modules/loyalty/service"
import type EventDrawModuleService from "../modules/event-draw/service"

export type CreditEventSpinInput = {
  entryId: string
  email: string
  points: number
  rewardId: string
}

export type CreditEventSpinResult = {
  customer_id: string
  credited: number
}

/**
 * Finds (or creates) the Medusa customer for a spin entrant by email, credits
 * their Doll Rewards loyalty account, and marks the entry/reward as credited.
 *
 * Entrants are NOT logged in — the only handle we have is the email they
 * typed on the wheel form — so this always resolves a customer by email
 * before crediting.
 *
 * Idempotency: `awardPoints` is keyed on `orderId = "event:" + rewardId`, so
 * re-running this for the same reward (e.g. a retried request) cannot
 * double-credit points. Awarding 0 points is a no-op success — the entry and
 * reward are still updated so the reward is marked "credited".
 *
 * Known limitation: the find-or-create-customer step below is a
 * check-then-insert race — two concurrent spins finishing for the same email
 * at the same time could each miss the other's `listCustomers` lookup and
 * both call `createCustomers`, producing two customer rows (Medusa customers
 * have no DB-unique email constraint by default). This is a narrow window
 * and out of scope to fix here; the loyalty idempotency guarantee (no
 * double-credit on retry) is unaffected either way.
 */
export async function creditEventSpinPoints(
  container: MedusaContainer,
  args: CreditEventSpinInput,
): Promise<CreditEventSpinResult> {
  const event = container.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const loyalty = container.resolve<LoyaltyModuleService>(LOYALTY_MODULE)
  const customerService: any = container.resolve(Modules.CUSTOMER)

  const email = args.email.trim().toLowerCase()

  // find-or-create customer by email
  const existing = await customerService.listCustomers({ email })
  const customer = existing?.[0] ?? (await customerService.createCustomers({ email }))

  await loyalty.ensureAccount(customer.id)
  if (args.points > 0) {
    // orderId is the idempotency key inside awardPoints
    await loyalty.awardPoints(customer.id, args.points, {
      reason: "event spin",
      orderId: `event:${args.rewardId}`,
    })
  }

  await event.updateEventEntries({ id: args.entryId, customer_id: customer.id })
  await event.updateEventRewards({ id: args.rewardId, status: "credited" })

  return { customer_id: customer.id, credited: args.points }
}
