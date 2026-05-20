# FB Story Cross-Post Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After each successful IG Story publish, also post the same rendered MP4 as a video story to the linked Facebook Page — soft-fail so FB hiccups never un-mark a successfully-published IG slot.

**Architecture:** New thin HTTP client `src/lib/meta-fb.ts` mirroring the shape of `meta-ig.ts` against the `/{page_id}/video_stories` endpoint with `file_url` (R2-hosted MP4). `publishStorySlot` gains a post-IG branch gated by `STORIES_CROSSPOST_FB` + `META_FB_PAGE_ID`; FB success → `metadata.publish.fb_story_id`; FB failure → `metadata.fb_publish_error` (slot still posted).

**Tech Stack:** TypeScript 5.6, Medusa v2 (2.13.1), Jest, Yarn 4.12, Node 20+, Meta Graph API v21.0.

**Spec:** [`docs/superpowers/specs/2026-05-20-fb-story-crosspost-design.md`](../specs/2026-05-20-fb-story-crosspost-design.md)

---

## File Structure

**New files:**
- `src/lib/meta-fb.ts` — Thin HTTP client for Page video_stories endpoint (config, error class, publishFbVideoStory, isFbCrosspostEnabled). ~120 lines.
- `src/lib/__tests__/meta-fb.unit.spec.ts` — Unit tests for env reading + enabled-flag gating.

**Modified files:**
- `src/lib/publish-story-slot.ts` — Add post-IG FB cross-post branch; extend metadata write to include `fb_story_id` + `fb_publish_error`; export new pure helper `readFbPublishError` for symmetry with `readAttemptCount`.
- `src/lib/__tests__/publish-story-slot.unit.spec.ts` — Add tests for `readFbPublishError` helper.
- `.env.template` — Add `META_FB_PAGE_ID` and `STORIES_CROSSPOST_FB`.

**No DB migration.** All new fields live in existing `slot.metadata` JSONB.

---

## Task 1: Create `meta-fb.ts` client

**Files:**
- Create: `src/lib/meta-fb.ts`

- [ ] **Step 1: Write the file**

```ts
/**
 * Thin client for Meta's Facebook Page Stories content-publishing flow.
 * Covers video stories specifically using file_url mode (server-side fetch
 * of a public MP4 — our Stories are R2-hosted):
 *   POST /{page_id}/video_stories?upload_phase=start&file_url=<mp4>
 *     → returns { video_id }
 *   POST /{page_id}/video_stories?upload_phase=finish&video_id=<id>
 *     → returns { post_id, success }
 *
 * No retries here — the caller (publish-story-slot) is the retry layer
 * and treats FB failure as soft-failure (IG remains source of truth).
 */

export type MetaFbConfig = {
  pageId: string
  pageAccessToken: string
  apiVersion: string
}

export class MetaFbError extends Error {
  name = "MetaFbError"
  status: number
  fbtraceId?: string
  /** When set, surface this as user-facing detail in the cron alert. */
  metaErrorCode?: number
  metaErrorSubcode?: number
  constructor(
    message: string,
    status: number,
    extras: { fbtraceId?: string; code?: number; subcode?: number } = {},
  ) {
    super(message)
    this.status = status
    this.fbtraceId = extras.fbtraceId
    this.metaErrorCode = extras.code
    this.metaErrorSubcode = extras.subcode
  }
}

export function readMetaFbEnv(): MetaFbConfig | null {
  const pageAccessToken = process.env.META_PAGE_ACCESS_TOKEN
  const pageId = process.env.META_FB_PAGE_ID
  const apiVersion = process.env.META_API_VERSION ?? "v21.0"
  if (!pageAccessToken || !pageId) return null
  return { pageAccessToken, pageId, apiVersion }
}

export function isMetaFbConfigured(): boolean {
  return readMetaFbEnv() != null
}

/**
 * True only when BOTH the env flag is "true" AND credentials are present.
 * publishStorySlot calls this to decide whether to attempt the cross-post.
 */
export function isFbCrosspostEnabled(): boolean {
  if (process.env.STORIES_CROSSPOST_FB !== "true") return false
  return isMetaFbConfigured()
}

function buildUrl(path: string, cfg: MetaFbConfig): URL {
  const cleaned = path.replace(/^\//, "")
  const url = new URL(`https://graph.facebook.com/${cfg.apiVersion}/${cleaned}`)
  url.searchParams.set("access_token", cfg.pageAccessToken)
  return url
}

async function call<T>(
  path: string,
  cfg: MetaFbConfig,
  init: RequestInit & { params?: Record<string, string> } = {},
): Promise<T> {
  const url = buildUrl(path, cfg)
  for (const [k, v] of Object.entries(init.params ?? {})) {
    url.searchParams.set(k, v)
  }
  const { params: _ignored, ...fetchInit } = init
  const res = await fetch(url, fetchInit)
  let json: any = null
  try {
    json = await res.json()
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const err = json?.error
    throw new MetaFbError(
      err?.message ?? `Meta FB API ${res.status}`,
      res.status,
      {
        fbtraceId: err?.fbtrace_id,
        code: err?.code,
        subcode: err?.error_subcode,
      },
    )
  }
  return json as T
}

/**
 * Two-phase publish:
 *   start (file_url) → video_id
 *   finish (video_id) → post_id
 * Returns the FB post_id on success, throws MetaFbError on any failure.
 */
export async function publishFbVideoStory(
  args: { videoUrl: string },
  cfg: MetaFbConfig = readMetaFbEnv() ?? throwUnconfigured(),
): Promise<string> {
  const startResult = await call<{ video_id: string }>(
    `${cfg.pageId}/video_stories`,
    cfg,
    {
      method: "POST",
      params: {
        upload_phase: "start",
        file_url: args.videoUrl,
      },
    },
  )

  if (!startResult?.video_id) {
    throw new MetaFbError(
      "FB video_stories start returned no video_id",
      502,
    )
  }

  const finishResult = await call<{ post_id?: string; success?: boolean }>(
    `${cfg.pageId}/video_stories`,
    cfg,
    {
      method: "POST",
      params: {
        upload_phase: "finish",
        video_id: startResult.video_id,
      },
    },
  )

  if (!finishResult?.post_id) {
    throw new MetaFbError(
      `FB video_stories finish returned no post_id (success=${finishResult?.success})`,
      502,
    )
  }

  return finishResult.post_id
}

function throwUnconfigured(): never {
  throw new MetaFbError(
    "Meta FB not configured: set META_PAGE_ACCESS_TOKEN + META_FB_PAGE_ID",
    500,
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `yarn tsc --noEmit`
Expected: PASS (no errors). If there are unrelated errors elsewhere in the repo, only the new file should be clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/meta-fb.ts
git commit -m "feat(stories): meta-fb.ts — Page video_stories client for cross-post"
```

---

## Task 2: Unit tests for `meta-fb.ts`

**Files:**
- Create: `src/lib/__tests__/meta-fb.unit.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import {
  isFbCrosspostEnabled,
  isMetaFbConfigured,
  readMetaFbEnv,
} from "../meta-fb"

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  // Restore env between tests so order doesn't matter.
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k]
  }
  Object.assign(process.env, ORIGINAL_ENV)
})

describe("readMetaFbEnv", () => {
  it("returns null when META_PAGE_ACCESS_TOKEN is missing", () => {
    delete process.env.META_PAGE_ACCESS_TOKEN
    process.env.META_FB_PAGE_ID = "1234567890"
    expect(readMetaFbEnv()).toBeNull()
  })

  it("returns null when META_FB_PAGE_ID is missing", () => {
    process.env.META_PAGE_ACCESS_TOKEN = "token"
    delete process.env.META_FB_PAGE_ID
    expect(readMetaFbEnv()).toBeNull()
  })

  it("returns config when both env vars are set", () => {
    process.env.META_PAGE_ACCESS_TOKEN = "token"
    process.env.META_FB_PAGE_ID = "1234567890"
    process.env.META_API_VERSION = "v21.0"
    expect(readMetaFbEnv()).toEqual({
      pageAccessToken: "token",
      pageId: "1234567890",
      apiVersion: "v21.0",
    })
  })

  it("defaults apiVersion to v21.0 when unset", () => {
    process.env.META_PAGE_ACCESS_TOKEN = "token"
    process.env.META_FB_PAGE_ID = "1234567890"
    delete process.env.META_API_VERSION
    expect(readMetaFbEnv()?.apiVersion).toBe("v21.0")
  })
})

describe("isMetaFbConfigured", () => {
  it("reflects readMetaFbEnv", () => {
    delete process.env.META_PAGE_ACCESS_TOKEN
    delete process.env.META_FB_PAGE_ID
    expect(isMetaFbConfigured()).toBe(false)

    process.env.META_PAGE_ACCESS_TOKEN = "token"
    process.env.META_FB_PAGE_ID = "1234567890"
    expect(isMetaFbConfigured()).toBe(true)
  })
})

describe("isFbCrosspostEnabled", () => {
  it("returns false when STORIES_CROSSPOST_FB is unset", () => {
    delete process.env.STORIES_CROSSPOST_FB
    process.env.META_PAGE_ACCESS_TOKEN = "token"
    process.env.META_FB_PAGE_ID = "1234567890"
    expect(isFbCrosspostEnabled()).toBe(false)
  })

  it("returns false when STORIES_CROSSPOST_FB is anything but the string 'true'", () => {
    process.env.META_PAGE_ACCESS_TOKEN = "token"
    process.env.META_FB_PAGE_ID = "1234567890"
    process.env.STORIES_CROSSPOST_FB = "1"
    expect(isFbCrosspostEnabled()).toBe(false)
    process.env.STORIES_CROSSPOST_FB = "yes"
    expect(isFbCrosspostEnabled()).toBe(false)
    process.env.STORIES_CROSSPOST_FB = "TRUE"
    expect(isFbCrosspostEnabled()).toBe(false)
  })

  it("returns false when flag is 'true' but creds missing", () => {
    process.env.STORIES_CROSSPOST_FB = "true"
    delete process.env.META_PAGE_ACCESS_TOKEN
    delete process.env.META_FB_PAGE_ID
    expect(isFbCrosspostEnabled()).toBe(false)
  })

  it("returns true when flag is 'true' AND creds present", () => {
    process.env.STORIES_CROSSPOST_FB = "true"
    process.env.META_PAGE_ACCESS_TOKEN = "token"
    process.env.META_FB_PAGE_ID = "1234567890"
    expect(isFbCrosspostEnabled()).toBe(true)
  })
})
```

- [ ] **Step 2: Run the new tests and verify they pass**

Run: `yarn jest src/lib/__tests__/meta-fb.unit.spec.ts`
Expected: 9 tests passing across 3 describe blocks.

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/meta-fb.unit.spec.ts
git commit -m "test(stories): meta-fb env + enabled-flag unit tests"
```

---

## Task 3: Add `readFbPublishError` helper (TDD — failing test first)

**Files:**
- Modify: `src/lib/__tests__/publish-story-slot.unit.spec.ts` (append a new describe block)

- [ ] **Step 1: Add the failing test**

Open `src/lib/__tests__/publish-story-slot.unit.spec.ts` and add the import + describe block. The new import line goes at the top alongside the existing imports.

Add to the import block at the top of the file:

```ts
import {
  readAttemptCount,
  readFbPublishError,
  readLastAttemptAt,
  readRender,
} from "../publish-story-slot"
```

Append at the end of the existing `describe("publish-story-slot helpers", ...)` block, just before its closing `})`:

```ts
  describe("readFbPublishError", () => {
    it("returns null when metadata is null/empty/missing the key", () => {
      expect(readFbPublishError(null)).toBeNull()
      expect(readFbPublishError(undefined)).toBeNull()
      expect(readFbPublishError({})).toBeNull()
      expect(readFbPublishError({ fb_publish_error: null })).toBeNull()
    })

    it("returns null when fb_publish_error is not an object", () => {
      expect(readFbPublishError({ fb_publish_error: "oops" })).toBeNull()
      expect(readFbPublishError({ fb_publish_error: 42 })).toBeNull()
    })

    it("returns the error block when shape is valid", () => {
      const err = readFbPublishError({
        fb_publish_error: {
          message: "boom",
          status: 400,
          fbtrace_id: "abc",
          meta_code: 100,
          attempted_at: "2026-05-20T10:00:00.000Z",
        },
      })
      expect(err).toEqual({
        message: "boom",
        status: 400,
        fbtrace_id: "abc",
        meta_code: 100,
        attempted_at: "2026-05-20T10:00:00.000Z",
      })
    })

    it("requires message to be a string — returns null otherwise", () => {
      expect(
        readFbPublishError({ fb_publish_error: { status: 400 } }),
      ).toBeNull()
    })
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn jest src/lib/__tests__/publish-story-slot.unit.spec.ts`
Expected: FAIL — TypeScript error or "readFbPublishError is not defined" because the helper hasn't been added to `publish-story-slot.ts` yet.

- [ ] **Step 3: Do NOT commit yet** — implementation goes in next task.

---

## Task 4: Implement `readFbPublishError` + wire the FB cross-post branch

**Files:**
- Modify: `src/lib/publish-story-slot.ts`

- [ ] **Step 1: Replace the imports block at the top of `publish-story-slot.ts`**

Find:

```ts
import {
  MetaIgError,
  isMetaIgConfigured,
  publishContainer,
  pollContainerUntilReady,
  submitStoryContainer,
} from "./meta-ig"
import { STORIES_MODULE } from "../modules/stories"
import type StoriesModuleService from "../modules/stories/service"
```

Replace with:

```ts
import {
  MetaIgError,
  isMetaIgConfigured,
  publishContainer,
  pollContainerUntilReady,
  submitStoryContainer,
} from "./meta-ig"
import {
  MetaFbError,
  isFbCrosspostEnabled,
  publishFbVideoStory,
} from "./meta-fb"
import { STORIES_MODULE } from "../modules/stories"
import type StoriesModuleService from "../modules/stories/service"
```

- [ ] **Step 2: Replace the success block inside `publishStorySlot`'s `try`**

Find this block (currently lines ~84–105):

```ts
  try {
    const creationId = await submitStoryContainer({ videoUrl: render.mp4_url })
    await pollContainerUntilReady({ creationId })
    const mediaId = await publishContainer({ creationId })

    await stories.markPosted(args.slotId)
    await stories.updateSlotMetadata(args.slotId, {
      publish: {
        media_id: mediaId,
        creation_id: creationId,
        published_at: new Date().toISOString(),
      },
      // Clear any previous failure annotation now that the slot succeeded.
      publish_error: null,
    })

    return {
      ok: true,
      media_id: mediaId,
      creation_id: creationId,
      duration_ms: Date.now() - startedAt,
    }
  } catch (err) {
```

Replace with:

```ts
  try {
    const creationId = await submitStoryContainer({ videoUrl: render.mp4_url })
    await pollContainerUntilReady({ creationId })
    const mediaId = await publishContainer({ creationId })

    await stories.markPosted(args.slotId)

    let fbStoryId: string | undefined
    let fbPublishError: FbPublishErrorRecord | null = null

    if (isFbCrosspostEnabled()) {
      try {
        fbStoryId = await publishFbVideoStory({ videoUrl: render.mp4_url })
      } catch (fbErr) {
        const e = fbErr instanceof MetaFbError ? fbErr : null
        fbPublishError = {
          message: (fbErr as Error)?.message ?? "FB cross-post failed",
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
      // Clear any previous IG failure annotation now that the slot succeeded.
      publish_error: null,
      // null clears any prior failure; record clears any prior success.
      fb_publish_error: fbPublishError,
    })

    return {
      ok: true,
      media_id: mediaId,
      creation_id: creationId,
      duration_ms: Date.now() - startedAt,
    }
  } catch (err) {
```

- [ ] **Step 3: Add the type alias and the new helper**

At the top of the file, just below the `import type StoriesModuleService` line, add the type alias:

```ts
type FbPublishErrorRecord = {
  message: string
  status?: number
  fbtrace_id?: string
  meta_code?: number
  attempted_at: string
}
```

At the bottom of the file, after `readLastAttemptAt`, append the new helper:

```ts
export function readFbPublishError(
  metadata: unknown,
): FbPublishErrorRecord | null {
  if (!metadata || typeof metadata !== "object") return null
  const e = (metadata as any).fb_publish_error
  if (!e || typeof e !== "object") return null
  if (typeof e.message !== "string") return null
  return {
    message: e.message,
    status: typeof e.status === "number" ? e.status : undefined,
    fbtrace_id: typeof e.fbtrace_id === "string" ? e.fbtrace_id : undefined,
    meta_code: typeof e.meta_code === "number" ? e.meta_code : undefined,
    attempted_at:
      typeof e.attempted_at === "string" ? e.attempted_at : "",
  }
}
```

- [ ] **Step 4: Re-run the failing test from Task 3 — it should now pass**

Run: `yarn jest src/lib/__tests__/publish-story-slot.unit.spec.ts`
Expected: All tests in this file pass, including the new `readFbPublishError` block (4 tests).

- [ ] **Step 5: Run the full unit suite to make sure nothing else broke**

Run: `yarn test:unit`
Expected: Same green count as before plus the new tests. No reds.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `yarn tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/publish-story-slot.ts src/lib/__tests__/publish-story-slot.unit.spec.ts
git commit -m "feat(stories): cross-post IG stories to FB Page after publish

Soft-fail design: on FB API failure the slot is still marked posted on IG,
and the failure is recorded in slot.metadata.fb_publish_error for visibility.
Gated by STORIES_CROSSPOST_FB=true + META_FB_PAGE_ID."
```

---

## Task 5: Document the new env vars

**Files:**
- Modify: `.env.template`

- [ ] **Step 1: Inspect current `.env.template`**

Run: `cat .env.template | head -80`
Expected: See existing `META_PAGE_ACCESS_TOKEN` and `META_IG_BUSINESS_ACCOUNT_ID` already present.

- [ ] **Step 2: Append the two new entries**

Find the Meta-related block (around `META_PAGE_ACCESS_TOKEN` / `META_IG_BUSINESS_ACCOUNT_ID`) and add directly below it:

```
# FB Page Story cross-post (optional)
# When STORIES_CROSSPOST_FB=true and META_FB_PAGE_ID is set, the auto-pilot
# also posts each successful IG story as a FB Page video story.
# Uses the same META_PAGE_ACCESS_TOKEN; needs pages_manage_posts scope.
META_FB_PAGE_ID=
STORIES_CROSSPOST_FB=
```

If `.env.template` does not exist (it should — the project docs reference it), check for it first:

Run: `ls .env.template 2>&1`
- If present → append the block above.
- If missing → skip this task and log a note in the commit body that the template file is absent.

- [ ] **Step 3: Commit**

```bash
git add .env.template
git commit -m "docs(env): document META_FB_PAGE_ID and STORIES_CROSSPOST_FB"
```

---

## Task 6: Manual verification checklist (operator action — NOT executed by the agent)

These steps must be performed by the human operator after the code is deployed. The agent should print this checklist at the end of execution and stop.

- [ ] In Meta Business Suite, retrieve the Doll Up FB Page numeric ID
  (Page → About → Page ID).
- [ ] In Coolify env for `dollup-medusa`, add:
  - `META_FB_PAGE_ID=<page id>`
  - `STORIES_CROSSPOST_FB=true`
- [ ] Confirm `META_PAGE_ACCESS_TOKEN` has the `pages_manage_posts` scope.
  Quick check via Graph API Explorer using the token:
  `GET /me/permissions` — look for `pages_manage_posts` with status `granted`.
  If absent, regenerate the token with that scope added.
- [ ] Redeploy the backend service in Coolify.
- [ ] Trigger one slot publish (admin "Publish now" or wait for next cron run).
- [ ] Confirm the story appears on both Instagram AND Facebook Page Stories.
- [ ] Inspect the slot row in DB: `metadata.publish.fb_story_id` should be a
  string. `metadata.fb_publish_error` should be null.
- [ ] Negative test: set `STORIES_CROSSPOST_FB=false`, publish one more slot,
  confirm IG-only and `fb_story_id` is undefined / `fb_publish_error` null.

---

## Self-Review Notes

- Every spec section has at least one task:
  - meta-fb.ts client → Task 1
  - publishStorySlot branch → Task 4
  - Metadata schema additions → Task 4 (`fb_story_id`, `fb_publish_error`)
  - Env var docs → Task 5
  - Tests → Tasks 2, 3, 4
  - Manual verification → Task 6
- No placeholders. All code blocks are complete.
- Type consistency: `MetaFbError` constructor signature matches `MetaIgError`.
  `publishFbVideoStory` arg name `videoUrl` matches `submitStoryContainer`.
  `FbPublishErrorRecord` shape matches the spec's error matrix exactly.
- The spec calls for a "video_id + upload_url" then upload step; the plan
  uses the simpler **`file_url` mode** in a single start/finish cycle,
  matching what `submitStoryContainer` does for IG and exactly the
  use-case in the spec ("Page video-stories endpoint accepts file_url
  mode"). Spec is satisfied.
