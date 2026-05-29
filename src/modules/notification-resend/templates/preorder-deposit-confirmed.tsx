import { Section, Text } from "@react-email/components"
import * as React from "react"

import {
  BRAND,
  EmailLayout,
  Heading,
  Paragraph,
  formatMur,
} from "./_layout"

export type PreorderDepositConfirmedData = {
  customerFirstName: string
  displayId: string | number
  balanceAmount: number
}

const STOREFRONT_URL =
  process.env.STOREFRONT_URL ?? "https://shop.dollupboutique.com"

export default function PreorderDepositConfirmedEmail(
  data: PreorderDepositConfirmedData,
) {
  const { customerFirstName, displayId, balanceAmount } = data

  return (
    <EmailLayout
      preview={`Deposit received — your pre-order #${displayId} is confirmed`}
      storefrontUrl={STOREFRONT_URL}
    >
      <Heading>
        Hi {customerFirstName || "there"} — your pre-order is confirmed!
      </Heading>
      <Paragraph>
        We've received your deposit for pre-order #{displayId}. Thank you! Your
        pieces are now reserved and we'll place the order with SHEIN. Expect
        delivery in roughly 15–20 days.
      </Paragraph>

      <Section
        style={{
          backgroundColor: BRAND.cream,
          borderRadius: "8px",
          padding: "16px",
          margin: "8px 0 0 0",
        }}
      >
        <Text
          style={{
            color: BRAND.inkMuted,
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.14em",
            margin: "0 0 6px 0",
            textTransform: "uppercase",
          }}
        >
          Balance on arrival
        </Text>
        <Text
          style={{
            color: BRAND.ink,
            fontSize: "18px",
            fontWeight: 700,
            margin: 0,
          }}
        >
          {formatMur(balanceAmount)}
        </Text>
        <Text
          style={{
            color: BRAND.inkSoft,
            fontSize: "14px",
            lineHeight: "22px",
            margin: "8px 0 0 0",
          }}
        >
          The remaining balance is due when your order arrives and is ready for
          pickup or delivery.
        </Text>
      </Section>

      <Paragraph>
        We'll keep you posted as your order makes its way over. Questions? Just
        reply to this email.
      </Paragraph>
    </EmailLayout>
  )
}
