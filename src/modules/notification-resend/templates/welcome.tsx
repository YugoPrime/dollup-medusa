import { Section, Text } from "@react-email/components"
import * as React from "react"

import {
  BRAND,
  Button,
  EmailLayout,
  Heading,
  Paragraph,
} from "./_layout"

export type WelcomeEmailData = {
  storefrontUrl: string
  customerFirstName: string
  welcomeBonusPoints: number
}

export default function WelcomeEmail(data: WelcomeEmailData) {
  const { storefrontUrl, customerFirstName, welcomeBonusPoints } = data

  return (
    <EmailLayout
      preview={
        welcomeBonusPoints > 0
          ? `You just got ${welcomeBonusPoints} Doll Rewards points`
          : "Welcome to Doll Up Boutique"
      }
      storefrontUrl={storefrontUrl}
    >
      <Heading>Welcome, {customerFirstName || "babe"}!</Heading>
      <Paragraph>
        We're so glad you're here. Your account is ready — saved
        addresses, faster checkout, wishlist sync, and order history all in
        one place.
      </Paragraph>

      {welcomeBonusPoints > 0 ? (
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
            Welcome gift
          </Text>
          <Text
            style={{
              color: "#ffffff",
              fontFamily: "Georgia, 'Times New Roman', serif",
              fontSize: "28px",
              fontWeight: 700,
              margin: "0 0 4px 0",
            }}
          >
            {welcomeBonusPoints} points
          </Text>
          <Text
            style={{
              color: "rgba(255,255,255,0.85)",
              fontSize: "13px",
              margin: 0,
            }}
          >
            Already in your Doll Rewards account
          </Text>
        </Section>
      ) : null}

      <Paragraph>
        Earn 2 points per Rs 100 spent. 1 point = Rs 1 off your next order,
        from 150 points minimum. Birthday bonus, early access drops, and
        member-only offers — that's the deal.
      </Paragraph>

      <Section style={{ padding: "16px 0 8px 0" }}>
        <Button href={`${storefrontUrl}/shop`}>Start shopping</Button>
      </Section>

      <Paragraph>
        Follow us on{" "}
        <a
          href="https://www.instagram.com/doll_up_boutique"
          style={{ color: BRAND.coral }}
        >
          Instagram
        </a>{" "}
        for new drops, styling looks, and behind-the-scenes.
      </Paragraph>
    </EmailLayout>
  )
}
