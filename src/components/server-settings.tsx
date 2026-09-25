"use client";
import { useEffect, useState } from "react";
import { Check, Database, RefreshCw } from "lucide-react";
import { api, post } from "@/lib/client";
import { serverConfigFields, type ServerConfigKey, type ServerConfigValues, type ServerConfigView } from "@/lib/server-config-fields";

export default function ServerSettings() {
  const [view, setView] = useState<ServerConfigView>();
  const [changes, setChanges] = useState<ServerConfigValues>({});
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function load() {
    setBusy(true); setError(""); setNotice("");
    try { setView(await api<ServerConfigView>("settings/server")); setChanges({}); setPassword(""); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  function change(key: ServerConfigKey, value: string, secret = false) {
    setNotice("");
    setChanges((previous) => {
      const next = { ...previous, [key]: value };
      if ((secret && !value) || (!secret && value === view?.values[key])) delete next[key];
      return next;
    });
  }
  async function save(discard = false) {
    if (!view) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await post<ServerConfigView>(discard ? "settings/server/discard" : "settings/server", { revision: view.revision, changes: discard ? {} : changes, currentPassword: password });
      setView(result); setChanges({}); setPassword("");
      setNotice(discard ? "ยกเลิกค่าที่รอแล้ว ระบบยังใช้ค่าปัจจุบัน" : result.pendingRestart ? "บันทึกแล้ว รีสตาร์ตเซิร์ฟเวอร์เพื่อเริ่มใช้ค่าใหม่ จากนั้นกลับมาเปิดร้าน" : "บันทึกแล้ว ค่าตรงกับที่กำลังใช้งาน");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function importFirebase(file?: File) {
    if (!file) return;
    setError(""); setNotice("");
    try {
      if (file.size > 64000) throw new Error();
      const data = JSON.parse(await file.text());
      if (data.type !== "service_account" || typeof data.project_id !== "string" || typeof data.client_email !== "string" || typeof data.private_key !== "string") throw new Error();
      setChanges((previous) => ({ ...previous, DATA_BACKEND: "firestore", FIREBASE_PROJECT_ID: data.project_id, FIREBASE_CLIENT_EMAIL: data.client_email, FIREBASE_PRIVATE_KEY: data.private_key }));
      setNotice("อ่านไฟล์ Firebase แล้ว ตรวจค่าและกดบันทึกเพื่อยืนยัน");
    } catch { setError("ใช้ไฟล์ JSON ของ Firebase service account ที่ดาวน์โหลดจาก Project settings"); }
  }
  return <section className="panel settings-wide">
    <div className="panel-heading"><h2>การเชื่อมต่อเซิร์ฟเวอร์</h2><Database size={21} /></div>
    <p className="small-print">ปิดรับรายการซื้อและรอการชำระที่ค้างให้เสร็จก่อนบันทึกส่วนนี้ ค่าใหม่เริ่มใช้หลังรีสตาร์ตเซิร์ฟเวอร์ คีย์เดิมจะไม่ส่งกลับมาแสดงบนเว็บ</p>
    {view && <>
      <div className={view.pendingRestart ? "form-error" : "success-banner"} role="status">
        {view.pendingRestart ? "มีการตั้งค่ารอรีสตาร์ต" : "ค่าที่บันทึกตรงกับที่ใช้งาน"} · ฐานข้อมูลปัจจุบัน: {view.activeValues.DATA_BACKEND}
        {view.activeValues.DATA_BACKEND === "firestore" && ` (${view.activeValues.FIREBASE_PROJECT_ID})`}
      </div>
      {view.pendingRestart && <p className="small-print">เครื่องนี้: หยุดคำสั่ง npm run dev แล้วเปิดใหม่ · บนโฮสต์: restart/redeploy แอปโดยใช้ดิสก์ตั้งค่าเดิม</p>}
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset className="config-fields" disabled={busy}>
          <legend>Firebase และตำแหน่งเก็บข้อมูล</legend>
          <label className="field">นำเข้าไฟล์ Firebase service account JSON
            <input type="file" accept=".json,application/json" onChange={(e) => { void importFirebase(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          <p className="small-print">เปลี่ยนโปรเจกต์หรือไฟล์ฐานข้อมูลไม่ได้ย้ายข้อมูลเดิม บัญชีเจ้าหน้าที่มาจากฐานข้อมูลที่เลือก หากปลายทางยังว่างให้ตั้งรหัสผู้ดูแลคนแรกก่อนเปลี่ยน</p>
        </fieldset>
        {(["database", "payment"] as const).map((group) => <details className="config-details" key={group} open={group === "database"}>
          <summary>{group === "database" ? "ค่าฐานข้อมูล" : "คีย์ Omise และ Webhook"}</summary>
          <fieldset className="config-fields" disabled={busy}>
            <div className="config-form-grid">{serverConfigFields.filter((f) => f.group === group).map((field) => {
              const secret = "secret" in field && field.secret;
              const value = changes[field.key] ?? (secret ? "" : view.values[field.key] || "");
              return <div key={field.key}>
                <label className="field">{field.label}
                  {"options" in field ? <select value={value} onChange={(e) => change(field.key, e.target.value)}>
                    {field.options.map((option) => <option key={option} value={option}>{option === "demo" ? "Demo · ไฟล์ในเครื่อง" : option === "firestore" ? "Cloud Firestore" : option === "test" ? "Test · ไม่มีเงินจริง" : "Live · รับเงินจริง"}</option>)}
                  </select> : "multiline" in field ? <textarea rows={3} value={value} autoComplete="off" spellCheck={false}
                    placeholder={view.secrets[field.key]?.configured ? "มีคีย์แล้ว — เว้นว่างเพื่อเก็บค่าเดิม" : "วาง Private Key หรือใช้ไฟล์ JSON ด้านบน"}
                    onChange={(e) => change(field.key, e.target.value, secret)} /> : <input type={secret ? "password" : "text"} value={value} autoComplete="off" spellCheck={false}
                    placeholder={secret && view.secrets[field.key]?.configured ? "มีคีย์แล้ว — เว้นว่างเพื่อเก็บค่าเดิม" : ""}
                    onChange={(e) => change(field.key, e.target.value, secret)} />}
                </label>
                {secret && <label className="config-clear-secret"><input type="checkbox" checked={changes[field.key] === ""}
                  onChange={(e) => setChanges((previous) => { const next = { ...previous }; if (e.target.checked) next[field.key] = ""; else delete next[field.key]; return next; })} /> ล้างคีย์นี้</label>}
                {"help" in field && <p className="small-print">{field.help}</p>}
              </div>;
            })}</div>
          </fieldset>
        </details>)}
        <label className="field">รหัสผ่านผู้ดูแลเพื่อบันทึกการเชื่อมต่อ
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required maxLength={128} disabled={busy} />
        </label>
        <div className="modal-actions config-actions">
          <button className="secondary-button" type="button" onClick={load} disabled={busy}><RefreshCw size={16} /> โหลดล่าสุด</button>
          {view.pendingRestart && <button type="button" className="secondary-button" disabled={busy || !password} onClick={() => void save(true)}>ยกเลิกค่าที่รอรีสตาร์ต</button>}
          <button className="primary-button" disabled={busy || !Object.keys(changes).length}><Check size={17} /> {busy ? "กำลังบันทึก..." : "บันทึกการเชื่อมต่อ"}</button>
        </div>
      </form>
    </>}
    {!view && <button className="secondary-button" disabled={busy} onClick={load}>{busy ? "กำลังโหลด..." : "ลองโหลดอีกครั้ง"}</button>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="success-banner" role="status">{notice}</p>}
  </section>;
}
