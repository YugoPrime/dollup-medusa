import { defineLink } from "@medusajs/framework/utils"
import CustomerModule from "@medusajs/medusa/customer"
import ChatModule from "../modules/chat"

export default defineLink(
  { linkable: ChatModule.linkable.chatContact, isList: false },
  { linkable: CustomerModule.linkable.customer, isList: false }
)
