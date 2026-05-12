import { Img, Section, Text } from "@react-email/components"
import * as React from "react"

import {
  BRAND,
  Button,
  EmailLayout,
  Heading,
  Paragraph,
  StatRow,
  formatMur,
} from "./_layout"

export type OrderShippedEmailData = {
  storefrontUrl: string
  customerFirstName: string
  displayId: string | number
  deliveryMethod: "home_delivery" | "post_office" | "pickup" | string
  // Raw label the customer picked at checkout, e.g. "Express Postage".
  // Falls back to a deliveryMethod-based label when null.
  shippingMethodLabel?: string | null
  deliveryDate?: string | null
  trackingNumber?: string | null
  // True when the order is marked paid in the backend (admin set
  // metadata.sale_type === "paid" or Medusa captured the payment).
  // When false, the email shows bank-transfer instructions for the
  // remaining home-delivery balance.
  isPaid: boolean
  // Order recap
  items: Array<{
    title: string
    quantity: number
    unit_price: number
    thumbnail?: string | null
  }>
  subtotal: number
  shippingTotal: number
  total: number
}

const PICKUP_ADDRESS = "Royal Road, Pereybere, Mauritius (next to the public beach)"
const PICKUP_HOURS = "Mon–Sat, 10:00 — 18:00"
const WHATSAPP_NUMBER = "+230 5941 6359"
const WHATSAPP_LINK_BASE = "https://wa.me/23059416359"
const MAURITIUS_POST_TRACK_BASE =
  "https://www.mauritiuspost.mu/track-trace/?tracking_code="
const MCB_ACCOUNT_NUMBER = "000446948071"

function isPickupMethod(
  shippingMethodLabel: string | null | undefined,
  deliveryMethod: string,
): boolean {
  if (shippingMethodLabel === "Pick Up") return true
  return deliveryMethod === "pickup"
}

function isPostageMethod(
  shippingMethodLabel: string | null | undefined,
  deliveryMethod: string,
): boolean {
  if (shippingMethodLabel) {
    return shippingMethodLabel.toLowerCase().includes("postage")
  }
  return deliveryMethod === "post_office"
}

function isHomeDeliveryMethod(
  shippingMethodLabel: string | null | undefined,
  deliveryMethod: string,
): boolean {
  if (shippingMethodLabel === "Home Delivery") return true
  return deliveryMethod === "home_delivery"
}

function getHeading(
  shippingMethodLabel: string | null | undefined,
  deliveryMethod: string,
  customerFirstName: string,
): string {
  const name = customerFirstName || "there"
  if (isPickupMethod(shippingMethodLabel, deliveryMethod)) {
    return `Hi ${name} — your order is ready for pick up at Pereybere`
  }
  if (isPostageMethod(shippingMethodLabel, deliveryMethod)) {
    return `Hi ${name} — your parcel is on its way`
  }
  if (isHomeDeliveryMethod(shippingMethodLabel, deliveryMethod)) {
    return `Hi ${name} — your order is out for delivery`
  }
  return `Hi ${name} — your order is on the way`
}

function getPreview(
  shippingMethodLabel: string | null | undefined,
  deliveryMethod: string,
  deliveryDate?: string | null,
  trackingNumber?: string | null,
): string {
  if (isPickupMethod(shippingMethodLabel, deliveryMethod)) {
    return "Come grab your order from Pereybere"
  }
  if (isPostageMethod(shippingMethodLabel, deliveryMethod)) {
    return trackingNumber
      ? `Tracking: ${trackingNumber}`
      : "Your parcel is on its way"
  }
  if (isHomeDeliveryMethod(shippingMethodLabel, deliveryMethod)) {
    return deliveryDate
      ? `We're delivering on ${deliveryDate}`
      : "Your order is out for delivery"
  }
  return "Your order is on the way"
}

function getIntro(
  shippingMethodLabel: string | null | undefined,
  deliveryMethod: string,
  deliveryDate?: string | null,
  trackingNumber?: string | null,
): string {
  if (isPickupMethod(shippingMethodLabel, deliveryMethod)) {
    return "Your order is packed and waiting at our Pereybere shop. Drop by during our hours — or tap the button below to message us on WhatsApp and confirm a time."
  }
  if (isPostageMethod(shippingMethodLabel, deliveryMethod)) {
    return trackingNumber
      ? "We've handed your parcel to Mauritius Post. Use the tracking button below to follow it."
      : "We've handed your parcel to Mauritius Post. You'll get a notice from your local office when it arrives."
  }
  if (isHomeDeliveryMethod(shippingMethodLabel, deliveryMethod)) {
    return deliveryDate
      ? `Our courier is bringing your order on ${deliveryDate}. Please keep your phone close — they'll call when nearby.`
      : "We've scheduled delivery for your order. Our courier will call you when nearby."
  }
  return "We've finished preparing your order — it's now heading your way."
}

export default function OrderShippedEmail(data: OrderShippedEmailData) {
  const {
    storefrontUrl,
    customerFirstName,
    displayId,
    deliveryMethod,
    shippingMethodLabel,
    deliveryDate,
    trackingNumber,
    isPaid,
    items,
    subtotal,
    shippingTotal,
    total,
  } = data

  const isPickup = isPickupMethod(shippingMethodLabel, deliveryMethod)
  const isPostage = isPostageMethod(shippingMethodLabel, deliveryMethod)
  const isHomeDelivery = isHomeDeliveryMethod(shippingMethodLabel, deliveryMethod)

  const heading = getHeading(shippingMethodLabel, deliveryMethod, customerFirstName)
  const preview = getPreview(
    shippingMethodLabel,
    deliveryMethod,
    deliveryDate,
    trackingNumber,
  )
  const intro = getIntro(
    shippingMethodLabel,
    deliveryMethod,
    deliveryDate,
    trackingNumber,
  )

  const whatsappPickupHref = `${WHATSAPP_LINK_BASE}?text=${encodeURIComponent(
    `Hi Doll Up Boutique, I'd like to confirm a pickup time for order #${displayId}.`,
  )}`

  const trackingHref = trackingNumber
    ? `${MAURITIUS_POST_TRACK_BASE}${encodeURIComponent(trackingNumber)}`
    : null

  return (
    <EmailLayout preview={preview} storefrontUrl={storefrontUrl}>
      <Heading>{heading}</Heading>
      <Paragraph>{intro}</Paragraph>

      {isPickup ? (
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
            Where to pick up
          </Text>
          <Text
            style={{
              color: BRAND.ink,
              fontSize: "14px",
              lineHeight: "22px",
              margin: 0,
              whiteSpace: "pre-line",
            }}
          >
            {`${PICKUP_ADDRESS}\n${PICKUP_HOURS}`}
          </Text>
        </Section>
      ) : null}

      {isPickup ? (
        <Section style={{ padding: "0 0 20px 0" }}>
          <Button href={whatsappPickupHref}>Confirm date &amp; time</Button>
          <Text
            style={{
              color: BRAND.inkMuted,
              fontSize: "12px",
              lineHeight: "18px",
              margin: "8px 0 0 0",
              textAlign: "center",
            }}
          >
            Opens WhatsApp to {WHATSAPP_NUMBER}
          </Text>
        </Section>
      ) : null}

      {isPostage && trackingHref ? (
        <Section style={{ padding: "0 0 8px 0" }}>
          <Button href={trackingHref}>Track on Mauritius Post</Button>
          <Text
            style={{
              color: BRAND.inkMuted,
              fontSize: "12px",
              lineHeight: "18px",
              margin: "8px 0 16px 0",
              textAlign: "center",
            }}
          >
            Tracking #: <strong>{trackingNumber}</strong>
            <br />
            Please allow up to 1 day for the tracking to update.
          </Text>
        </Section>
      ) : null}

      {isPostage && !trackingHref ? (
        <Section
          style={{
            backgroundColor: BRAND.cream,
            borderRadius: "8px",
            padding: "12px 16px",
            margin: "0 0 16px 0",
          }}
        >
          <Text
            style={{
              color: BRAND.inkSoft,
              fontSize: "13px",
              lineHeight: "20px",
              margin: 0,
            }}
          >
            Your tracking number will be sent in a follow-up email shortly.
          </Text>
        </Section>
      ) : null}

      {isHomeDelivery && !isPaid ? (
        <Section
          style={{
            backgroundColor: BRAND.blush,
            borderRadius: "8px",
            padding: "16px",
            margin: "0 0 16px 0",
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
            Payment
          </Text>
          <Text
            style={{
              color: BRAND.ink,
              fontSize: "14px",
              lineHeight: "22px",
              margin: "0 0 10px 0",
            }}
          >
            You can pay our courier on arrival (Cash, Juice, or Bank Transfer).
          </Text>
          <Text
            style={{
              color: BRAND.ink,
              fontSize: "14px",
              lineHeight: "22px",
              margin: 0,
            }}
          >
            Prefer to pay ahead? Transfer to our MCB account{" "}
            <strong>{MCB_ACCOUNT_NUMBER}</strong> and send a screenshot by
            replying to this email or via WhatsApp{" "}
            <strong>{WHATSAPP_NUMBER}</strong>.
          </Text>
        </Section>
      ) : null}

      <Text
        style={{
          color: BRAND.inkMuted,
          fontSize: "12px",
          fontWeight: 700,
          letterSpacing: "0.14em",
          margin: "8px 0 8px 0",
          textTransform: "uppercase",
        }}
      >
        Order #{displayId}
      </Text>

      <Section
        style={{
          backgroundColor: BRAND.cream,
          borderRadius: "8px",
          padding: "16px",
        }}
      >
        {items.map((item, i) => (
          <table
            key={i}
            width="100%"
            style={{
              borderCollapse: "collapse",
              marginBottom: i === items.length - 1 ? 0 : "12px",
            }}
          >
            <tbody>
              <tr>
                {item.thumbnail ? (
                  <td width="64" style={{ paddingRight: "12px" }}>
                    <Img
                      src={item.thumbnail}
                      alt={item.title}
                      width="64"
                      height="64"
                      style={{ borderRadius: "6px", objectFit: "cover" }}
                    />
                  </td>
                ) : null}
                <td>
                  <Text
                    style={{
                      color: BRAND.ink,
                      fontSize: "14px",
                      fontWeight: 600,
                      margin: 0,
                    }}
                  >
                    {item.title}
                  </Text>
                  <Text
                    style={{
                      color: BRAND.inkMuted,
                      fontSize: "12px",
                      margin: "2px 0 0 0",
                    }}
                  >
                    Qty: {item.quantity}
                  </Text>
                </td>
                <td
                  align="right"
                  style={{
                    color: BRAND.ink,
                    fontSize: "14px",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatMur(item.unit_price * item.quantity)}
                </td>
              </tr>
            </tbody>
          </table>
        ))}
      </Section>

      <Section style={{ padding: "16px 0 0 0" }}>
        <StatRow label="Subtotal" value={formatMur(subtotal)} />
        <StatRow
          label="Delivery"
          value={shippingTotal > 0 ? formatMur(shippingTotal) : "Free"}
        />
        <StatRow label="Total" value={formatMur(total)} emphasized />
      </Section>

      <Paragraph>
        Got a question or a hiccup? Reply to this email or message us on
        WhatsApp — we&apos;ll sort it.
      </Paragraph>
    </EmailLayout>
  )
}
