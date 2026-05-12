import * as React from "react"

import OrderShippedEmail from "../order-shipped"

export default function OrderShippedRodriguesPostagePreview() {
  return (
    <OrderShippedEmail
      storefrontUrl="https://shop.dollupboutique.com"
      customerFirstName="Anya"
      displayId={1046}
      deliveryMethod="post_office"
      shippingMethodLabel="Rodrigues Postage"
      deliveryDate={null}
      trackingNumber="RR987654321MU"
      isPaid={true}
      items={[
        {
          title: "Cotton Wrap Blouse — S / White",
          quantity: 1,
          unit_price: 1190,
          thumbnail: "https://cdn.dollupboutique.com/dollup-media/sample/cotton-wrap-blouse.jpg",
        },
      ]}
      subtotal={1190}
      shippingTotal={100}
      total={1290}
    />
  )
}
