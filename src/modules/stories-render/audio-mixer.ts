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
 *
 * Repeats are possible — two slots in the same day can hash to the same track.
 * For no-repeat-per-day guarantees use `pickTrackForPlanSlot` instead, which
 * shuffles the track list deterministically per plan and indexes by slot
 * position so all slots in a plan get distinct tracks (until track count is
 * exhausted, then it wraps).
 */
export function pickTrackForSlot(slotId: string, tracks: string[]): string | null {
  if (tracks.length === 0) return null
  const hash = createHash("sha256").update(slotId).digest()
  const idx = hash.readUInt32BE(0) % tracks.length
  return tracks[idx]
}

/**
 * Stable Fisher-Yates-style permutation of `tracks` seeded by `planId`. Same
 * plan always produces the same order so re-renders are bit-for-bit stable;
 * different plans get different orders so day-to-day variety is preserved.
 *
 * Implementation: derive each swap index from sha256(`${planId}:${i}`) so
 * we don't need a stateful seeded RNG. The shuffle is O(n) and pure.
 */
export function shuffleTracksForPlan(
  planId: string,
  tracks: readonly string[],
): string[] {
  const out = tracks.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const h = createHash("sha256").update(`${planId}:${i}`).digest()
    const j = h.readUInt32BE(0) % (i + 1)
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

/**
 * No-repeat-per-day picker: returns the track at position `slotIndex` in the
 * plan's deterministic shuffle. If `slotIndex` exceeds `tracks.length` (more
 * slots than tracks in a day), wraps modulo — the first repeat falls on the
 * (tracks.length + 1)th slot, never sooner.
 */
export function pickTrackForPlanSlot(
  planId: string,
  slotIndex: number,
  tracks: string[],
): string | null {
  if (tracks.length === 0) return null
  const shuffled = shuffleTracksForPlan(planId, tracks)
  const safeIndex = Number.isFinite(slotIndex) && slotIndex >= 0 ? Math.trunc(slotIndex) : 0
  return shuffled[safeIndex % shuffled.length]
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
 *
 * `-movflags +faststart` relocates the MP4 moov atom to the START of the
 * file. Required by streaming consumers that need to parse metadata before
 * downloading the whole file — most notably Meta's video_stories ingest,
 * which rejects non-faststart MP4s with the generic "There was a problem
 * uploading your video file" (error code 6000). Works fine alongside
 * `-c:v copy` — ffmpeg rewrites only the moov location during muxing,
 * not the video stream.
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
    "-movflags", "+faststart",
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
 *
 * When `planId` + `slotIndex` are passed, picks via the per-plan permutation
 * so no two slots in the same day share a track (until tracks are exhausted).
 * Otherwise falls back to the per-slot hash (which can repeat within a day).
 */
export async function applyAudioToRender(opts: {
  slotId: string
  videoPath: string
  durationSeconds: number
  audioDir: string
  volume?: number
  planId?: string
  slotIndex?: number
}): Promise<string | null> {
  const tracks = await listAudioTracks(opts.audioDir)
  const trackName =
    opts.planId && typeof opts.slotIndex === "number"
      ? pickTrackForPlanSlot(opts.planId, opts.slotIndex, tracks)
      : pickTrackForSlot(opts.slotId, tracks)
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
