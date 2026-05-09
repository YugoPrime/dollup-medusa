import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CHAT_MODULE } from "../../../../modules/chat"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const chat: any = req.scope.resolve(CHAT_MODULE)
  const {
    channel,
    status,
    q,
    limit = 50,
    offset = 0,
  } = req.query as Record<string, any>

  const filter: Record<string, any> = {}
  if (channel) filter.channel = channel
  if (status && status !== "all") filter.status = status

  const threads = await chat.listThreads(filter, {
    take: Number(limit),
    skip: Number(offset),
    order: { last_message_at: "DESC" },
  })

  // Hydrate per thread. Volume is low enough for v1 that N+1 is fine; revisit
  // with query.graph if thread count grows past ~500.
  const out = await Promise.all(
    threads.map(async (t: any) => {
      const [contact] = await chat.listContacts({ id: t.contact_id })
      const [last] = await chat.listMessages(
        { thread_id: t.id },
        { take: 1, order: { created_at: "DESC" } }
      )
      return { ...t, contact: contact ?? null, last_message: last ?? null }
    })
  )

  const filtered = q
    ? out.filter((t: any) => {
        const hay =
          (t.contact?.display_name ?? "") +
          " " +
          (t.last_message?.body ?? "")
        return hay.toLowerCase().includes(String(q).toLowerCase())
      })
    : out

  res.json({ threads: filtered })
}
