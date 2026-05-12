import * as React from "react"

import OrderShippedEmail from "../order-shipped"

export default function OrderShippedHomeDeliveryUnpaidPreview() {
  return (
    <OrderShippedEmail
      storefrontUrl="https://shop.dollupboutique.com"
      customerFirstName="Aaliyah"
      displayId={1043}
      deliveryMethod="home_delivery"
      shippingMethodLabel="Home Delivery"
      deliveryDate="2026-05-15"
      trackingNumber={null}
      isPaid={false}
      items={[
        {
          title: "Linen Wide-Leg Pants — S / Cream",
          quantity: 2,
          unit_price: 1290,
          thumbnail: "https://cdn.dollupboutique.com/dollup-media/sample/linen-pants.jpg",
        },
        {
          title: "Knot-Front Crop Tee — One Size / Sage",
          quantity: 1,
          unit_price: 690,
          thumbnail: "https://cdn.dollupboutique.com/dollup-media/sample/knot-tee.jpg",
        },
      ]}
      subtotal={3270}
      shippingTotal={150}
      total={3420}
    />
  )
}
