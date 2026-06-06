# Local SHEIN Daemon — Setup

SHEIN now serves JavaScript captcha challenges (`/risk/challenge`) on every plain server fetch, which makes datacenter IPs (like Coolify) unable to read pages. The preorder quote-scrape daemon and daily availability sweep both require a real browser with Chromium to resolve these challenges. This guide gets them running on a laptop instead, using the same supervision model as the stories renderer (Windows Task Scheduler).

## How it works

1. The Coolify cron `preorder-availability-check` (runs once daily) stays registered but **deliberately no-ops** without the `AVAILABILITY_SWEEP_ENABLED` flag — this is intentional so it doesn't crash trying to launch Chromium on the datacenter.
2. A local daemon on your laptop polls the production DB every 5 minutes, finds any preorder quote job in `pending` state, scrapes SHEIN with a real Chromium browser, resolves captcha challenges, and stores the quoted price back in the prod DB.
3. A separate daily availability sweep (runs ~06:00 MU) scans all active preorder variants and checks SHEIN current stock + price, updating `preorder_availability_check` records.
4. Both daemons log to `logs/` with one-line heartbeats per tick; failed ticks fire Telegram alerts.
5. **If the laptop is offline**, pending quote jobs stay pending. The storefront shows "waiting for quote" until the daemon comes back online and catches up.

## One-time setup

### 1. Configure your laptop

Make a `.env.local-render` in this folder (do NOT commit — `.env*` is gitignored):

```sh
# Production DB — same value as Coolify's DATABASE_URL.
DATABASE_URL=postgres://USER:PASS@HOST:5432/DBNAME

# Production Redis — same value as Coolify's REDIS_URL. Used for locking.
REDIS_URL=redis://USER:PASS@HOST:6379

# Optional: seconds between quote-job scans (default 300 = 5 min, min 30).
QUOTE_POLL_SECONDS=300

# Optional: milliseconds to wait for SHEIN captcha challenge to resolve (default 6000).
CHALLENGE_SETTLE_MS=6000
```

This is the **same file** the stories renderer uses. If you already have `.env.local-render` from LOCAL-RENDERING-SETUP.md, no changes needed.

### 2. Install deps (first time only)

```sh
cd Backend/dollup-medusa
yarn install
yarn build
```

Playwright will download Chromium to your local machine on first run (~150 MB):

```sh
npx playwright install chromium
```

### 3. Ensure the SSH tunnel is running

Both daemons connect to prod DB via the `coolify-db-tunnel` SSH tunnel. Verify it's running:

```powershell
pm2 list
```

You should see `coolify-db-tunnel` in the process table. If not, start it:

```powershell
pm2 start coolify-db-tunnel
```

Refer to LOCAL-RENDERING-SETUP.md for full tunnel setup.

### 4. Register the quote poller scheduled task

Run this PowerShell command (as Administrator) from `Backend/dollup-medusa/`:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-quote-daemon-task.ps1
```

This registers `\DollUp\DollUp-Quote-Scrape-Poller` to run every 5 minutes between 09:00–22:00 MU, executing the quote-job scraper with Chromium.

### 5. Register the daily availability sweep (manual)

The availability sweep is a separate daily task. You can either:

**Option A: Use Task Scheduler UI (recommended for manual supervision)**

1. Open Windows Task Scheduler (`taskschd.msc`).
2. Right-click **Task Scheduler Library** → **New Folder** → name it `DollUp`.
3. Right-click the `DollUp` folder → **Create Task**.
4. **General tab:**
   - Name: `DollUp-Availability-Sweep`
   - Check "Run with highest privileges"
   - Trigger: **New** → **One time** → set to daily at 06:00 (adjust as needed)
   - Advanced: check "Repeat task every 1 day"
5. **Actions tab:**
   - Action: **Start a program**
   - Program: `powershell.exe`
   - Arguments:
     ```
     -ExecutionPolicy Bypass -File start-availability-sweep.ps1
     ```
   - Start in: `C:\Users\<YOU>\projects\DOLL UP BOUTIQUE\Backend\dollup-medusa`
6. **Conditions tab:**
   - Uncheck "Stop if on battery power"
7. **Settings tab:**
   - Check "Run task as soon as possible after a scheduled start is missed"
   - Check "If the task fails, restart every 5 minutes"
   - Set maximum retry count to 3
8. **OK** and provide admin credentials.

**Option B: Script it (future improvement)**

We'll provide `start-availability-sweep.ps1` (alongside `start-quote-daemon-poller.ps1`) in a future update. For now, follow Option A.

### 6. Create the poller startup script (if not present)

If `start-quote-daemon-poller.ps1` doesn't exist, create it at `Backend/dollup-medusa/start-quote-daemon-poller.ps1`:

```powershell
# Load .env.local-render
if (-not (Test-Path ".env.local-render")) {
  Write-Error ".env.local-render not found. Copy from Coolify and set DATABASE_URL/REDIS_URL."
  exit 1
}

Get-Content .env.local-render | ForEach-Object {
  if ($_ -match "^\s*([^#=]+?)\s*=\s*(.*)$") {
    [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2])
  }
}

# Check tunnel
$tunnel = pm2 list | Select-String "coolify-db-tunnel"
if (-not $tunnel) {
  Write-Error "coolify-db-tunnel PM2 process not running. Start it with: pm2 start coolify-db-tunnel"
  exit 2
}

# Run the quote poller
Write-Host "[quote-poller] starting at $(Get-Date)" | Tee-Object -FilePath "logs/quote-scrape-poller-task.log" -Append
yarn medusa exec ./src/scripts/scrape-quote-jobs.ts | Tee-Object -FilePath "logs/quote-scrape-poller-task.log" -Append
```

## Daily use

### Quote poller

The quote poller runs automatically via Task Scheduler every 5 minutes (09:00–22:00 MU). To verify it's working:

```powershell
# Check the log file
Get-Content logs/quote-scrape-poller-task.log -Tail 20
```

Or run one manual tick:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-quote-daemon-poller.ps1
```

### Availability sweep

The availability sweep runs automatically at 06:00 MU via Task Scheduler. To run manually:

```powershell
$env:AVAILABILITY_SWEEP_ENABLED = 'true'
yarn medusa exec ./src/scripts/run-availability-sweep.ts
```

(Or use the `start-availability-sweep.ps1` script once created.)

## Environment flags

- **`AVAILABILITY_SWEEP_ENABLED=true`** — set ONLY on the laptop before running the sweep script. The Coolify cron checks this flag and skips gracefully if it's not set (no error, just a no-op return).
- **`CHALLENGE_SETTLE_MS`** — milliseconds to wait for SHEIN's JS captcha to finish (default 6000). Increase if SHEIN takes longer to respond; decrease if you're sure it's resolved faster.

### Coolify environment

Do **NOT** set `AVAILABILITY_SWEEP_ENABLED` on Coolify. The scheduled cron stays registered for redundancy, but it will always skip without the flag.

## What gets logged

### Quote poller

Every tick logs to `logs/quote-scrape-poller-task.log`:
- `[quote-poller] tick=N jobs_pending=K` — how many quote jobs are waiting
- `[quote-poller] job=... fetching SHEIN SKU ...` — which job is being processed
- `[quote-poller] job=... quoted MUR X` — success; quote stored
- `[quote-poller] job=... needs_manual (reason: ...)` — escalated to manual review
- `[quote-poller] iteration done | quoted=X escalated=Y errors=Z`

### Availability sweep

Logs to `logs/availability-sweep-task.log` (daily):
- `[availability-sweep] scanning N variants` — how many preorder variants to check
- `[availability-sweep] variant=... in_stock=true price=X` — variant available and price updated
- `[availability-sweep] variant=... out_of_stock` — SHEIN no longer has it
- `[availability-sweep] sweep complete | checked=X updated=Y errors=Z`

### Heartbeat

Both daemons update `preorder_settings.shein_daemon_last_seen_at` on every successful tick. The storefront and admin UI check this timestamp to know the daemon is online.

## Verifying it works

1. **Logs are rolling**: `Get-Content logs/quote-scrape-poller-task.log -Tail 5` shows recent entries with timestamps.
2. **Heartbeat updates**: Query the DB:
   ```sql
   SELECT shein_daemon_last_seen_at FROM preorder_settings LIMIT 1;
   ```
   Should be within the last 5 minutes.
3. **Pending jobs clear**: A preorder quote request moves from `status=pending` → `status=quoted` after a tick.
4. **Telegram alerts**: Tick failures (tunnel down, Chromium crash, fetch error) fire alerts to your owner chat.

## Troubleshooting

### "coolify-db-tunnel not running"
The SSH tunnel to prod is down. Check:
```powershell
pm2 list | Select-String tunnel
pm2 logs coolify-db-tunnel --lines 50
```
Restart:
```powershell
pm2 restart coolify-db-tunnel
```

### Chromium not found / path errors
Playwright wasn't installed. Run:
```powershell
npx playwright install chromium
```
This downloads ~150 MB to your local machine.

### All jobs landing in `needs_manual`
Chromium may not be launching, or SHEIN challenge resolution is failing. Increase `CHALLENGE_SETTLE_MS` (e.g., to 10000) and try again. Or check the detailed logs:
```powershell
Get-Content logs/quote-scrape-poller-task.log -Tail 100 | findstr "error\|failed\|Error"
```

### "DATABASE_URL is required" / env vars not loading
The `.env.local-render` file didn't load correctly. Verify:
- File exists at `Backend/dollup-medusa/.env.local-render`
- Syntax: `KEY=value` with no quotes
- No trailing whitespace
- File encoding is UTF-8

Test manually:
```powershell
Get-Content .env.local-render | ForEach-Object {
  if ($_ -match "^\s*([^#=]+?)\s*=\s*(.*)$") {
    Write-Host "$($Matches[1]) = $($Matches[2])"
  }
}
```

### Quotes stay "pending" forever in admin
The daemon isn't running or is crashing on every tick. Check:
1. Task Scheduler: Open `taskschd.msc`, navigate to `DollUp` folder, right-click `DollUp-Quote-Scrape-Poller` → **Properties** → **History** tab. Look for failed runs.
2. Manual tick: Run `powershell -ExecutionPolicy Bypass -File .\start-quote-daemon-poller.ps1` in a terminal. If it errors immediately, the error message will tell you why.
3. Log file: `Get-Content logs/quote-scrape-poller-task.log -Tail 50` for the last tick's output.

### Tunnel is up, Chromium is installed, but quotes still fail
SHEIN's captcha detection or page structure may have changed. Check:
1. Increase `CHALLENGE_SETTLE_MS` to 10000 and try again.
2. Run a manual tick with verbose logging:
   ```powershell
   $env:DEBUG = "quote-scrape*"
   powershell -ExecutionPolicy Bypass -File .\start-quote-daemon-poller.ps1
   ```
3. If a specific SKU always fails, check the SHEIN page manually in a browser — it might be region-locked or removed.

### Task Scheduler entry doesn't run at scheduled time
1. Verify the trigger: open `taskschd.msc` → `DollUp` → right-click task → **Properties** → **Triggers** tab.
2. Ensure your laptop doesn't sleep during the scheduled window (Power Settings → set "When lid closes" to "Do nothing").
3. Check the task history for error codes. Microsoft docs on common exit codes: https://docs.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page

### Availability sweep never runs at 06:00 MU
Same as above. Also confirm:
- Task is set to **repeat every 1 day** (not one-time).
- **Run with highest privileges** is checked.
- The `start-availability-sweep.ps1` script exists and is executable.

Run manually to test:
```powershell
$env:AVAILABILITY_SWEEP_ENABLED = 'true'
yarn medusa exec ./src/scripts/run-availability-sweep.ts
```
