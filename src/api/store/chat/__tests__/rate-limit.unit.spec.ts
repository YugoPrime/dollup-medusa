import {
  checkAndIncrement,
  dayBucket,
  hourBucket,
  IP_DAILY_LIMIT,
  MAX_MESSAGE_CHARS,
  SESSION_HOURLY_LIMIT,
} from "../rate-limit"

function fakeCache() {
  const store = new Map<string, number>()
  return {
    store,
    async get(key: string) {
      return store.get(key)
    },
    async set(key: string, value: number) {
      store.set(key, value)
    },
  }
}

describe("checkAndIncrement", () => {
  it("allows the first request and counts it", async () => {
    const cache = fakeCache()
    expect(await checkAndIncrement(cache as any, "k", 3, 60)).toEqual({
      allowed: true,
      count: 1,
    })
  })

  it("allows exactly up to the limit, then blocks", async () => {
    const cache = fakeCache()
    for (let i = 1; i <= 3; i++) {
      expect((await checkAndIncrement(cache as any, "k", 3, 60)).allowed).toBe(true)
    }
    const blocked = await checkAndIncrement(cache as any, "k", 3, 60)
    expect(blocked.allowed).toBe(false)
    expect(blocked.count).toBe(3)
  })

  it("does not keep incrementing once blocked", async () => {
    const cache = fakeCache()
    for (let i = 0; i < 5; i++) await checkAndIncrement(cache as any, "k", 2, 60)
    expect(cache.store.get("k")).toBe(2)
  })

  it("keeps separate keys independent", async () => {
    const cache = fakeCache()
    await checkAndIncrement(cache as any, "a", 1, 60)
    expect((await checkAndIncrement(cache as any, "b", 1, 60)).allowed).toBe(true)
  })

  it("passes the ttl through to the cache so the window expires", async () => {
    const set = jest.fn()
    const cache = { async get() { return undefined }, set }
    await checkAndIncrement(cache as any, "k", 5, 3600)
    expect(set).toHaveBeenCalledWith("k", 1, 3600)
  })

  it("fails OPEN when the cache read throws — a customer is never blocked by a Redis outage", async () => {
    const broken = {
      async get() {
        throw new Error("redis down")
      },
      async set() {},
    }
    expect((await checkAndIncrement(broken as any, "k", 1, 60)).allowed).toBe(true)
  })

  it("still allows the request when only the cache WRITE throws", async () => {
    const halfBroken = {
      async get() {
        return 0
      },
      async set() {
        throw new Error("redis down")
      },
    }
    expect((await checkAndIncrement(halfBroken as any, "k", 1, 60)).allowed).toBe(true)
  })

  it("treats a corrupt cached value as zero rather than blocking", async () => {
    const weird = {
      async get() {
        return "not-a-number"
      },
      async set() {},
    }
    expect((await checkAndIncrement(weird as any, "k", 1, 60)).allowed).toBe(true)
  })

  it("exposes the documented limits", () => {
    expect(SESSION_HOURLY_LIMIT).toBe(20)
    expect(IP_DAILY_LIMIT).toBe(60)
    expect(MAX_MESSAGE_CHARS).toBe(1000)
  })
})

describe("buckets", () => {
  it("hourBucket is the UTC hour", () => {
    expect(hourBucket(new Date("2026-08-10T14:37:02Z"))).toBe("2026-08-10T14")
  })

  it("dayBucket is the UTC day", () => {
    expect(dayBucket(new Date("2026-08-10T14:37:02Z"))).toBe("2026-08-10")
  })

  it("a new hour is a new bucket, so the window rolls", () => {
    expect(hourBucket(new Date("2026-08-10T14:59:59Z"))).not.toBe(
      hourBucket(new Date("2026-08-10T15:00:00Z")),
    )
  })
})
