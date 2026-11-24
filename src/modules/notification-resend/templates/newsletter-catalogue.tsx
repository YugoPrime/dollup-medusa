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

import type { CatalogueCard } from "../../newsletter/lib/catalogue"
import { BRAND } from "./_layout"

export type NewsletterCatalogueProps = {
  subject: string
  preheader: string | null
  introText: string | null
  bannerUrl: string | null
  bannerLink: string | null
  campaignId: string
  cards: CatalogueCard[]
  storefrontUrl: string
  unsubscribeUrl: string
}

const GOLD = "#C9A96E"
const CHAMPAGNE = "#FBF3E8"
const SERIF = "Georgia, 'Times New Roman', serif"

const stackCss =
  "@media only screen and (max-width: 480px){.dub-col{display:block !important;box-sizing:border-box !important;width:100% !important;max-width:100% !important;padding-left:0 !important;padding-right:0 !important}.dub-fill{display:none !important}}"

const s = {
  body: {
    backgroundColor: BRAND.cream,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: BRAND.ink,
    margin: 0,
    padding: "24px 12px",
  },
  container: {
    backgroundColor: "#ffffff",
    margin: "0 auto",
    maxWidth: "600px",
    overflow: "hidden",
  },
  header: {
    backgroundColor: BRAND.coral,
    padding: "24px",
    textAlign: "center" as const,
  },
  banner: { display: "block", width: "100%", height: "auto" },
  intro: {
    color: BRAND.inkSoft,
    fontFamily: SERIF,
    fontSize: "16px",
    lineHeight: "26px",
    margin: 0,
    padding: "28px 32px 8px 32px",
    textAlign: "center" as const,
  },
  gridWrap: { backgroundColor: CHAMPAGNE, padding: "20px 10px" },
  cell: { padding: "10px", verticalAlign: "top" as const, width: "50%" },
  card: {
    backgroundColor: "#ffffff",
    border: `1px solid ${BRAND.border}`,
    borderCollapse: "collapse" as const,
  },
  img: { display: "block", width: "100%", height: "auto" },
  noImg: { height: "24px", lineHeight: "24px", fontSize: "1px" },
  info: { padding: "14px 12px 16px 12px", textAlign: "center" as const },
  title: {
    color: BRAND.ink,
    fontFamily: SERIF,
    fontSize: "15px",
    lineHeight: "21px",
    margin: "0 0 6px 0",
  },
  price: {
    color: BRAND.ink,
    fontSize: "14px",
    lineHeight: "20px",
    margin: "0 0 12px 0",
    whiteSpace: "nowrap" as const,
  },
  was: {
    color: BRAND.inkMuted,
    marginLeft: "8px",
    textDecoration: "line-through",
  },
  shop: {
    border: `1px solid ${GOLD}`,
    color: BRAND.ink,
    display: "inline-block",
    fontSize: "12px",
    letterSpacing: "0.12em",
    padding: "9px 22px",
    textDecoration: "none",
    textTransform: "uppercase" as const,
  },
  footer: { padding: "0 32px 28px 32px", textAlign: "center" as const },
  small: {
    color: BRAND.inkMuted,
    fontSize: "12px",
    lineHeight: "18px",
    margin: "12px 0 0 0",
  },
  link: { color: BRAND.inkMuted, textDecoration: "underline" },
}

function IntroText({ text }: { text: string }) {
  const lines = text.split("\n")
  return (
    <Text style={s.intro}>
      {lines.map((line, i) => (
        <React.Fragment key={i}>
          {i > 0 && <br />}
          {line}
        </React.Fragment>
      ))}
    </Text>
  )
}

function ProductCard({ card }: { card: CatalogueCard }) {
  return (
    <table width="100%" role="presentation" style={s.card}>
      <tbody>
        <tr>
          <td>
            {card.imageUrl ? (
              <Link href={card.url}>
                <Img
                  src={card.imageUrl}
                  alt={card.title}
                  width="100%"
                  style={s.img}
                />
              </Link>
            ) : (
              <div style={s.noImg}>&nbsp;</div>
            )}
          </td>
        </tr>
        <tr>
          <td style={s.info}>
            <Text style={s.title}>{card.title}</Text>
            <Text style={s.price}>
              {card.price}
              {card.originalPrice && (
                <span style={s.was}>{card.originalPrice}</span>
              )}
            </Text>
            <Link href={card.url} style={s.shop}>
              Shop
            </Link>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

export default function NewsletterCatalogueEmail({
  subject,
  preheader,
  introText,
  bannerUrl,
  cards,
  storefrontUrl: rawStorefrontUrl,
  unsubscribeUrl,
}: NewsletterCatalogueProps) {
  // Defensive: a trailing slash would give `//logo.png`.
  const storefrontUrl = rawStorefrontUrl.replace(/\/+$/, "")
  return (
    <Html>
      <Head>
        <title>{subject}</title>
        <style>{stackCss}</style>
      </Head>
      {preheader && <Preview>{preheader}</Preview>}
      <Body style={s.body}>
        <Container style={s.container}>
          <Section style={s.header}>
            <Link href={storefrontUrl}>
              <Img
                src={`${storefrontUrl}/logo.png`}
                alt="Doll Up Boutique"
                width="120"
                style={{ display: "inline-block", margin: 0 }}
              />
            </Link>
          </Section>

          {bannerUrl && (
            <Link href={storefrontUrl}>
              <Img
                src={bannerUrl}
                alt="Doll Up Boutique"
                width="600"
                style={s.banner}
              />
            </Link>
          )}

          {introText && <IntroText text={introText} />}

          <Section style={s.gridWrap}>
            <table
              width="100%"
              role="presentation"
              style={{ borderCollapse: "collapse" }}
            >
              <tbody>
                {chunk(cards, 2).map((pair) => (
                  <tr key={pair[0].id}>
                    {pair.map((c) => (
                      <td key={c.id} className="dub-col" style={s.cell}>
                        <ProductCard card={c} />
                      </td>
                    ))}
                    {pair.length === 1 && (
                      <td className="dub-fill" style={s.cell} />
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section style={{ padding: "24px 32px 0 32px", textAlign: "center" }}>
            <Link href={storefrontUrl} style={s.shop}>
              Shop all
            </Link>
          </Section>

          <Section style={{ padding: "24px 32px" }}>
            <Hr style={{ borderColor: GOLD, margin: 0 }} />
          </Section>

          <Section style={s.footer}>
            <Text style={{ ...s.small, margin: 0 }}>
              Doll Up Boutique Limited · BRN C18159019 · VAT 27646277
              <br />
              Mauritius — fashion, lingerie & beachwear since 2018
            </Text>
            <Text style={s.small}>
              Questions? Reply to this email or message us on{" "}
              <Link
                href="https://wa.me/23059416359"
                style={{ color: BRAND.coral }}
              >
                WhatsApp
              </Link>
              .
            </Text>
            <Text style={s.small}>
              You&apos;re receiving this because you signed up for Doll Up news.{" "}
              <Link href={unsubscribeUrl} style={s.link}>
                Unsubscribe
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}
