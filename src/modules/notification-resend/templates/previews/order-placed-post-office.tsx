import * as React from "react"

import OrderPlacedEmail from "../order-placed"

export default function OrderPlacedPostOfficePreview() {
  return (
    <OrderPlacedEmail
      storefrontUrl="https://shop.dollupboutique.com"
      customerFirstName="Marie"
      displayId={1044}
      items={[
        {
          title: "Pleated Mini Skirt — S / Black",
          quantity: 1,
          unit_price: 1490,
          thumbnail:
            "https://cdn.dollupboutique.com/dollup-media/sample/pleated-skirt.jpg",
        },
      ]}
      subtotal={1490}
      shippingTotal={70}
      total={1560}
      shippingAddress={{
        address_1: "12 Rue des Frangipaniers",
        city: "Curepipe",
        phone: "5712-3456",
      }}
      deliveryMethod="post_office"
      shippingMethodLabel="Postage"
      deliveryDate={null}
    />
  )
}
