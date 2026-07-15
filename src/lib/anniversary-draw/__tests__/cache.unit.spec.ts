import { __resetCacheForTests, cached, EMPTY_PAYLOAD } from "../cache"
import type { DrawPayload } from "../entries"

const payload = (count: number): DrawPayload => ({
  entries: [],
  count,
  entryCount: count,
  winnerId: null,
})

describe("cached", () => {
  beforeEach(() => {
    __resetCacheForTests()
    jest.useFakeTimers().setSystemTime(new Date("2026-07-20T00:00:00Z"))
  })
  afterEach(() => jest.useRealTimers())

  it("calls through on a cold cache", async () => {
    const fetcher = jest.fn().mockResolvedValue(payload(1))
    await expect(cached(fetcher)).resolves.toEqual(payload(1))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("serves from cache within the TTL", async () => {
    const fetcher = jest.fn().mockResolvedValue(payload(1))
    await cached(fetcher)
    jest.advanceTimersByTime(30_000)
    await expect(cached(fetcher)).resolves.toEqual(payload(1))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("refetches after the TTL expires", async () => {
    const fetcher = jest.fn().mockResolvedValueOnce(payload(1)).mockResolvedValueOnce(payload(2))
    await cached(fetcher)
    jest.advanceTimersByTime(61_000)
    await expect(cached(fetcher)).resolves.toEqual(payload(2))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("serves the last good payload when the fetcher throws", async () => {
    const fetcher = jest.fn().mockResolvedValueOnce(payload(5)).mockRejectedValueOnce(new Error("medusa down"))
    await cached(fetcher)
    jest.advanceTimersByTime(61_000)
    await expect(cached(fetcher)).resolves.toEqual(payload(5))
  })

  it("serves an empty payload when the fetcher throws with a cold cache", async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error("medusa down"))
    await expect(cached(fetcher)).resolves.toEqual(EMPTY_PAYLOAD)
  })

  it("holds the TTL through a failure so the immediate next call does not retry", async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error("medusa down"))
    await cached(fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await cached(fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("dedupes concurrent callers on a cold cache into a single fetch", async () => {
    let resolveFetch!: (p: DrawPayload) => void
    const fetcher = jest.fn().mockReturnValue(
      new Promise<DrawPayload>((resolve) => {
        resolveFetch = resolve
      })
    )

    const call1 = cached(fetcher)
    const call2 = cached(fetcher)
    const call3 = cached(fetcher)

    resolveFetch(payload(7))

    await expect(call1).resolves.toEqual(payload(7))
    await expect(call2).resolves.toEqual(payload(7))
    await expect(call3).resolves.toEqual(payload(7))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("dedupes concurrent callers arriving just after TTL expiry into a single fetch", async () => {
    const fetcher = jest.fn().mockResolvedValueOnce(payload(1))
    await cached(fetcher)
    jest.advanceTimersByTime(61_000)

    let resolveFetch!: (p: DrawPayload) => void
    fetcher.mockReturnValueOnce(
      new Promise<DrawPayload>((resolve) => {
        resolveFetch = resolve
      })
    )

    const call1 = cached(fetcher)
    const call2 = cached(fetcher)

    resolveFetch(payload(9))

    await expect(call1).resolves.toEqual(payload(9))
    await expect(call2).resolves.toEqual(payload(9))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
