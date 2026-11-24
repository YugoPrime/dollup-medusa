import {
  CATEGORY_BUTTONS,
  NEWSLETTER_HEADER_URL,
  splitIntro,
} from "../../notification-resend/templates/newsletter-catalogue"
import type { CatalogueCard } from "../lib/catalogue"
import {
  renderCatalogueEmail,
  UNSUBSCRIBE_PLACEHOLDER,
  type CatalogueEmailInput,
} from "../render-catalogue"

const card = (i: number): CatalogueCard => ({
  id: `p${i}`,
  title: `Satin wrap midi dress with long sleeves ${i}`.repeat(2),
  url: `https://dollupboutique.com/products/p${i}?utm_source=newsletter`,
  imageUrl: `https://cdn.dollupboutique.com/p${i}.jpg`,
  price: "Rs 990",
  originalPrice: i % 2 ? "Rs 1,290" : null,
})

const base: CatalogueEmailInput = {
  subject: "New in",
  preheader: "Fresh party pieces",
  introText: "Line one\nLine two",
  bannerUrl: "https://cdn.dollupboutique.com/newsletter/b.jpg",
  bannerLink: null,
  campaignId: "nlcamp_1",
  cards: Array.from({ length: 24 }, (_, i) => card(i)),
  storefrontUrl: "https://dollupboutique.com",
  unsubscribeUrl: UNSUBSCRIBE_PLACEHOLDER,
}

describe("renderCatalogueEmail", () => {
  it("renders 24 long-titled cards under 100 KB with the key parts", async () => {
    const html = await renderCatalogueEmail(base)
    expect(html).toContain("{{{RESEND_UNSUBSCRIBE_URL}}}")
    expect(html).toContain("Rs 1,290")
    expect(html).toContain(
      "https://dollupboutique.com/products/p3?utm_source=newsletter"
    )
    expect(html).toContain("newsletter/b.jpg")
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(100_000)
  })

  it("never builds a double slash from a storefront URL with a trailing slash", async () => {
    const html = await renderCatalogueEmail({ ...base, storefrontUrl: "https://dollupboutique.com//" })
    expect(html).not.toContain("dollupboutique.com//")
    expect(html).toContain('href="https://dollupboutique.com"')
    expect(html).toContain('href="https://dollupboutique.com/shop?category=dresses&amp;')
  })

  it("omits banner, and a missing card image renders no img", async () => {
    const noBanner = await renderCatalogueEmail({
      ...base,
      bannerUrl: null,
      introText: null,
      cards: [{ ...card(1), imageUrl: null }],
    })
    expect(noBanner).not.toContain("newsletter/b.jpg")
    expect(noBanner).not.toContain("p1.jpg")
  })
})

const cards = (n: number) => Array.from({ length: n }, (_, i) => card(i))

describe("catalogue email layout", () => {
  it("shows the satin header image with alt text and a fallback colour, not the old logo", async () => {
    const html = await renderCatalogueEmail(base)
    expect(NEWSLETTER_HEADER_URL).toBe(
      "https://cdn.dollupboutique.com/newsletter/28244b2470bc/header-satin.jpg"
    )
    expect(html).toContain(`src="${NEWSLETTER_HEADER_URL}"`)
    expect(html).toContain('alt="Doll Up Boutique"')
    expect(html).toContain("#E9DDD3")
    expect(html).not.toContain("logo.png")
  })

  it("links Dresses, Beachwear and Lingerie, in that order, with the campaign's UTM tags", async () => {
    const html = await renderCatalogueEmail(base)
    expect(CATEGORY_BUTTONS.map((b) => b.handle)).toEqual(["dresses", "beachwear", "lingerie"])
    for (const h of ["dresses", "beachwear", "lingerie"]) {
      expect(html).toContain(
        `href="https://dollupboutique.com/shop?category=${h}&amp;utm_source=newsletter&amp;utm_medium=email&amp;utm_campaign=nlcamp_1"`
      )
    }
    const at = (label: string) => html.indexOf(`>${label}</a>`)
    expect(at("Dresses")).toBeGreaterThan(-1)
    expect(at("Dresses")).toBeLessThan(at("Beachwear"))
    expect(at("Beachwear")).toBeLessThan(at("Lingerie"))
  })

  it("splits the intro into a title and body lines, ignoring CRLF and blank lines", () => {
    expect(splitIntro("Title\r\n\r\nBody one\r\nBody two\n")).toEqual({
      title: "Title",
      body: ["Body one", "Body two"],
    })
    expect(splitIntro("Only")).toEqual({ title: "Only", body: [] })
  })

  it("renders the first intro line as a 32px Playfair title and the rest as body text", async () => {
    const html = await renderCatalogueEmail({
      ...base,
      introText: "The Festive Collection is here\nSatin and velvet",
    })
    expect(html).toMatch(/<[^>]+font-size:32px[^>]*>The Festive Collection is here</)
    expect(html).toContain("Playfair+Display")
    expect(html).toContain("Satin and velvet")
  })

  it("renders no title for a blank intro", async () => {
    const html = await renderCatalogueEmail({ ...base, introText: " \r\n " })
    expect(html).not.toContain("font-size:32px")
  })

  it("puts the banner after the 4th product and links it to bannerLink, else the storefront", async () => {
    const html = await renderCatalogueEmail({ ...base, bannerLink: "https://dollupboutique.com/sale" })
    const banner = html.indexOf("newsletter/b.jpg")
    expect(banner).toBeGreaterThan(html.lastIndexOf("products/p3?"))
    expect(banner).toBeLessThan(html.indexOf("products/p4?"))
    expect(html).toMatch(/<a href="https:\/\/dollupboutique\.com\/sale"[^>]*><img[^>]+newsletter\/b\.jpg/)

    const home = await renderCatalogueEmail(base)
    expect(home).toMatch(/<a href="https:\/\/dollupboutique\.com"[^>]*><img[^>]+newsletter\/b\.jpg/)
  })

  it("puts the banner after the grid with 4 or fewer products and keeps an odd row's filler", async () => {
    const three = await renderCatalogueEmail({ ...base, cards: cards(3) })
    expect(three.indexOf("newsletter/b.jpg")).toBeGreaterThan(three.lastIndexOf("products/p2?"))

    const five = await renderCatalogueEmail({ ...base, cards: cards(5) })
    const b5 = five.indexOf("newsletter/b.jpg")
    expect(b5).toBeGreaterThan(five.lastIndexOf("products/p3?"))
    expect(b5).toBeLessThan(five.indexOf("products/p4?"))
    expect(five.slice(five.indexOf("products/p4?"))).toContain('class="dub-fill"')
  })

  it("shows no banner when only a banner link is set", async () => {
    const html = await renderCatalogueEmail({
      ...base,
      bannerUrl: null,
      bannerLink: "https://dollupboutique.com/sale",
    })
    expect(html).not.toContain("newsletter/b.jpg")
    expect(html).not.toContain("dollupboutique.com/sale")
  })

  it("gives every card its own bordered cell so the two cards in a row share one height", async () => {
    const html = await renderCatalogueEmail(base)
    const cells = html.match(/<td[^>]*class="dub-col"[^>]*>/g) ?? []
    expect(cells).toHaveLength(24)
    for (const c of cells) expect(c).toContain("border:1px solid")
    expect(html).toContain("height:42px")
    expect(html).toContain('class="dub-gap"')
    expect(html).toContain(".dub-gap{display:block")
    expect(html).not.toContain("height:100%")
  })

  it("says why the reader gets the email", async () => {
    const html = await renderCatalogueEmail(base)
    expect(html).toContain(
      "You&#x27;re receiving this because you shopped with Doll Up or signed up for our news."
    )
  })
})
