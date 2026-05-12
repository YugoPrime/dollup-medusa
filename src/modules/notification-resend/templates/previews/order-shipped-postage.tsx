import * as React from "react"

import OrderShippedEmail from "../order-shipped"

export default function OrderShippedPostagePreview() {
  return (
    <OrderShippedEmail
      storefrontUrl="https://shop.dollupboutique.com"
      customerFirstName="Marie"
      displayId={1044}
      deliveryMethod="post_office"
      shippingMethodLabel="Postage"
      deliveryDate={null}
      trackingNumber="DP510924255MU"
      isPaid={true}
      items={[
        {
          title: "Pleated Mini Skirt — S / Black",
          quantity: 1,
          unit_price: 1490,
          thumbnail: "https://cdn.dollupboutique.com/dollup-media/sample/pleated-skirt.jpg",
        },
      ]}
      subtotal={1490}
      shippingTotal={70}
      total={1560}
    />
  )
}
