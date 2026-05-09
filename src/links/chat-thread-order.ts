import { defineLink } from "@medusajs/framework/utils"
import OrderModule from "@medusajs/medusa/order"
import ChatModule from "../modules/chat"

export default defineLink(
  { linkable: ChatModule.linkable.chatThread, isList: false },
  { linkable: OrderModule.linkable.order, isList: false }
)
