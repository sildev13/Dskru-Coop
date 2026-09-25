import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { gatewayConfig } from "@/lib/omise";
import { cancelUnpaid, publicPurchase, reconcilePurchase, startCheckout } from "@/lib/checkout";
import {
  authorizedMutation,
  firstAdmin,
  getUser,
  login,
  logout,
  verifyCurrentPassword,
  renew,
  requireUser,
  setSession,
  setupRequired,
} from "@/lib/auth";
import { safeUser, can } from "@/lib/permissions";
import {
  paymentAvailable,
  paymentConfig,
  validRecipient,
} from "@/lib/payments";
import { hashPassword } from "@/lib/passwords";
import { saveUser } from "@/lib/accounts";
import {
  AppError,
  cents,
  reservedStock,
} from "@/lib/domain";
import { isDemo, mutate, readState } from "@/lib/store";
import { shopConfig, shopConfigSchema } from "@/lib/shop-config";
import { saveServerConfig, serverConfigChanging, serverConfigInput, serverConfigView } from "@/lib/server-config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const money = z
  .number()
  .finite()
  .min(0)
  .max(100000)
  .refine(
    (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001,
    "ใช้ทศนิยมไม่เกิน 2 ตำแหน่ง",
  );
const itemSchema = z.object({
  id: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,80}$/)
    .optional(),
  name: z.string().trim().min(1).max(100),
  subtitle: z.string().trim().max(100).default(""),
  price: money,
  stock: z.number().int().min(0).max(100000),
  barcode: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z-]{1,80}$/),
  category: z.enum(["drinks", "snacks", "food", "supplies"]),
  image: z
    .string()
    .max(1000)
    .refine(
      (v) => !v || /^\/products\/[\w.-]+$/.test(v) || /^https:\/\//.test(v),
      "ใช้ URL รูปภาพแบบ HTTPS",
    ),
  reorderLevel: z.number().int().min(0).max(100000).default(10),
  active: z.boolean().default(true),
});
const purchaseSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().max(80),
        qty: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(100),
  paymentMethod: z.literal("promptpay", { error: "ร้านรับชำระด้วยการโอนผ่านพร้อมเพย์เท่านั้น" }),
  studentId: z
    .string()
    .trim()
    .regex(/^[\dA-Za-z-]{0,30}$/)
    .optional(),
  requestId: z.string().uuid(),
});
const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9._-]{2,39}$/,
    "ชื่อผู้ใช้ต้องมี 3–40 ตัว ใช้ภาษาอังกฤษ ตัวเลข . _ หรือ -",
  );
const passwordSchema = z
  .string()
  .min(12, "รหัสผ่านต้องมีอย่างน้อย 12 ตัวอักษร")
  .max(128, "รหัสผ่านยาวเกินไป");
const accountSchema = z.object({
  id: z.string().uuid().optional(),
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(80),
  role: z.enum(["admin", "cashier", "stock"]),
  active: z.boolean(),
  password: passwordSchema.optional(),
});
const promptpaySchema = z
  .object({
    enabled: z.boolean(),
    recipientId: z
      .string()
      .trim()
      .max(25)
      .transform((v) => v.replace(/[\s-]/g, "")),
    recipientName: z.string().trim().max(100),
    revision: z.number().int().min(0),
    currentPassword: z.string().min(1).max(128),
  })
  .refine(
    (v) =>
      (!v.recipientId || validRecipient(v.recipientId)) &&
      (!v.enabled ||
        Boolean(v.recipientName)),
    "ระบุชื่อร้านสำหรับแสดงขณะชำระเงิน",
  );
const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
async function body(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > 100_000) throw new AppError("ข้อมูลมีขนาดใหญ่เกินไป", 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("รูปแบบข้อมูลไม่ถูกต้อง");
  }
}
async function handle(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await context.params;
    const route = path.join("/");
    const method = request.method;
    if (method !== "GET") {
      const origin = request.headers.get("origin");
      const requestOrigin = new URL(request.url).origin;
      const host = request.headers.get("host");
      const scheme =
        request.headers.get("x-forwarded-proto") ||
        new URL(request.url).protocol.replace(":", "");
      const hostOrigin = host ? `${scheme}://${host}` : requestOrigin;
      if (
        (origin && origin !== requestOrigin && origin !== hostOrigin) ||
        request.headers.get("sec-fetch-site") === "cross-site"
      )
        throw new AppError("ไม่อนุญาตคำขอจากเว็บไซต์อื่น", 403);
    }
    if (route === "items" && method === "GET") {
      const state = await readState();
      const payment = paymentConfig(state.settings);
      return json({
        items: state.items.filter((i) => i.active).map((i) => ({ ...i, stock: Math.max(0, i.stock - reservedStock(state, i.id)) })),
        config: {
          demo: isDemo(),
          promptpayAvailable: paymentAvailable(payment),
          recipientName: payment.recipientName,
          storeOpen: state.settings.storeOpen,
          paymentMode: gatewayConfig().mode,
          shop: shopConfig(state.settings),
        },
      });
    }
    if (route === "purchase" && method === "POST") {
      const input = purchaseSchema.parse(await body(request));
      const purchase = await startCheckout(input);
      return json(
        {
          ...publicPurchase(purchase),
          accessToken: purchase.accessToken,
        },
        201,
      );
    }
    if (route.startsWith("purchase/") && path.length === 2) {
      const state = await readState();
      const purchase = state.transactions.find((t) => t.id === path[1]);
      if (
        !purchase ||
        request.headers.get("x-order-token") !== purchase.accessToken
      )
        throw new AppError("ไม่พบรายการ", 404);
      if (method === "GET") return json(publicPurchase(await reconcilePurchase(purchase.id)));
      if (method === "DELETE")
        return json(
          await mutate((s) => {
            return publicPurchase(cancelUnpaid(s, path[1]));
          }),
        );
    }
    if (route === "admin/login" && method === "POST") {
      const { username, password } = z
        .object({
          username: usernameSchema,
          password: z.string().min(1).max(128),
        })
        .parse(await body(request));
      const result = await login(username, password, request);
      return setSession(json({ ok: true, user: result.user }), result.token);
    }
    if (route === "admin/setup" && method === "POST") {
      const input = z
        .object({
          username: usernameSchema,
          displayName: z.string().trim().min(1).max(80),
          password: passwordSchema,
          setupToken: z.string().max(256).optional(),
        })
        .parse(await body(request));
      const result = await firstAdmin(request, input);
      return setSession(
        json({ ok: true, user: result.user }, 201),
        result.token,
      );
    }
    if (route === "admin/logout" && method === "POST") {
      await logout(request);
      return setSession(json({ ok: true }));
    }
    if (route === "admin/session" && method === "GET") {
      const user = await getUser(request);
      return json({
        authenticated: Boolean(user),
        user: user ? safeUser(user) : null,
        demo: isDemo(),
        setupRequired: !user && (await setupRequired()),
        setupTokenRequired: !isDemo(),
      });
    }
    const user = await requireUser(request);
    if (route === "settings/shop" && method === "GET") {
      await requireUser(request, "settings");
      const { settings } = await readState();
      return json({ config: shopConfig(settings), revision: settings.shopRevision || 0 });
    }
    if (route === "settings/shop" && method === "POST") {
      await requireUser(request, "settings");
      const input = z.object({ config: shopConfigSchema, revision: z.number().int().min(0) }).strict().parse(await body(request));
      return json(await authorizedMutation(request, "settings", (state) => {
        if ((state.settings.shopRevision || 0) !== input.revision) throw new AppError("การตั้งค่าถูกแก้ไขแล้ว กรุณาโหลดข้อมูลล่าสุด", 409);
        state.settings.shop = input.config;
        state.settings.shopRevision = input.revision + 1;
        return { config: input.config, revision: state.settings.shopRevision };
      }));
    }
    if (route === "settings/server" && method === "GET") {
      await requireUser(request, "settings");
      return json(serverConfigView());
    }
    if ((route === "settings/server" || route === "settings/server/discard") && method === "POST") {
      await requireUser(request, "settings");
      const input = serverConfigInput.parse(await body(request));
      await verifyCurrentPassword(user, input.currentPassword);
      return json(await saveServerConfig(input.revision, input.changes, () => authorizedMutation(request, "settings", (state, actor) => {
        if (actor.passwordHash !== user.passwordHash) throw new AppError("ข้อมูลบัญชีเปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่", 401);
        if (route !== "settings/server/discard" && (state.settings.storeOpen || state.transactions.some((order) => order.status === "pending" && order.gateway)))
          throw new AppError("ปิดรับรายการซื้อและรอรายการชำระค้างให้เสร็จก่อนบันทึกการเชื่อมต่อเซิร์ฟเวอร์", 409);
        return actor.id;
      }), route === "settings/server/discard"));
    }
    if (route === "admin/session" && method === "POST")
      return setSession(
        json({ ok: true, user: safeUser(user) }),
        await renew(request),
      );
    if (route === "admin/password" && method === "POST") {
      const input = z
        .object({
          currentPassword: z.string().min(1).max(128),
          password: passwordSchema,
        })
        .parse(await body(request));
      await verifyCurrentPassword(user, input.currentPassword);
      const passwordHash = await hashPassword(input.password);
      await authorizedMutation(request, "account", (state, current) => {
        if (current.passwordHash !== user.passwordHash)
          throw new AppError(
            "ข้อมูลบัญชีเปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่",
            401,
          );
        current.passwordHash = passwordHash;
        current.updatedAt = new Date().toISOString();
        state.sessions = state.sessions.filter((s) => s.userId !== current.id);
      });
      return setSession(json({ ok: true }));
    }
    if (route === "admin/users" && method === "GET") {
      await requireUser(request, "users");
      return json((await readState()).users.map(safeUser));
    }
    if (route === "admin/users/save" && method === "POST") {
      await requireUser(request, "users");
      const input = accountSchema.parse(await body(request));
      const passwordHash = input.password
        ? await hashPassword(input.password)
        : undefined;
      const { password, ...fields } = input;
      return json(
        await authorizedMutation(request, "users", (state, actor) =>
          saveUser(state, actor, fields, passwordHash),
        ),
      );
    }
    if (route === "settings/promptpay" && method === "GET") {
      await requireUser(request, "settings");
      return json({ ...paymentConfig((await readState()).settings), gateway: gatewayConfig() });
    }
    if (route === "settings/promptpay" && method === "POST") {
      await requireUser(request, "settings");
      const input = promptpaySchema.parse(await body(request));
      await verifyCurrentPassword(user, input.currentPassword);
      const saved = await authorizedMutation(request, "settings", (state, actor) => {
          if (actor.passwordHash !== user.passwordHash)
            throw new AppError(
              "ข้อมูลบัญชีเปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่",
              401,
            );
          const previous = paymentConfig(state.settings);
          if (previous.revision !== input.revision)
            throw new AppError(
              "การตั้งค่าถูกแก้ไขโดยผู้ดูแลคนอื่น กรุณาโหลดข้อมูลล่าสุด",
              409,
            );
          state.settings.promptpay = {
            enabled: input.enabled,
            recipientId: input.recipientId,
            recipientName: input.recipientName,
            revision: previous.revision + 1,
            updatedAt: new Date().toISOString(),
            updatedBy: actor.id,
          };
          return state.settings.promptpay;
        });
      return json({ ...saved, gateway: gatewayConfig() });
    }
    if (route === "admin/overview" && method === "GET") {
      const state = await readState();
      const payment = paymentConfig(state.settings);
      return json({
        items: state.items,
        settings: {
          storeOpen: state.settings.storeOpen,
          dailyTarget: state.settings.dailyTarget,
          cooperativeBalance:
            user.role === "admin" ? state.settings.cooperativeBalance : 0,
          shop: shopConfig(state.settings),
        },
        budget: user.role === "admin" ? state.budget : [],
        user: safeUser(user),
        transactions: can(user.role, "transactions")
          ? state.transactions.map(publicPurchase)
          : [],
        demo: isDemo(),
        promptpayAvailable: paymentAvailable(payment),
        recipientName: payment.recipientName,
      });
    }
    if (route === "transactions" && method === "GET") {
      await requireUser(request, "transactions");
      const state = await readState();
      return json(state.transactions.map(publicPurchase));
    }
    if (route === "transactions/confirm" && method === "POST") {
      await requireUser(request, "transactions");
      throw new AppError("ระบบยืนยันจาก Omise อัตโนมัติ ไม่สามารถยืนยันการชำระด้วยเจ้าหน้าที่", 410);
    }
    if (route === "transactions/check" && method === "POST") {
      await requireUser(request, "transactions");
      const { id } = z
        .object({ id: z.string().uuid() })
        .parse(await body(request));
      return json(publicPurchase(await reconcilePurchase(id)));
    }
    if (route === "transactions/cancel" && method === "POST") {
      const { id } = z
        .object({ id: z.string().uuid() })
        .parse(await body(request));
      return json(
        await authorizedMutation(request, "transactions", (s, actor) => {
          return publicPurchase(cancelUnpaid(s, id, actor.id));
        }),
      );
    }
    if (route === "stock/update" && method === "POST") {
      const input = itemSchema.parse(await body(request));
      return json(
        await authorizedMutation(request, "inventory", (s) => {
          if (
            s.items.some(
              (i) =>
                i.barcode === input.barcode && i.id !== input.id && i.active,
            )
          )
            throw new AppError("บาร์โค้ดนี้ถูกใช้งานแล้ว", 409);
          const item = { ...input, id: input.id || randomUUID() };
          const reserved = reservedStock(s, item.id);
          if (item.stock < reserved || (reserved > 0 && !item.active))
            throw new AppError(`สินค้านี้ถูกจองรอชำระ ${reserved} ชิ้น ไม่สามารถลดต่ำกว่าจำนวนจองหรือปิดขายได้`, 409);
          const index = s.items.findIndex((i) => i.id === item.id);
          if (index < 0) s.items.push(item);
          else s.items[index] = item;
          return item;
        }),
      );
    }
    if (route === "stock/delete" && method === "POST") {
      const { id } = z.object({ id: z.string() }).parse(await body(request));
      return json(
        await authorizedMutation(request, "inventory", (s) => {
          const item = s.items.find((i) => i.id === id);
          if (!item) throw new AppError("ไม่พบสินค้า", 404);
          if (
            s.transactions.some(
              (t) => t.status === "pending" && t.items.some((i) => i.id === id),
            )
          )
            throw new AppError(
              "สินค้านี้มีรายการรอชำระ กรุณาจัดการรายการก่อน",
              409,
            );
          item.active = false;
          return { ok: true };
        }),
      );
    }
    if (route === "settings" && method === "POST") {
      const input = z
        .object({ dailyTarget: money, storeOpen: z.boolean() })
        .parse(await body(request));
      return json(
        await authorizedMutation(request, "settings", (s) => {
          if (input.storeOpen && (serverConfigChanging() || serverConfigView().pendingRestart))
            throw new AppError("มีค่าการเชื่อมต่อรอเริ่มใช้งาน กรุณารีสตาร์ตเซิร์ฟเวอร์หรือยกเลิกค่าที่รอก่อนเปิดร้าน", 409);
          s.settings = { ...s.settings, ...input };
          return s.settings;
        }),
      );
    }
    if (route === "budget" && method === "POST") {
      const input = z
        .object({
          amount: z
            .number()
            .finite()
            .min(-100000)
            .max(100000)
            .refine(
              (v) =>
                v !== 0 && Math.abs(v * 100 - Math.round(v * 100)) < 0.00001,
            ),
          note: z.string().trim().min(1).max(200),
        })
        .parse(await body(request));
      return json(
        await authorizedMutation(request, "budget", (s, actor) => {
          const entry = {
            ...input,
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            createdBy: actor.id,
          };
          s.settings.cooperativeBalance =
            (cents(s.settings.cooperativeBalance) + cents(input.amount)) / 100;
          s.budget.unshift(entry);
          return entry;
        }),
      );
    }
    throw new AppError("ไม่พบหน้านี้", 404);
  } catch (error) {
    if (error instanceof AppError)
      return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return json(
        { error: error.issues[0]?.message || "ข้อมูลไม่ถูกต้อง" },
        400,
      );
    console.error(
      "Request failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return json(
      { error: "บันทึกข้อมูลไม่สำเร็จ กรุณาลองอีกครั้งหรือติดต่อเจ้าหน้าที่" },
      500,
    );
  }
}
export { handle as GET, handle as POST, handle as DELETE };
