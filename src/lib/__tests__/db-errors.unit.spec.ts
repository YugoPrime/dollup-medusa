import { isUniqueViolation } from "../db-errors"

describe("isUniqueViolation", () => {
  it("recognises the Postgres SQLSTATE", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true)
  })
  it("recognises the MikroORM exception name", () => {
    expect(isUniqueViolation({ name: "UniqueConstraintViolationException" })).toBe(true)
  })
  it("recognises the raw driver message", () => {
    expect(
      isUniqueViolation(new Error('duplicate key value violates unique constraint "IDX_feed_post_post_date_unique"')),
    ).toBe(true)
  })
  it("ignores other errors", () => {
    expect(isUniqueViolation(new Error("connection reset"))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
  })
})
