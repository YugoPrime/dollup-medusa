import {
  pickTrackForPlanSlot,
  pickTrackForSlot,
  shuffleTracksForPlan,
} from "../audio-mixer"

const TRACKS = [
  "track-1.mp3",
  "track-2.mp3",
  "track-3.mp3",
  "track-4.mp3",
  "track-5.mp3",
  "track-6.mp3",
  "track-7.mp3",
  "track-8.mp3",
  "track-9.mp3",
]

describe("pickTrackForSlot (legacy per-slot hash)", () => {
  it("returns null when no tracks are available", () => {
    expect(pickTrackForSlot("slot_abc", [])).toBeNull()
  })

  it("is stable across calls for the same slot id", () => {
    const a = pickTrackForSlot("slot_abc", TRACKS)
    const b = pickTrackForSlot("slot_abc", TRACKS)
    expect(a).toBe(b)
  })
})

describe("shuffleTracksForPlan", () => {
  it("returns a permutation of the input (no drops, no duplicates)", () => {
    const shuffled = shuffleTracksForPlan("plan_001", TRACKS)
    expect(shuffled).toHaveLength(TRACKS.length)
    expect(new Set(shuffled).size).toBe(TRACKS.length)
    for (const t of TRACKS) expect(shuffled).toContain(t)
  })

  it("is deterministic for the same plan id", () => {
    const a = shuffleTracksForPlan("plan_001", TRACKS)
    const b = shuffleTracksForPlan("plan_001", TRACKS)
    expect(a).toEqual(b)
  })

  it("produces a different order for different plan ids", () => {
    // Not a strict invariant for tiny inputs, but with 9 tracks the chance of
    // collision across two unrelated planIds is ~1/9! ≈ 1 in 360k.
    const a = shuffleTracksForPlan("plan_aaa", TRACKS)
    const b = shuffleTracksForPlan("plan_bbb", TRACKS)
    expect(a).not.toEqual(b)
  })

  it("does not mutate the input array", () => {
    const original = TRACKS.slice()
    shuffleTracksForPlan("plan_001", TRACKS)
    expect(TRACKS).toEqual(original)
  })
})

describe("pickTrackForPlanSlot (no-repeat-per-day)", () => {
  it("returns null when no tracks are available", () => {
    expect(pickTrackForPlanSlot("plan_001", 0, [])).toBeNull()
  })

  it("returns distinct tracks for every slot in a plan, up to tracks.length", () => {
    const picks: string[] = []
    for (let i = 0; i < TRACKS.length; i++) {
      const t = pickTrackForPlanSlot("plan_001", i, TRACKS)
      expect(t).not.toBeNull()
      picks.push(t!)
    }
    expect(new Set(picks).size).toBe(TRACKS.length)
  })

  it("wraps modulo tracks.length when slot count exceeds track count", () => {
    const slotN = TRACKS.length
    const slot0 = pickTrackForPlanSlot("plan_001", 0, TRACKS)
    const wrapped = pickTrackForPlanSlot("plan_001", slotN, TRACKS)
    expect(wrapped).toBe(slot0)
  })

  it("first repeat is exactly at the (tracks.length + 1)-th slot, never sooner", () => {
    // The headline guarantee — 9 tracks means the first 9 slots are all unique.
    // Verified across 10 different plan ids so we can't claim it's coincidental.
    for (const planId of [
      "plan_001",
      "plan_002",
      "plan_xyz",
      "plan_2026-05-20",
      "plan_2026-05-21",
      "plan_2026-05-22",
      "plan_2026-05-23",
      "plan_2026-05-24",
      "plan_2026-05-25",
      "plan_2026-05-26",
    ]) {
      const picks = Array.from({ length: TRACKS.length }, (_, i) =>
        pickTrackForPlanSlot(planId, i, TRACKS),
      )
      expect(new Set(picks).size).toBe(TRACKS.length)
    }
  })

  it("two different plans use different track orders", () => {
    // Different planIds → distinct sequences. We don't require every slot to
    // differ, just that the overall sequences are not byte-identical.
    const plan001 = Array.from({ length: TRACKS.length }, (_, i) =>
      pickTrackForPlanSlot("plan_001", i, TRACKS),
    )
    const plan002 = Array.from({ length: TRACKS.length }, (_, i) =>
      pickTrackForPlanSlot("plan_002", i, TRACKS),
    )
    expect(plan001).not.toEqual(plan002)
  })

  it("is stable across calls (re-renders pick the same track)", () => {
    const a = pickTrackForPlanSlot("plan_001", 3, TRACKS)
    const b = pickTrackForPlanSlot("plan_001", 3, TRACKS)
    expect(a).toBe(b)
  })

  it("falls back gracefully when slotIndex is invalid (negative / NaN)", () => {
    // Both should resolve to slot 0 of the shuffled list rather than crashing.
    const ref = pickTrackForPlanSlot("plan_001", 0, TRACKS)
    expect(pickTrackForPlanSlot("plan_001", -1, TRACKS)).toBe(ref)
    expect(pickTrackForPlanSlot("plan_001", Number.NaN, TRACKS)).toBe(ref)
  })
})
