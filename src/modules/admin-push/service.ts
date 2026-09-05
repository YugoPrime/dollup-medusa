import { MedusaError, MedusaService } from "@medusajs/framework/utils"

import AdminPushSubscription from "./models/admin-push-subscription"

export type AdminPushSubscriptionDTO = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  username: string
  user_agent: string | null
  created_at: Date
  updated_at: Date
}

export type SubscriptionInput = {
  endpoint: string
  p256dh: string
  auth: string
  username: string
  user_agent?: string | null
}

const MAX_USER_AGENT = 300

function invalid(message: string): never {
  throw new MedusaError(MedusaError.Types.INVALID_DATA, message)
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * Accepts the JSON a browser produces from `PushSubscription.toJSON()`
 * (`{ endpoint, keys: { p256dh, auth } }`) plus `username` and optional
 * `user_agent`, and returns the flat shape the model stores.
 */
export function validateSubscriptionInput(body: unknown): SubscriptionInput {
  const b = (body ?? {}) as Record<string, unknown>
  const endpoint = str(b.endpoint)
  if (!endpoint.startsWith("https://")) invalid("endpoint must be an https URL")

  const keys = (b.keys ?? {}) as Record<string, unknown>
  const p256dh = str(keys.p256dh)
  const auth = str(keys.auth)
  if (!p256dh) invalid("keys.p256dh is required")
  if (!auth) invalid("keys.auth is required")

  const username = str(b.username)
  if (!username) invalid("username is required")

  const uaRaw = str(b.user_agent)
  const user_agent = uaRaw ? uaRaw.slice(0, MAX_USER_AGENT) : null

  return { endpoint, p256dh, auth, username, user_agent }
}

class AdminPushModuleService extends MedusaService({ AdminPushSubscription }) {
  async findByEndpoint(endpoint: string): Promise<AdminPushSubscriptionDTO | null> {
    const rows = (await this.listAdminPushSubscriptions(
      { endpoint },
      { take: 1 },
    )) as AdminPushSubscriptionDTO[]
    return rows[0] ?? null
  }

  async upsertByEndpoint(input: SubscriptionInput): Promise<AdminPushSubscriptionDTO> {
    const existing = await this.findByEndpoint(input.endpoint)
    const data = {
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      username: input.username,
      user_agent: input.user_agent ?? null,
    }
    if (existing) {
      return (await this.updateAdminPushSubscriptions({
        id: existing.id,
        ...data,
      })) as AdminPushSubscriptionDTO
    }
    return (await this.createAdminPushSubscriptions(data)) as AdminPushSubscriptionDTO
  }

  /** Idempotent. Returns true when a row was deleted. */
  async removeByEndpoint(endpoint: string): Promise<boolean> {
    const existing = await this.findByEndpoint(endpoint)
    if (!existing) return false
    await this.deleteAdminPushSubscriptions(existing.id)
    return true
  }

  async listAll(): Promise<AdminPushSubscriptionDTO[]> {
    return (await this.listAdminPushSubscriptions(
      {},
      { take: 1000, order: { created_at: "ASC" } },
    )) as AdminPushSubscriptionDTO[]
  }

  async listForUser(username: string): Promise<AdminPushSubscriptionDTO[]> {
    return (await this.listAdminPushSubscriptions(
      { username },
      { take: 100, order: { created_at: "ASC" } },
    )) as AdminPushSubscriptionDTO[]
  }
}

export default AdminPushModuleService
