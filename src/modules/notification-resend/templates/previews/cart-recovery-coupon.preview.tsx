import * as React from "react"
import CartRecoveryCouponEmail from "../cart-recovery-coupon"

export default function Preview() {
  return (
    <CartRecoveryCouponEmail
      storefrontUrl="https://dollupboutique.com"
      customerFirstName="Emilie"
      cartResumeUrl="https://dollupboutique.com/cart?cart_id=cart_01H123&promo=RECOVER-XK7P9"
      items={[
        {
          title: "PU Leather Lingerie Bodysuit",
          thumbnail: "https://placehold.co/96",
          quantity: 1,
        },
      ]}
      couponCode="RECOVER-XK7P9"
      couponExpiresAt={new Date(
        Date.now() + 14 * 24 * 60 * 60 * 1000,
      ).toISOString()}
      couponPercentage={5}
    />
  )
}
