import * as React from "react"

import PasswordResetEmail from "../password-reset"

export default function PasswordResetPreview() {
  return (
    <PasswordResetEmail
      storefrontUrl="https://shop.dollupboutique.com"
      resetUrl="https://shop.dollupboutique.com/reset-password?token=preview-token-abc123"
      expiresInMinutes={60}
    />
  )
}
