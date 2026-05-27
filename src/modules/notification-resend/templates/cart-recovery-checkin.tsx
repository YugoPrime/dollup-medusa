import { Section } from "@react-email/components"
import * as React from "react"

import {
  BRAND,
  Button,
  EmailLayout,
  Heading,
  Paragraph,
} from "./_layout"

export type CartRecoveryItem = {
  title: string
  thumbnail: string | null
  quantity: number
}

export type CartRecoveryCheckinData = {
  storefrontUrl: string
  customerFirstName: string
  cartResumeUrl: string
  items: CartRecoveryItem[]
}

export default function CartRecoveryCheckinEmail(
  data: CartRecoveryCheckinData,
) {
  const { storefrontUrl, customerFirstName, cartResumeUrl, items } = data
  const shown = items.slice(0, 4)
  const moreCount = items.length - shown.length

  return (
    <EmailLayout
      preview="Anything we can help with?"
      storefrontUrl={storefrontUrl}
    >
      <Heading>Hi {customerFirstName || "babe"} 💭</Heading>
      <Paragraph>
        We noticed you left a few pieces in your cart. Did something go
        wrong with your order? If you have any question or hit a snag,
        just reply to this email — we're happy to help.
      </Paragraph>

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
        Or browse the latest drops at{" "}
        <a href={storefrontUrl} style={{ color: BRAND.coral }}>
          dollupboutique.com
        </a>
        .
      </Paragraph>
    </EmailLayout>
  )
}
