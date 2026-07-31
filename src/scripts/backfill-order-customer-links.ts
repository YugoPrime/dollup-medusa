import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Re-point orders that are stranded on a GUEST customer record onto the real
 * account that owns the same email address.
 *
 * Why these exist: until the 2026-07-31 storefront fix, checkout-time signup
 * logged in BEFORE `POST /store/customers` created the customer row, so the
 * session's `actor_id` claim was "". Medusa 401s every store route that needs a
 * *registered* customer — including `POST /store/carts/:id/customer`
 * (transferCart). The cart therefore kept the guest customer_id Medusa stamps on
 * it at `cart.update({ email })`, cart.complete froze that id onto the order,
 * and the order never appeared under /account/orders. Same end state for anyone
 * who checked out logged-out, or who registered after ordering as a guest.
 *
 *   set -a; . ./.env; set +a
 *   yarn medusa exec ./src/scripts/backfill-order-customer-links.ts          # dry run
 *   APPLY=true yarn medusa exec ./src/scripts/backfill-order-customer-links.ts
 *
 * Env flags:
 *   APPLY=true            actually write. Default is DRY RUN — reports only.
 *   ORDER_DISPLAY_ID=694  target a single order by its # number
 *   INCLUDE_CANCELED=true also relink canceled orders (default: skip them)
 *
 * Safety rules, all enforced below — it refuses rather than guesses:
 *   - only relinks when the order's CURRENT customer is a guest (has_account
 *     false) or null. An order already on a real account is never touched.
 *   - only relinks when that guest record's email matches the order's email,
 *     so a shared/blank guest row can't drag unrelated orders across.
 *   - refuses any email that resolves to more than one account.
 *   - leaves the guest customer rows in place. Carts, addresses and order
 *     history reference them; deleting is a separate, riskier decision.
 *
 * Idempotent: re-running after a successful pass finds nothing to do.
 */
export default async function backfillOrderCustomerLinks({
  container,
}: {
  container: any
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const orderModule = container.resolve(Modules.ORDER)
  const customerModule = container.resolve(Modules.CUSTOMER)

  const APPLY = process.env.APPLY === "true"
  const targetDisplayId = process.env.ORDER_DISPLAY_ID
  const includeCanceled = process.env.INCLUDE_CANCELED === "true"

  const norm = (e?: string | null) => (e ?? "").trim().toLowerCase()

  // ---- load every customer record ----------------------------------------
  const customers: Array<{
    id: string
    email: string
    has_account: boolean
    created_at: Date
  }> = []
  for (let skip = 0; ; skip += 500) {
    const page = await customerModule.listCustomers(
      {},
      { select: ["id", "email", "has_account", "created_at"], take: 500, skip },
    )
    customers.push(...page)
    if (page.length < 500) break
  }

  const byId = new Map(customers.map((c) => [c.id, c]))
  const accountsByEmail = new Map<string, typeof customers>()
  for (const c of customers) {
    if (!c.has_account) continue
    const key = norm(c.email)
    if (!key) continue
    const bucket = accountsByEmail.get(key) ?? []
    bucket.push(c)
    accountsByEmail.set(key, bucket)
  }

  // ---- load every order ---------------------------------------------------
  const orders: Array<{
    id: string
    display_id: number
    email: string
    customer_id: string | null
    status: string
    created_at: Date
  }> = []
  for (let skip = 0; ; skip += 500) {
    const page = await orderModule.listOrders(
      {},
      {
        select: [
          "id",
          "display_id",
          "email",
          "customer_id",
          "status",
          "created_at",
        ],
        take: 500,
        skip,
      },
    )
    orders.push(...page)
    if (page.length < 500) break
  }

  logger.info(
    `Loaded ${orders.length} orders and ${customers.length} customer records ` +
      `(${accountsByEmail.size} distinct account emails).`,
  )

  // ---- classify -----------------------------------------------------------
  const relink: Array<{
    id: string
    display_id: number
    email: string
    from: string | null
    to: string
  }> = []
  const skipped: string[] = []

  for (const o of orders) {
    if (targetDisplayId && String(o.display_id) !== String(targetDisplayId)) {
      continue
    }
    if (!includeCanceled && o.status === "canceled") continue

    const accounts = accountsByEmail.get(norm(o.email))
    if (!accounts?.length) continue

    if (accounts.length > 1) {
      skipped.push(
        `#${o.display_id} ${o.email} — ${accounts.length} accounts share this email, resolve by hand`,
      )
      continue
    }
    const account = accounts[0]
    if (o.customer_id === account.id) continue // already correct

    if (o.customer_id) {
      const current = byId.get(o.customer_id)
      if (!current) {
        skipped.push(
          `#${o.display_id} ${o.email} — current customer_id ${o.customer_id} not found`,
        )
        continue
      }
      if (current.has_account) {
        skipped.push(
          `#${o.display_id} ${o.email} — already on a REAL account (${current.id}), not touching`,
        )
        continue
      }
      if (norm(current.email) !== norm(o.email)) {
        skipped.push(
          `#${o.display_id} ${o.email} — guest record ${current.id} has a different email (${current.email})`,
        )
        continue
      }
    }

    relink.push({
      id: o.id,
      display_id: o.display_id,
      email: o.email,
      from: o.customer_id,
      to: account.id,
    })
  }

  relink.sort((a, b) => a.display_id - b.display_id)

  logger.info("")
  logger.info(
    `=== ${relink.length} order(s) to relink onto their account ===${
      APPLY ? "" : "   [DRY RUN — nothing will be written]"
    }`,
  )
  for (const r of relink) {
    logger.info(
      `  #${String(r.display_id).padEnd(5)} ${r.email.padEnd(36)} ${r.from ?? "NULL"} -> ${r.to}`,
    )
  }
  if (skipped.length) {
    logger.info("")
    logger.info(`=== ${skipped.length} skipped (need a human) ===`)
    for (const s of skipped) logger.info(`  ${s}`)
  }

  const affected = new Set(relink.map((r) => norm(r.email)))
  logger.info("")
  logger.info(`Accounts affected: ${affected.size}`)

  if (!APPLY) {
    logger.info("")
    logger.info("DRY RUN — re-run with APPLY=true to write these changes.")
    return
  }
  if (!relink.length) {
    logger.info("Nothing to do.")
    return
  }

  // ---- write, one at a time so a single failure can't take the batch down --
  let ok = 0
  const failures: string[] = []
  for (const r of relink) {
    try {
      await orderModule.updateOrders([{ id: r.id, customer_id: r.to }])
      ok++
    } catch (e: any) {
      failures.push(`#${r.display_id}: ${e?.message ?? e}`)
    }
  }

  logger.info("")
  logger.info(`Relinked ${ok}/${relink.length} orders.`)
  if (failures.length) {
    logger.error(`${failures.length} failed:`)
    for (const f of failures) logger.error(`  ${f}`)
  }

  // ---- verify by re-reading what we just wrote ----------------------------
  const ids = relink.map((r) => r.id)
  const after = await orderModule.listOrders(
    { id: ids },
    { select: ["id", "display_id", "customer_id"], take: ids.length },
  )
  const expected = new Map(relink.map((r) => [r.id, r.to]))
  const wrong = after.filter(
    (o: any) => o.customer_id !== expected.get(o.id),
  )
  if (wrong.length) {
    logger.error(
      `VERIFY FAILED — ${wrong.length} order(s) did not persist: ${wrong
        .map((o: any) => `#${o.display_id}`)
        .join(", ")}`,
    )
  } else {
    logger.info(
      `VERIFIED — all ${after.length} orders now read back with the account customer_id.`,
    )
  }
}
