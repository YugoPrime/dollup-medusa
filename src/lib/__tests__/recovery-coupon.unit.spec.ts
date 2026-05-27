import {
  generateCouponCode,
  couponExpiryISO,
  RECOVERY_COUPON_PREFIX,
  RECOVERY_COUPON_ALPHABET,
} from "../recovery-coupon"

describe("recovery-coupon", () => {
  describe("generateCouponCode", () => {
    it("returns codes prefixed with RECOVER-", () => {
      const code = generateCouponCode()
      expect(code.startsWith(`${RECOVERY_COUPON_PREFIX}-`)).toBe(true)
    })

    it("returns a 5-char suffix from the no-ambiguous alphabet", () => {
      const code = generateCouponCode()
      const suffix = code.slice(RECOVERY_COUPON_PREFIX.length + 1)
      expect(suffix.length).toBe(5)
      for (const ch of suffix) {
        expect(RECOVERY_COUPON_ALPHABET).toContain(ch)
      }
    })

    it("does not include ambiguous chars 0/O/1/I in the alphabet", () => {
      expect(RECOVERY_COUPON_ALPHABET).not.toMatch(/[0O1I]/)
    })

    it("returns different codes across many calls (~no immediate collisions)", () => {
      const codes = new Set<string>()
      for (let i = 0; i < 500; i++) codes.add(generateCouponCode())
      expect(codes.size).toBeGreaterThan(495)
    })
  })

  describe("couponExpiryISO", () => {
    it("returns an ISO timestamp N days in the future", () => {
      const now = Date.now()
      const iso = couponExpiryISO(14, new Date(now))
      const ms = new Date(iso).getTime()
      const fourteenDays = 14 * 24 * 60 * 60 * 1000
      expect(ms - now).toBe(fourteenDays)
    })
  })
})
