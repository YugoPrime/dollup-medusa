import * as React from "react"

import OrderPlacedEmail from "../order-placed"

export default function OrderPlacedExpressPostagePreview() {
  return (
    <OrderPlacedEmail
      storefrontUrl="https://shop.dollupboutique.com"
      customerFirstName="Leah"
      displayId={1045}
      items={[
        {
          title: "Satin Slip Dress — M / Champagne",
          quantity: 1,
          unit_price: 2290,
          thumbnail:
            "https://cdn.dollupboutique.com/dollup-media/sample/satin-slip.jpg",
        },
      ]}
      subtotal={2290}
      shippingTotal={110}
      total={2400}
      shippingAddress={{
        address_1: "5 Rue Saint Jean",
        city: "Rose Hill",
        phone: "5712-3456",
      }}
      deliveryMethod="post_office"
      shippingMethodLabel="Express Postage"
      deliveryDate={null}
    />
  )
}
