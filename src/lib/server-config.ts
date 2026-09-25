import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { createPrivateKey, randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { AppError } from "./domain";
import { serverConfigFields, type ServerConfigKey, type ServerConfigValues, type ServerConfigView } from "./server-config-fields";

const keys = serverConfigFields.map((f) => f.key) as [ServerConfigKey, ...ServerConfigKey[]];
const valuesSchema = z.partialRecord(z.enum(keys), z.string().max(10000));
const documentSchema = z.object({
  revision: z.string().max(80), values: valuesSchema,
  updatedAt: z.string().optional(), updatedBy: z.string().optional(),
}).strict();
type ConfigDocument = z.infer<typeof documentSchema>;
export const serverConfigInput = z.object({
  revision: z.string().max(80), changes: valuesSchema,
  currentPassword: z.string().min(1).max(128),
}).strict();
const runtime = globalThis as typeof globalThis & {
  dskruServerConfig?: Map<string, ConfigDocument>;
  dskruConfigQueue?: Promise<unknown>;
  dskruConfigChanging?: boolean;
};
function configPath() {
  return path.resolve(process.env.SYSTEM_CONFIG_PATH || path.join(process.cwd(), ".data", "server-config.json"));
}
function readDocument(): ConfigDocument {
  try {
    return documentSchema.parse(JSON.parse(readFileSync(/* turbopackIgnore: true */ configPath(), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { revision: "environment", values: {} };
    // Never log a parse error containing credentials or silently fall back to another database.
    throw new AppError("อ่านไฟล์ตั้งค่าเซิร์ฟเวอร์ไม่สำเร็จ ให้ผู้ติดตั้งตรวจ SYSTEM_CONFIG_PATH", 503);
  }
}
function activeDocument() {
  runtime.dskruServerConfig ||= new Map();
  const file = configPath();
  if (!runtime.dskruServerConfig.has(file)) runtime.dskruServerConfig.set(file, readDocument());
  return runtime.dskruServerConfig.get(file)!;
}
function effective(document: ConfigDocument): Record<ServerConfigKey, string> {
  return Object.fromEntries(serverConfigFields.map((field) => [field.key,
    document.values[field.key] ?? process.env[field.key] ?? ("fallback" in field ? field.fallback : ""),
  ])) as Record<ServerConfigKey, string>;
}
// Freeze file overrides for this process, including during development hot reload.
// Existing environment-only installations continue to work without a config file.
export function serverEnv(key: ServerConfigKey): string {
  return effective(activeDocument())[key];
}
export const serverConfigChanging = () => Boolean(runtime.dskruConfigChanging);
export function serverConfigView(): ServerConfigView {
  const active = effective(activeDocument());
  const document = readDocument();
  const saved = effective(document);
  const view: ServerConfigView = {
    revision: document.revision, values: {}, activeValues: {}, secrets: {},
    pendingRestart: keys.some((key) => saved[key] !== active[key]), updatedAt: document.updatedAt,
  };
  for (const field of serverConfigFields) {
    if ("secret" in field && field.secret) view.secrets[field.key] = { configured: Boolean(saved[field.key]), active: Boolean(active[field.key]) };
    else { view.values[field.key] = saved[field.key]; view.activeValues[field.key] = active[field.key]; }
  }
  return view;
}
function validate(values: Record<ServerConfigKey, string>) {
  const fail = (message: string): never => { throw new AppError(message); };
  if (!["demo", "firestore"].includes(values.DATA_BACKEND)) fail("เลือกฐานข้อมูล demo หรือ firestore");
  if (!["test", "live"].includes(values.PAYMENT_MODE)) fail("เลือกโหมดชำระเงิน test หรือ live");
  if (values.DATA_BACKEND === "firestore") {
    if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(values.FIREBASE_PROJECT_ID)) fail("Firebase Project ID ไม่ถูกต้อง");
    if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(values.FIREBASE_CLIENT_EMAIL)) fail("ใช้ Client Email ของ Firebase service account");
    try { createPrivateKey(values.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")); }
    catch { fail("Firebase Private Key ต้องเป็นคีย์ PEM ที่สมบูรณ์"); }
  }
  if (values.DEMO_DATA_PATH && (!path.isAbsolute(values.DEMO_DATA_PATH) || !values.DEMO_DATA_PATH.endsWith(".json") || path.resolve(values.DEMO_DATA_PATH) === configPath() || path.resolve(values.DEMO_DATA_PATH).startsWith(path.join(process.cwd(), "public") + path.sep)))
    fail("ไฟล์ demo ต้องเป็น absolute path ลงท้าย .json อยู่นอก public และไม่ใช่ไฟล์ตั้งค่าเซิร์ฟเวอร์");
  for (const key of ["ADMIN_SETUP_TOKEN", "CRON_SECRET"] as const)
    if (values[key] && values[key].length < 24) fail(`${key} ต้องมีอย่างน้อย 24 ตัวอักษร`);
  if (values.PAYMENT_MODE === "test" && values.DATA_BACKEND !== "demo") fail("โหมดทดสอบการชำระเงินต้องใช้ฐานข้อมูล demo");
  if (values.OMISE_SECRET_KEY && (!values.OMISE_SECRET_KEY.startsWith(`skey_${values.PAYMENT_MODE}_`) || values.OMISE_SECRET_KEY.length <= 15)) fail("Omise Secret Key ไม่ตรงกับโหมดที่เลือก");
  if (values.OMISE_WEBHOOK_SECRET && (!/^[A-Za-z0-9+/]+={0,2}$/.test(values.OMISE_WEBHOOK_SECRET) || Buffer.from(values.OMISE_WEBHOOK_SECRET, "base64").length < 16)) fail("Webhook Signing Secret ต้องเป็น Base64 จาก Omise");
  if (values.PAYMENT_WEBHOOK_URL) {
    try {
      const url = new URL(values.PAYMENT_WEBHOOK_URL);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/api/payments/omise/webhook" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error();
    } catch { fail("Webhook ต้องเป็น HTTPS ของเว็บจริง ลงท้าย /api/payments/omise/webhook"); }
  }
}
export async function saveServerConfig(revision: string, changes: ServerConfigValues, authorize: () => Promise<string>, discard = false) {
  activeDocument();
  const job = (runtime.dskruConfigQueue || Promise.resolve()).catch(() => {}).then(async () => {
    const previous = readDocument();
    if (previous.revision !== revision) throw new AppError("การตั้งค่าถูกแก้ไขแล้ว กรุณาโหลดข้อมูลล่าสุด", 409);
    const values = discard ? { ...activeDocument().values } : { ...previous.values, ...Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, value.trim()])) };
    const next = { values, revision: randomUUID(), updatedAt: new Date().toISOString(), updatedBy: "" };
    if (!discard) validate(effective(next));
    runtime.dskruConfigChanging = true;
    try {
    next.updatedBy = await authorize();
    const file = configPath();
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(temp, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
      for (let attempt = 0; ; attempt++) {
        try { await rename(temp, file); break; }
        catch (error) {
          if (attempt >= 5 || !["EPERM", "EBUSY", "EACCES"].includes((error as NodeJS.ErrnoException).code || "")) throw error;
          await delay(50 * 2 ** attempt);
        }
      }
    } catch { throw new AppError("เขียนไฟล์ตั้งค่าไม่ได้ ให้ผู้ติดตั้งกำหนด SYSTEM_CONFIG_PATH บนดิสก์ถาวรที่เขียนได้", 503); }
    return serverConfigView();
    } finally { runtime.dskruConfigChanging = false; }
  });
  runtime.dskruConfigQueue = job;
  return job;
}
