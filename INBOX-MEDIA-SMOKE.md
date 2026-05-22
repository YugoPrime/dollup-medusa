# Inbox Media — live smoke checklist

After both repos deploy to Coolify, run through:

## Env vars (Coolify backend service)

Add (or confirm present):
- `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` (already set — same as stories)
- `INBOX_R2_CLEANUP_ENABLED=false` initially. Flip to `true` after 30 days of clean operation.
- `INBOX_R2_CLEANUP_DAYS=90` (default; override only if needed)
- `INBOX_R2_CLEANUP_DRY_RUN=true` for the first 3 days after enabling.

## Test sequence

1. From a personal FB account, DM the Doll Up FB Page with **just text** — confirm thread appears in /inbox.
2. DM with **a photo** (any image from camera roll). Within 30s, refresh /inbox.
   - **Expect:** thread shows new message with image thumbnail in bubble.
   - **Verify:** R2 — image lives at `https://<R2_PUBLIC_URL>/inbox/<thread_id>/<hash>.jpg`.
   - **Verify:** the message row in Postgres `chat_message.attachments[0].url_r2` is the R2 URL, NOT a `lookaside.fbsbx.com` URL.
3. Click the thumbnail → lightbox opens fullscreen, Esc + backdrop click close.
4. In composer: click image button → pick a JPEG → preview appears with "Uploading…" → switches to no-overlay when done. Send. Within ~5s, the message appears in Messenger on the customer side.
5. Composer: paste an image from clipboard → same flow.
6. Composer: drag image from Finder/Explorer onto the composer → preview appears.
7. Try to attach 6 images → 6th rejected with "Max 5 images per message".
8. Try to attach a PDF → "Skipping ...: unsupported type application/pdf".
9. Type text + attach 1 image → Send → expect TWO message bubbles (Meta has no combined text+image in a single Send call) — first text, then image.
10. Past 24h: open a thread whose last_inbound_at > 24h, confirm composer shows the amber HUMAN_AGENT banner BEFORE you try to send.

## Failure paths to confirm

- Disconnect from internet, drop image → composer shows "Upload failed" on the preview tile.
- Remove `META_PAGE_ACCESS_TOKEN` env var, send → message row persists with `meta_status=failed` and red bubble shows in UI.

## Cleanup cron preview

After 7+ days of real traffic, run once with dry-run to preview what would delete:

```bash
INBOX_R2_CLEANUP_ENABLED=true \
INBOX_R2_CLEANUP_DAYS=90 \
INBOX_R2_CLEANUP_DRY_RUN=true \
yarn medusa exec ./src/scripts/run-inbox-cleanup-once.ts
```

(Add the script if you want a manual trigger — optional; the cron itself will fire daily at 04:00.)
