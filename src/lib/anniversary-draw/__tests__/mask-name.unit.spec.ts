import { maskName } from "../mask-name"

describe("maskName", () => {
  it("uses first name + surname initial", () => {
    expect(maskName({ firstName: "Rahvi", lastName: "Bichon" })).toBe("Rahvi B.")
  })

  it("falls back to first name only when there is no surname", () => {
    expect(maskName({ firstName: "Rahvi", lastName: "" })).toBe("Rahvi")
  })

  it("falls back to the email prefix when there is no name", () => {
    expect(maskName({ email: "rahvi.b99@gmail.com" })).toBe("Rahvi B")
  })

  it("falls back to a generic label when nothing is usable", () => {
    expect(maskName({})).toBe("Doll Up client")
    expect(maskName({ firstName: "   ", email: "   " })).toBe("Doll Up client")
    expect(maskName({ email: "123456@gmail.com" })).toBe("Doll Up client")
  })

  it("title-cases shouted and lowercase input", () => {
    expect(maskName({ firstName: "RAHVI", lastName: "BICHON" })).toBe("Rahvi B.")
    expect(maskName({ firstName: "rahvi", lastName: "bichon" })).toBe("Rahvi B.")
  })

  it("preserves hyphens and apostrophes inside names", () => {
    expect(maskName({ firstName: "marie-claire", lastName: "Dupont" })).toBe("Marie-Claire D.")
    expect(maskName({ firstName: "o'brien", lastName: "Smith" })).toBe("O'Brien S.")
  })

  it("strips characters that are not letters, spaces, hyphens or apostrophes", () => {
    expect(maskName({ firstName: "Rahvi123", lastName: "Bichon" })).toBe("Rahvi B.")
    expect(maskName({ firstName: "<script>", lastName: "X" })).toBe("Script X.")
    expect(maskName({ firstName: "Rahvi 😀", lastName: "Bichon" })).toBe("Rahvi B.")
  })

  it("returns the generic label when stripping leaves nothing", () => {
    expect(maskName({ firstName: "🎉🎉", lastName: "🎉" })).toBe("Doll Up client")
  })

  it("truncates to 18 characters", () => {
    // "Bartholomewxxxxxxxx Smith" -> "Bartholomewxxxxxxxx S." (22) -> cut to 18.
    const out = maskName({ firstName: "Bartholomewxxxxxxxx", lastName: "Smith" })
    expect(out.length).toBeLessThanOrEqual(18)
    expect(out).toBe("Bartholomewxxxxxxx")
  })

  it("does not leave a dangling initial after truncation", () => {
    // "Alexandrinaxxxxx S." is 19 -> cut to 18 leaves "...xxxxx S" -> drop the orphan.
    expect(maskName({ firstName: "Alexandrinaxxxxx", lastName: "Smith" })).toBe("Alexandrinaxxxxx")
    // 14 chars, comfortably under the cap — must survive intact.
    expect(maskName({ firstName: "Alexandrina", lastName: "Smith" })).toBe("Alexandrina S.")
  })
})
