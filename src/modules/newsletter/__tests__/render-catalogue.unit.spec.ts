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
    expect(html).toContain('src="https://dollupboutique.com/logo.png"')
    expect(html).toContain('href="https://dollupboutique.com"')
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
