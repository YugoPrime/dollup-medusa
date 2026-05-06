import { parseOgFromHtml } from "../og-scrape"

describe("parseOgFromHtml", () => {
  it("extracts og:title, og:image, og:description", () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Cool Lace Bodysuit" />
        <meta property="og:image" content="https://cdn.example.com/x.jpg" />
        <meta property="og:description" content="Sexy & comfy" />
      </head><body></body></html>
    `
    expect(parseOgFromHtml(html)).toEqual({
      title: "Cool Lace Bodysuit",
      image: "https://cdn.example.com/x.jpg",
      description: "Sexy & comfy",
    })
  })

  it("falls back to Alibaba .product-title-text + first .detail-gallery-img", () => {
    const html = `
      <html><body>
        <h1 class="product-title-text">Alibaba Title</h1>
        <div class="detail-gallery-img"><img src="https://ali.example/a.jpg"/></div>
      </body></html>
    `
    expect(parseOgFromHtml(html)).toEqual({
      title: "Alibaba Title",
      image: "https://ali.example/a.jpg",
      description: null,
    })
  })

  it("returns nulls when nothing parseable is present", () => {
    expect(parseOgFromHtml("<html><body></body></html>")).toEqual({
      title: null,
      image: null,
      description: null,
    })
  })

  it("trims whitespace and ignores empty content attrs", () => {
    const html = `<meta property="og:title" content="   " />`
    expect(parseOgFromHtml(html).title).toBeNull()
  })
})
