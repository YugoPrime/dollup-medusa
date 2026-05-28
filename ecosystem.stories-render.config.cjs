// PM2 ecosystem file for the Stories local rendering daemon.
//
// Runs in CRON MODE — not long-polling. PM2 fires the daemon once per day
// at 18:30 MU; the daemon scans pending slots, renders them, sends a
// Telegram summary, and exits. PM2 then waits until the next cron tick.
//
// One-time setup:
//   npm install -g pm2 pm2-windows-startup
//   pm2-startup install
//   cd "C:\Users\rahvi\projects\DOLL UP BOUTIQUE\Backend\dollup-medusa"
//   mkdir logs -ErrorAction SilentlyContinue
//   pm2 start ecosystem.stories-render.config.cjs
//   pm2 save
//
// Daily ops:
//   pm2 status                       — list all apps
//   pm2 logs stories-render-daemon   — tail logs
//   pm2 restart stories-render-daemon — force a run now (e.g. you boot
//                                      later than 18:30 and want to
//                                      catch up tonight's render)
//
// Note: PM2 cron uses the system local timezone. The laptop must be set
// to Mauritius time (UTC+4) for "30 18 * * *" to fire at 18:30 MU.
module.exports = {
  apps: [
    {
      // SSH tunnel to Coolify host. Forwards local 5432 + 6379 to the
      // docker-internal Postgres/Redis containers. The render daemon
      // depends on this — without the tunnel, .env.local-render's
      // 127.0.0.1 hosts point at nothing.
      //
      // SSH key auth must be set up so the tunnel reconnects unattended
      // (no password prompt). The exact -L forwards mirror the manual
      // command that was already running in a PowerShell terminal.
      name: "coolify-db-tunnel",
      cwd: "C:\\Users\\rahvi\\projects\\DOLL UP BOUTIQUE\\Backend\\dollup-medusa",
      script: "C:\\Windows\\System32\\OpenSSH\\ssh.exe",
      args: [
        "-N",
        "-o",
        "ServerAliveInterval=30",
        "-o",
        "ServerAliveCountMax=3",
        "-o",
        "ExitOnForwardFailure=yes",
        "-L",
        "5432:10.0.1.10:5432",
        "-L",
        "6379:10.0.1.6:6379",
        "root@100.65.8.93",
      ],
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 100,
      min_uptime: "30s",
      out_file: "./logs/ssh-tunnel-out.log",
      error_file: "./logs/ssh-tunnel-err.log",
      merge_logs: true,
      time: true,
    },
    // NOTE: there used to be a `stories-render-daemon` PM2 entry here that
    // fired once a day via cron_restart. It was deleted 2026-05-28 because:
    //   - Windows Task Scheduler's `\DollUp\DollUp-Stories-Render-Daemon`
    //     already fires `start-render-daemon.ps1` at 18:30 MU daily (the
    //     primary batch path).
    //   - The on-demand "Re-render" button is now served by a SECOND
    //     Windows Task Scheduler entry (`\DollUp\DollUp-Stories-Render-Poller`)
    //     that fires `start-render-poller.ps1` every 5 minutes from
    //     09:00 to 17:00 MU. Task Scheduler is the proven-reliable
    //     supervisor on this Windows box; PM2 + cmd.exe spawning has
    //     repeatedly fought back hard (Node DEP0190, PATH lookup,
    //     ghost PIDs).
    // PM2 here is reduced to a single job: keeping the SSH tunnel up.
  ],
}
