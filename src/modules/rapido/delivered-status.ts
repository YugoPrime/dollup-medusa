/**
 * Which Rapido webhook statuses mean "the customer has the parcel".
 *
 * Rapido's integration brief documents the webhook envelope but never
 * enumerates the status vocabulary — the only string it shows is
 * `READY_FOR_PICKUP`, from the create-order response. So the defaults below are
 * educated guesses, and `RAPIDO_DELIVERED_STATUSES` exists to correct them from
 * Coolify (restart, no redeploy) the moment we see the real string in the logs.
 *
 * Deliberately conservative: only terminal-success statuses belong here. A
 * failed or returned delivery must never mark an order delivered — those are
 * stored as `rapido_status` and left for a human.
 */

const DEFAULT_DELIVERED_STATUSES = ["DELIVERED", "COMPLETED", "LIVRE", "LIVREE"]

/**
 * Fold a status into the comparison form: accents stripped, uppercased, and
 * every run of non-alphanumerics collapsed to a single underscore. Lets
 * "Livrée", "delivered" and "DELIVERED" all land on the same key, and means an
 * env override can be written in whichever style Rapido happens to use.
 */
function normalize(status: string): string {
  return status
    .normalize("NFD")
    // Drop combining marks (the accent halves NFD just split off). Must happen
    // before the separator pass below, or "LIVRÉE" would fold to "LIVRE_E".
    .replace(/\p{M}+/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

/**
 * The active set, read from the environment on every call rather than at module
 * load — otherwise a Jest test (or a config reload) that changes the env var
 * would be ignored until the process restarted.
 */
export function deliveredStatusSet(): Set<string> {
  const raw = process.env.RAPIDO_DELIVERED_STATUSES ?? ""
  const configured = raw
    .split(",")
    .map((s) => normalize(s))
    .filter((s) => s.length > 0)

  const source = configured.length > 0 ? configured : DEFAULT_DELIVERED_STATUSES
  return new Set(source.map(normalize))
}

/** True when this Rapido status means the order was successfully delivered. */
export function isDeliveredStatus(status: string): boolean {
  if (typeof status !== "string") return false
  const key = normalize(status)
  if (!key) return false
  return deliveredStatusSet().has(key)
}
