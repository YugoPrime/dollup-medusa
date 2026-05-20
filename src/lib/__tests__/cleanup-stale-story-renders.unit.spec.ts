import {
  decideR2Cleanup,
  type SlotSummary,
} from "../cleanup-stale-story-renders"
import type { R2StoryObject } from "../r2-story-uploader"

const NOW = new Date("2026-05-21T12:00:00.000Z")
const DAY = 24 * 60 * 60 * 1000

function obj(
  key: string,
  ageMs: number,
  size = 1_000_000,
): R2StoryObject {
  return {
    key,
    lastModified: new Date(NOW.getTime() - ageMs),
    size,
  }
}

function slot(
  id: string,
  args: { postedAgeMs?: number | null; currentMp4Url?: string | null } = {},
): SlotSummary {
  return {
    id,
    posted_at:
      args.postedAgeMs == null
        ? null
        : new Date(NOW.getTime() - args.postedAgeMs),
    current_mp4_url: args.currentMp4Url ?? null,
  }
}

describe("decideR2Cleanup", () => {
  it("returns empty decision when inventory is empty", () => {
    const d = decideR2Cleanup({
      inventory: [],
      slotsById: new Map(),
      now: NOW,
    })
    expect(d.delete).toEqual([])
    expect(d.keep).toEqual([])
  })

  it("deletes orphan keys whose shape doesn't match the schema", () => {
    const stranger = obj("stories/weird-thing.mp4", DAY)
    const archive = obj("backups/something.mp4", DAY)
    const d = decideR2Cleanup({
      inventory: [stranger, archive],
      slotsById: new Map(),
      now: NOW,
    })
    expect(d.delete.map((o) => o.key)).toEqual([stranger.key, archive.key])
    expect(d.reasons.get(stranger.key)).toMatch(/orphan-key/)
  })

  it("deletes MP4s whose slot was hard-deleted from the DB", () => {
    const o = obj("stories/stslot_GONE/abc123def456.mp4", DAY)
    const d = decideR2Cleanup({
      inventory: [o],
      slotsById: new Map(),
      now: NOW,
    })
    expect(d.delete).toEqual([o])
    expect(d.reasons.get(o.key)).toMatch(/slot-not-found/)
  })

  it("deletes MP4s for slots posted >7 days ago", () => {
    const o = obj("stories/stslot_OLDPOST/abc.mp4", 10 * DAY)
    const slotMap = new Map<string, SlotSummary>([
      [
        "stslot_OLDPOST",
        slot("stslot_OLDPOST", {
          postedAgeMs: 8 * DAY,
          currentMp4Url: "https://cdn/stories/stslot_OLDPOST/abc.mp4",
        }),
      ],
    ])
    const d = decideR2Cleanup({
      inventory: [o],
      slotsById: slotMap,
      now: NOW,
    })
    expect(d.delete).toEqual([o])
    expect(d.reasons.get(o.key)).toMatch(/posted-over-7-days/)
  })

  it("KEEPS MP4s for slots posted recently (within 7 days)", () => {
    const o = obj("stories/stslot_RECENT/abc.mp4", DAY)
    const slotMap = new Map<string, SlotSummary>([
      [
        "stslot_RECENT",
        slot("stslot_RECENT", {
          postedAgeMs: 2 * DAY,
          currentMp4Url: "https://cdn/stories/stslot_RECENT/abc.mp4",
        }),
      ],
    ])
    const d = decideR2Cleanup({
      inventory: [o],
      slotsById: slotMap,
      now: NOW,
    })
    expect(d.keep).toEqual([o])
    expect(d.delete).toEqual([])
  })

  it("deletes stale re-renders (older hash that's no longer the slot's current)", () => {
    // Slot was rendered, then re-rendered → new hash. Old hash MP4 is still
    // in R2 but no longer referenced by the slot, AND is > 24h old.
    // (Hashes are sha256 hex, so [a-f0-9] only.)
    const oldHash = obj(
      "stories/stslot_ABC/aaaaaaaaaaaaaaaa.mp4",
      3 * DAY,
    )
    const newHash = obj(
      "stories/stslot_ABC/bbbbbbbbbbbbbbbb.mp4",
      2 * 60 * 60 * 1000, // 2h ago
    )
    const slotMap = new Map<string, SlotSummary>([
      [
        "stslot_ABC",
        slot("stslot_ABC", {
          currentMp4Url: "https://cdn/stories/stslot_ABC/bbbbbbbbbbbbbbbb.mp4",
        }),
      ],
    ])
    const d = decideR2Cleanup({
      inventory: [oldHash, newHash],
      slotsById: slotMap,
      now: NOW,
    })
    expect(d.delete).toEqual([oldHash])
    expect(d.keep).toEqual([newHash])
  })

  it("KEEPS MP4s younger than 24h even when not the slot's current (race window)", () => {
    // Just-uploaded MP4 whose metadata.render write hasn't landed yet. The 24h
    // grace prevents the cleanup from racing the upload→metadata pipeline.
    const justUploaded = obj(
      "stories/stslot_RACE/cccccccccccccccc.mp4",
      30 * 60 * 1000, // 30 min ago
    )
    const slotMap = new Map<string, SlotSummary>([
      [
        "stslot_RACE",
        slot("stslot_RACE", {
          currentMp4Url: "https://cdn/stories/stslot_RACE/dddddddddddddddd.mp4",
        }),
      ],
    ])
    const d = decideR2Cleanup({
      inventory: [justUploaded],
      slotsById: slotMap,
      now: NOW,
    })
    expect(d.keep).toEqual([justUploaded])
  })

  it("KEEPS unposted slots' current MP4 even if it's >7 days old", () => {
    // Edge case: a slot was rendered a long time ago but never posted (e.g.
    // pinned for a future campaign). We must not delete its live MP4.
    const o = obj("stories/stslot_PINNED/eeeeeeeeeeeeeeee.mp4", 20 * DAY)
    const slotMap = new Map<string, SlotSummary>([
      [
        "stslot_PINNED",
        slot("stslot_PINNED", {
          postedAgeMs: null,
          currentMp4Url:
            "https://cdn/stories/stslot_PINNED/eeeeeeeeeeeeeeee.mp4",
        }),
      ],
    ])
    const d = decideR2Cleanup({
      inventory: [o],
      slotsById: slotMap,
      now: NOW,
    })
    expect(d.keep).toEqual([o])
    expect(d.delete).toEqual([])
  })

  it("handles a mix of all rules in one pass", () => {
    const orphan = obj("stories/loose.mp4", DAY)
    const ghostSlot = obj("stories/stslot_GHOST/abcdef1234567890.mp4", DAY)
    const oldPosted = obj("stories/stslot_OLD/0000000000000000.mp4", 10 * DAY)
    const recentPosted = obj("stories/stslot_NEW/1111111111111111.mp4", DAY)
    const staleRerender = obj(
      "stories/stslot_RE/2222222222222222.mp4",
      5 * DAY,
    )
    const liveRerender = obj(
      "stories/stslot_RE/3333333333333333.mp4",
      2 * 60 * 60 * 1000,
    )

    const slotMap = new Map<string, SlotSummary>([
      [
        "stslot_OLD",
        slot("stslot_OLD", {
          postedAgeMs: 8 * DAY,
          currentMp4Url: "https://cdn/stories/stslot_OLD/0000000000000000.mp4",
        }),
      ],
      [
        "stslot_NEW",
        slot("stslot_NEW", {
          postedAgeMs: 1 * DAY,
          currentMp4Url: "https://cdn/stories/stslot_NEW/1111111111111111.mp4",
        }),
      ],
      [
        "stslot_RE",
        slot("stslot_RE", {
          currentMp4Url: "https://cdn/stories/stslot_RE/3333333333333333.mp4",
        }),
      ],
    ])

    const d = decideR2Cleanup({
      inventory: [
        orphan,
        ghostSlot,
        oldPosted,
        recentPosted,
        staleRerender,
        liveRerender,
      ],
      slotsById: slotMap,
      now: NOW,
    })

    expect(new Set(d.delete.map((o) => o.key))).toEqual(
      new Set([orphan.key, ghostSlot.key, oldPosted.key, staleRerender.key]),
    )
    expect(new Set(d.keep.map((o) => o.key))).toEqual(
      new Set([recentPosted.key, liveRerender.key]),
    )
  })
})
