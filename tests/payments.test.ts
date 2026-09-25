import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createHmac, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "../src/app/api/[...path]/route";
import { POST as webhook } from "../src/app/api/payments/omise/webhook/route";
import { GET as cron } from "../src/app/api/payments/reconcile/route";
import { mutate, readState } from "../src/lib/store";
import { initialState } from "../src/lib/seed";
import { applyCharge, startCheckout } from "../src/lib/checkout";
import { gatewayConfig } from "../src/lib/omise";
import { mockOmise } from "./helpers/omise";

test("automatic PromptPay payment lifecycle", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dskru-payments-"));
  process.env.SYSTEM_CONFIG_PATH = path.join(directory, "server-config.json");
  process.env.DATA_BACKEND = "demo";
  process.env.DEMO_DATA_PATH = path.join(directory, "isolated.json");
  process.env.CRON_SECRET = "isolated-cron-secret-for-tests-only";
  const provider = mockOmise(t);
  const input = () => ({ items: [{ id: "water", qty: 3 }], paymentMethod: "promptpay" as const, requestId: randomUUID() });
  async function reset() {
    await mutate((state) => {
      Object.assign(state, initialState());
      state.settings.promptpay = { enabled: true, recipientId: "", recipientName: "Test school", revision: 1 };
    });
    provider.charges.clear();
    provider.creates = 0;
    provider.gets = 0;
    provider.offline = provider.loseCreateResponse = provider.rejectCreate = false;
  }
  async function request(route: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
    return (method === "GET" ? GET : method === "DELETE" ? DELETE : POST)(new NextRequest(`http://localhost/api/${route}`, {
      method, headers: { "content-type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
    }), { params: Promise.resolve({ path: route.split("/") }) });
  }
  function event(chargeId: string, changes: Record<string, unknown> = {}, options: { badSignature?: boolean; age?: number; rotation?: boolean } = {}) {
    const raw = JSON.stringify({ object: "event", key: "charge.complete", data: { id: chargeId, status: "successful", paid: true, ...changes } });
    const timestamp = String(Math.floor(Date.now() / 1000) - (options.age || 0));
    const signature = createHmac("sha256", Buffer.from(process.env.OMISE_WEBHOOK_SECRET!, "base64")).update(`${timestamp}.${raw}`).digest("hex");
    return webhook(new Request("https://shop.example/api/payments/omise/webhook", {
      method: "POST", body: raw, headers: {
        "omise-signature-timestamp": timestamp,
        "omise-signature": options.badSignature ? "0".repeat(64) : (options.rotation ? `${"0".repeat(64)}, ` : "") + signature,
      },
    }));
  }
  async function due(id: string) { await mutate((s) => { s.transactions.find((p) => p.id === id)!.gateway!.checkAfter = 0; }); }
  try {
    await t.test("cash, under-minimum orders and missing gateway configuration cannot create orders", async () => {
      await reset();
      assert.equal((await request("purchase", "POST", { ...input(), paymentMethod: "cash" })).status, 400);
      assert.equal((await request("purchase", "POST", { ...input(), items: [{ id: "water", qty: 1 }] })).status, 400);
      const key = process.env.OMISE_SECRET_KEY;
      delete process.env.OMISE_SECRET_KEY;
      assert.equal((await request("purchase", "POST", input())).status, 409);
      assert.equal((await readState()).transactions.length, 0);
      process.env.OMISE_SECRET_KEY = key;
      assert.equal(provider.creates, 0);
    });
    await t.test("concurrent checkout retries create one charge and reserve available stock", async () => {
      await reset();
      await mutate((s) => { s.items[0].stock = 3; });
      const body = input();
      const results = await Promise.all(Array.from({ length: 4 }, () => startCheckout(body)));
      assert.equal(new Set(results.map((p) => p.id)).size, 1);
      assert.equal(provider.creates, 1);
      assert.equal((await readState()).items[0].stock, 3);
      assert.equal((await (await request("items")).json()).items[0].stock, 0);
      assert.equal((await request("purchase", "POST", input())).status, 409);
      const order = results[0];
      const view = await (await request(`purchase/${order.id}`, "GET", undefined, { "x-order-token": order.accessToken })).json();
      assert.equal(view.gateway, undefined);
      assert.equal(view.accessToken, undefined);
      assert.equal(view.requestId, undefined);
      assert.equal((await request(`purchase/${order.id}`, "DELETE", undefined, { "x-order-token": order.accessToken })).status, 409);
    });
    await t.test("bad signatures and replayed timestamps are rejected; signed bodies cannot claim payment", async () => {
      await reset();
      const order = await startCheckout(input());
      const id = order.gateway!.chargeId!;
      assert.equal((await event(id, {}, { badSignature: true })).status, 401);
      assert.equal((await event(id, {}, { age: 600 })).status, 401);
      assert.equal(provider.gets, 0);
      assert.equal((await event(id, { amount: 1 }, { rotation: true })).status, 200);
      assert.equal((await readState()).transactions[0].status, "pending");
      assert.equal((await readState()).settings.cooperativeBalance, 0);
    });
    await t.test("amount, currency, mode, reference and charge ID mismatches never fulfill", async () => {
      await reset();
      const order = await startCheckout(input());
      const charge = provider.charges.get(order.gateway!.chargeId!)!;
      const good = { ...structuredClone(charge), status: "successful" as const, paid: true };
      for (const bad of [
        { ...good, amount: 1 }, { ...good, currency: "usd" }, { ...good, livemode: true },
        { ...good, metadata: { ...good.metadata, payment_reference: "forged" } },
        { ...good, id: "chrg_test_unrelated" },
      ]) {
        const state = await readState();
        assert.throws(() => applyCharge(state, order.id, bad));
        assert.equal(state.transactions[0].status, "pending");
        assert.equal(state.settings.cooperativeBalance, 0);
      }
      provider.charges.set(charge.id, { ...good, amount: 1 });
      assert.equal((await event(charge.id)).status, 409);
      assert.equal((await readState()).items[0].stock, 48);
    });
    await t.test("duplicate concurrent webhooks complete and credit a sale only once", async () => {
      await reset();
      const order = await startCheckout(input());
      const charge = provider.charges.get(order.gateway!.chargeId!)!;
      charge.status = "successful";
      charge.paid = true;
      const replies = await Promise.all(Array.from({ length: 6 }, () => event(charge.id)));
      assert.ok(replies.every((r) => r.status === 200));
      const state = await readState();
      assert.equal(state.transactions[0].status, "completed");
      assert.equal(state.transactions[0].confirmedBy, "omise");
      assert.equal(state.items[0].stock, 45);
      assert.equal(state.settings.cooperativeBalance, 21);
      assert.equal(state.transactions[0].gateway?.qrImageUrl, undefined);
    });
    await t.test("failed or expired provider states release reservations without sales revenue", async () => {
      for (const status of ["failed", "expired"] as const) {
        await reset();
        const order = await startCheckout(input());
        const charge = provider.charges.get(order.gateway!.chargeId!)!;
        charge.status = status;
        assert.equal((await event(charge.id)).status, 200);
        const state = await readState();
        assert.equal(state.transactions[0].status, "cancelled");
        assert.equal(state.items[0].stock, 48);
        assert.equal(state.settings.cooperativeBalance, 0);
        assert.equal((await (await request("items")).json()).items[0].stock, 48);
      }
    });
    await t.test("lost create response is recovered without generating a second charge", async () => {
      await reset();
      provider.loseCreateResponse = true;
      const body = input();
      const order = await startCheckout(body);
      assert.equal(order.gateway!.status, "creating");
      await due(order.id);
      const recovered = await startCheckout(body);
      assert.equal(recovered.gateway!.chargeId, [...provider.charges.keys()][0]);
      assert.equal(recovered.gateway!.status, "pending");
      assert.equal(provider.creates, 1);
    });
    await t.test("creation rejection releases stock; API outages never imply successful payment", async () => {
      await reset();
      provider.rejectCreate = true;
      assert.equal((await startCheckout(input())).status, "cancelled");
      assert.equal((await (await request("items")).json()).items[0].stock, 48);
      provider.rejectCreate = false;
      const order = await startCheckout(input());
      provider.offline = true;
      await due(order.id);
      const view = await (await request(`purchase/${order.id}`, "GET", undefined, { "x-order-token": order.accessToken })).json();
      assert.equal(view.status, "pending");
      assert.match(view.payment.error, /เชื่อมต่อ/);
      assert.equal((await readState()).settings.cooperativeBalance, 0);
    });
    await t.test("a late successful correction is recorded without consuming another customer's reservation", async () => {
      await reset();
      await mutate((s) => { s.items[0].stock = 3; });
      const first = await startCheckout(input());
      const firstCharge = provider.charges.get(first.gateway!.chargeId!)!;
      firstCharge.status = "expired";
      await event(firstCharge.id);
      await startCheckout(input());
      firstCharge.status = "successful";
      firstCharge.paid = true;
      await event(firstCharge.id);
      let state = await readState();
      const firstAfter = state.transactions.find((p) => p.id === first.id)!;
      assert.equal(firstAfter.status, "pending");
      assert.equal(firstAfter.gateway!.status, "successful");
      assert.match(firstAfter.gateway!.error!, /ได้รับเงินแล้ว/);
      assert.equal(state.settings.cooperativeBalance, 0);
      assert.equal(state.items[0].stock, 3);
      await mutate((s) => { s.items[0].stock = 6; });
      await event(firstCharge.id);
      state = await readState();
      assert.equal(state.transactions.find((p) => p.id === first.id)!.status, "completed");
      assert.equal(state.items[0].stock, 3);
      assert.equal(state.settings.cooperativeBalance, 21);
    });
    await t.test("scheduled reconciliation recovers a paid order without a kiosk or webhook", async () => {
      await reset();
      const order = await startCheckout(input());
      const charge = provider.charges.get(order.gateway!.chargeId!)!;
      charge.status = "successful";
      charge.paid = true;
      await due(order.id);
      assert.equal((await cron(new Request("https://shop.example/api/payments/reconcile"))).status, 401);
      const result = await cron(new Request("https://shop.example/api/payments/reconcile", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), { checked: 1, failed: 0 });
      assert.equal((await readState()).transactions[0].status, "completed");
    });
    await t.test("test keys cannot enable real Firestore sales; live requires public webhook configuration", () => {
      process.env.DATA_BACKEND = "firestore";
      assert.equal(gatewayConfig().ready, false);
      process.env.PAYMENT_MODE = "live";
      process.env.OMISE_SECRET_KEY = "skey_live_mock_test_only";
      assert.equal(gatewayConfig().ready, false);
      process.env.PAYMENT_WEBHOOK_URL = "https://shop.example/api/payments/omise/webhook";
      assert.equal(gatewayConfig().ready, true);
      process.env.SYSTEM_CONFIG_PATH = path.join(directory, "server-config.json");
  process.env.DATA_BACKEND = "demo";
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
