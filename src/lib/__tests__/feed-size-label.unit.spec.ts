import { sizesForPhoto, sortSizes } from "../feed-size-label"

describe("sortSizes", () => {
  it("orders letter sizes from small to large", () => {
    expect(sortSizes(["L", "S", "XS", "M"])).toEqual(["XS", "S", "M", "L"])
  })

  it("treats XXL as 2XL and XXXL as 3XL, keeping each spelling", () => {
    expect(sortSizes(["2XL", "XL", "XXS", "4XL", "XXXL"])).toEqual(["XXS", "XL", "2XL", "XXXL", "4XL"])
  })

  it("puts combined sizes after the single sizes", () => {
    expect(sortSizes(["L/XL", "S/M", "M"])).toEqual(["M", "S/M", "L/XL"])
  })

  it("puts cups before numbers, numbers ascending", () => {
    expect(sortSizes(["38", "C", "B", "37"])).toEqual(["B", "C", "37", "38"])
  })

  it("shows every one-size spelling as One size", () => {
    expect(sortSizes(["OS"])).toEqual(["One size"])
    expect(sortSizes(["Free Size"])).toEqual(["One size"])
    expect(sortSizes(["one  size"])).toEqual(["One size"])
  })

  it("drops duplicates whatever their case or spaces, keeping the first spelling", () => {
    expect(sortSizes(["m", "M", " M "])).toEqual(["m"])
  })

  it("puts unknown labels after the known sizes", () => {
    expect(sortSizes(["Petite", "S"])).toEqual(["S", "Petite"])
  })

  it("drops empty labels", () => {
    expect(sortSizes(["", "  ", "S"])).toEqual(["S"])
  })

  it("strips invisible and control characters", () => {
    expect(sortSizes(["S\u200b", "\u200b", "M\u0000", "\ufeffL"])).toEqual(["S", "M", "L"])
  })
})

describe("sizesForPhoto", () => {
  const snapshot = {
    variants_in_stock: [
      { sizes: ["S", "XS"], image_urls: ["w.jpg", "w-b.jpg"] },
      { sizes: ["L"], image_urls: ["r.jpg", "shared.jpg"] },
      { sizes: ["M"], image_urls: ["shared.jpg"] },
    ],
  }

  it("gives a colour's photo that colour's sizes", () => {
    expect(sizesForPhoto(snapshot, "w-b.jpg")).toEqual(["XS", "S"])
  })

  it("gives a photo shared by several colours all of their sizes", () => {
    expect(sizesForPhoto(snapshot, "shared.jpg")).toEqual(["M", "L"])
  })

  it("gives a photo of no colour every in-stock size", () => {
    expect(sizesForPhoto(snapshot, "other.jpg")).toEqual(["XS", "S", "M", "L"])
  })

  it("returns nothing when there is no snapshot", () => {
    expect(sizesForPhoto(null, "x.jpg")).toEqual([])
    expect(sizesForPhoto(undefined, "x.jpg")).toEqual([])
  })

  it("returns nothing when no variant has sizes", () => {
    expect(sizesForPhoto({ variants_in_stock: [{ image_urls: ["x.jpg"] }] }, "x.jpg")).toEqual([])
  })
})
