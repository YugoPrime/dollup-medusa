import * as React from "react"

import OrderPlacedEmail from "../order-placed"

export default function OrderPlacedPickupPreview() {
  return (
    <OrderPlacedEmail
      storefrontUrl="https://shop.dollupboutique.com"
      customerFirstName="Sarah"
      displayId={1042}
      items={[
        {
          title: "Floral Wrap Midi Dress — M / Coral",
          quantity: 1,
          unit_price: 1950,
          thumbnail:
            "https://cdn.dollupboutique.com/dollup-media/sample/floral-wrap-midi.jpg",
        },
        {
          title: "Strappy Block Heels — 37 / Beige",
          quantity: 1,
          unit_price: 1450,
          thumbnail:
            "https://cdn.dollupboutique.com/dollup-media/sample/strappy-block-heels.jpg",
        },
      ]}
      subtotal={3400}
      shippingTotal={0}
      total={3400}
      shippingAddress={{
        address_1: null,
        city: null,
        phone: "5712-3456",
      }}
      deliveryMethod="pickup"
      shippingMethodLabel="Pick Up"
      deliveryDate={null}
    />
  )
}
