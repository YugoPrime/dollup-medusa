import { maskName } from "../mask-name"

describe("maskName", () => {
  it("uses first name + surname initial", () => {
    expect(maskName({ firstName: "Rahvi", lastName: "Bichon" })).toBe("Rahvi B.")
  })

  it("falls back to first name only when there is no surname", () => {
    expect(maskName({ firstName: "Rahvi", lastName: "" })).toBe("Rahvi")
  })

  it("falls back to the email prefix when there is no name", () => {
    expect(maskName({ email: "rahvi.b99@gmail.com" })).toBe("Rahvi B.")
  })

  it("reduces every word after the first in the email prefix to an initial", () => {
    // Full surname in an email prefix is strictly more identifying than the
    // name path's "Jane D." — must never reach the wall as "Jane Doe".
    expect(maskName({ email: "jane.doe@gmail.com" })).toBe("Jane D.")
  })

  it("reduces a 3+ word email prefix the same way", () => {
    // "+promo" is dropped before splitting, so the tag can't land in the
    // surname position; "ahkine" is the surname and gets initialised.
    expect(maskName({ email: "jean_luc.ahkine+promo@yahoo.fr" })).toBe("Jean A.")
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


  // --- REGRESSION: the 2026-07-17 live leak -------------------------------
  // The wall published full surnames because customers type their whole name
  // into the first-name box and leave last-name empty. Masking must be
  // positional, never dependent on which field the words arrived in.
  it("masks a full name typed into the first-name field alone", () => {
    expect(maskName({ firstName: "Hashna Dhula", lastName: "" })).toBe("Hashna D.")
    expect(maskName({ firstName: "Kate Meunier", lastName: null })).toBe("Kate M.")
    expect(maskName({ firstName: "Estelle Lee" })).toBe("Estelle L.")
  })

  it("masks a full name typed into the last-name field alone", () => {
    expect(maskName({ firstName: "", lastName: "Hashna Dhula" })).toBe("Hashna D.")
  })

  it("masks three-part names down to first + final initial", () => {
    expect(maskName({ firstName: "Marie Anne Lee", lastName: "" })).toBe("Marie L.")
    expect(maskName({ firstName: "Marie", lastName: "Li Ying Pin" })).toBe("Marie P.")
  })

  it("never emits more than one full word", () => {
    for (const n of [
      maskName({ firstName: "Hashna Dhula" }),
      maskName({ firstName: "Marie Anne Lee" }),
      maskName({ firstName: "A B C D E" }),
      maskName({ email: "jane.doe@gmail.com" }),
    ]) {
      const words = n.split(" ")
      const fullWords = words.filter((w) => !/^\p{L}\.$/u.test(w))
      expect(fullWords.length).toBeLessThanOrEqual(1)
    }
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
