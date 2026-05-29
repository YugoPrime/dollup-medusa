// Payment destination info for Juice / Bank Transfer. Mirrors the storefront's
// src/lib/payment-info.ts so deposit emails can show the bank details. If these
// change, update BOTH this file and the storefront copy.
export const PAYMENT_INFO = {
  account_name: "Doll Up Boutique Limited",
  bank: "MCB",
  account_number: "000446948071",
  whatsapp: "+230 5941 6359",
  // Digits-only form for the wa.me deep link.
  whatsapp_digits: "23059416359",
} as const
