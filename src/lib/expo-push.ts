// Tiny wrapper around Expo's push notification HTTPS endpoint.
// https://docs.expo.dev/push-notifications/sending-notifications/
//
// Usage:
//   await sendExpoPush(logger, token, { title, body, data })
//
// No access token is needed for low-volume sends. If the project later opts
// into enhanced security, set EXPO_ACCESS_TOKEN in Coolify and this helper
// will start sending it as a Bearer header.

const EXPO_ENDPOINT = "https://exp.host/--/api/v2/push/send"

export type ExpoPushPayload = {
  title: string
  body: string
  data?: Record<string, unknown>
  // 'default' plays the device's default notification sound on iOS.
  sound?: "default" | null
  badge?: number
}

type Logger = {
  info: (m: string) => void
  warn: (m: string) => void
  error: (m: string) => void
}

export function isExpoToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (value.startsWith("ExponentPushToken[") ||
      value.startsWith("ExpoPushToken["))
  )
}

export async function sendExpoPush(
  logger: Logger,
  to: unknown,
  payload: ExpoPushPayload,
): Promise<void> {
  if (!isExpoToken(to)) {
    const preview =
      typeof to === "string" ? `"${to.slice(0, 20)}…"` : typeof to
    logger.warn(`[expo-push] skip: invalid token shape ${preview}`)
    return
  }

  const headers: Record<string, string> = {
    accept: "application/json",
    "accept-encoding": "gzip, deflate",
    "content-type": "application/json",
  }
  if (process.env.EXPO_ACCESS_TOKEN) {
    headers.authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`
  }

  const body = {
    to,
    title: payload.title,
    body: payload.body,
    sound: payload.sound === null ? null : (payload.sound ?? "default"),
    data: payload.data ?? {},
    ...(payload.badge != null ? { badge: payload.badge } : {}),
  }

  try {
    const res = await fetch(EXPO_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      logger.error(`[expo-push] HTTP ${res.status}: ${text}`)
      return
    }
    // Expo returns { data: { status: "ok" | "error", ... } } per ticket
    const json = (await res.json().catch(() => null)) as
      | { data?: { status?: string; message?: string; details?: unknown } }
      | null
    const status = json?.data?.status
    if (status === "error") {
      const message = json?.data?.message ?? "unknown"
      // DeviceNotRegistered = user uninstalled or token expired. Caller
      // should consider clearing the stored token; we just log here.
      logger.warn(`[expo-push] ticket error: ${message}`)
      return
    }
    logger.info(`[expo-push] sent to ${to.slice(0, 24)}…`)
  } catch (err) {
    logger.error(`[expo-push] fetch failed: ${(err as Error).message}`)
  }
}
