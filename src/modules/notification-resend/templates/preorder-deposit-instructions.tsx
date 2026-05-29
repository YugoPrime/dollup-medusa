import { Section, Text } from "@react-email/components"
import * as React from "react"

import {
  BRAND,
  EmailLayout,
  Heading,
  Paragraph,
  StatRow,
  formatMur,
} from "./_layout"

export type PreorderDepositInstructionsData = {
  customerFirstName: string
  displayId: string | number
  depositAmount: number // whole rupees
  balanceAmount: number
  totalAmount: number
  deadlineLabel: string // e.g. "30 May 2026, 2:00 PM"
  bank: string
  accountName: string
  accountNumber: string
  whatsapp: string
}

const STOREFRONT_URL =
  process.env.STOREFRONT_URL ?? "https://shop.dollupboutique.com"

export default function PreorderDepositInstructionsEmail(
  data: PreorderDepositInstructionsData,
) {
  const {
    customerFirstName,
    displayId,
    depositAmount,
    balanceAmount,
    totalAmount,
    deadlineLabel,
    bank,
    accountName,
    accountNumber,
    whatsapp,
  } = data

  return (
    <EmailLayout
      preview={`Reserve your pre-order #${displayId} — deposit due ${deadlineLabel}`}
      storefrontUrl={STOREFRONT_URL}
    >
      <Heading>
        Hi {customerFirstName || "there"} — almost reserved!
      </Heading>
      <Paragraph>
        Thank you for your pre-order reservation #{displayId}. To confirm it and
        secure your pieces, please pay the 75% deposit of{" "}
        <strong>{formatMur(depositAmount)}</strong> by{" "}
        <strong>{deadlineLabel}</strong>. If we don't receive it in time, the
        reservation is released automatically.
      </Paragraph>

      <Section style={{ padding: "8px 0 0 0" }}>
        <StatRow label="Total" value={formatMur(totalAmount)} />
        <StatRow label="Deposit due now (75%)" value={formatMur(depositAmount)} />
        <StatRow
          label="Balance on arrival"
          value={formatMur(balanceAmount)}
          emphasized
        />
      </Section>

      <Section
        style={{
          backgroundColor: BRAND.blush,
          borderRadius: "8px",
          padding: "16px",
          margin: "20px 0 0 0",
        }}
      >
        <Text
          style={{
            color: BRAND.inkMuted,
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.14em",
            margin: "0 0 8px 0",
            textTransform: "uppercase",
          }}
        >
          How to pay your deposit
        </Text>
        <Text
          style={{
            color: BRAND.ink,
            fontSize: "14px",
            lineHeight: "22px",
            margin: "0 0 10px 0",
          }}
        >
          Bank transfer (Juice or {bank}) to:
        </Text>
        <Text
          style={{
            color: BRAND.ink,
            fontSize: "14px",
            lineHeight: "24px",
            margin: 0,
          }}
        >
          Bank: <strong>{bank}</strong>
          <br />
          Account name: <strong>{accountName}</strong>
          <br />
          Account number: <strong>{accountNumber}</strong>
        </Text>
        <Text
          style={{
            color: BRAND.ink,
            fontSize: "14px",
            lineHeight: "22px",
            margin: "10px 0 0 0",
          }}
        >
          Once paid, send the transfer screenshot to us on WhatsApp{" "}
          <strong>{whatsapp}</strong> so we can confirm your pre-order right
          away.
        </Text>
      </Section>

      <Paragraph>
        Reservation #{displayId} · deposit deadline {deadlineLabel}. Questions?
        Just reply to this email — we read every message.
      </Paragraph>
    </EmailLayout>
  )
}
