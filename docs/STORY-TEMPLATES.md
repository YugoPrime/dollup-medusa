# Story Templates - Authoring Guide

Templates live in `src/story-templates/<slug>/`. Each folder must contain `meta.json`, `index.html`, `styles.css`, and a generated `preview.jpg`.

Shared brand variables are in `src/story-templates/_brand/tokens.css`. Template canvases are fixed at 1080 by 1920 and should declare a HyperFrames root with `data-composition-id`, `data-width`, `data-height`, and `data-duration`.

Use `data-hf-image="<slot_id>"` on image tags and match each slot in `meta.json`. Use `data-hf-text="<override_id>"` for editable text. Required slots without values fail the render.

Run `yarn regen-previews` after adding or editing templates. Test one template with `POST /admin/stories/templates/<slug>/render-sample`, then use the slot detail page to render against real product images.

## Render Operations

Story renders are CPU and memory heavy: HyperFrames launches headless Chrome, captures frames, encodes with ffmpeg, mixes audio, then uploads the MP4 to R2.

Production defaults are intentionally conservative:

- `RENDER_WORKERS` defaults to `1`. Raise only after confirming the container has enough memory.
- `RENDER_FPS` defaults to `30`. Lower to `24` if the host is CPU constrained.
- `RENDER_QUALITY` defaults to `standard`. Use `draft` if the host is CPU constrained.
- `RENDER_TIMEOUT_MS` defaults to `180000` (3 minutes). Increase if cold-start renders are timing out.
- `RENDER_USE_DOCKER` defaults to off. Set to `true` only if the runtime container has Docker CLI + daemon access.
- The runner defaults `PRODUCER_FORCE_SCREENSHOT=true` and `PRODUCER_ENABLE_STREAMING_ENCODE=false` unless those env vars are explicitly set. That is slower than HyperFrames' local default, but more compatible with Coolify-style containers.
- `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_PUBLIC_URL` must be set or MP4 upload fails.

If a slot shows `render stuck` in admin, the previous backend process stopped after setting `metadata.render_started_at` but before writing `metadata.render` or `metadata.render_error`. Re-render the slot after deploying the backend fix or after increasing render resources.
