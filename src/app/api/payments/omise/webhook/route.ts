import { NextResponse } from "next/server";
import { z } from "zod";
import { applyCharge } from "@/lib/checkout";
import { AppError } from "@/lib/domain";
import { retrieveCharge, verifyWebhook } from "@/lib/omise";
import { mutate, readState } from "@/lib/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 100_000) throw new AppError("Payload too large", 413);
    verifyWebhook(raw, request.headers);
    const event = z.object({
      object: z.literal("event"), key: z.string(),
      data: z.object({ id: z.string() }).passthrough(),
    }).parse(JSON.parse(raw));
    if (!["charge.create", "charge.complete", "charge.update", "charge.expire"].includes(event.key))
      return NextResponse.json({ received: true });
    // Never complete from the webhook's claimed status, amount or metadata.
    const charge = await retrieveCharge(event.data.id);
    const state = await readState();
    const order = state.transactions.find((p) => p.gateway?.chargeId === charge.id || p.id === charge.metadata.order_id);
    if (order?.gateway) await mutate((current) => applyCharge(current, order.id, charge));
    return NextResponse.json({ received: true });
  } catch (error) {
    const status = error instanceof AppError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500;
    return NextResponse.json({ error: "Webhook was not processed" }, { status });
  }
}
