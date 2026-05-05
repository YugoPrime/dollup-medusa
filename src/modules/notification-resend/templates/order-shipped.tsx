import { Section, Text } from "@react-email/components"
import * as React from "react"

import {
  BRAND,
  Button,
  EmailLayout,
  Heading,
  Paragraph,
} from "./_layout"

export type OrderShippedEmailData = {
  storefrontUrl: string
  customerFirstName: string
  displayId: string | number
  deliveryMethod: "home_delivery" | "post_office" | "pickup" | string
  deliveryDate?: string | null
  trackingNumber?: string | null
}

const PICKUP_ADDRESS =
  "Royal Road, Pereybere, Mauritius (next to the public beach)"
const PICKUP_HOURS = "Mon–Sat, 10:00 — 18:00"

function getCopy(
  method: OrderShippedEmailData["deliveryMethod"],
  deliveryDate?: string | null,
  trackingNumber?: string | null,
) {
  switch (method) {
    case "home_delivery":
      return {
        heading: "Your order is scheduled for delivery",
        preview: `We're delivering on ${deliveryDate ?? "your scheduled date"}`,
        intro: deliveryDate
          ? `Our courier is bringing your order on ${deliveryDate}. Please keep your phone close — they'll call when nearby.`
          : `We've scheduled delivery for your order. Our courier will call you when nearby.`,
        sub:
          "Payment is collected on delivery — Cash, Juice, Bank Transfer or myT Money. Receipts available on request.",
      }
    case "post_office":
      return {
        heading: "Your order has shipped",
        preview: trackingNumber
          ? `Tracking: ${trackingNumber}`
          : "Your parcel is on its way",
        intro: trackingNumber
          ? `We've handed your parcel to Mauritius Post. Use the tracking number below to follow it.`
          : `We've handed your parcel to Mauritius Post. You'll get a notice from your local office when it arrives.`,
        sub: trackingNumber ? `Tracking number: ${trackingNumber}` : null,
      }
    case "pickup":
      return {
        heading: "Your order is ready for pickup",
        preview: "Come grab your order from Pereybere",
        intro: `Your order is packed and waiting for you at our Pereybere location.`,
        sub: `${PICKUP_ADDRESS}\n${PICKUP_HOURS}`,
      }
    default:
      return {
        heading: "Your order is on the way",
        preview: "Your order is out for delivery",
        intro: `We've finished preparing your order — it's now heading your way.`,
        sub: null,
      }
  }
}

export default function OrderShippedEmail(data: OrderShippedEmailData) {
  const {
    storefrontUrl,
    customerFirstName,
    displayId,
    deliveryMethod,
    deliveryDate,
    trackingNumber,
  } = data
  const copy = getCopy(deliveryMethod, deliveryDate, trackingNumber)
  const orderUrl = `${storefrontUrl}/track-order?id=${encodeURIComponent(
    String(displayId),
  )}`

  return (
    <EmailLayout preview={copy.preview} storefrontUrl={storefrontUrl}>
      <Heading>
        Hi {customerFirstName || "there"} — {copy.heading.toLowerCase()}
      </Heading>
      <Paragraph>{copy.intro}</Paragraph>

      <Section
        style={{
          backgroundColor: BRAND.blush,
          borderRadius: "8px",
          padding: "16px",
          margin: "8px 0 16px 0",
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
          Order #{displayId}
        </Text>
        {copy.sub ? (
          <Text
            style={{
              color: BRAND.ink,
              fontSize: "14px",
              lineHeight: "22px",
              margin: 0,
              whiteSpace: "pre-line",
            }}
          >
            {copy.sub}
          </Text>
        ) : null}
      </Section>

      <Section style={{ padding: "8px 0 8px 0" }}>
        <Button href={orderUrl}>View order details</Button>
      </Section>

      <Paragraph>
        Got a question or a hiccup? Reply to this email or message us on
        WhatsApp — we'll sort it.
      </Paragraph>
    </EmailLayout>
  )
}
