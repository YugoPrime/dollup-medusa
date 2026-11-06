export type RenderMode = "local" | "shadow" | "cloud"

export function resolveRenderMode(
  env: NodeJS.ProcessEnv = process.env
): RenderMode {
  const raw = (env.STORIES_RENDER_MODE ?? "").trim().toLowerCase()
  return raw === "cloud" || raw === "shadow" ? raw : "local"
}
