import * as React from "react"

import OrderPlacedEmail from "../order-placed"

export default function OrderPlacedHomeDeliveryPreview() {
  return (
    <OrderPlacedEmail
      storefrontUrl="https://shop.dollupboutique.com"
      customerFirstName="Aaliyah"
      displayId={1043}
      items={[
        {
          title: "Linen Wide-Leg Pants — S / Cream",
          quantity: 2,
          unit_price: 1290,
          thumbnail:
            "https://cdn.dollupboutique.com/dollup-media/sample/linen-pants.jpg",
        },
        {
          title: "Knot-Front Crop Tee — One Size / Sage",
          quantity: 1,
          unit_price: 690,
          thumbnail:
            "https://cdn.dollupboutique.com/dollup-media/sample/knot-tee.jpg",
        },
      ]}
      subtotal={3270}
      shippingTotal={150}
      total={3420}
      shippingAddress={{
        address_1: "Avenue des Bougainvilliers, Block A apt 3",
        city: "Quatre Bornes",
        phone: "5712-3456",
      }}
      deliveryMethod="home_delivery"
      shippingMethodLabel="Home Delivery"
      deliveryDate="2026-05-15"
    />
  )
}
