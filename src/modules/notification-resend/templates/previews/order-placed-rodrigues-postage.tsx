import * as React from "react"

import OrderPlacedEmail from "../order-placed"

export default function OrderPlacedRodriguesPostagePreview() {
  return (
    <OrderPlacedEmail
      storefrontUrl="https://shop.dollupboutique.com"
      customerFirstName="Anya"
      displayId={1046}
      items={[
        {
          title: "Cotton Wrap Blouse — S / White",
          quantity: 1,
          unit_price: 1190,
          thumbnail:
            "https://cdn.dollupboutique.com/dollup-media/sample/cotton-wrap-blouse.jpg",
        },
      ]}
      subtotal={1190}
      shippingTotal={100}
      total={1290}
      shippingAddress={{
        address_1: "Lot 14 Rue Joseph",
        city: "Port Mathurin, Rodrigues",
        phone: "5712-3456",
      }}
      deliveryMethod="post_office"
      shippingMethodLabel="Rodrigues Postage"
      deliveryDate={null}
    />
  )
}
