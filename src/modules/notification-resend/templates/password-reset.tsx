import { Section, Text } from "@react-email/components"
import * as React from "react"

import {
  BRAND,
  Button,
  EmailLayout,
  Heading,
  Paragraph,
} from "./_layout"

export type PasswordResetEmailData = {
  storefrontUrl: string
  resetUrl: string
  expiresInMinutes?: number
}

export default function PasswordResetEmail(data: PasswordResetEmailData) {
  const { storefrontUrl, resetUrl, expiresInMinutes = 60 } = data

  return (
    <EmailLayout
      preview="Reset your Doll Up Boutique password"
      storefrontUrl={storefrontUrl}
    >
      <Heading>Reset your password</Heading>
      <Paragraph>
        Someone (hopefully you!) asked to reset the password for your Doll
        Up Boutique account. Click the button below to choose a new one.
      </Paragraph>

      <Section style={{ padding: "8px 0 16px 0" }}>
        <Button href={resetUrl}>Reset password</Button>
      </Section>

      <Text
        style={{
          color: BRAND.inkMuted,
          fontSize: "13px",
          lineHeight: "20px",
          margin: "0 0 12px 0",
        }}
      >
        This link expires in {expiresInMinutes} minutes. If you didn't
        request a reset, you can safely ignore this email — your password
        won't change.
      </Text>

      <Text
        style={{
          color: BRAND.inkMuted,
          fontSize: "12px",
          lineHeight: "18px",
          margin: 0,
          wordBreak: "break-all",
        }}
      >
        Trouble with the button? Copy this link into your browser:
        <br />
        <a href={resetUrl} style={{ color: BRAND.coral }}>
          {resetUrl}
        </a>
      </Text>
    </EmailLayout>
  )
}
