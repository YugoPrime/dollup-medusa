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

/** Satin + logo, one baked image so it looks the same in every mail app (spec 2026-11-25). */
export const NEWSLETTER_HEADER_URL =
  "https://cdn.dollupboutique.com/newsletter/28244b2470bc/header-satin.jpg"

export const CATEGORY_BUTTONS: ReadonlyArray<{ label: string; handle: string }> = [
  { label: "Dresses", handle: "dresses" },
  { label: "Beachwear", handle: "beachwear" },
  { label: "Lingerie", handle: "lingerie" },
]

/** The promo banner goes after this many products (or after the grid when there are fewer). */
const BANNER_AFTER_CARDS = 4

const GOLD = "#C9A96E"
const CHAMPAGNE = "#FBF3E8"
const STRIP = "#F3EADF"
const HEADER_FALLBACK = "#E9DDD3"
const SERIF = "Georgia, 'Times New Roman', serif"
// Gmail drops web fonts and shows Georgia; Apple Mail shows Playfair, the storefront's display font.
const DISPLAY = "'Playfair Display', Georgia, 'Times New Roman', serif"
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
const FONT_CSS =
  "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600&display=swap"

// Phones stack the cards. The gap cell turns into a 16px spacer; a filler cell disappears.
const stackCss =
  "@media only screen and (max-width: 480px){.dub-col{display:block !important;box-sizing:border-box !important;width:100% !important;max-width:100% !important}.dub-gap{display:block !important;width:100% !important;height:16px !important}.dub-fill{display:none !important}}"

const s = {
  body: {
    backgroundColor: BRAND.cream,
    fontFamily: SANS,
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
  header: { backgroundColor: HEADER_FALLBACK },
  headerImg: {
    display: "block",
    width: "100%",
    height: "auto",
    color: BRAND.ink,
    fontFamily: SERIF,
    fontSize: "20px",
    textAlign: "center" as const,
  },
  strip: { backgroundColor: STRIP, padding: "14px 22px" },
  navCell: { padding: "0 5px" },
  navBtn: {
    backgroundColor: "#ffffff",
    border: `1px solid ${GOLD}`,
    color: BRAND.ink,
    display: "block",
    fontFamily: SANS,
    fontSize: "12px",
    letterSpacing: "0.16em",
    lineHeight: "16px",
    padding: "10px 0",
    textAlign: "center" as const,
    textDecoration: "none",
    textTransform: "uppercase" as const,
  },
  introWrap: { padding: "34px 36px 26px 36px", textAlign: "center" as const },
  introTitle: {
    color: BRAND.ink,
    fontFamily: DISPLAY,
    fontSize: "32px",
    fontWeight: 400,
    lineHeight: "40px",
    margin: 0,
    textAlign: "center" as const,
  },
  introRule: {
    backgroundColor: GOLD,
    fontSize: "1px",
    height: "1px",
    lineHeight: "1px",
    margin: "18px auto",
    width: "60px",
  },
  introBody: {
    color: "#5C4D4D",
    fontFamily: SANS,
    fontSize: "15px",
    lineHeight: "25px",
    margin: 0,
    textAlign: "center" as const,
  },
  gridWrap: { backgroundColor: CHAMPAGNE, padding: "20px 16px" },
  cardCell: {
    backgroundColor: "#ffffff",
    border: `1px solid ${BRAND.border}`,
    padding: 0,
    verticalAlign: "top" as const,
    width: "48%",
  },
  gapCell: { fontSize: "1px", lineHeight: "1px", width: "4%" },
  fillCell: { width: "48%" },
  spacer: { fontSize: "1px", height: "16px", lineHeight: "16px" },
  img: { display: "block", width: "100%", height: "auto" },
  noImg: { height: "24px", lineHeight: "24px", fontSize: "1px" },
  info: { padding: "14px 12px 16px 12px", textAlign: "center" as const },
  title: {
    color: BRAND.ink,
    fontFamily: SERIF,
    fontSize: "15px",
    // Two lines high whatever the title, so prices and buttons line up across a row.
    height: "42px",
    lineHeight: "21px",
    margin: "0 0 6px 0",
    overflow: "hidden",
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
  bannerCell: { paddingTop: "16px" },
  bannerImg: { display: "block", width: "100%", height: "auto" },
  footer: { padding: "0 32px 28px 32px", textAlign: "center" as const },
  small: {
    color: BRAND.inkMuted,
    fontSize: "12px",
    lineHeight: "18px",
    margin: "12px 0 0 0",
  },
  link: { color: BRAND.inkMuted, textDecoration: "underline" },
}

/** First non-blank line is the title; the other non-blank lines are the body. */
export function splitIntro(text: string): { title: string; body: string[] } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  return { title: lines[0] ?? "", body: lines.slice(1) }
}

function categoryUrl(storefrontUrl: string, handle: string, campaignId: string): string {
  return `${storefrontUrl}/shop?category=${handle}&utm_source=newsletter&utm_medium=email&utm_campaign=${encodeURIComponent(campaignId)}`
}

/**
 * Where the banner opens. Storefront links get the newsletter's UTM tags (unless they
 * already carry some), so sale clicks count for the email; other sites are left as typed.
 */
function bannerHref(link: string | null, storefrontUrl: string, campaignId: string): string {
  const target = link ?? `${storefrontUrl}/`
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return target
  }
  if (url.host !== new URL(storefrontUrl).host || url.searchParams.has("utm_source")) {
    return target
  }
  url.searchParams.set("utm_source", "newsletter")
  url.searchParams.set("utm_medium", "email")
  url.searchParams.set("utm_campaign", campaignId)
  return url.toString()
}

function Intro({ text }: { text: string }) {
  const { title, body } = splitIntro(text)
  if (!title) return null
  return (
    <Section style={s.introWrap}>
      <Text style={s.introTitle}>{title}</Text>
      <div style={s.introRule}>&nbsp;</div>
      {body.length > 0 && (
        <Text style={s.introBody}>
          {body.map((line, i) => (
            <React.Fragment key={i}>
              {i > 0 && <br />}
              {line}
            </React.Fragment>
          ))}
        </Text>
      )}
    </Section>
  )
}

function CardCell({ card }: { card: CatalogueCard }) {
  return (
    <td className="dub-col" width="48%" valign="top" style={s.cardCell}>
      {card.imageUrl ? (
        <Link href={card.url}>
          {/* Pixel width for Outlook desktop, which ignores a percentage; other clients follow the inline 100%. */}
          <Img src={card.imageUrl} alt={card.title} width="270" style={s.img} />
        </Link>
      ) : (
        <div style={s.noImg}>&nbsp;</div>
      )}
      <div style={s.info}>
        <Text style={s.title}>{card.title}</Text>
        <Text style={s.price}>
          {card.price}
          {card.originalPrice && <span style={s.was}>{card.originalPrice}</span>}
        </Text>
        <Link href={card.url} style={s.shop}>
          Shop
        </Link>
      </div>
    </td>
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
  bannerLink,
  campaignId,
  cards,
  storefrontUrl: rawStorefrontUrl,
  unsubscribeUrl,
}: NewsletterCatalogueProps) {
  // Defensive: a trailing slash would give `//shop`.
  const storefrontUrl = rawStorefrontUrl.replace(/\/+$/, "")
  const rows = chunk(cards, 2)
  // Cards sit two per row, so "after card 4" is after row index 1.
  const bannerAfterRow =
    cards.length > BANNER_AFTER_CARDS ? BANNER_AFTER_CARDS / 2 - 1 : rows.length - 1
  const bannerRow = bannerUrl ? (
    <tr>
      <td colSpan={3} style={s.bannerCell}>
        <Link href={bannerHref(bannerLink, storefrontUrl, campaignId)}>
          <Img src={bannerUrl} alt={subject} width="568" style={s.bannerImg} />
        </Link>
      </td>
    </tr>
  ) : null

  return (
    <Html>
      <Head>
        <title>{subject}</title>
        <link rel="stylesheet" href={FONT_CSS} />
        <style>{stackCss}</style>
      </Head>
      {preheader && <Preview>{preheader}</Preview>}
      <Body style={s.body}>
        <Container style={s.container}>
          <Section style={s.header}>
            <Link href={storefrontUrl}>
              <Img
                src={NEWSLETTER_HEADER_URL}
                alt="Doll Up Boutique"
                width="600"
                style={s.headerImg}
              />
            </Link>
          </Section>

          <Section style={s.strip}>
            <table width="100%" role="presentation" style={{ borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  {CATEGORY_BUTTONS.map((b) => (
                    <td key={b.handle} align="center" width="33%" style={s.navCell}>
                      <Link href={categoryUrl(storefrontUrl, b.handle, campaignId)} style={s.navBtn}>
                        {b.label}
                      </Link>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </Section>

          {introText && <Intro text={introText} />}

          <Section style={s.gridWrap}>
            <table width="100%" role="presentation" style={{ borderCollapse: "collapse" }}>
              <tbody>
                {rows.map((pair, i) => (
                  <React.Fragment key={pair[0].id}>
                    {i > 0 && (
                      <tr>
                        <td colSpan={3} style={s.spacer}>
                          &nbsp;
                        </td>
                      </tr>
                    )}
                    <tr>
                      <CardCell card={pair[0]} />
                      <td
                        className={pair.length === 1 ? "dub-gap dub-fill" : "dub-gap"}
                        width="4%"
                        style={s.gapCell}
                      >
                        &nbsp;
                      </td>
                      {pair[1] ? (
                        <CardCell card={pair[1]} />
                      ) : (
                        <td className="dub-fill" width="48%" style={s.fillCell} />
                      )}
                    </tr>
                    {i === bannerAfterRow && bannerRow}
                  </React.Fragment>
                ))}
                {rows.length === 0 && bannerRow}
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
              You&apos;re receiving this because you shopped with Doll Up or signed up for our news.{" "}
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
