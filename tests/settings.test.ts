import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { NextRequest } from "next/server";
import { GET, POST } from "../src/app/api/[...path]/route";
import { mutate, readState } from "../src/lib/store";
import { serverEnv } from "../src/lib/server-config";
import { mockOmise } from "./helpers/omise";

test("web configuration permissions, persistence, checkout rules and restart boundaries", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dskru-settings-test-"));
  process.env.DATA_BACKEND = "demo";
  process.env.DEMO_DATA_PATH = path.join(directory, "demo.json");
  process.env.SYSTEM_CONFIG_PATH = path.join(directory, "server-config.json");
  delete process.env.CRON_SECRET;
  const gateway = mockOmise(t);
  const password = "configuration-test-password-2026";
  async function request(route: string, body?: unknown, cookie = "", headers: Record<string, string> = {}) {
    const method = body === undefined ? "GET" : "POST";
    return (method === "GET" ? GET : POST)(new NextRequest(`http://localhost:3000/api/${route}`, {
      method, headers: { "content-type": "application/json", cookie, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), { params: Promise.resolve({ path: route.split("/") }) });
  }
  const setup = await request("admin/setup", { username: "settings.admin", displayName: "Test admin", password });
  assert.equal(setup.status, 201);
  const cookie = setup.headers.get("set-cookie")!.split(";")[0];
  let shop = await (await request("settings/shop", undefined, cookie)).json();
  let server = await (await request("settings/server", undefined, cookie)).json();
  const saveServer = (changes: Record<string, string>, revision = server.revision, currentPassword = password) => request("settings/server", { changes, revision, currentPassword }, cookie);

  await t.test("only administrators can read and write configuration; CSRF and passwords are enforced", async () => {
    for (const route of ["settings/shop", "settings/server"]) assert.equal((await request(route)).status, 401);
    for (const role of ["cashier", "stock"]) {
      await request("admin/users/save", { username: `settings.${role}`, displayName: role, password, role, active: true }, cookie);
      const login = await request("admin/login", { username: `settings.${role}`, password });
      const staffCookie = login.headers.get("set-cookie")!.split(";")[0];
      for (const route of ["settings/shop", "settings/server"]) {
        assert.equal((await request(route, undefined, staffCookie)).status, 403);
        assert.equal((await request(route, {}, staffCookie)).status, 403);
      }
    }
    assert.equal((await request("settings/server", { revision: server.revision, changes: {}, currentPassword: password }, cookie, { origin: "https://other.example" })).status, 403);
    assert.equal((await saveServer({ CRON_SECRET: "x".repeat(24) }, server.revision, "wrong-password")).status, 400);
    assert.equal((await saveServer({ CRON_SECRET: "x".repeat(24) })).status, 409, "infrastructure changes require a closed shop");
  });
  await t.test("shop settings are durable, public fields are applied and stale editors cannot overwrite them", async () => {
    assert.equal(shop.config.studentIdMode, "optional");
    const change = { ...shop, config: { ...shop.config, storeName: "ร้านทดสอบ", schoolName: "โรงเรียนทดสอบ", studentIdMode: "required", studentIdLength: 5, maxItemQuantity: 2, idleMinutes: 10, receiptSeconds: 30 } };
    const response = await request("settings/shop", change, cookie);
    assert.equal(response.status, 200);
    shop = await response.json();
    assert.equal((await request("settings/shop", change, cookie)).status, 409);
    const publicData = await (await request("items")).json();
    assert.equal(publicData.config.shop.storeName, "ร้านทดสอบ");
    assert.equal(publicData.config.shop.studentIdLength, 5);
    assert.equal(JSON.parse(await readFile(process.env.DEMO_DATA_PATH!, "utf8")).settings.shop.idleMinutes, 10);
    for (const invalid of [{ idleMinutes: 0 }, { maximumOrder: 19 }, { minimumOrder: 100, maximumOrder: 30 }, { storeName: "" }, { studentIdLength: 31 }])
      assert.equal((await request("settings/shop", { ...shop, config: { ...shop.config, ...invalid } }, cookie)).status, 400);
  });
  await t.test("student ID and quantity settings are enforced by the server and existing retries still work", async () => {
    await mutate((state) => { state.settings.promptpay = { enabled: true, recipientId: "", recipientName: "Test shop", revision: 1 }; });
    const purchase = { items: [{ id: "milk", qty: 2 }], paymentMethod: "promptpay", studentId: "00123", requestId: randomUUID() };
    for (const studentId of [undefined, "0012", "abcde"])
      assert.equal((await request("purchase", { ...purchase, studentId })).status, 400);
    assert.equal((await request("purchase", { ...purchase, items: [{ id: "milk", qty: 3 }] })).status, 400);
    const response = await request("purchase", purchase);
    assert.equal(response.status, 201);
    const order = await response.json();
    assert.equal(order.studentId, "00123");
    assert.equal(gateway.creates, 1);
    const changed = await request("settings/shop", { ...shop, config: { ...shop.config, studentIdMode: "hidden" } }, cookie);
    shop = await changed.json();
    assert.equal((await request("purchase", purchase)).status, 201, "a changed rule must not break an existing checkout retry");
    assert.equal((await request("purchase", { ...purchase, requestId: randomUUID() })).status, 400, "hidden student IDs must not be stored by stale clients");
    await request("settings", { dailyTarget: 500, storeOpen: false }, cookie);
    assert.equal((await saveServer({ CRON_SECRET: "x".repeat(24) })).status, 409, "pending payments must finish before changing connection keys");
    await mutate((state) => { for (const pending of state.transactions) pending.status = "cancelled"; });
  });
  await t.test("connection validation rejects arbitrary keys, bad Firebase credentials and mismatched payment modes", async () => {
    for (const changes of [
      { NODE_OPTIONS: "arbitrary code" }, { DATA_BACKEND: "unknown" }, { CRON_SECRET: "short" },
      { DEMO_DATA_PATH: "relative.json" }, { DEMO_DATA_PATH: process.env.SYSTEM_CONFIG_PATH! },
      { DATA_BACKEND: "firestore", PAYMENT_MODE: "live", FIREBASE_PROJECT_ID: "valid-project", FIREBASE_CLIENT_EMAIL: "admin@valid-project.iam.gserviceaccount.com", FIREBASE_PRIVATE_KEY: "not-a-private-key" },
      { PAYMENT_MODE: "live" }, { PAYMENT_WEBHOOK_URL: "http://localhost/api/payments/omise/webhook" },
    ] as Record<string, string>[]) assert.equal((await saveServer(changes)).status, 400);
  });
  await t.test("saved keys are redacted, take effect only after restart and can be discarded", async () => {
    const secret = "test-only-cron-secret-abcdefghijklmnopqrstuvwxyz";
    const response = await saveServer({ CRON_SECRET: secret });
    assert.equal(response.status, 200);
    server = await response.json();
    assert.equal(server.pendingRestart, true);
    assert.equal(server.secrets.CRON_SECRET.configured, true);
    assert.equal(server.secrets.CRON_SECRET.active, false);
    assert.ok(!JSON.stringify(server).includes(secret));
    assert.ok(!JSON.stringify(await (await request("items")).json()).includes(secret));
    assert.equal(serverEnv("CRON_SECRET"), "", "the running process keeps its active credentials");
    assert.equal(JSON.parse(await readFile(process.env.SYSTEM_CONFIG_PATH!, "utf8")).values.CRON_SECRET, secret);
    const child = execFileSync(process.execPath, ["--import", "tsx", "-e", "const {serverEnv}=require('./src/lib/server-config.ts'); process.stdout.write(String(serverEnv('CRON_SECRET').length));"], { cwd: process.cwd(), env: process.env, encoding: "utf8" });
    assert.equal(Number(child), secret.length, "a fresh server process loads the saved file");
    assert.equal((await request("settings", { dailyTarget: 500, storeOpen: true }, cookie)).status, 409);
    const restored = await request("settings/server/discard", { revision: server.revision, changes: {}, currentPassword: password }, cookie);
    assert.equal(restored.status, 200);
    server = await restored.json();
    assert.equal(server.pendingRestart, false);
    assert.equal(server.secrets.CRON_SECRET.configured, false);
    assert.equal((await request("settings", { dailyTarget: 500, storeOpen: true }, cookie)).status, 200);
  });
  await t.test("concurrent configuration editors cannot silently replace each other's saved keys", async () => {
    await request("settings", { dailyTarget: 500, storeOpen: false }, cookie);
    const responses = await Promise.all([saveServer({ CRON_SECRET: "a".repeat(24) }), saveServer({ CRON_SECRET: "b".repeat(24) })]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await readState()).settings.storeOpen, false);
  });
});
