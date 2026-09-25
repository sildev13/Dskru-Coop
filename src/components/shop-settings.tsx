"use client";
import { useEffect, useState } from "react";
import { Check, RefreshCw, SlidersHorizontal } from "lucide-react";
import { api, post } from "@/lib/client";
import type { ShopConfig } from "@/lib/shop-config";

type View = { config: ShopConfig; revision: number };
const textFields = [
  ["storeName", "ชื่อร้าน", 60], ["schoolName", "ชื่อโรงเรียน / คำอธิบายร้าน", 100],
  ["schoolShortName", "ชื่อย่อโรงเรียน", 30], ["eyebrow", "ข้อความเหนือหัวข้อ", 80],
  ["welcomeTitle", "หัวข้อหน้าร้าน", 80], ["welcomeMessage", "ข้อความต้อนรับ", 180],
  ["catalogNote", "ข้อความใต้รายการสินค้า", 180], ["supportMessage", "ข้อความใต้ตะกร้า", 180],
  ["footerText", "ข้อความท้ายเว็บ", 100],
] as const;
const numberFields = [
  ["idleMinutes", "ล้างตะกร้าเมื่อไม่ใช้งาน (นาที)", 1, 60],
  ["receiptSeconds", "แสดงใบเสร็จก่อนเริ่มใหม่ (วินาที)", 5, 300],
  ["maxItemQuantity", "จำนวนสูงสุดต่อสินค้าในหนึ่งรายการ", 1, 99],
  ["minimumOrder", "ยอดขั้นต่ำต่อรายการ (บาท)", 20, 150000],
  ["maximumOrder", "ยอดสูงสุดต่อรายการ (บาท)", 20, 150000],
] as const;
export default function ShopSettings() {
  const [view, setView] = useState<View>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function load() {
    setBusy(true); setError(""); setNotice("");
    try { setView(await api<View>("settings/shop")); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  function update<K extends keyof ShopConfig>(key: K, value: ShopConfig[K]) {
    setView((previous) => previous && ({ ...previous, config: { ...previous.config, [key]: value } }));
    setNotice("");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      setView(await post<View>("settings/shop", view));
      setNotice("บันทึกแล้ว หน้าร้านจะรับค่าใหม่อัตโนมัติ");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel settings-wide">
    <div className="panel-heading"><h2>หน้าร้านและการใช้งาน</h2><SlidersHorizontal size={21} /></div>
    <p className="small-print">ตั้งค่าชื่อร้าน ข้อความ และวิธีใช้งานได้จากหน้านี้ เวลาล้างตะกร้าจะไม่ยกเลิกรายการที่กำลังรอชำระ</p>
    {view && <form onSubmit={save}>
      <fieldset disabled={busy} className="config-fields">
        <legend>ข้อมูลที่แสดงบนเว็บและรายงาน</legend>
        <div className="config-form-grid">{textFields.map(([key, label, max]) => <label className="field" key={key}>
          {label}<input value={view.config[key]} maxLength={max}
            required={["storeName", "schoolName", "schoolShortName", "welcomeTitle"].includes(key)}
            onChange={(event) => update(key, event.target.value)} />
        </label>)}</div>
      </fieldset>
      <fieldset disabled={busy} className="config-fields">
        <legend>รหัสนักเรียนและการซื้อ</legend>
        <div className="config-form-grid">
          <label className="field">การกรอกรหัสนักเรียน<select value={view.config.studentIdMode} onChange={(e) => update("studentIdMode", e.target.value as ShopConfig["studentIdMode"])}>
            <option value="optional">ไม่บังคับ</option><option value="required">ต้องกรอกก่อนชำระเงิน</option><option value="hidden">ไม่เก็บรหัสนักเรียน</option>
          </select></label>
          <label className="field">จำนวนหลักของรหัส (0 = ไม่กำหนด สูงสุด 30 หลัก)
            <input type="number" min={0} max={30} step={1} required disabled={view.config.studentIdMode === "hidden"}
              value={view.config.studentIdLength} onChange={(e) => update("studentIdLength", Number(e.target.value))} />
          </label>
          {numberFields.map(([key, label, min, max]) => <label className="field" key={key}>{label}
            <input type="number" min={min} max={max} step={1} required value={view.config[key]} onChange={(e) => update(key, Number(e.target.value))} />
          </label>)}
        </div>
        <p className="small-print">ยอดรับชำระต้องอยู่ในช่วง 20–150,000 บาทตามระบบ Omise · รหัสนักเรียนยังไม่ได้ตรวจเทียบทะเบียนนักเรียน</p>
      </fieldset>
      <div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={load}><RefreshCw size={16} /> โหลดล่าสุด</button>
        <button className="primary-button" disabled={busy}><Check size={17} /> {busy ? "กำลังบันทึก..." : "บันทึกหน้าร้าน"}</button></div>
    </form>}
    {!view && <button className="secondary-button" disabled={busy} onClick={load}>{busy ? "กำลังโหลด..." : "ลองโหลดอีกครั้ง"}</button>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="success-banner" role="status">{notice}</p>}
  </section>;
}
