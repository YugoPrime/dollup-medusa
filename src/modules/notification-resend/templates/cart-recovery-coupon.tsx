import { Section, Text } from "@react-email/components"
import * as React from "react"

import {
  BRAND,
  Button,
  EmailLayout,
  Heading,
  Paragraph,
} from "./_layout"
import type { CartRecoveryItem } from "./cart-recovery-checkin"

export type CartRecoveryCouponData = {
  storefrontUrl: string
  customerFirstName: string
  cartResumeUrl: string
  items: CartRecoveryItem[]
  couponCode: string
  couponExpiresAt: string // ISO
  couponPercentage: number // e.g. 5
}

function formatExpiry(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

export default function CartRecoveryCouponEmail(
  data: CartRecoveryCouponData,
) {
  const {
    storefrontUrl,
    customerFirstName,
    cartResumeUrl,
    items,
    couponCode,
    couponExpiresAt,
    couponPercentage,
  } = data
  const shown = items.slice(0, 4)
  const moreCount = items.length - shown.length

  return (
    <EmailLayout
      preview={`Here's ${couponPercentage}% off to come back`}
      storefrontUrl={storefrontUrl}
    >
      <Heading>Still thinking it over?</Heading>
      <Paragraph>
        Hi {customerFirstName || "babe"} — a little something to help you
        come back. Use this code at checkout for {couponPercentage}% off
        your order.
      </Paragraph>

      <Section
        style={{
          backgroundColor: BRAND.coral,
          borderRadius: "8px",
          padding: "20px",
          margin: "8px 0 16px 0",
          textAlign: "center",
        }}
      >
        <Text
          style={{
            color: "#ffffff",
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.14em",
            margin: "0 0 4px 0",
            textTransform: "uppercase",
          }}
        >
          {couponPercentage}% off
        </Text>
        <Text
          style={{
            color: "#ffffff",
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: "28px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            margin: "0 0 4px 0",
          }}
        >
          {couponCode}
        </Text>
        <Text
          style={{
            color: "rgba(255,255,255,0.85)",
            fontSize: "12px",
            margin: 0,
          }}
        >
          Expires {formatExpiry(couponExpiresAt)}
        </Text>
      </Section>

      <Section
        style={{
          backgroundColor: BRAND.cream,
          borderRadius: "8px",
          padding: "16px",
          margin: "8px 0 16px 0",
        }}
      >
        {shown.map((item, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "6px 0",
            }}
          >
            {item.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.thumbnail}
                alt=""
                width={48}
                height={48}
                style={{ borderRadius: "6px", objectFit: "cover" }}
              />
            ) : (
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "6px",
                  backgroundColor: "#fff",
                }}
              />
            )}
            <div style={{ fontSize: "14px", color: BRAND.ink }}>
              {item.title}
              {item.quantity > 1 ? ` × ${item.quantity}` : ""}
            </div>
          </div>
        ))}
        {moreCount > 0 ? (
          <Paragraph>+ {moreCount} more</Paragraph>
        ) : null}
      </Section>

      <Section style={{ padding: "16px 0 8px 0" }}>
        <Button href={cartResumeUrl}>Resume your cart</Button>
      </Section>

      <Paragraph>
        Apply the code at checkout. Valid until{" "}
        {formatExpiry(couponExpiresAt)}.
      </Paragraph>
    </EmailLayout>
  )
}
