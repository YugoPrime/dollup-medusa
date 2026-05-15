import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import fs from "node:fs/promises"
import path from "node:path"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const slug = req.params.slug
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
    res.status(404).send("Not found")
    return
  }
  const previewPath = path.resolve(process.cwd(), "src/story-templates", slug, "preview.jpg")
  try {
    const buf = await fs.readFile(previewPath)
    res.setHeader("content-type", "image/jpeg")
    res.setHeader("cache-control", "public, max-age=3600")
    res.status(200).send(buf)
  } catch {
    res.status(404).send("Not found")
  }
}

