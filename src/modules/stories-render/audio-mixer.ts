import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

/**
 * Returns the list of audio track filenames inside the brand audio dir.
 * Returns [] if the dir doesn't exist or no tracks are present — the
 * caller treats that as "skip audio mixing, ship silent MP4".
 */
export async function listAudioTracks(audioDir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(audioDir)
    return files
      .filter((f) => /\.(mp3|m4a|aac|wav)$/i.test(f))
      .sort()
  } catch {
    return []
  }
}

/**
 * Deterministic track-per-slot picker. Same slotId always maps to the same
 * track so re-renders are stable; different slotIds spread evenly across
 * available tracks so the daily feed varies.
 */
export function pickTrackForSlot(slotId: string, tracks: string[]): string | null {
  if (tracks.length === 0) return null
  const hash = createHash("sha256").update(slotId).digest()
  const idx = hash.readUInt32BE(0) % tracks.length
  return tracks[idx]
}

export class AudioMixError extends Error {
  name = "AudioMixError"
}

export type MixAudioArgs = {
  videoPath: string
  audioPath: string
  outPath: string
  durationSeconds: number
  /** 0..1, default 0.4 (-8dB) */
  volume?: number
}

/**
 * Mix a music track under a silent MP4 via ffmpeg. Video stream is copied
 * (no re-encode), audio is mixed at `volume` with 0.3s fade-in and a 0.5s
 * fade-out ending exactly at video duration. Output is capped to video
 * length via `-shortest`.
 */
export async function mixAudio(args: MixAudioArgs): Promise<void> {
  const { videoPath, audioPath, outPath, durationSeconds } = args
  const volume = args.volume ?? 0.4
  const fadeOutStart = Math.max(0, durationSeconds - 0.5)
  const filter = `[1:a]volume=${volume},afade=t=in:d=0.3,afade=t=out:st=${fadeOutStart}:d=0.5[a]`
  const ffmpegArgs = [
    "-y",
    "-i", videoPath,
    "-i", audioPath,
    "-filter_complex", filter,
    "-map", "0:v",
    "-map", "[a]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "128k",
    "-shortest",
    outPath,
  ]
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ffmpegArgs, { stdio: ["ignore", "ignore", "pipe"] })
    let stderr = ""
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
      if (stderr.length > 4000) stderr = stderr.slice(-4000)
    })
    proc.on("error", (err) => reject(new AudioMixError(`ffmpeg spawn error: ${err.message}`)))
    proc.on("exit", (code) => {
      if (code === 0) resolve()
      else reject(new AudioMixError(`ffmpeg exited ${code}: ${stderr.slice(-500)}`))
    })
  })
}

/**
 * Convenience: pick a track for the given slot, mix it under the silent
 * render in-place, and return which track was used (or null if no tracks
 * available). On mix failure, the silent MP4 is left untouched.
 */
export async function applyAudioToRender(opts: {
  slotId: string
  videoPath: string
  durationSeconds: number
  audioDir: string
  volume?: number
}): Promise<string | null> {
  const tracks = await listAudioTracks(opts.audioDir)
  const trackName = pickTrackForSlot(opts.slotId, tracks)
  if (!trackName) return null

  const audioPath = path.join(opts.audioDir, trackName)
  const mixedPath = opts.videoPath.replace(/\.mp4$/i, ".mixed.mp4")

  await mixAudio({
    videoPath: opts.videoPath,
    audioPath,
    outPath: mixedPath,
    durationSeconds: opts.durationSeconds,
    volume: opts.volume,
  })

  await fs.rename(mixedPath, opts.videoPath)
  return trackName
}
