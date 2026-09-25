export const serverConfigFields = [
  { key: "DATA_BACKEND", label: "ฐานข้อมูล", group: "database", options: ["demo", "firestore"] },
  { key: "FIREBASE_PROJECT_ID", label: "Firebase Project ID", group: "database" },
  { key: "FIREBASE_CLIENT_EMAIL", label: "Firebase Client Email", group: "database" },
  { key: "FIREBASE_PRIVATE_KEY", label: "Firebase Private Key", group: "database", secret: true, multiline: true },
  { key: "DEMO_DATA_PATH", label: "ตำแหน่งไฟล์ข้อมูล demo (absolute path)", group: "database", help: "เว้นว่างเพื่อใช้ .data/demo.json ใช้เมื่อเลือกฐานข้อมูล demo เท่านั้น" },
  { key: "ADMIN_SETUP_TOKEN", label: "รหัสตั้งค่าผู้ดูแลคนแรก", group: "database", secret: true, help: "อย่างน้อย 24 ตัวอักษร ใช้ตอนเชื่อมต่อฐานข้อมูลใหม่ที่ยังไม่มีผู้ดูแล เก็บรหัสที่ตั้งไว้สำหรับเข้าสู่หน้าสร้างบัญชี" },
  { key: "PAYMENT_MODE", label: "โหมด Omise", group: "payment", options: ["live", "test"], fallback: "live" },
  { key: "OMISE_SECRET_KEY", label: "Omise Secret Key", group: "payment", secret: true },
  { key: "OMISE_WEBHOOK_SECRET", label: "Omise Webhook Signing Secret", group: "payment", secret: true },
  { key: "PAYMENT_WEBHOOK_URL", label: "Webhook URL", group: "payment", help: "https://ชื่อเว็บ/api/payments/omise/webhook" },
  { key: "CRON_SECRET", label: "คีย์งานตรวจสถานะตามเวลา", group: "payment", secret: true, help: "อย่างน้อย 24 ตัวอักษร ใช้กับ Authorization: Bearer ของงานเรียก /api/payments/reconcile บนโฮสต์" },
] as const;
export type ServerConfigKey = typeof serverConfigFields[number]["key"];
export type ServerConfigValues = Partial<Record<ServerConfigKey, string>>;
export type ServerConfigView = {
  revision: string;
  values: ServerConfigValues;
  activeValues: ServerConfigValues;
  secrets: Partial<Record<ServerConfigKey, { configured: boolean; active: boolean }>>;
  pendingRestart: boolean;
  updatedAt?: string;
};
