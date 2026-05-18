# Local Story Rendering — Setup

Coolify's backend container is too small to render IG Stories (chrome-headless-shell software rendering @ 1080×1920 produces ~1.4 fps on the host vs. the 30 fps target — see commit history for the full investigation). This guide gets the SAME render pipeline running on a laptop instead.

## How it works

1. The Coolify cron at 18:00 MU keeps running. It creates tomorrow's plan, picks products, but **stops before rendering** (the new `STORIES_RENDER_REMOTE_ONLY` env var skips the heavy step).
2. A local daemon on your laptop polls the production DB every 5 minutes, finds any slot in the next 7 days without an mp4, renders it locally with your laptop's CPU, uploads to R2, and writes the result back to the prod DB.
3. The admin UI's "Auto-render" and "Render all" buttons still work — they just defer the actual work to the daemon (slots show "rendering..." until the daemon catches up).
4. **If the laptop is offline**, slots stay in "pending" state. Next time you bring the laptop online and start the daemon, it scans the lookahead window and renders everything that's missing.

## One-time setup

### 1. Set the Coolify env var

In Coolify → backend app → Environment Variables, add:

```
STORIES_RENDER_REMOTE_ONLY=true
```

Redeploy the backend. From now on, no chrome will spawn inside Coolify.

### 2. Configure your laptop

Make a `.env.local-render` in this folder (do NOT commit — `.env*` is gitignored):

```sh
# Production DB — same value as Coolify's DATABASE_URL.
DATABASE_URL=postgres://USER:PASS@HOST:5432/DBNAME

# Production Redis — same value as Coolify's REDIS_URL. Used for locking.
REDIS_URL=redis://USER:PASS@HOST:6379

# R2 — same values as Coolify. The daemon uploads the rendered mp4s.
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
R2_BUCKET=dollup-stories
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_PUBLIC_URL=https://stories.dollupboutique.com

# Optional: limit how many days forward to scan (default 7).
RENDER_LOOKAHEAD_DAYS=7

# Optional: seconds between scans in daemon mode (default 300 = 5 min, min 30).
RENDER_POLL_SECONDS=300

# Optional: set to "true" to render-and-exit instead of looping forever.
RENDER_ONCE=false
```

### 3. Install deps (first time only)

```sh
cd Backend/dollup-medusa
yarn install
yarn build
```

The HyperFrames package will download chrome-headless-shell to `~/.cache/puppeteer` on first render (~150 MB). FFmpeg must be installed and on PATH:
- **Windows**: `winget install Gyan.FFmpeg` or download from https://ffmpeg.org/
- **macOS**: `brew install ffmpeg`
- **Linux**: `apt install ffmpeg` / `dnf install ffmpeg`

## Daily use

Open a terminal at `Backend/dollup-medusa/` and run:

```sh
# Loads .env.local-render and starts the daemon. It loops forever until Ctrl+C.
node --env-file=.env.local-render node_modules/.bin/medusa exec ./src/scripts/local-render-stories.ts
```

Or on Windows PowerShell (no `--env-file` flag in older Node):

```powershell
# Load env from .env.local-render, then start the daemon.
Get-Content .env.local-render | ForEach-Object {
  if ($_ -match "^\s*([^#=]+?)\s*=\s*(.*)$") {
    [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2])
  }
}
yarn medusa exec ./src/scripts/local-render-stories.ts
```

**Tip:** keep this terminal open in the background while your laptop is on. Each scan logs a one-line summary; renders take ~30-60s each on modern hardware.

## One-shot mode (manual catch-up)

If you just want to "render everything pending and exit":

```sh
RENDER_ONCE=true yarn medusa exec ./src/scripts/local-render-stories.ts
```

## What gets logged

Every scan logs:
- `[local-render] scanning N plan(s)` — how many days have plans in the window
- `[local-render] plan stplan_... (YYYY-MM-DD): K/N slot(s) need rendering`
- `[local-render]   ok    slot=... duration_ms=...`
- `[local-render]   skip  slot=... reason="..."`
- `[local-render]   FAIL  slot=... msg="..."`
- `[local-render] iteration done | ok=X skipped=Y errors=Z`

The same per-stage logs from the backend (`[stories-render]`, `[stories-render:runner]`) appear in your local terminal too, since the daemon reuses the exact same render service.

## Troubleshooting

- **"Chrome not found" / first-render hang**: HyperFrames downloads chrome-headless-shell into `~/.cache/puppeteer/chrome-headless-shell/`. Allow a few minutes the first time.
- **ffmpeg ENOENT**: install ffmpeg system-wide (see prereqs above).
- **"DATABASE_URL is required"**: env file didn't load. Verify the path and syntax — values must NOT be wrapped in quotes.
- **Slot stays "rendering" forever in admin**: daemon isn't running, or it errored on this specific slot (check `metadata.render_error` via admin).
- **R2 upload fails**: verify `R2_ENDPOINT` includes `https://` and the bucket exists.
