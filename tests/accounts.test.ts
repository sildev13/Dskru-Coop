import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { mockOmise } from "./helpers/omise";
import { GET, POST } from "../src/app/api/[...path]/route";
import { mutate, readState } from "../src/lib/store";
import { initialState } from "../src/lib/seed";
import { authorizedMutation, tokenId } from "../src/lib/auth";
import { verifyPassword } from "../src/lib/passwords";
import type { SafeUser } from "../src/lib/types";

test("accounts, role enforcement, revocation and PromptPay configuration", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dskru-accounts-"));
  process.env.SYSTEM_CONFIG_PATH = path.join(directory, "server-config.json");
  process.env.DATA_BACKEND = "demo";
  process.env.DEMO_DATA_PATH = path.join(directory, "demo.json");
  delete process.env.PROMPTPAY_ID;
  delete process.env.PROMPTPAY_NAME;
  mockOmise(t);
  const password = "isolated-test-password-2026";
  const input = (username: string) => ({
    username,
    displayName: username,
    password,
  });
  const purchase = () => ({
    items: [{ id: "water", qty: 3 }],
    paymentMethod: "promptpay",
    requestId: randomUUID(),
  });
  async function request(
    route: string,
    method = "GET",
    body?: unknown,
    cookie = "",
  ) {
    const req = new NextRequest(`http://localhost:3000/api/${route}`, {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return (method === "GET" ? GET : POST)(req, {
      params: Promise.resolve({ path: route.split("/") }),
    });
  }
  const cookieOf = (response: Response) =>
    response.headers.get("set-cookie")!.split(";")[0];
  async function signIn(username: string, secret = password) {
    const response = await request("admin/login", "POST", {
      username,
      password: secret,
    });
    assert.equal(response.status, 200, await response.clone().text());
    return cookieOf(response);
  }
  let admin = "",
    cashier = "",
    stock = "",
    adminUser: SafeUser,
    cashierUser: SafeUser,
    stockUser: SafeUser;
  try {
    await t.test(
      "legacy storage preserves shop data and has no default account",
      async () => {
        const { users, sessions, ...legacy } = initialState();
        legacy.settings.cooperativeBalance = 75;
        await writeFile(process.env.DEMO_DATA_PATH!, JSON.stringify(legacy));
        const result = await (await request("admin/session")).json();
        assert.equal(result.setupRequired, true);
        assert.equal(result.authenticated, false);
        assert.equal((await readState()).settings.cooperativeBalance, 75);
        assert.equal(
          (await request("admin/login", "POST", { pin: "2550" })).status,
          400,
        );
        assert.equal(
          (
            await request(
              "admin/overview",
              "GET",
              undefined,
              "dskru_admin=retired-cookie",
            )
          ).status,
          401,
        );
      },
    );
    await t.test(
      "first administrator is created once even with concurrent setup",
      async () => {
        assert.equal(
          (
            await request("admin/setup", "POST", {
              ...input("admin.one"),
              password: "short",
            })
          ).status,
          400,
        );
        const responses = await Promise.all([
          request("admin/setup", "POST", input("admin.one")),
          request("admin/setup", "POST", input("admin.two")),
        ]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
        const response = responses.find((r) => r.status === 201)!;
        admin = cookieOf(response);
        adminUser = (await response.json()).user;
        assert.match(response.headers.get("set-cookie")!, /HttpOnly/i);
        assert.match(response.headers.get("set-cookie")!, /SameSite=strict/i);
        const state = await readState();
        assert.equal(state.users.length, 1);
        assert.equal(state.users[0].role, "admin");
        assert.equal("passwordHash" in adminUser, false);
        assert.notEqual(state.users[0].passwordHash, password);
        assert.equal(
          await verifyPassword(password, state.users[0].passwordHash),
          true,
        );
        assert.equal(state.sessions[0].id, tokenId(admin.split("=")[1]));
        assert.equal(
          (await (await request("admin/session")).json()).setupRequired,
          false,
        );
        assert.equal(
          (await request("admin/setup", "POST", input("takeover"))).status,
          409,
        );
      },
    );
    await t.test(
      "admin creates unique accounts with validated roles and salted passwords",
      async () => {
        for (const role of ["cashier", "stock"] as const) {
          const r = await request(
            "admin/users/save",
            "POST",
            { ...input(role), role, active: true },
            admin,
          );
          assert.equal(r.status, 200);
          const user = await r.json();
          assert.equal("passwordHash" in user, false);
          if (role === "cashier") cashierUser = user;
          else stockUser = user;
        }
        cashier = await signIn("CASHIER");
        stock = await signIn("stock");
        assert.equal(
          (
            await request(
              "admin/users/save",
              "POST",
              { ...input("Cashier"), role: "cashier", active: true },
              admin,
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await request(
              "admin/users/save",
              "POST",
              { ...input("new.role"), role: "root", active: true },
              admin,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "admin/users/save",
              "POST",
              {
                username: "no.password",
                displayName: "test",
                role: "stock",
                active: true,
              },
              admin,
            )
          ).status,
          400,
        );
        const state = await readState();
        assert.notEqual(
          state.users[0].passwordHash,
          state.users[1].passwordHash,
        );
        assert.equal(
          JSON.stringify(
            await (
              await request("admin/users", "GET", undefined, admin)
            ).json(),
          ).includes("passwordHash"),
          false,
        );
      },
    );
    await t.test(
      "cashier and stock permissions are enforced at server endpoints",
      async () => {
        const item = (await readState()).items[0];
        for (const cookie of [cashier, stock]) {
          for (const route of ["admin/users", "settings/promptpay"])
            assert.equal(
              (await request(route, "GET", undefined, cookie)).status,
              403,
              route,
            );
          for (const [route, body] of [
            [
              "admin/users/save",
              { ...input("forbidden"), role: "admin", active: true },
            ],
            ["settings", { dailyTarget: 500, storeOpen: true }],
            ["budget", { amount: 1, note: "test" }],
            ["settings/promptpay", {}],
          ] as const)
            assert.equal(
              (await request(route, "POST", body, cookie)).status,
              403,
              route,
            );
        }
        assert.equal(
          (await request("transactions", "GET", undefined, cashier)).status,
          200,
        );
        assert.equal(
          (await request("transactions", "GET", undefined, stock)).status,
          403,
        );
        assert.equal(
          (
            await request(
              "transactions/confirm",
              "POST",
              { id: randomUUID() },
              stock,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              "transactions/cancel",
              "POST",
              { id: randomUUID() },
              stock,
            )
          ).status,
          403,
        );
        assert.equal(
          (await request("stock/update", "POST", item, cashier)).status,
          403,
        );
        assert.equal(
          (await request("stock/delete", "POST", { id: item.id }, cashier))
            .status,
          403,
        );
        assert.equal(
          (await request("stock/update", "POST", item, stock)).status,
          200,
        );
        for (const cookie of [cashier, stock]) {
          const view = await (
            await request("admin/overview", "GET", undefined, cookie)
          ).json();
          assert.equal(view.users, undefined);
          assert.equal(view.sessions, undefined);
          assert.equal(view.settings.promptpay, undefined);
          assert.deepEqual(view.budget, []);
          assert.equal(JSON.stringify(view).includes("passwordHash"), false);
          if (cookie === stock) assert.deepEqual(view.transactions, []);
        }
      },
    );
    await t.test(
      "PromptPay config requires admin password and validates recipient",
      async () => {
        const config = {
          enabled: true,
          recipientId: "000-000-0000",
          recipientName: "Test recipient A",
          revision: 0,
          currentPassword: password,
        };
        for (const changes of [{ recipientId: "123" }, { recipientName: "" }])
          assert.equal(
            (
              await request(
                "settings/promptpay",
                "POST",
                { ...config, ...changes },
                admin,
              )
            ).status,
            400,
          );
        assert.equal(
          (
            await request(
              "settings/promptpay",
              "POST",
              { ...config, currentPassword: "wrong" },
              admin,
            )
          ).status,
          400,
        );
        const result = await request(
          "settings/promptpay",
          "POST",
          config,
          admin,
        );
        assert.equal(result.status, 200);
        const saved = await result.json();
        assert.equal(saved.recipientId, "0000000000");
        assert.equal(saved.revision, 1);
        assert.equal(saved.updatedBy, adminUser.id);
        const publicConfig = (await (await request("items")).json()).config;
        assert.equal(publicConfig.promptpayAvailable, true);
        assert.equal(publicConfig.recipientId, undefined);
        assert.equal(
          (await request("settings/promptpay", "POST", config, admin)).status,
          409,
        );
      },
    );
    await t.test(
      "pending QR and name stay fixed when recipient changes or payment is disabled",
      async () => {
        const body = purchase();
        const first = await (await request("purchase", "POST", body)).json();
        assert.match(first.payment.qrImageUrl, /^https:\/\/api.omise.co\/charges\//);
        const config = {
          enabled: true,
          recipientId: "0000000000000",
          recipientName: "Test recipient B",
          revision: 1,
          currentPassword: password,
        };
        assert.equal(
          (await request("settings/promptpay", "POST", config, admin)).status,
          200,
        );
        const retry = await (await request("purchase", "POST", body)).json();
        assert.equal(retry.id, first.id);
        assert.equal(retry.payment.qrImageUrl, first.payment.qrImageUrl);
        assert.equal(retry.recipientName, "Test recipient A");
        const second = await (
          await request("purchase", "POST", purchase())
        ).json();
        assert.equal(second.recipientName, "Test recipient B");
        assert.notEqual(second.payment.qrImageUrl, first.payment.qrImageUrl);
        assert.equal(
          (
            await request(
              "settings/promptpay",
              "POST",
              { ...config, enabled: false, revision: 2 },
              admin,
            )
          ).status,
          200,
        );
        assert.equal(
          (await request("purchase", "POST", purchase())).status,
          409,
        );
        assert.equal(
          (
            await request("purchase", "POST", {
              ...purchase(),
              paymentMethod: "cash",
            })
          ).status,
          400,
        );
        assert.equal(
          (await (await request("purchase", "POST", body)).json()).payment.qrImageUrl,
          first.payment.qrImageUrl,
        );
        assert.equal(
          (
            await request(
              "transactions/confirm",
              "POST",
              { id: first.id },
              cashier,
            )
          ).status,
          410,
        );
        const stored = (await readState()).transactions.find(
          (x) => x.id === first.id,
        )!;
        assert.equal(stored.confirmedBy, undefined);
        assert.equal(stored.gateway!.qrImageUrl, first.payment.qrImageUrl);
        const disk = JSON.parse(
          await readFile(process.env.DEMO_DATA_PATH!, "utf8"),
        );
        assert.equal(disk.settings.promptpay.enabled, false);
      },
    );
    await t.test(
      "self-demotion is blocked and account changes revoke every active session",
      async () => {
        for (const change of [{ active: false }, { role: "cashier" }])
          assert.equal(
            (
              await request(
                "admin/users/save",
                "POST",
                { ...adminUser, ...change },
                admin,
              )
            ).status,
            409,
          );
        const secondSession = await signIn("cashier");
        assert.equal(
          (
            await request(
              "admin/users/save",
              "POST",
              { ...cashierUser, active: false },
              admin,
            )
          ).status,
          200,
        );
        for (const cookie of [cashier, secondSession])
          assert.equal(
            (await request("transactions", "GET", undefined, cookie)).status,
            401,
          );
        assert.equal(
          (
            await request("admin/login", "POST", {
              username: "cashier",
              password,
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await request(
              "admin/users/save",
              "POST",
              { ...cashierUser, role: "stock" },
              admin,
            )
          ).status,
          200,
        );
        const downgraded = await signIn("cashier");
        assert.equal(
          (await request("transactions", "GET", undefined, downgraded)).status,
          403,
        );
        assert.equal(
          (
            await request(
              "admin/users/save",
              "POST",
              { ...cashierUser, password: "reset-password-for-test" },
              admin,
            )
          ).status,
          200,
        );
        assert.equal(
          (await request("admin/overview", "GET", undefined, downgraded))
            .status,
          401,
        );
        assert.equal(
          (
            await request("admin/login", "POST", {
              username: "cashier",
              password,
            })
          ).status,
          401,
        );
        assert.ok(await signIn("cashier", "reset-password-for-test"));
      },
    );
    await t.test(
      "password changes require current password and invalidate previous cookies",
      async () => {
        const data = {
          currentPassword: "wrong",
          password: "new-stock-password-2026",
        };
        assert.equal(
          (await request("admin/password", "POST", data, stock)).status,
          400,
        );
        assert.equal(
          (
            await request(
              "admin/password",
              "POST",
              { ...data, currentPassword: password },
              stock,
            )
          ).status,
          200,
        );
        assert.equal(
          (await request("admin/overview", "GET", undefined, stock)).status,
          401,
        );
        assert.equal(
          (
            await request("admin/login", "POST", {
              username: "stock",
              password,
            })
          ).status,
          401,
        );
        stock = await signIn("stock", data.password);
      },
    );
    await t.test(
      "logout, expiration and queued mutations cannot reuse revoked sessions",
      async () => {
        assert.equal(
          (await request("admin/session", "POST", {}, stock)).status,
          200,
        );
        assert.equal(
          (await request("admin/logout", "POST", {}, stock)).status,
          200,
        );
        assert.equal(
          (await request("admin/overview", "GET", undefined, stock)).status,
          401,
        );
        stock = await signIn("stock", "new-stock-password-2026");
        await mutate((s) => {
          s.sessions.find(
            (x) => x.id === tokenId(stock.split("=")[1]),
          )!.expiresAt = Date.now() - 1;
        });
        assert.equal(
          (await request("admin/session", "POST", {}, stock)).status,
          401,
        );
        stock = await signIn("stock", "new-stock-password-2026");
        const revocation = mutate((s) => {
          s.sessions = s.sessions.filter((x) => x.userId !== stockUser.id);
        });
        const mutation = authorizedMutation(
          new NextRequest("http://localhost/api/stock/update", {
            headers: { cookie: stock },
          }),
          "inventory",
          (s) => {
            s.items[0].stock = 12345;
          },
        );
        await revocation;
        await assert.rejects(mutation, /เข้าสู่ระบบ/);
        assert.notEqual((await readState()).items[0].stock, 12345);
        stock = await signIn("stock", "new-stock-password-2026");
        await mutate((s) => {
          s.sessions.find(
            (x) => x.id === tokenId(stock.split("=")[1]),
          )!.createdAt = Date.now() - 8 * 60 * 60_000;
        });
        assert.equal(
          (await request("admin/session", "POST", {}, stock)).status,
          401,
        );
      },
    );
    await t.test(
      "wrong passwords have generic errors and per-account rate limits",
      async () => {
        const unknown = await request("admin/login", "POST", {
          username: "unknown",
          password,
        });
        const wrong = await request("admin/login", "POST", {
          username: adminUser.username,
          password: "wrong",
        });
        assert.equal(unknown.status, 401);
        assert.deepEqual(await unknown.json(), await wrong.json());
        for (let i = 0; i < 4; i++)
          assert.equal(
            (
              await request("admin/login", "POST", {
                username: adminUser.username,
                password: "wrong",
              })
            ).status,
            401,
          );
        assert.equal(
          (
            await request("admin/login", "POST", {
              username: adminUser.username,
              password,
            })
          ).status,
          429,
        );
        assert.ok(await signIn("stock", "new-stock-password-2026"));
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
