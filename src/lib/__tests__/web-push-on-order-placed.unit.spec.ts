jest.mock("../web-push", () => ({
  isWebPushConfigured: jest.fn(),
  getAdminUrl: jest.fn(() => "https://admin.dollupboutique.com"),
  sendWebPush: jest.fn(),
  buildOrderPlacedPayload: jest.fn(() => ({ title: "t", body: "b", url: "u", tag: "g" })),
}))

import { isWebPushConfigured, sendWebPush } from "../web-push"
import webPushOnOrderPlaced, { config } from "../../subscribers/web-push-on-order-placed"

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
const subs = [
  { id: "a", endpoint: "https://p/1", p256dh: "k", auth: "a", username: "u" },
  { id: "b", endpoint: "https://p/2", p256dh: "k", auth: "a", username: "u" },
]
const pushService = { listAll: jest.fn(), removeByEndpoint: jest.fn() }
const orderService = { retrieveOrder: jest.fn() }

function container() {
  return {
    resolve: (key: string) => {
      if (key === "logger") return logger
      if (key === "admin_push") return pushService
      if (key === "order") return orderService
      throw new Error(`unexpected resolve ${key}`)
    },
  } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  pushService.listAll.mockResolvedValue(subs)
  orderService.retrieveOrder.mockResolvedValue({ id: "order_1", display_id: 1 })
})

describe("web-push-on-order-placed", () => {
  it("registers on order.placed", () => {
    expect(config.event).toBe("order.placed")
  })

  it("does nothing when VAPID is not configured", async () => {
    ;(isWebPushConfigured as jest.Mock).mockReturnValue(false)
    await webPushOnOrderPlaced({ event: { name: "order.placed", data: { id: "order_1" } }, container: container() } as never)
    expect(orderService.retrieveOrder).not.toHaveBeenCalled()
    expect(sendWebPush).not.toHaveBeenCalled()
  })

  it("sends to every subscription and prunes gone ones", async () => {
    ;(isWebPushConfigured as jest.Mock).mockReturnValue(true)
    ;(sendWebPush as jest.Mock)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, gone: true, status: 410, message: "gone" })
    await webPushOnOrderPlaced({ event: { name: "order.placed", data: { id: "order_1" } }, container: container() } as never)
    expect(sendWebPush).toHaveBeenCalledTimes(2)
    expect(pushService.removeByEndpoint).toHaveBeenCalledTimes(1)
    expect(pushService.removeByEndpoint).toHaveBeenCalledWith("https://p/2")
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("sent 1, pruned 1"))
  })

  it("skips quietly when nobody is subscribed", async () => {
    ;(isWebPushConfigured as jest.Mock).mockReturnValue(true)
    pushService.listAll.mockResolvedValue([])
    await webPushOnOrderPlaced({ event: { name: "order.placed", data: { id: "order_1" } }, container: container() } as never)
    expect(orderService.retrieveOrder).not.toHaveBeenCalled()
  })

  it("logs and swallows errors", async () => {
    ;(isWebPushConfigured as jest.Mock).mockReturnValue(true)
    orderService.retrieveOrder.mockRejectedValue(new Error("db down"))
    await expect(
      webPushOnOrderPlaced({ event: { name: "order.placed", data: { id: "order_1" } }, container: container() } as never),
    ).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("db down"))
  })
})
