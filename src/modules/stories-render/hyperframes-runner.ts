import { spawn } from "node:child_process"
import path from "node:path"

export class RenderCliError extends Error {
  name = "RenderCliError"

  constructor(
    public stderrTail: string,
    public exitCode: number,
  ) {
    super(`HyperFrames CLI exited ${exitCode}: ${stderrTail.slice(-500)}`)
  }
}

export class RenderTimeoutError extends Error {
  name = "RenderTimeoutError"

  constructor(public timeoutMs: number) {
    super(`HyperFrames CLI exceeded ${timeoutMs}ms`)
  }
}

export type SpawnRenderArgs = {
  tmpDir: string
  outPath: string
  timeoutMs?: number
}

export async function spawnRender(args: SpawnRenderArgs): Promise<void> {
  const { tmpDir, outPath, timeoutMs = 60_000 } = args
  return new Promise((resolve, reject) => {
    const cliPath = path.resolve(process.cwd(), "node_modules/hyperframes/dist/cli.js")
    // NOTE: --docker is intentionally NOT passed. That flag tells HyperFrames
    // to spin up its OWN Docker container for rendering (Docker-in-Docker) —
    // which fails inside our already-containerized backend with "spawnSync
    // docker ENOENT". HyperFrames detects /.dockerenv on its own and applies
    // container-friendly Chrome flags (--no-sandbox, --disable-dev-shm-usage)
    // automatically. The Chrome binary is located via env var
    // PRODUCER_HEADLESS_SHELL_PATH (set in the Dockerfile to /usr/bin/chromium).
    const proc = spawn(process.execPath, [cliPath, "render", tmpDir, "-o", outPath, "--quiet"], {
      stdio: ["ignore", "ignore", "pipe"],
    })
    let settled = false
    let stderrBuf = ""

    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) reject(err)
      else resolve()
    }

    const timer = setTimeout(() => {
      proc.kill("SIGKILL")
      finish(new RenderTimeoutError(timeoutMs))
    }, timeoutMs)

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString()
      if (stderrBuf.length > 4000) stderrBuf = stderrBuf.slice(-4000)
    })
    proc.on("error", (err) => finish(err))
    proc.on("exit", (code) => {
      if (code === 0) finish()
      else finish(new RenderCliError(stderrBuf.slice(-500), code ?? -1))
    })
  })
}
