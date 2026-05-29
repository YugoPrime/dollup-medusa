import { Section } from "@react-email/components"
import * as React from "react"

import { Button, EmailLayout, Heading, Paragraph } from "./_layout"

export type PreorderReservationExpiredData = {
  customerFirstName: string
  displayId: string | number
}

const STOREFRONT_URL =
  process.env.STOREFRONT_URL ?? "https://shop.dollupboutique.com"

export default function PreorderReservationExpiredEmail(
  data: PreorderReservationExpiredData,
) {
  const { customerFirstName, displayId } = data

  return (
    <EmailLayout
      preview={`Your pre-order #${displayId} reservation expired`}
      storefrontUrl={STOREFRONT_URL}
    >
      <Heading>
        Hi {customerFirstName || "there"} — your reservation has expired
      </Heading>
      <Paragraph>
        We didn't receive the deposit for pre-order #{displayId} in time, so the
        reservation has been released. No worries — nothing was charged.
      </Paragraph>
      <Paragraph>
        Still want those pieces? You can re-order any time while they're
        available. We'd love to get them to you.
      </Paragraph>

      <Section style={{ padding: "8px 0 8px 0" }}>
        <Button href={STOREFRONT_URL}>Re-order now</Button>
      </Section>

      <Paragraph>
        Questions or need a hand? Just reply to this email — we're happy to
        help.
      </Paragraph>
    </EmailLayout>
  )
}
