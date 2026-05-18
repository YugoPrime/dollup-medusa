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
  workers?: number
  fps?: number
  quality?: RenderQuality
  useDocker?: boolean
}

type RenderQuality = "draft" | "standard" | "high"

const DEFAULT_RENDER_WORKERS = 1
const DEFAULT_RENDER_FPS = 30
const DEFAULT_RENDER_QUALITY: RenderQuality = "standard"
const STDERR_BUFFER_LIMIT = 12_000
const STDERR_MESSAGE_LIMIT = 4_000

export function resolveRenderWorkers(
  raw = process.env.RENDER_WORKERS,
): number {
  if (raw == null || raw.trim() === "") return DEFAULT_RENDER_WORKERS

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_RENDER_WORKERS
  return parsed
}

export function resolveRenderFps(raw = process.env.RENDER_FPS): number {
  if (raw == null || raw.trim() === "") return DEFAULT_RENDER_FPS

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 240) return DEFAULT_RENDER_FPS
  return parsed
}

export function resolveRenderQuality(
  raw = process.env.RENDER_QUALITY,
): RenderQuality {
  if (raw === "draft" || raw === "standard" || raw === "high") return raw
  return DEFAULT_RENDER_QUALITY
}

export function resolveRenderUseDocker(
  raw = process.env.RENDER_USE_DOCKER,
): boolean {
  return raw === "true" || raw === "1"
}

export function buildRenderCliArgs(args: SpawnRenderArgs): string[] {
  const cliPath = path.resolve(process.cwd(), "node_modules/hyperframes/dist/cli.js")
  const workers = args.workers ?? resolveRenderWorkers()
  const fps = args.fps ?? resolveRenderFps()
  const quality = args.quality ?? resolveRenderQuality()

  const cliArgs = [
    cliPath,
    "render",
    args.tmpDir,
    "-o",
    args.outPath,
    "--quiet",
    "--fps",
    String(fps),
    "--quality",
    quality,
    "--workers",
    String(workers),
    "--max-concurrent-renders",
    "1",
    "--no-browser-gpu",
  ]

  if (args.useDocker ?? resolveRenderUseDocker()) {
    cliArgs.push("--docker")
  }

  return cliArgs
}

export async function spawnRender(args: SpawnRenderArgs): Promise<void> {
  const { tmpDir, outPath, timeoutMs = 60_000 } = args
  return new Promise((resolve, reject) => {
    // NOTE: --docker is intentionally NOT passed. That flag tells HyperFrames
    // to spin up its OWN Docker container for rendering (Docker-in-Docker) -
    // which fails inside our already-containerized backend with "spawnSync
    // docker ENOENT". HyperFrames detects /.dockerenv on its own and applies
    // container-friendly Chrome flags (--no-sandbox, --disable-dev-shm-usage)
    // automatically. The Chrome binary is located via env var
    // PRODUCER_HEADLESS_SHELL_PATH (set in the Dockerfile).
    const detached = process.platform !== "win32"
    const proc = spawn(process.execPath, buildRenderCliArgs({ ...args, tmpDir, outPath }), {
      detached,
      env: {
        ...process.env,
        HYPERFRAMES_NO_UPDATE_CHECK: "1",
        PRODUCER_ENABLE_STREAMING_ENCODE:
          process.env.PRODUCER_ENABLE_STREAMING_ENCODE ?? "false",
        PRODUCER_FORCE_SCREENSHOT:
          process.env.PRODUCER_FORCE_SCREENSHOT ?? "true",
        PRODUCER_MAX_CONCURRENT_RENDERS:
          process.env.PRODUCER_MAX_CONCURRENT_RENDERS ?? "1",
      },
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
      killRenderProcess(proc.pid, detached)
      finish(new RenderTimeoutError(timeoutMs))
    }, timeoutMs)

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString()
      if (stderrBuf.length > STDERR_BUFFER_LIMIT) {
        stderrBuf = stderrBuf.slice(-STDERR_BUFFER_LIMIT)
      }
    })
    proc.on("error", (err) => finish(err))
    proc.on("exit", (code) => {
      if (code === 0) finish()
      else finish(new RenderCliError(normalizeRenderStderr(stderrBuf), code ?? -1))
    })
  })
}

export function normalizeRenderStderr(stderr: string): string {
  const plain = stderr
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "\n")

  const usefulLines = plain
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .filter((line) => !isFfmpegProgressLine(line))

  return usefulLines.join("\n").slice(-STDERR_MESSAGE_LIMIT)
}

function isFfmpegProgressLine(line: string): boolean {
  return (
    /\bframe=\s*\d+/.test(line) &&
    /\bfps=/.test(line) &&
    /\btime=/.test(line) &&
    /\bspeed=/.test(line)
  )
}

function killRenderProcess(pid: number | undefined, detached: boolean): void {
  if (!pid) return
  try {
    if (detached && process.platform !== "win32") {
      process.kill(-pid, "SIGKILL")
    } else {
      process.kill(pid, "SIGKILL")
    }
  } catch {
    // The process may already have exited between timeout and kill.
  }
}
