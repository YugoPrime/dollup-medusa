# Facebook Story Cross-Post for Auto-Published IG Stories

**Date:** 2026-05-20
**Status:** Approved design — ready for implementation plan
**Project:** dollup-medusa (Doll Up Boutique backend)

## Problem

The stories auto-pilot publishes to Instagram via the Graph API
(`submitStoryContainer` → `media_publish`). When stories were posted manually
from the IG phone app, Meta's "Share story to Facebook" toggle mirrored them
to the linked Facebook Page. The Graph API publish path does NOT honor that
toggle, so today nothing reaches Facebook Stories.

We need API-published IG Stories to also appear as Facebook Page Stories,
matching the prior manual behaviour.

## Goal

After each successful IG Story publish, post the same rendered MP4 as a
**video story** to the linked Facebook Page using the Page's
`/video_stories` endpoint. FB cross-post is a best-effort side-effect — IG
remains the source of truth for whether a slot is "posted".

## Non-Goals

- Photo-story fallback (frame-extract from MP4)
- Per-slot opt-in UI in the admin
- Caption / link-sticker support (neither IG nor FB Stories APIs accept them)
- Retry logic dedicated to FB failures (cron already runs every 5 min; if FB
  is flaky we accept missing the cross-post for that slot)
- Cross-post any historical slots already posted to IG

## Architecture

Three pieces, all additive — IG happy path is untouched.

### 1. New low-level client: `src/lib/meta-fb.ts`

Mirrors the shape of `src/lib/meta-ig.ts`:

- `MetaFbConfig` type (pageId, pageAccessToken, apiVersion)
- `readMetaFbEnv()` returns config or `null`
- `isMetaFbConfigured()` boolean
- `isFbCrosspostEnabled()` — returns true only when both
  `STORIES_CROSSPOST_FB === "true"` AND `isMetaFbConfigured() === true`
- `MetaFbError` (status, fbtraceId, metaErrorCode, metaErrorSubcode)
- `publishFbVideoStory({ videoUrl }) → Promise<string>` — encapsulates the
  two-phase `start` → `finish` flow against `/{page_id}/video_stories`,
  returns the FB story post ID.

The Page video-stories endpoint accepts `file_url` mode (server-side fetch
of a public URL — which is what our R2-hosted MP4 already is), so a single
two-step API exchange suffices without binary upload from the server:

1. `POST /{page_id}/video_stories?upload_phase=start&file_url=<mp4>&access_token=…`
   → returns `video_id`
2. `POST /{page_id}/video_stories?upload_phase=finish&video_id=<id>&access_token=…`
   → returns `post_id` (string)

No status-poll step is required: when `upload_phase=finish` returns OK the
story is published.

If Meta's API ever responds with a `success:true` but no `post_id`, treat as
soft-failure (record fbtrace_id, return undefined post_id) rather than
throwing — we still want IG marked posted.

### 2. Wire into `src/lib/publish-story-slot.ts`

Inside the existing `try` block, after `stories.markPosted(args.slotId)` and
before returning the success result, append:

```ts
let fbStoryId: string | undefined
let fbPublishError: { message: string; status?: number; fbtrace_id?: string; meta_code?: number; attempted_at: string } | null = null

if (isFbCrosspostEnabled()) {
  try {
    fbStoryId = await publishFbVideoStory({ videoUrl: render.mp4_url })
  } catch (err) {
    const e = err instanceof MetaFbError ? err : null
    fbPublishError = {
      message: (err as Error)?.message ?? "FB cross-post failed",
      status: e?.status,
      fbtrace_id: e?.fbtraceId,
      meta_code: e?.metaErrorCode,
      attempted_at: new Date().toISOString(),
    }
  }
}

await stories.updateSlotMetadata(args.slotId, {
  publish: {
    media_id: mediaId,
    creation_id: creationId,
    published_at: new Date().toISOString(),
    fb_story_id: fbStoryId,
  },
  publish_error: null,
  fb_publish_error: fbPublishError,
})
```

The function STILL returns `{ ok: true, ... }` on FB cross-post failure — IG
is already posted and authoritative.

### 3. Surface FB failures (optional but recommended)

If a Telegram or other alert path exists for `publish_error`, mirror it for
`fb_publish_error` so a partial success is visible. If no alert path exists
today, skip — the failure is still readable in `slot.metadata` for the admin
UI.

## Environment Variables

New env vars in Coolify (and `.env.template`):

| Var | Required | Description |
|---|---|---|
| `META_FB_PAGE_ID` | when cross-post on | Doll Up FB Page numeric ID |
| `STORIES_CROSSPOST_FB` | when cross-post on | `"true"` to enable; absent/anything else disables |

Existing env vars reused — no changes:

- `META_PAGE_ACCESS_TOKEN` (must include `pages_manage_posts` scope —
  almost certainly already present since IG publishing works with the same
  Page token)
- `META_API_VERSION`

When `STORIES_CROSSPOST_FB` is unset or false, OR when `META_FB_PAGE_ID` is
missing, the cross-post step is skipped silently (no logs, no errors).

## Slot Metadata Schema Additions

Two new fields, both optional, no migration needed (Medusa metadata is JSONB):

- `metadata.publish.fb_story_id` — string, FB Page Story post ID, or
  undefined if cross-post failed or was disabled
- `metadata.fb_publish_error` — null or `{ message, status?, fbtrace_id?,
  meta_code?, attempted_at }`. Cleared (set to null) on each publish attempt
  before the FB call, set on failure.

## Error Handling Matrix

| Condition | IG slot status | Return value | Logged where |
|---|---|---|---|
| IG fails | not posted | `{ok: false, ...}` | `metadata.publish_error` |
| IG ok, FB disabled by env | posted | `{ok: true, fb_story_id: undefined}` | nowhere (silent skip) |
| IG ok, FB env missing | posted | `{ok: true, fb_story_id: undefined}` | nowhere (silent skip) |
| IG ok, FB API 4xx/5xx | posted | `{ok: true, fb_story_id: undefined}` | `metadata.fb_publish_error` + optional alert |
| IG ok, FB ok | posted | `{ok: true, fb_story_id: "..."}` | `metadata.publish.fb_story_id` |

## Testing

Unit tests added alongside the new code:

1. `src/lib/__tests__/meta-fb.unit.spec.ts`
   - happy path: `publishFbVideoStory` calls `start` then `finish` with
     correct params and returns post_id
   - error mapping: non-2xx body with `error.message/code/subcode` → throws
     `MetaFbError` with those fields
   - missing env → `readMetaFbEnv()` returns null and
     `isFbCrosspostEnabled()` returns false even with the flag on

2. Extend `src/lib/__tests__/publish-story-slot.unit.spec.ts` (or create if
   absent) with three new cases:
   - FB cross-post disabled by flag → IG publishes, `fb_story_id` undefined,
     `fb_publish_error` null, slot still marked posted
   - FB cross-post enabled, FB throws → IG marked posted, `fb_publish_error`
     populated, return value still `ok: true`
   - FB cross-post enabled, FB succeeds → `fb_story_id` set in metadata

## Manual Verification (after deploy)

1. Set `META_FB_PAGE_ID` + `STORIES_CROSSPOST_FB=true` in Coolify, redeploy
2. Wait for next auto-publish slot (or hit `publish-now` route) on one slot
3. Check IG → story visible
4. Check FB Page → story visible
5. Check `slot.metadata.publish.fb_story_id` in DB → string present
6. Force-disable: revoke FB Page perms temporarily, publish another slot,
   confirm IG still posts and `slot.metadata.fb_publish_error` is populated
   without affecting `posted_at`

## Out of Scope (Future)

- Crossposting to Reels feed alongside Stories
- Per-template opt-out (e.g. some templates IG-only)
- Backfill of historical slots
