import { Img, Section, Text } from "@react-email/components"
import * as React from "react"

import {
  BRAND,
  EmailLayout,
  Heading,
  Paragraph,
  StatRow,
  formatMur,
} from "./_layout"

export type OrderPlacedEmailData = {
  storefrontUrl: string
  customerFirstName: string
  displayId: string | number
  items: Array<{
    title: string
    quantity: number
    unit_price: number
    thumbnail?: string | null
  }>
  subtotal: number
  shippingTotal: number
  total: number
  shippingAddress: {
    address_1?: string | null
    city?: string | null
    phone?: string | null
  }
  deliveryMethod?: string | null
  // Raw label from cart metadata (e.g. "Express Postage", "Rodrigues Postage")
  // so the email shows exactly what the customer picked, not the flattened
  // 3-bucket version used elsewhere.
  shippingMethodLabel?: string | null
  deliveryDate?: string | null
}

const fallbackDeliveryLabel: Record<string, string> = {
  home_delivery: "Home / Office Delivery",
  post_office: "Postage",
  pickup: "Pick up in Pereybere",
}

function displayDeliveryLabel(
  shippingMethodLabel: string | null | undefined,
  deliveryMethod: string | null | undefined,
): string {
  if (shippingMethodLabel) {
    // Keep the location explicit for pickup; pass everything else through.
    if (shippingMethodLabel === "Pick Up") return "Pick up in Pereybere"
    if (shippingMethodLabel === "Home Delivery") return "Home / Office Delivery"
    return shippingMethodLabel
  }
  if (deliveryMethod && fallbackDeliveryLabel[deliveryMethod]) {
    return fallbackDeliveryLabel[deliveryMethod]
  }
  return "To be confirmed"
}

function isPickupMethod(
  shippingMethodLabel: string | null | undefined,
  deliveryMethod: string | null | undefined,
): boolean {
  if (shippingMethodLabel === "Pick Up") return true
  return deliveryMethod === "pickup"
}

function isPostageMethod(
  shippingMethodLabel: string | null | undefined,
  deliveryMethod: string | null | undefined,
): boolean {
  if (shippingMethodLabel) {
    return shippingMethodLabel.toLowerCase().includes("postage")
  }
  return deliveryMethod === "post_office"
}

export default function OrderPlacedEmail(data: OrderPlacedEmailData) {
  const {
    storefrontUrl,
    customerFirstName,
    displayId,
    items,
    subtotal,
    shippingTotal,
    total,
    shippingAddress,
    deliveryMethod,
    shippingMethodLabel,
  } = data
  const methodLabel = displayDeliveryLabel(shippingMethodLabel, deliveryMethod)
  const isPickup = isPickupMethod(shippingMethodLabel, deliveryMethod)
  const isPostage = isPostageMethod(shippingMethodLabel, deliveryMethod)

  return (
    <EmailLayout
      preview={`Order #${displayId} confirmed — thank you!`}
      storefrontUrl={storefrontUrl}
    >
      <Heading>Hi {customerFirstName || "there"} — order received</Heading>
      <Paragraph>
        Thanks for shopping with Doll Up Boutique. We're preparing your order now and will update you as soon as it's ready for the next step.
      </Paragraph>

      <Text
        style={{
          color: BRAND.inkMuted,
          fontSize: "12px",
          fontWeight: 700,
          letterSpacing: "0.14em",
          margin: "24px 0 8px 0",
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

      <Section style={{ padding: "20px 0 0 0" }}>
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
          Delivery Method
        </Text>
        <Text
          style={{
            color: BRAND.ink,
            fontSize: "14px",
            fontWeight: 600,
            lineHeight: "22px",
            margin: 0,
          }}
        >
          {methodLabel}
        </Text>
        {!isPickup && shippingAddress.address_1 ? (
          <Text
            style={{
              color: BRAND.inkSoft,
              fontSize: "14px",
              lineHeight: "22px",
              margin: "2px 0 0 0",
            }}
          >
            {shippingAddress.address_1}
            {shippingAddress.city ? `, ${shippingAddress.city}` : ""}
          </Text>
        ) : null}
      </Section>

      {isPostage ? (
        <Section
          style={{
            backgroundColor: BRAND.blush,
            borderRadius: "8px",
            padding: "16px",
            margin: "16px 0 0 0",
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
            Your order will be processed only once payment is received. If
            you've already paid, you'll get an update with tracking shortly.
          </Text>
          <Text
            style={{
              color: BRAND.ink,
              fontSize: "14px",
              lineHeight: "22px",
              margin: 0,
            }}
          >
            Otherwise, please transfer to our MCB account{" "}
            <strong>000446948071</strong> and send a screenshot by replying
            to this email or via WhatsApp <strong>+230 5941 6359</strong>.
          </Text>
        </Section>
      ) : null}

      <Paragraph>
        Need anything? Just reply to this email — we read every message.
      </Paragraph>
    </EmailLayout>
  )
}
