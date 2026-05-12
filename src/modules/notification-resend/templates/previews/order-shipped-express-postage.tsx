import * as React from "react"

import OrderShippedEmail from "../order-shipped"

export default function OrderShippedExpressPostagePreview() {
  return (
    <OrderShippedEmail
      storefrontUrl="https://shop.dollupboutique.com"
      customerFirstName="Leah"
      displayId={1045}
      deliveryMethod="post_office"
      shippingMethodLabel="Express Postage"
      deliveryDate={null}
      trackingNumber="EE123456789MU"
      isPaid={true}
      items={[
        {
          title: "Satin Slip Dress — M / Champagne",
          quantity: 1,
          unit_price: 2290,
          thumbnail: "https://cdn.dollupboutique.com/dollup-media/sample/satin-slip.jpg",
        },
      ]}
      subtotal={2290}
      shippingTotal={110}
      total={2400}
    />
  )
}
