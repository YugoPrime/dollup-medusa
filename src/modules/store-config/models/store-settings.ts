import { model } from "@medusajs/framework/utils"

const StoreSettings = model.define("StoreSettings", {
  id: model.id({ prefix: "storeset" }).primaryKey(),
  contact_phone: model.text().default("+230 5941 6359"),
  contact_email: model.text().default("hello@dollupboutique.com"),
  contact_hours: model
    .text()
    .default("Mon-Sat 09:00-18:00 (Mauritius time)"),
  instagram_url: model
    .text()
    .default("https://www.instagram.com/dollupboutique/"),
  facebook_url: model
    .text()
    .default("https://www.facebook.com/dollupboutique/"),
  tiktok_url: model.text().default("https://www.tiktok.com/@dollupboutique"),
  whatsapp_url: model.text().default("https://wa.me/23059416359"),
  footer_copyright: model
    .text()
    .default("Doll Up Boutique Limited. BRN C18159019 - VAT 27646277."),
})

export default StoreSettings
