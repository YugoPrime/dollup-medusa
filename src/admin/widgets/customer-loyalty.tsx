import { defineWidgetConfig } from "@medusajs/admin-sdk"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Prompt,
  Table,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useEffect, useState } from "react"

type LoyaltyAccount = {
  id: string
  customer_id: string
  points_balance: number
  lifetime_earned: number
  lifetime_redeemed: number
}

type LoyaltyTxn = {
  id: string
  type: "earn" | "redeem" | "adjustment" | "expire"
  points: number
  reason: string
  order_id: string | null
  created_at: string
}

type LoyaltyResponse = {
  loyalty: LoyaltyAccount
  transactions: LoyaltyTxn[]
  transactions_count: number
}

type LoyaltySettings = {
  earn_rate_per_100_mur: number
  redeem_rate_mur_per_100_pts: number
  min_redeem_points: number
  welcome_bonus_points: number
  points_expiry_months: number | null
}

type LoyaltySettingsResponse = {
  settings: LoyaltySettings
}

type WidgetProps = {
  data: { id: string }
}

const fetcher = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(body || `Request failed with ${res.status}`)
  }
  return res.json()
}

const txnTypeColor: Record<LoyaltyTxn["type"], "green" | "orange" | "blue" | "red"> = {
  earn: "green",
  redeem: "blue",
  adjustment: "orange",
  expire: "red",
}

const CustomerLoyaltyWidget = ({ data: customer }: WidgetProps) => {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resp, setResp] = useState<LoyaltyResponse | null>(null)
  const [settings, setSettings] = useState<LoyaltySettings | null>(null)
  const [settingsForm, setSettingsForm] = useState<Record<keyof LoyaltySettings, string>>({
    earn_rate_per_100_mur: "",
    redeem_rate_mur_per_100_pts: "",
    min_redeem_points: "",
    welcome_bonus_points: "",
    points_expiry_months: "",
  })
  const [settingsSaving, setSettingsSaving] = useState(false)

  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustDelta, setAdjustDelta] = useState("")
  const [adjustReason, setAdjustReason] = useState("")
  const [adjustSubmitting, setAdjustSubmitting] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [json, settingsJson] = (await Promise.all([
        fetcher(`/admin/loyalty/accounts/${customer.id}`),
        fetcher("/admin/loyalty/settings"),
      ])) as [LoyaltyResponse, LoyaltySettingsResponse]
      setResp(json)
      setSettings(settingsJson.settings)
      setSettingsForm(toSettingsForm(settingsJson.settings))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const submitSettings = async () => {
    setSettingsSaving(true)
    try {
      const payload = {
        earn_rate_per_100_mur: Number(settingsForm.earn_rate_per_100_mur),
        redeem_rate_mur_per_100_pts: Number(
          settingsForm.redeem_rate_mur_per_100_pts,
        ),
        min_redeem_points: Number(settingsForm.min_redeem_points),
        welcome_bonus_points: Number(settingsForm.welcome_bonus_points),
        points_expiry_months: settingsForm.points_expiry_months.trim()
          ? Number(settingsForm.points_expiry_months)
          : null,
      }
      const json = (await fetcher("/admin/loyalty/settings", {
        method: "POST",
        body: JSON.stringify(payload),
      })) as LoyaltySettingsResponse
      setSettings(json.settings)
      setSettingsForm(toSettingsForm(json.settings))
      toast.success("Loyalty settings saved")
    } catch (e) {
      toast.error((e as Error).message || "Failed to save settings")
    } finally {
      setSettingsSaving(false)
    }
  }

  useEffect(() => {
    if (customer?.id) {
      void load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id])

  const submitAdjust = async () => {
    const delta = Number(adjustDelta)
    if (!Number.isFinite(delta) || delta === 0) {
      toast.error("Delta must be a non-zero number")
      return
    }
    if (!adjustReason.trim()) {
      toast.error("Reason is required")
      return
    }
    setAdjustSubmitting(true)
    try {
      await fetcher(`/admin/loyalty/accounts/${customer.id}/adjust`, {
        method: "POST",
        body: JSON.stringify({ delta, reason: adjustReason.trim() }),
      })
      toast.success("Points adjusted")
      setAdjustOpen(false)
      setAdjustDelta("")
      setAdjustReason("")
      await load()
    } catch (e) {
      toast.error((e as Error).message || "Failed to adjust points")
    } finally {
      setAdjustSubmitting(false)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Doll Rewards</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Loyalty points for this customer
          </Text>
        </div>
        <Button
          size="small"
          variant="secondary"
          onClick={() => setAdjustOpen(true)}
          disabled={loading}
        >
          Adjust points
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4 px-6 py-4">
        <Stat label="Balance" value={resp?.loyalty.points_balance} loading={loading} />
        <Stat label="Lifetime earned" value={resp?.loyalty.lifetime_earned} loading={loading} />
        <Stat label="Lifetime redeemed" value={resp?.loyalty.lifetime_redeemed} loading={loading} />
      </div>

      <div className="px-6 py-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <Heading level="h3">Program settings</Heading>
          <Button
            size="small"
            variant="secondary"
            onClick={() => void submitSettings()}
            disabled={loading || settingsSaving || !settings}
          >
            {settingsSaving ? "Saving..." : "Save settings"}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <SettingsField
            id="earn-rate"
            label="Earn per Rs 100"
            value={settingsForm.earn_rate_per_100_mur}
            onChange={(value) =>
              setSettingsForm((prev) => ({
                ...prev,
                earn_rate_per_100_mur: value,
              }))
            }
          />
          <SettingsField
            id="redeem-rate"
            label="Rs per 100 points"
            value={settingsForm.redeem_rate_mur_per_100_pts}
            onChange={(value) =>
              setSettingsForm((prev) => ({
                ...prev,
                redeem_rate_mur_per_100_pts: value,
              }))
            }
          />
          <SettingsField
            id="min-redeem"
            label="Min redeem points"
            value={settingsForm.min_redeem_points}
            onChange={(value) =>
              setSettingsForm((prev) => ({
                ...prev,
                min_redeem_points: value,
              }))
            }
          />
          <SettingsField
            id="welcome-bonus"
            label="Welcome bonus"
            value={settingsForm.welcome_bonus_points}
            onChange={(value) =>
              setSettingsForm((prev) => ({
                ...prev,
                welcome_bonus_points: value,
              }))
            }
          />
          <SettingsField
            id="points-expiry"
            label="Expiry months"
            value={settingsForm.points_expiry_months}
            placeholder="No expiry"
            onChange={(value) =>
              setSettingsForm((prev) => ({
                ...prev,
                points_expiry_months: value,
              }))
            }
          />
        </div>
      </div>

      <div className="px-6 py-4">
        <Heading level="h3" className="mb-2">
          Recent activity
        </Heading>
        {error ? (
          <Text className="text-ui-fg-error">Failed to load: {error}</Text>
        ) : loading ? (
          <Text className="text-ui-fg-subtle">Loading…</Text>
        ) : !resp || resp.transactions.length === 0 ? (
          <Text className="text-ui-fg-subtle">No transactions yet.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Type</Table.HeaderCell>
                <Table.HeaderCell>Points</Table.HeaderCell>
                <Table.HeaderCell>Reason</Table.HeaderCell>
                <Table.HeaderCell>Order</Table.HeaderCell>
                <Table.HeaderCell>When</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {resp.transactions.map((t) => (
                <Table.Row key={t.id}>
                  <Table.Cell>
                    <Badge color={txnTypeColor[t.type]} size="2xsmall">
                      {t.type}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>{t.points}</Table.Cell>
                  <Table.Cell>{t.reason}</Table.Cell>
                  <Table.Cell>{t.order_id ?? "—"}</Table.Cell>
                  <Table.Cell>
                    {new Date(t.created_at).toLocaleString()}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>

      <Prompt open={adjustOpen} onOpenChange={setAdjustOpen}>
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>Adjust points</Prompt.Title>
            <Prompt.Description>
              Positive values credit the account, negative values debit it.
              Adjustments are recorded in the ledger with the admin actor.
            </Prompt.Description>
          </Prompt.Header>
          <div className="flex flex-col gap-3 px-6 py-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="loyalty-delta">Delta</Label>
              <Input
                id="loyalty-delta"
                type="number"
                placeholder="e.g. 100 or -50"
                value={adjustDelta}
                onChange={(e) => setAdjustDelta(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="loyalty-reason">Reason</Label>
              <Textarea
                id="loyalty-reason"
                placeholder="Visible in the ledger; written in plain language."
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
              />
            </div>
          </div>
          <Prompt.Footer>
            <Prompt.Cancel>Cancel</Prompt.Cancel>
            <Prompt.Action
              onClick={(e) => {
                e.preventDefault()
                void submitAdjust()
              }}
              disabled={adjustSubmitting}
            >
              {adjustSubmitting ? "Saving…" : "Save adjustment"}
            </Prompt.Action>
          </Prompt.Footer>
        </Prompt.Content>
      </Prompt>
    </Container>
  )
}

const Stat = ({
  label,
  value,
  loading,
}: {
  label: string
  value: number | undefined
  loading: boolean
}) => (
  <div>
    <Text size="small" className="text-ui-fg-subtle">
      {label}
    </Text>
    <Heading level="h2" className="mt-1">
      {loading || value === undefined ? "—" : value.toLocaleString()}
    </Heading>
  </div>
)

const SettingsField = ({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) => (
  <div className="flex flex-col gap-1">
    <Label htmlFor={`loyalty-${id}`}>{label}</Label>
    <Input
      id={`loyalty-${id}`}
      type="number"
      min="0"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
)

function toSettingsForm(settings: LoyaltySettings) {
  return {
    earn_rate_per_100_mur: String(settings.earn_rate_per_100_mur),
    redeem_rate_mur_per_100_pts: String(settings.redeem_rate_mur_per_100_pts),
    min_redeem_points: String(settings.min_redeem_points),
    welcome_bonus_points: String(settings.welcome_bonus_points),
    points_expiry_months:
      settings.points_expiry_months === null
        ? ""
        : String(settings.points_expiry_months),
  }
}

export const config = defineWidgetConfig({
  zone: "customer.details.after",
})

export default CustomerLoyaltyWidget
