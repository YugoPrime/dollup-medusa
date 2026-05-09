import { MedusaService } from "@medusajs/framework/utils"
import { ChannelAccount } from "./models/channel-account"
import { Contact } from "./models/contact"
import { Thread } from "./models/thread"
import { Message } from "./models/message"

class ChatModuleService extends MedusaService({
  ChannelAccount,
  Contact,
  Thread,
  Message,
}) {}

export default ChatModuleService
