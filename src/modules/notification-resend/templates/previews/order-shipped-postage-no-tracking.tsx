import * as React from "react"

import OrderShippedEmail from "../order-shipped"

export default function OrderShippedPostageNoTrackingPreview() {
  return (
    <OrderShippedEmail
      storefrontUrl="https://shop.dollupboutique.com"
      customerFirstName="Nadia"
      displayId={1047}
      deliveryMethod="post_office"
      shippingMethodLabel="Postage"
      deliveryDate={null}
      trackingNumber={null}
      isPaid={true}
      items={[
        {
          title: "Lace Trim Camisole — XS / Blush",
          quantity: 1,
          unit_price: 890,
          thumbnail: "https://cdn.dollupboutique.com/dollup-media/sample/lace-cami.jpg",
        },
      ]}
      subtotal={890}
      shippingTotal={70}
      total={960}
    />
  )
}
