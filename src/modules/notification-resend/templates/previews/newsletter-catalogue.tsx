import * as React from "react"

import NewsletterCatalogueEmail from "../newsletter-catalogue"

const cdn = "https://cdn.dollupboutique.com"
const images = [
  `${cdn}/products/is2281/is2281-xs-green-front.jpg`,
  `${cdn}/products/is2297/is2297-s-red-back.jpg`,
  `${cdn}/products/is2364/is2364-s-blue-back.jpg`,
  `${cdn}/IS2389-01KSNHT7M6G0ENTGCD9S2RBRNP.jpg`,
]

export const sampleCards = Array.from({ length: 7 }, (_, i) => ({
  id: `p${i}`,
  title:
    i === 2
      ? "Satin wrap midi dress with long sleeves and a ruched waist in emerald"
      : `Party dress ${i + 1}`,
  url: `https://dollupboutique.com/products/p${i}`,
  imageUrl: images[i % images.length],
  price: "Rs 990",
  originalPrice: i % 2 ? "Rs 1,290" : null,
}))

export default function NewsletterCataloguePreview() {
  return (
    <NewsletterCatalogueEmail
      subject="New in: party pieces"
      preheader="Fresh party pieces, just landed"
      introText={"Our newest pieces are here.\nPicked for your next night out."}
      bannerUrl={`${cdn}/homepage/babe-essentials/is1361.jpg`}
      cards={sampleCards}
      storefrontUrl="https://dollupboutique.com"
      unsubscribeUrl="#"
    />
  )
}
