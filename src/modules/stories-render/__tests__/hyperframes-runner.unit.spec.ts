import { describe, expect, it } from "@jest/globals"

import {
  buildRenderCliArgs,
  normalizeRenderStderr,
  resolveRenderFps,
  resolveRenderQuality,
  resolveRenderUseDocker,
  resolveRenderWorkers,
} from "../hyperframes-runner"

describe("hyperframes-runner", () => {
  describe("resolveRenderWorkers", () => {
    it("defaults to one worker for low-memory production containers", () => {
      expect(resolveRenderWorkers(undefined)).toBe(1)
      expect(resolveRenderWorkers("")).toBe(1)
      expect(resolveRenderWorkers("0")).toBe(1)
      expect(resolveRenderWorkers("not-a-number")).toBe(1)
    })

    it("allows an explicit positive worker count", () => {
      expect(resolveRenderWorkers("2")).toBe(2)
    })
  })

  describe("render option resolvers", () => {
    it("keeps fps and quality conservative but configurable", () => {
      expect(resolveRenderFps(undefined)).toBe(30)
      expect(resolveRenderFps("24")).toBe(24)
      expect(resolveRenderFps("0")).toBe(30)
      expect(resolveRenderFps("300")).toBe(30)

      expect(resolveRenderQuality(undefined)).toBe("standard")
      expect(resolveRenderQuality("draft")).toBe("draft")
      expect(resolveRenderQuality("bad")).toBe("standard")
    })

    it("uses Docker mode only when explicitly enabled", () => {
      expect(resolveRenderUseDocker(undefined)).toBe(false)
      expect(resolveRenderUseDocker("false")).toBe(false)
      expect(resolveRenderUseDocker("true")).toBe(true)
      expect(resolveRenderUseDocker("1")).toBe(true)
    })
  })

  describe("buildRenderCliArgs", () => {
    it("constrains HyperFrames concurrency by default", () => {
      const args = buildRenderCliArgs({
        tmpDir: "/tmp/story-template",
        outPath: "/tmp/render.mp4",
      })

      expect(args).toEqual(
        expect.arrayContaining([
          "render",
          "/tmp/story-template",
          "-o",
          "/tmp/render.mp4",
          "--quiet",
          "--fps",
          "30",
          "--quality",
          "standard",
          "--workers",
          "1",
          "--max-concurrent-renders",
          "1",
          "--no-browser-gpu",
        ]),
      )
    })

    it("supports explicit Docker mode for hosts with Docker access", () => {
      const args = buildRenderCliArgs({
        tmpDir: "/tmp/story-template",
        outPath: "/tmp/render.mp4",
        useDocker: true,
      })

      expect(args).toContain("--docker")
    })
  })

  describe("normalizeRenderStderr", () => {
    it("removes noisy ffmpeg progress while keeping the render error", () => {
      const message = normalizeRenderStderr(
        "frame=  14 fps=0.0 q=0.0 size=0kB time=00:00:00.00 bitrate=N/A speed=0x\r\n" +
          "\u001b[31mRender failed\u001b[0m\n" +
          "Protocol error: Target closed\n" +
          "Try --docker for containerized rendering\n",
      )

      expect(message).not.toContain("frame=")
      expect(message).toContain("Render failed")
      expect(message).toContain("Protocol error: Target closed")
      expect(message).toContain("Try --docker")
    })
  })
})
