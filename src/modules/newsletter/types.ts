export type NewsletterList = "main" | "after_dark"
export const NEWSLETTER_LISTS: NewsletterList[] = ["main", "after_dark"]

export type SubscriberSource =
  | "footer"
  | "after_dark_pdp"
  | "checkout"
  | "import"
  | "admin"
export type SubscriberStatus = "subscribed" | "unsubscribed"
export type CampaignStatus = "draft" | "sending" | "sent" | "failed"

export type SubscriberDTO = {
  id: string
  email: string
  list: NewsletterList
  source: SubscriberSource
  status: SubscriberStatus
  subscribed_at: Date
  unsubscribed_at: Date | null
  resend_contact_id: string | null
  resend_synced_at: Date | null
  resend_sync_error: string | null
  created_at: Date
  updated_at: Date
}

export type CampaignDTO = {
  id: string
  list: NewsletterList
  subject: string
  preheader: string | null
  intro_text: string | null
  banner_url: string | null
  product_ids: string[]
  status: CampaignStatus
  resend_broadcast_id: string | null
  recipient_count: number | null
  sent_at: Date | null
  sent_by: string | null
  error: string | null
  created_at: Date
  updated_at: Date
}
