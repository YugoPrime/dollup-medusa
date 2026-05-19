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
    {
      name: "stories-render-daemon",
      cwd: "C:\\Users\\rahvi\\projects\\DOLL UP BOUTIQUE\\Backend\\dollup-medusa",
      script: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        ".\\start-render-daemon.ps1",
      ],
      // Cron mode: fire at 18:30 MU every day. PM2 launches the script,
      // it runs once, exits, and PM2 waits for the next cron tick.
      cron_restart: "30 18 * * *",
      autorestart: false,
      out_file: "./logs/stories-render-out.log",
      error_file: "./logs/stories-render-err.log",
      merge_logs: true,
      time: true,
    },
  ],
}
