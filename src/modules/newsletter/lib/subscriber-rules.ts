import type { SubscriberDTO, SubscriberSource } from "../types"

type Existing = Pick<SubscriberDTO, "status"> | null

export function decideAdd(
  existing: Existing,
  source: SubscriberSource
): "create" | "noop" | "resubscribe" {
  if (!existing) return "create"
  if (existing.status === "subscribed") return "noop"
  // An import never re-subscribes someone who unsubscribed.
  return source === "import" ? "noop" : "resubscribe"
}

export function decideImport(
  existing: Existing,
  csvUnsubscribed: boolean
): "create" | "skip" | "unsubscribe" {
  if (!existing) return "create"
  if (existing.status === "subscribed" && csvUnsubscribed) return "unsubscribe"
  return "skip"
}
