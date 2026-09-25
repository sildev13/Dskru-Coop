import type { Settings, PromptPayConfig } from "./types";
import { gatewayConfig } from "./omise";
export function validRecipient(id: string) {
  return /^(0\d{9}|\d{13})$/.test(id);
}
export function paymentConfig(settings: Settings): PromptPayConfig {
  if (settings.promptpay) return settings.promptpay;
  const recipientId = process.env.PROMPTPAY_ID || "";
  const recipientName = process.env.PROMPTPAY_NAME || "";
  return {
    enabled: validRecipient(recipientId) && Boolean(recipientName.trim()),
    recipientId,
    recipientName,
    revision: 0,
  };
}
export function paymentAvailable(config: PromptPayConfig) {
  return (
    config.enabled &&
    gatewayConfig().ready &&
    Boolean(config.recipientName.trim())
  );
}
