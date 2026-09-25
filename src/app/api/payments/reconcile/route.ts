import { serverEnv } from "@/lib/server-config";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { reconcilePurchase } from "@/lib/checkout";
import { readState } from "@/lib/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
// Run every minute from the deployment's scheduler. This survives closed kiosks
// and missing webhooks; no per-process timer or browser session is required.
export async function GET(request: Request) {
  const secret = serverEnv("CRON_SECRET") || "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.get("authorization") || "");
  if (secret.length < 24 || expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const orders = (await readState()).transactions
      .filter((p) => p.status === "pending" && p.gateway && p.gateway.checkAfter <= Date.now())
      .sort((a, b) => a.gateway!.checkAfter - b.gateway!.checkAfter).slice(0, 10);
    const results = await Promise.allSettled(orders.map((p) => reconcilePurchase(p.id)));
    const failed = results.filter((r) => r.status === "rejected" || Boolean(r.value.gateway?.error)).length;
    return NextResponse.json({ checked: results.length, failed }, { status: failed ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Reconciliation failed" }, { status: 503 });
  }
}
