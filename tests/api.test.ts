import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "../src/app/api/[...path]/route";
import { mutate, readState } from "../src/lib/store";
import { mockOmise } from "./helpers/omise";
test("API security, checkout, concurrency and durable demo storage", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dskru-test-"));
  process.env.SYSTEM_CONFIG_PATH = path.join(directory, "server-config.json");
  process.env.DATA_BACKEND = "demo";
  process.env.DEMO_DATA_PATH = path.join(directory, "demo.json");
  process.env.ADMIN_PIN = "test-pin-123456";
  process.env.SESSION_SECRET =
    "test-secret-with-at-least-thirty-two-characters";
  delete process.env.PROMPTPAY_ID;
  const gateway = mockOmise(t);
  async function request(
    route: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const req = new NextRequest(`http://localhost:3000/api/${route}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const handler =
      method === "GET" ? GET : method === "DELETE" ? DELETE : POST;
    return handler(req, {
      params: Promise.resolve({ path: route.split("/") }),
    });
  }
  try {
    await t.test(
      "staff routes reject anonymous requests and cross-site writes",
      async () => {
        assert.equal((await request("transactions")).status, 401);
        assert.equal((await request("stock/update", "POST", {})).status, 401);
        assert.equal(
          (
            await request(
              "admin/login",
              "POST",
              { username: "school.admin", password: "test-password-123456" },
              { origin: "https://other.example" },
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              "admin/setup",
              "POST",
              {
                username: "school.admin",
                displayName: "School admin",
                password: "test-password-123456",
              },
              { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" },
            )
          ).status,
          201,
        );
      },
    );
    const login = await request("admin/login", "POST", {
      username: "school.admin",
      password: "test-password-123456",
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.match(login.headers.get("set-cookie")!, /HttpOnly/i);
    await t.test(
      "validation rejects fractions, overselling, and unconfigured PromptPay",
      async () => {
        for (const qty of [-1, 1.2, 49]) {
          const response = await request("purchase", "POST", {
            items: [{ id: "water", qty }],
            paymentMethod: "promptpay",
            requestId: randomUUID(),
          });
          assert.ok(response.status >= 400);
        }
        assert.equal(
          (
            await request("purchase", "POST", {
              items: [{ id: "water", qty: 1 }],
              paymentMethod: "promptpay",
              requestId: randomUUID(),
            })
          ).status,
          409,
        );
      },
    );
    await mutate((s) => { s.settings.promptpay = { enabled: true, recipientId: "", recipientName: "Test shop", revision: 1 }; });
    const input = {
      items: [{ id: "water", qty: 3 }],
      paymentMethod: "promptpay",
      studentId: "00123",
      requestId: randomUUID(),
      total: 0.01,
    };
    const response = await request("purchase", "POST", input);
    assert.equal(response.status, 201);
    const order = await response.json();
    assert.equal(order.total, 21);
    await t.test("student IDs retain leading zeros in durable orders and staff reports", async () => {
      assert.equal(order.studentId, "00123");
      const saved = (await readState()).transactions.find((record) => record.id === order.id)!;
      assert.equal(saved.studentId, "00123");
      const file = JSON.parse(await readFile(process.env.DEMO_DATA_PATH!, "utf8"));
      assert.equal(file.transactions.find((record: { id: string }) => record.id === order.id).studentId, "00123");
      const staffResponse = await request("transactions", "GET", undefined, { cookie });
      assert.equal(staffResponse.status, 200);
      assert.match(JSON.stringify(await staffResponse.json()), /00123/);
      const mismatchedRetry = await request("purchase", "POST", { ...input, studentId: "00999" });
      assert.equal(mismatchedRetry.status, 409);
      assert.equal((await readState()).transactions.find((record) => record.id === order.id)!.studentId, "00123");
      assert.equal(gateway.charges.size, 1);
    });
    await t.test("invalid student ID data is rejected before saving a new order", async () => {
      const before = (await readState()).transactions.length;
      for (const studentId of [123, "0".repeat(31), "001<script>", "001 23"]) {
        assert.equal((await request("purchase", "POST", { ...input, requestId: randomUUID(), studentId })).status, 400);
      }
      assert.equal((await readState()).transactions.length, before);
      assert.equal(gateway.charges.size, 1);
    });
    await t.test("inventory edits cannot consume or deactivate reserved stock", async () => {
      const item = (await readState()).items.find((i) => i.id === "water")!;
      for (const change of [{ stock: 2 }, { active: false }]) {
        assert.equal((await request("stock/update", "POST", { ...item, ...change }, { cookie })).status, 409);
      }
      assert.equal((await request("stock/delete", "POST", { id: item.id }, { cookie })).status, 409);
      assert.equal((await readState()).items.find((i) => i.id === "water")!.stock, 48);
    });
    await t.test(
      "order tokens protect private receipts and retries reuse the order",
      async () => {
        assert.equal((await request(`purchase/${order.id}`)).status, 404);
        assert.equal(
          (
            await request(`purchase/${order.id}`, "GET", undefined, {
              "x-order-token": order.accessToken,
            })
          ).status,
          200,
        );
        const retry = await (await request("purchase", "POST", input)).json();
        assert.equal(retry.id, order.id);
        assert.equal(retry.studentId, "00123");
      },
    );
    await t.test(
      "parallel API status checks deduct stock and credit revenue exactly once",
      async () => {
        const charge = [...gateway.charges.values()][0];
        charge.status = "successful";
        charge.paid = true;
        await mutate((s) => { s.transactions[0].gateway!.checkAfter = 0; });
        const responses = await Promise.all(
          Array.from({ length: 5 }, () =>
            request(
              "transactions/check",
              "POST",
              { id: order.id },
              { cookie },
            ),
          ),
        );
        assert.ok(responses.every((r) => r.status === 200));
        const state = await readState();
        assert.equal(state.items.find((i) => i.id === "water")!.stock, 45);
        assert.equal(state.settings.cooperativeBalance, 21);
        const file = JSON.parse(
          await readFile(process.env.DEMO_DATA_PATH!, "utf8"),
        );
        assert.equal(file.transactions[0].status, "completed");
        assert.equal(file.transactions[0].studentId, "00123");
      },
    );
    await t.test("a confirmed sale cannot be cancelled", async () => {
      assert.equal(
        (
          await request(`purchase/${order.id}`, "DELETE", undefined, {
            "x-order-token": order.accessToken,
          })
        ).status,
        409,
      );
    });
    await t.test(
      "stock validation rejects duplicate barcodes and fractional inventory",
      async () => {
        const state = await readState();
        const item = state.items[1];
        assert.equal(
          (
            await request(
              "stock/update",
              "POST",
              { ...item, stock: 1.1 },
              { cookie },
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "stock/update",
              "POST",
              { ...item, barcode: state.items[0].barcode },
              { cookie },
            )
          ).status,
          409,
        );
      },
    );
    await t.test(
      "cash ledger updates balance and records an audit entry",
      async () => {
        assert.equal(
          (
            await request(
              "budget",
              "POST",
              { amount: -2.5, note: "test restock" },
              { cookie },
            )
          ).status,
          200,
        );
        const state = await readState();
        assert.equal(state.settings.cooperativeBalance, 18.5);
        assert.equal(state.budget.length, 1);
      },
    );
    await t.test("login attempts are rate limited", async () => {
      for (let i = 0; i < 5; i++)
        assert.equal(
          (
            await request("admin/login", "POST", {
              username: "school.admin",
              password: "wrong",
            })
          ).status,
          401,
        );
      assert.equal(
        (
          await request("admin/login", "POST", {
            username: "school.admin",
            password: "test-password-123456",
          })
        ).status,
        429,
      );
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
