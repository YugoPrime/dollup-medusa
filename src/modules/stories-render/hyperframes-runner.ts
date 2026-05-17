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
    // --docker tells HyperFrames to use container-friendly Chrome flags
    // (--no-sandbox, --disable-dev-shm-usage, --disable-gpu) and adjusts its
    // capture pipeline for the limited resources of a container. Without it
    // the browser launches but produces ~80px-wide garbage frames that ffmpeg
    // can't encode (HyperFrames itself prints "Try --docker for containerized
    // rendering" in the error tail). Opt out locally with HYPERFRAMES_LOCAL=1.
    const cliArgs = [cliPath, "render", tmpDir, "-o", outPath, "--quiet"]
    if (process.env.HYPERFRAMES_LOCAL !== "1") {
      cliArgs.push("--docker")
    }
    const proc = spawn(process.execPath, cliArgs, {
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
