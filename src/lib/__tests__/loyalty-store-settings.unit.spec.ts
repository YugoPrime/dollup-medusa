import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { renderToStaticMarkup } from "react-dom/server"

import { GET } from "../../api/store/loyalty/settings/route"
import { LOYALTY_MODULE } from "../../modules/loyalty"
import WelcomeEmail from "../../modules/notification-resend/templates/welcome"
import emailOnCustomerCreated from "../../subscribers/email-on-customer-created"

const SETTINGS = {
  id: "loyalty_settings",
  earn_rate_per_100_mur: 5,
  redeem_rate_mur_per_100_pts: 100,
  min_redeem_points: 150,
  welcome_bonus_points: 100,
  points_expiry_months: null,
}

describe("GET /store/loyalty/settings", () => {
  it("returns only the four public rules, cacheable for 5 minutes", async () => {
    const res: any = { setHeader: jest.fn(), json: jest.fn() }
    const scope = { resolve: () => ({ getSettings: async () => SETTINGS }) }
    await GET({ scope } as any, res)
    expect(res.json).toHaveBeenCalledWith({
      settings: {
        earn_rate_per_100_mur: 5,
        redeem_rate_mur_per_100_pts: 100,
        min_redeem_points: 150,
        welcome_bonus_points: 100,
      },
    })
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "public, max-age=300")
  })
})

describe("welcome email", () => {
  const html = (earnRatePer100: number, minRedeemPoints: number) =>
    renderToStaticMarkup(
      WelcomeEmail({
        storefrontUrl: "https://dollupboutique.com",
        customerFirstName: "Sarah",
        welcomeBonusPoints: 100,
        earnRatePer100,
        minRedeemPoints,
      }),
    )

  it("states the live earn rate and minimum", () => {
    const out = html(5, 150)
    expect(out).toContain("Earn 5 points per Rs 100 spent.")
    expect(out).toContain("from 150 points.")
    expect(out).toContain("Early access drops and member-only offers too.")
  })

  it("no longer promises a birthday bonus", () => {
    expect(html(5, 150)).not.toMatch(/birthday/i)
  })
})

describe("email-on-customer-created", () => {
  const createNotifications = jest.fn()
  let getSettings: () => Promise<unknown>
  const container = {
    resolve: (key: unknown) => {
      if (key === ContainerRegistrationKeys.LOGGER) {
        return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
      }
      if (key === ContainerRegistrationKeys.QUERY) {
        return {
          graph: async () => ({
            data: [{ id: "cus_1", email: "s@x.mu", first_name: "Sarah", has_account: true }],
          }),
        }
      }
      if (key === LOYALTY_MODULE) return { getSettings: () => getSettings() }
      if (key === Modules.NOTIFICATION) return { createNotifications }
      throw new Error(`unexpected resolve ${String(key)}`)
    },
  }
  const run = () => emailOnCustomerCreated({ event: { data: { id: "cus_1" } }, container } as any)

  beforeEach(() => createNotifications.mockReset())

  it("passes the live rules to the welcome email", async () => {
    getSettings = async () => ({ ...SETTINGS, earn_rate_per_100_mur: 7, min_redeem_points: 120 })
    await run()
    expect(createNotifications.mock.calls[0][0].data).toMatchObject({
      welcomeBonusPoints: 100,
      earnRatePer100: 7,
      minRedeemPoints: 120,
    })
  })

  it("falls back to 5 and 150 when the settings cannot be read", async () => {
    getSettings = async () => {
      throw new Error("db down")
    }
    await run()
    expect(createNotifications.mock.calls[0][0].data).toMatchObject({
      earnRatePer100: 5,
      minRedeemPoints: 150,
    })
  })
})
