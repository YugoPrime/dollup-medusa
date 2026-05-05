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
  deliveryDate?: string | null
}

const deliveryLabel: Record<string, string> = {
  home_delivery: "Home delivery",
  post_office: "Post office",
  pickup: "Pickup at Pereybere",
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
    deliveryDate,
  } = data
  const orderUrl = `${storefrontUrl}/track-order?id=${encodeURIComponent(
    String(displayId),
  )}`

  return (
    <EmailLayout
      preview={`Order #${displayId} confirmed — thank you!`}
      storefrontUrl={storefrontUrl}
    >
      <Heading>Hi {customerFirstName || "there"} — order received</Heading>
      <Paragraph>
        Thanks for shopping with Doll Up Boutique. We're packing your
        order now and will update you as soon as it's on the way.
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
          Delivery
        </Text>
        <Text
          style={{
            color: BRAND.inkSoft,
            fontSize: "14px",
            lineHeight: "22px",
            margin: 0,
          }}
        >
          {deliveryMethod
            ? deliveryLabel[deliveryMethod] ?? deliveryMethod
            : "To be confirmed"}
          {deliveryDate ? ` · ${deliveryDate}` : ""}
          {shippingAddress.address_1
            ? ` · ${shippingAddress.address_1}, ${shippingAddress.city ?? ""}`
            : ""}
        </Text>
      </Section>

      <Section style={{ padding: "24px 0 8px 0" }}>
        <Button href={orderUrl}>Track your order</Button>
      </Section>

      <Paragraph>
        Payment is collected on delivery (Cash, Juice, Bank Transfer or myT
        Money). Need anything? Just reply to this email — a real person
        reads every message.
      </Paragraph>
    </EmailLayout>
  )
}
