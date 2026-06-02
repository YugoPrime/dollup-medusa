export type ManualOrderMetadataInput = {
  delivery_method: string
  delivery_fee: number
  is_paid: boolean
  channel?: string
  payment_status?: string
  payment_method?: string
  point_of_sale?: string
  delivery_date?: string
  note?: string
  phone?: string
  external_id?: string
  chat_thread_id?: string
  chat_message_id?: string
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function buildManualOrderMetadata(
  input: ManualOrderMetadataInput,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    delivery_method: input.delivery_method,
    source: "hermes",
    channel: input.channel ?? "messenger",
    delivery_fee: input.delivery_fee,
  }

  if (input.is_paid) metadata.sale_type = "paid"

  const paymentStatus = clean(input.payment_status)
  if (paymentStatus) metadata.payment_status = paymentStatus

  const paymentMethod = clean(input.payment_method)
  if (paymentMethod) metadata.payment_method = paymentMethod

  const pointOfSale = clean(input.point_of_sale)
  if (pointOfSale) metadata.point_of_sale = pointOfSale

  const deliveryDate = clean(input.delivery_date)
  if (deliveryDate) metadata.delivery_date = deliveryDate

  const note = clean(input.note)
  if (note) metadata.note = note

  const phone = clean(input.phone)
  if (phone) metadata.phone = phone

  const externalId = clean(input.external_id)
  if (externalId) metadata.external_id = externalId

  const chatThreadId = clean(input.chat_thread_id)
  if (chatThreadId) metadata.chat_thread_id = chatThreadId

  const chatMessageId = clean(input.chat_message_id)
  if (chatMessageId) metadata.chat_message_id = chatMessageId

  return metadata
}
