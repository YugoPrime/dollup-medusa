import { buildManualOrderMetadata } from "../metadata"

describe("buildManualOrderMetadata", () => {
  it("persists pay, POS, and chat mapping fields for AI inbox orders", () => {
    const metadata = buildManualOrderMetadata({
      delivery_method: "Registered Postage",
      delivery_fee: 70,
      is_paid: true,
      channel: "messenger",
      payment_status: "paid",
      payment_method: " Juice / Bank Transfer ",
      point_of_sale: " Facebook ",
      chat_thread_id: "thr_123",
      chat_message_id: "msg_456",
      phone: "5702 2717",
      external_id: "messenger:thr_123:msg_456",
      note: "Post tomorrow",
    })

    expect(metadata).toEqual({
      delivery_method: "Registered Postage",
      source: "hermes",
      channel: "messenger",
      delivery_fee: 70,
      sale_type: "paid",
      payment_status: "paid",
      payment_method: "Juice / Bank Transfer",
      point_of_sale: "Facebook",
      chat_thread_id: "thr_123",
      chat_message_id: "msg_456",
      note: "Post tomorrow",
      phone: "5702 2717",
      external_id: "messenger:thr_123:msg_456",
    })
  })

  it("omits blank optional fields", () => {
    const metadata = buildManualOrderMetadata({
      delivery_method: "Home Delivery",
      delivery_fee: 0,
      is_paid: false,
      channel: "messenger",
      payment_method: "   ",
      point_of_sale: "",
      chat_thread_id: " ",
      chat_message_id: undefined,
    })

    expect(metadata).toEqual({
      delivery_method: "Home Delivery",
      source: "hermes",
      channel: "messenger",
      delivery_fee: 0,
    })
  })
})
