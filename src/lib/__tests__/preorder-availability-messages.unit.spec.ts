import {
  outOfStockMessage,
  removedMessage,
  needsManualCheckMessage,
  circuitBreakMessage,
} from "../preorder-availability-messages"

describe("preorder availability messages", () => {
  it("formats out-of-stock with title + URL", () => {
    const m = outOfStockMessage({
      title: "Floral Dress",
      handle: "floral-dress-preorder-abc",
      sheinUrl: "https://shein.com/x",
    })
    expect(m).toContain("Floral Dress")
    expect(m).toContain("https://shein.com/x")
    expect(m).toMatch(/sold out|unavailable|stock/i)
  })

  it("formats 404 removed message", () => {
    const m = removedMessage({
      title: "X",
      handle: "x",
      sheinUrl: "https://shein.com/x",
    })
    expect(m).toContain("removed")
    expect(m).toContain("X")
  })

  it("formats manual-check message after N failures", () => {
    const m = needsManualCheckMessage(
      { title: "T", handle: "h", sheinUrl: "https://shein.com/t" },
      3,
    )
    expect(m).toContain("3")
    expect(m).toContain("T")
  })

  it("formats circuit-break summary", () => {
    const m = circuitBreakMessage(8, 12, ["Dress A", "Top B", "Skirt C"])
    expect(m).toContain("8")
    expect(m).toContain("12")
    expect(m).toContain("Dress A")
  })
})
