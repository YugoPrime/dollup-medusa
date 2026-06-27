import { defineRouteConfig } from "@medusajs/admin-sdk"
import { CalendarSolid } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { useCallback, useEffect, useMemo, useState } from "react"

type PoolProduct = {
  id: string
  title: string
  ref: string | null
  thumbnail: string | null
  status: string
  scheduled_date: string | null
}
type FeedPostRow = {
  id: string
  post_date: string
  product_id: string | null
  status: "planned" | "posted" | "failed" | "skipped"
  image_urls: string[] | null
  product_snapshot: { name?: string } | null
}

const pad = (n: number) => String(n).padStart(2, "0")
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}

function monthRange(year: number, month: number) {
  const from = ymd(year, month, 1)
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const to = ymd(year, month, last)
  return { from, to, last }
}

const FeedPlannerPage = () => {
  // "Today" must be Mauritius-local (UTC+4) to match the backend's date guards;
  // using UTC would mislabel the day during the 20:00–24:00 MU window.
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Indian/Mauritius",
  }).format(new Date())
  const [ty, tm] = todayStr.split("-").map(Number)
  const [year, setYear] = useState(ty)
  const [month, setMonth] = useState(tm - 1) // 0-based
  const [pool, setPool] = useState<PoolProduct[]>([])
  const [pushedAt, setPushedAt] = useState<string | null>(null)
  const [rowsByDate, setRowsByDate] = useState<Record<string, FeedPostRow>>({})
  const [loading, setLoading] = useState(true)

  const { from, to, last } = useMemo(() => monthRange(year, month), [year, month])

  const loadPool = useCallback(async () => {
    const { ok, json } = await api("/admin/feed-posts/pool")
    if (ok) {
      setPool(json.products ?? [])
      setPushedAt(json.pushed_at ?? null)
    }
  }, [])

  const loadCalendar = useCallback(async () => {
    const { ok, json } = await api(
      `/admin/feed-posts/calendar?from=${from}&to=${to}`,
    )
    if (ok) {
      const map: Record<string, FeedPostRow> = {}
      for (const r of json.feed_posts as FeedPostRow[]) map[r.post_date] = r
      setRowsByDate(map)
    }
  }, [from, to])

  useEffect(() => {
    setLoading(true)
    Promise.all([loadPool(), loadCalendar()]).finally(() => setLoading(false))
  }, [loadPool, loadCalendar])

  const plan = async (date: string, productId: string) => {
    const { ok, json } = await api("/admin/feed-posts/plan", {
      method: "POST",
      body: JSON.stringify({ date, product_id: productId }),
    })
    if (!ok) {
      const reason = json?.reason ?? "error"
      toast.error(
        reason === "not_published"
          ? "That product isn't live yet — Go Live first."
          : reason === "past"
            ? "Can't schedule a past day."
            : reason === "posted"
              ? "That day is already posted."
              : "Could not schedule.",
      )
      return
    }
    toast.success("Scheduled.")
    await Promise.all([loadPool(), loadCalendar()])
  }

  const unplan = async (date: string) => {
    const { ok } = await api(`/admin/feed-posts/plan?date=${encodeURIComponent(date)}`, {
      method: "DELETE",
      body: JSON.stringify({ date }),
    })
    if (!ok) {
      toast.error("Could not unschedule.")
      return
    }
    toast.success("Unscheduled.")
    await Promise.all([loadPool(), loadCalendar()])
  }

  const onDropDay = (date: string) => (e: React.DragEvent) => {
    e.preventDefault()
    const productId = e.dataTransfer.getData("text/plain")
    if (productId) void plan(date, productId)
  }

  const prevMonth = () => {
    const d = new Date(Date.UTC(year, month - 1, 1))
    setYear(d.getUTCFullYear())
    setMonth(d.getUTCMonth())
  }
  const nextMonth = () => {
    const d = new Date(Date.UTC(year, month + 1, 1))
    setYear(d.getUTCFullYear())
    setMonth(d.getUTCMonth())
  }

  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay() // 0=Sun
  const cells: Array<number | null> = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: last }, (_, i) => i + 1),
  ]
  const monthLabel = new Date(Date.UTC(year, month, 1)).toLocaleString("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <Heading level="h1">Feed Planner</Heading>
        <Text className="text-ui-fg-subtle" size="small">
          {pushedAt
            ? `Latest push: ${new Date(pushedAt).toLocaleDateString()}`
            : "No recent push"}
        </Text>
      </div>

      <div className="grid grid-cols-[280px_1fr] gap-4 p-6">
        {/* Pool */}
        <div className="flex flex-col gap-2">
          <Heading level="h3">Latest import</Heading>
          {pool.length === 0 && !loading && (
            <Text size="small" className="text-ui-fg-subtle">
              No products in the latest push.
            </Text>
          )}
          {pool.map((p) => {
            const live = p.status === "published"
            return (
              <div
                key={p.id}
                draggable={live}
                onDragStart={(e) => {
                  if (!live) return
                  e.dataTransfer.setData("text/plain", p.id)
                }}
                className={`flex gap-2 items-center rounded-lg border p-2 ${
                  live ? "cursor-grab bg-ui-bg-base" : "opacity-50 bg-ui-bg-disabled"
                }`}
                title={live ? "Drag onto a day" : "Not live — Go Live first"}
              >
                {p.thumbnail ? (
                  <img src={p.thumbnail} alt="" className="w-10 h-10 rounded object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded bg-ui-bg-component" />
                )}
                <div className="min-w-0 flex-1">
                  <Text size="small" weight="plus" className="truncate">
                    {p.title}
                  </Text>
                  <div className="flex gap-1 items-center">
                    {p.ref && <Text size="xsmall" className="text-ui-fg-subtle">{p.ref}</Text>}
                    {!live && <Badge size="2xsmall" color="orange">draft</Badge>}
                    {p.scheduled_date && (
                      <Badge size="2xsmall" color="green">{p.scheduled_date.slice(5)}</Badge>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Calendar */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Button variant="secondary" size="small" onClick={prevMonth}>‹</Button>
            <Heading level="h3">{monthLabel}</Heading>
            <Button variant="secondary" size="small" onClick={nextMonth}>›</Button>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <Text key={d} size="xsmall" className="text-ui-fg-subtle text-center">{d}</Text>
            ))}
            {cells.map((day, idx) => {
              if (day === null) return <div key={`e${idx}`} />
              const date = ymd(year, month, day)
              const row = rowsByDate[date]
              const isPast = date < todayStr
              const isPosted = row?.status === "posted"
              const name = row?.product_snapshot?.name ?? row?.product_id ?? ""
              return (
                <div
                  key={date}
                  onDragOver={(e) => !isPast && !isPosted && e.preventDefault()}
                  onDrop={!isPast && !isPosted ? onDropDay(date) : undefined}
                  className={`min-h-[84px] rounded-lg border p-1 flex flex-col ${
                    isPast ? "bg-ui-bg-disabled opacity-60" : "bg-ui-bg-subtle"
                  } ${date === todayStr ? "border-ui-fg-interactive" : ""}`}
                >
                  <Text size="xsmall" className="text-ui-fg-subtle">{day}</Text>
                  {row ? (
                    <div className="mt-1 flex-1 rounded bg-ui-bg-base p-1">
                      <Text size="xsmall" weight="plus" className="truncate">{name}</Text>
                      <Badge size="2xsmall" color={isPosted ? "green" : "blue"}>
                        {row.status}
                      </Badge>
                      {!isPosted && !isPast && (
                        <Button
                          variant="transparent"
                          size="small"
                          onClick={() => void unplan(date)}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  ) : (
                    !isPast && (
                      <Text size="xsmall" className="text-ui-fg-muted mt-auto">auto</Text>
                    )
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Feed Planner",
  icon: CalendarSolid,
})

export default FeedPlannerPage
