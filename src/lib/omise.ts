import { serverEnv } from "@/lib/server-config";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError, cents } from "./domain";
import type { Purchase } from "./types";

const chargeSchema = z.object({
  object: z.literal("charge"),
  id: z.string().regex(/^chrg_(?:test_)?[a-z0-9]+$/),
  amount: z.number().int(),
  currency: z.string(),
  livemode: z.boolean(),
  status: z.enum(["pending", "successful", "failed", "expired", "reversed"]),
  paid: z.boolean(),
  expires_at: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()),
  source: z.object({
    type: z.literal("promptpay"),
    scannable_code: z.object({
      image: z.object({ download_uri: z.string() }).nullable().optional(),
    }).nullable().optional(),
  }),
});
export type OmiseCharge = z.infer<typeof chargeSchema>;
export function gatewayConfig() {
  const mode: "test" | "live" = serverEnv("PAYMENT_MODE") === "test" ? "test" : "live";
  const key = serverEnv("OMISE_SECRET_KEY") || "";
  const secret = serverEnv("OMISE_WEBHOOK_SECRET") || "";
  let webhookUrl = "";
  try {
    const url = new URL(serverEnv("PAYMENT_WEBHOOK_URL") || "");
    if (url.protocol === "https:" && !url.username && !url.password &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      url.pathname === "/api/payments/omise/webhook" && !url.search && !url.hash)
      webhookUrl = url.href;
  } catch {}
  const keyConfigured = key.startsWith(`skey_${mode}_`) && key.length > 15;
  const webhookSecretConfigured = /^[A-Za-z0-9+/]+={0,2}$/.test(secret) && Buffer.from(secret, "base64").length >= 16;
  const testStorageAllowed = mode === "live" || serverEnv("DATA_BACKEND") === "demo";
  return {
    provider: "omise" as const, mode, keyConfigured, webhookSecretConfigured,
    webhookUrl, reconciliationConfigured: Boolean(serverEnv("CRON_SECRET") && serverEnv("CRON_SECRET").length >= 24),
    ready: keyConfigured && webhookSecretConfigured && testStorageAllowed && (mode === "test" || Boolean(webhookUrl)),
    testStorageAllowed,
  };
}
export class OmiseError extends AppError {
  constructor(public definitive = false) {
    super("เชื่อมต่อผู้ให้บริการชำระเงินไม่สำเร็จ ระบบจะตรวจสถานะอีกครั้ง กรุณาอย่าชำระซ้ำ", 503);
  }
}
async function call(path: string, method = "GET", form?: URLSearchParams): Promise<unknown> {
  const config = gatewayConfig();
  if (!config.keyConfigured || !config.testStorageAllowed)
    throw new AppError("ยังไม่ได้ตั้งค่าบัญชี Omise สำหรับระบบนี้", 503);
  let response: Response;
  try {
    response = await fetch(`https://api.omise.co${path}`, {
      method, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${serverEnv("OMISE_SECRET_KEY")}:`).toString("base64")}`,
        "Omise-Version": "2019-05-29",
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(form ? { body: form.toString() } : {}),
    });
  } catch { throw new OmiseError(); }
  // Never return provider bodies: they may contain account details.
  if (!response.ok) throw new OmiseError([400, 401, 402, 403, 404, 422].includes(response.status));
  try { return await response.json(); } catch { throw new OmiseError(); }
}
export function parseCharge(data: unknown): OmiseCharge {
  const result = chargeSchema.safeParse(data);
  if (!result.success) throw new OmiseError();
  return result.data;
}
export async function createCharge(order: Purchase) {
  const form = new URLSearchParams({
    amount: String(cents(order.total)), currency: "thb", "source[type]": "promptpay",
    description: `DSKRU order ${order.id}`,
    "metadata[order_id]": order.id, "metadata[payment_reference]": order.gateway!.reference,
    expires_at: order.gateway!.expiresAt,
  });
  const webhook = gatewayConfig().webhookUrl;
  if (webhook) form.set("webhook_endpoints[]", webhook);
  return parseCharge(await call("/charges", "POST", form));
}
export async function retrieveCharge(id: string) {
  if (!/^chrg_(?:test_)?[a-z0-9]+$/.test(id)) throw new AppError("รหัสการชำระเงินไม่ถูกต้อง", 400);
  return parseCharge(await call(`/charges/${id}`));
}
// A timed-out POST has an unknown outcome. Recover its original charge using
// server-generated metadata; never repeat POST /charges for the same order.
export async function findCharge(order: Purchase) {
  const params = new URLSearchParams({
    from: new Date(new Date(order.timestamp).getTime() - 60_000).toISOString(),
    to: new Date(new Date(order.gateway!.expiresAt).getTime() + 60_000).toISOString(),
    limit: "100", order: "chronological",
  });
  for (let offset = 0; offset < 1000; offset += 100) {
    params.set("offset", String(offset));
    const page = z.object({ data: z.array(z.record(z.string(), z.unknown())), total: z.number().int() }).safeParse(await call(`/charges?${params}`));
    if (!page.success) throw new OmiseError();
    const match = page.data.data.find((entry) => {
      const metadata = entry.metadata as Record<string, unknown> | undefined;
      return metadata?.order_id === order.id && metadata?.payment_reference === order.gateway!.reference;
    });
    if (match) return retrieveCharge(String(match.id));
    if (offset + page.data.data.length >= page.data.total) return null;
    if (!page.data.data.length) throw new OmiseError();
  }
  throw new OmiseError();
}
export function assertChargeMatches(order: Purchase, charge: OmiseCharge) {
  const payment = order.gateway;
  if (!payment || (payment.chargeId && payment.chargeId !== charge.id) ||
    charge.metadata.order_id !== order.id || charge.metadata.payment_reference !== payment.reference ||
    charge.amount !== cents(order.total) || charge.currency.toLowerCase() !== "thb" ||
    charge.livemode !== (payment.mode === "live") || payment.mode !== gatewayConfig().mode ||
    charge.source.type !== "promptpay")
    throw new AppError("ข้อมูลการชำระเงินไม่ตรงกับรายการ ระบบยังไม่ออกใบเสร็จ", 409);
}
export function qrImage(charge: OmiseCharge) {
  const uri = charge.source.scannable_code?.image?.download_uri;
  if (!uri) return undefined;
  try {
    const url = new URL(uri);
    if (url.protocol === "https:" && url.hostname === "api.omise.co" &&
      !url.username && !url.password && url.pathname.startsWith(`/charges/${charge.id}/documents/`)) return url.href;
  } catch {}
  throw new AppError("ผู้ให้บริการส่ง QR ที่ไม่ถูกต้อง", 502);
}
export function verifyWebhook(raw: string, headers: Headers) {
  const secret = serverEnv("OMISE_WEBHOOK_SECRET");
  if (!secret || !gatewayConfig().webhookSecretConfigured) throw new AppError("ยังไม่ได้ตั้งค่า webhook", 503);
  const timestamp = headers.get("omise-signature-timestamp") || "";
  const signatures = (headers.get("omise-signature") || "").split(",");
  if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300)
    throw new AppError("Webhook signature ไม่ถูกต้อง", 401);
  const expected = createHmac("sha256", Buffer.from(secret, "base64")).update(`${timestamp}.${raw}`).digest();
  if (!signatures.some((value) => /^[a-f0-9]{64}$/i.test(value.trim()) && timingSafeEqual(Buffer.from(value.trim(), "hex"), expected)))
    throw new AppError("Webhook signature ไม่ถูกต้อง", 401);
}
