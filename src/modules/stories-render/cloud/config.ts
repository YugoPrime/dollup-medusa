export type CloudRenderConfig = {
  baseUrl: string
  apiKey: string
  callbackSecret: string
  callbackUrl: string
}

const DEFAULT_CALLBACK_URL = "https://api.dollupboutique.com/hooks/story-render"

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = (env[name] ?? "").trim()
  if (!value) throw new Error(`${name} is not set`)
  return value
}

function requireHttps(name: string, value: string): void {
  if (!value.toLowerCase().startsWith("https://")) {
    throw new Error(`${name} must be https`)
  }
}

export function readCloudRenderConfig(
  env: NodeJS.ProcessEnv = process.env
): CloudRenderConfig {
  const baseUrl = required(env, "STORY_RENDER_URL")
  const apiKey = required(env, "STORY_RENDER_API_KEY")
  const callbackSecret = required(env, "STORY_RENDER_CALLBACK_SECRET")
  const callbackUrl =
    (env.STORY_RENDER_CALLBACK_URL ?? "").trim() || DEFAULT_CALLBACK_URL
  requireHttps("STORY_RENDER_URL", baseUrl)
  requireHttps("STORY_RENDER_CALLBACK_URL", callbackUrl)
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiKey,
    callbackSecret,
    callbackUrl,
  }
}
