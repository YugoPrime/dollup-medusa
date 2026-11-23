import { render } from "@react-email/render"
import * as React from "react"

import NewsletterCatalogueEmail from "../notification-resend/templates/newsletter-catalogue"
import type { CatalogueCard } from "./lib/catalogue"

export const UNSUBSCRIBE_PLACEHOLDER = "{{{RESEND_UNSUBSCRIBE_URL}}}"

export type CatalogueEmailInput = {
  subject: string
  preheader: string | null
  introText: string | null
  bannerUrl: string | null
  cards: CatalogueCard[]
  storefrontUrl: string
  unsubscribeUrl: string
}

export async function renderCatalogueEmail(
  input: CatalogueEmailInput
): Promise<string> {
  return render(React.createElement(NewsletterCatalogueEmail, input))
}
