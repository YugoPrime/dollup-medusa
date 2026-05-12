import * as React from "react"

import WelcomeEmail from "../welcome"

export default function WelcomePreview() {
  return (
    <WelcomeEmail
      storefrontUrl="https://shop.dollupboutique.com"
      customerFirstName="Sarah"
      welcomeBonusPoints={50}
    />
  )
}
