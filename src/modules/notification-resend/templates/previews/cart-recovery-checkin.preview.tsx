import * as React from "react"
import CartRecoveryCheckinEmail from "../cart-recovery-checkin"

export default function Preview() {
  return (
    <CartRecoveryCheckinEmail
      storefrontUrl="https://dollupboutique.com"
      customerFirstName="Emilie"
      cartResumeUrl="https://dollupboutique.com/cart?cart_id=cart_01H123"
      items={[
        {
          title: "PU Leather Lingerie Bodysuit",
          thumbnail: "https://placehold.co/96",
          quantity: 1,
        },
        {
          title: "Pink Neon Short Dress",
          thumbnail: "https://placehold.co/96",
          quantity: 2,
        },
      ]}
    />
  )
}
