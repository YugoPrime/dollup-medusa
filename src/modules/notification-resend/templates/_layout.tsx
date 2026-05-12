import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components"
import * as React from "react"

type EmailLayoutProps = {
  preview: string
  storefrontUrl: string
  children: React.ReactNode
}

export const BRAND = {
  coral: "#5e423dff",
  coralDark: "#C84A36",
  blush: "#FCE4E0",
  cream: "#FFF7F2",
  ink: "#2A2A2A",
  inkSoft: "#5C4D4D",
  inkMuted: "#7A6363",
  border: "#F2D6CE",
}

export function EmailLayout({
  preview,
  storefrontUrl,
  children,
}: EmailLayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: BRAND.cream,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          color: BRAND.ink,
          margin: 0,
          padding: "32px 16px",
        }}
      >
        <Container
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "12px",
            margin: "0 auto",
            maxWidth: "560px",
            overflow: "hidden",
          }}
        >
          <Section
            style={{
              backgroundColor: BRAND.coral,
              padding: "24px",
              textAlign: "center",
            }}
          >
            <Link href={storefrontUrl}>
              <Img
                src={`${storefrontUrl}/logo.png`}
                alt="Doll Up Boutique"
                width="120"
                style={{ display: "inline-block", margin: 0 }}
              />
            </Link>
          </Section>

          <Section style={{ padding: "32px 32px 8px 32px" }}>
            {children}
          </Section>

          <Hr style={{ borderColor: BRAND.border, margin: "24px 32px" }} />

          <Section style={{ padding: "0 32px 24px 32px" }}>
            <Text
              style={{
                color: BRAND.inkMuted,
                fontSize: "12px",
                lineHeight: "18px",
                margin: 0,
              }}
            >
              Doll Up Boutique Limited · BRN C18159019 · VAT 27646277
              <br />
              Mauritius — fashion, lingerie & beachwear since 2018
            </Text>
            <Text
              style={{
                color: BRAND.inkMuted,
                fontSize: "12px",
                lineHeight: "18px",
                margin: "12px 0 0 0",
              }}
            >
              Questions? Reply to this email or message us on{" "}
              <Link
                href="https://wa.me/2305941 6359"
                style={{ color: BRAND.coral }}
              >
                WhatsApp
              </Link>
              .
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export function Heading({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        color: BRAND.ink,
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: "24px",
        fontWeight: 600,
        lineHeight: "32px",
        margin: "0 0 8px 0",
      }}
    >
      {children}
    </Text>
  )
}

export function Paragraph({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        color: BRAND.inkSoft,
        fontSize: "15px",
        lineHeight: "24px",
        margin: "0 0 16px 0",
      }}
    >
      {children}
    </Text>
  )
}

export function Button({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  // Wrap in a centered table — `align="center"` on the table itself is the
  // most reliable way to horizontally center a button across Gmail, Apple
  // Mail, and Outlook. `text-align: center` on the parent doesn't work in
  // all clients.
  return (
    <table
      align="center"
      cellPadding={0}
      cellSpacing={0}
      role="presentation"
      style={{ borderCollapse: "collapse", margin: "0 auto" }}
    >
      <tbody>
        <tr>
          <td>
            <Link
              href={href}
              style={{
                backgroundColor: BRAND.coral,
                borderRadius: "8px",
                color: "#ffffff",
                display: "inline-block",
                fontSize: "14px",
                fontWeight: 600,
                letterSpacing: "0.04em",
                padding: "12px 24px",
                textDecoration: "none",
                textTransform: "uppercase",
              }}
            >
              {children}
            </Link>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

export function StatRow({
  label,
  value,
  emphasized,
}: {
  label: string
  value: string
  emphasized?: boolean
}) {
  return (
    <table
      width="100%"
      style={{
        borderCollapse: "collapse",
        margin: emphasized ? "8px 0 0 0" : "4px 0",
      }}
    >
      <tbody>
        <tr>
          <td
            style={{
              color: emphasized ? BRAND.ink : BRAND.inkSoft,
              fontSize: emphasized ? "16px" : "14px",
              fontWeight: emphasized ? 700 : 400,
              padding: emphasized ? "8px 0 0 0" : 0,
              borderTop: emphasized ? `1px solid ${BRAND.border}` : "none",
            }}
          >
            {label}
          </td>
          <td
            align="right"
            style={{
              color: emphasized ? BRAND.coral : BRAND.ink,
              fontSize: emphasized ? "16px" : "14px",
              fontWeight: emphasized ? 700 : 500,
              padding: emphasized ? "8px 0 0 0" : 0,
              borderTop: emphasized ? `1px solid ${BRAND.border}` : "none",
            }}
          >
            {value}
          </td>
        </tr>
      </tbody>
    </table>
  )
}

export function formatMur(amount: number) {
  if (!Number.isFinite(amount)) return "Rs 0"
  return `Rs ${Math.round(amount).toLocaleString("en-MU")}`
}
