"use client";
import { useEffect, useState } from "react";
import { Check, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { api, dateTime, post } from "@/lib/client";
import type { PromptPayConfig } from "@/lib/types";
type PaymentSettings = PromptPayConfig & { gateway: {
  ready: boolean; mode: "test" | "live"; keyConfigured: boolean;
  webhookSecretConfigured: boolean; webhookUrl: string;
  reconciliationConfigured: boolean; testStorageAllowed: boolean;
} };
export default function PromptPaySettings() {
  const [config, setConfig] = useState<PaymentSettings>();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function load() {
    setError("");
    try {
      setConfig(await api<PaymentSettings>("settings/promptpay"));
      setPassword("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!config) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setConfig(
        await post<PaymentSettings>("settings/promptpay", {
          ...config,
          currentPassword: password,
        }),
      );
      setPassword("");
      setNotice("บันทึกการรับเงินแล้ว รายการซื้อใหม่จะใช้การตั้งค่านี้");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>PromptPay อัตโนมัติ · Omise</h2>
        <ShieldCheck size={21} />
      </div>
      {!config ? (
        <>
          <div className="loading-state">
            <LoaderCircle className="spin" />
            กำลังโหลดการตั้งค่า...
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="secondary-button" onClick={load}>
            ลองอีกครั้ง
          </button>
        </>
      ) : (
        <form onSubmit={save}>
          <div className={config.gateway.ready ? "success-banner" : "form-error"} role="status">
            {config.gateway.ready ? "ตั้งค่าการเชื่อมต่อแล้ว" : "ยังไม่พร้อมรับชำระ — ตั้งค่าคีย์ Omise ในส่วนการเชื่อมต่อเซิร์ฟเวอร์ด้านล่าง"}
            {config.gateway.mode === "test" ? " · โหมดทดสอบ ไม่มีเงินจริง" : " · โหมดรับเงินจริง"}
          </div>
          <ul className="gateway-checklist">
            <li>{config.gateway.keyConfigured ? "✓" : "○"} คีย์ Omise ตรงกับโหมดที่เลือก</li>
            <li>{config.gateway.webhookSecretConfigured ? "✓" : "○"} คีย์ตรวจลายเซ็น webhook</li>
            <li>{config.gateway.webhookUrl ? "✓" : "○"} URL รับผลการจ่ายผ่าน HTTPS</li>
            <li>{config.gateway.reconciliationConfigured ? "✓" : "○"} คีย์สำหรับงานตรวจสถานะสำรองตามเวลา</li>
          </ul>
          {!config.gateway.testStorageAllowed && <p className="form-error">โหมดทดสอบต้องใช้ฐานข้อมูล demo แยกจากข้อมูลขายจริง</p>}
          <p className="small-print">ตั้งค่าคีย์ผ่านส่วนการเชื่อมต่อเซิร์ฟเวอร์ด้านล่าง แล้วรีสตาร์ตแอปเพื่อเริ่มใช้ค่าใหม่</p>
          {config.gateway.webhookUrl && <p className="small-print gateway-url">Webhook: {config.gateway.webhookUrl}</p>}
          <div className="settings-row">
            <div>
              <strong>เปิดรับชำระผ่าน PromptPay</strong>
              <p>สแกนจ่าย → Omise แจ้งผล → ออกใบเสร็จอัตโนมัติ</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="เปิดรับชำระผ่าน PromptPay"
              aria-checked={config.enabled}
              className={`toggle ${config.enabled ? "on" : ""}`}
              disabled={busy}
              onClick={() => setConfig({ ...config, enabled: !config.enabled })}
            >
              <span />
            </button>
          </div>
          <label className="field">
            ชื่อร้านที่แสดงขณะชำระเงิน
            <input
              value={config.recipientName}
              onChange={(e) =>
                setConfig({ ...config, recipientName: e.target.value })
              }
              autoComplete="off"
              maxLength={100}
              required={config.enabled}
              placeholder="สหกรณ์โรงเรียน DSKRU"
            />
          </label>
          <label className="field">
            รหัสผ่านของคุณเพื่อบันทึก
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          <p className="permission-note">
            <ShieldCheck size={18} />
            บัญชีรับเงินจริงตั้งค่าใน Omise การแก้ชื่อร้านตรงนี้ไม่เปลี่ยนบัญชีรับเงิน
          </p>
          <p className="small-print" style={{ marginBottom: 15 }}>
            รับเฉพาะการโอน ขั้นต่ำ 20 บาทต่อรายการ QR มีอายุ 5 นาที
            ระบบตรวจยอดกับ API โดยไม่ต้องให้เจ้าหน้าที่กดยืนยัน
          </p>
          {config.updatedAt && (
            <p className="small-print">
              แก้ไขล่าสุด {dateTime(config.updatedAt)}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="success-banner" role="status">
              <Check size={17} />
              {notice}
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={load}
              disabled={busy}
            >
              <RefreshCw size={16} />
              โหลดล่าสุด
            </button>
            <button className="primary-button" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <Check size={18} />
              )}
              บันทึก PromptPay
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
