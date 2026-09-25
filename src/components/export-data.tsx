"use client";
import { useState } from "react";
import { Download, FileSpreadsheet, LoaderCircle } from "lucide-react";
import { dayKey } from "@/lib/client";
import { allowedExports, exportLabels, type ExportKind } from "@/lib/export-options";
import type { Role } from "@/lib/types";
import { Modal } from "./shared";

export default function ExportData({ role, initialKind, onExported, onSessionExpired }: {
  role: Role;
  initialKind: ExportKind;
  onExported: () => void;
  onSessionExpired: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ExportKind>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const allowed = allowedExports(role);
  const sections = kind === "all" ? allowed : [kind];
  const hasDates = sections.some((section) => section !== "inventory");

  async function download(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (hasDates && from && to && from > to) {
      setError("วันเริ่มต้นต้องไม่อยู่หลังวันสิ้นสุด");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({ kind });
      if (hasDates && from) query.set("from", from);
      if (hasDates && to) query.set("to", to);
      const response = await fetch(`/api/admin/export?${query}`, { cache: "no-store" });
      if (response.status === 401) {
        onSessionExpired();
        return;
      }
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "ส่งออกไม่สำเร็จ กรุณาลองอีกครั้ง");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || "dskru-export.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setOpen(false);
      onExported();
    } catch (error) {
      setError(error instanceof Error ? error.message : "ดาวน์โหลดไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button className="secondary-button" onClick={() => {
      setKind(initialKind === "all" || allowed.includes(initialKind) ? initialKind : "all");
      setError("");
      setOpen(true);
    }}>
      <FileSpreadsheet size={18} /> ส่งออก Excel
    </button>
    {open && <Modal title="ส่งออกข้อมูล Excel" wide onClose={busy ? undefined : () => setOpen(false)}>
      <form onSubmit={download} aria-busy={busy}>
        <p className="muted">เลือกข้อมูลที่ต้องการเก็บหรือส่งให้อาจารย์ในไฟล์ .xlsx</p>
        <label className="field">ข้อมูลที่ต้องการ
          <select value={kind} disabled={busy} onChange={(event) => { setKind(event.target.value as ExportKind); setError(""); }}>
            <option value="all">ทั้งหมดตามสิทธิ์ของฉัน</option>
            {allowed.map((section) => <option key={section} value={section}>{exportLabels[section]}</option>)}
          </select>
        </label>
        <div className="export-description">
          <strong>ข้อมูลในไฟล์</strong>
          <p>สรุป · {sections.map((section) => exportLabels[section]).join(" · ")}</p>
          <p>รวมทุกรายการของประเภทที่เลือก ไม่จำกัดเฉพาะหน้าตารางที่กำลังเปิด</p>
        </div>
        {hasDates && <>
          <div className="export-periods" aria-label="เลือกช่วงวันที่อย่างรวดเร็ว">
            <button type="button" className="text-button" disabled={busy} onClick={() => { setFrom(""); setTo(""); setError(""); }}>ทุกช่วงเวลา</button>
            <button type="button" className="text-button" disabled={busy} onClick={() => { const today = dayKey(new Date()); setFrom(today); setTo(today); setError(""); }}>วันนี้</button>
            <button type="button" className="text-button" disabled={busy} onClick={() => { const today = dayKey(new Date()); setFrom(`${today.slice(0, 7)}-01`); setTo(today); setError(""); }}>เดือนนี้</button>
          </div>
          <div className="form-grid">
            <label className="field">ตั้งแต่วันที่
              <input type="date" value={from} disabled={busy} min="1900-01-01" max={to || "9999-12-31"} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label className="field">ถึงวันที่
              <input type="date" value={to} disabled={busy} min={from || "1900-01-01"} max="9999-12-31" onChange={(event) => setTo(event.target.value)} />
            </label>
          </div>
          <p className="small-print">เว้นว่างเพื่อรวมทุกวัน · ใช้เวลาไทย รวมวันสิ้นสุดด้วย</p>
          <p className="small-print">ยอดขายใช้วันชำระสำเร็จ หากไม่มีใช้วันสร้างรายการ ส่วนรายการรอชำระ/ยกเลิกและบัญชีอื่นใช้วันสร้างรายการ</p>
        </>}
        {sections.includes("inventory") && <p className="small-print export-note">สต็อกเป็นยอดปัจจุบัน รวมสินค้าปิดขาย ไม่เปลี่ยนตามช่วงวันที่</p>}
        {sections.includes("budget") && <p className="small-print export-note">บัญชีรวมยอดขายชำระแล้วและรายรับ–รายจ่ายอื่น ยอดคงเหลือในสรุปเป็นยอดปัจจุบัน</p>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={() => setOpen(false)}>ยกเลิก</button>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? <LoaderCircle size={18} className="spin" /> : <Download size={18} />}
            {busy ? "กำลังสร้างไฟล์..." : "ดาวน์โหลด Excel"}
          </button>
        </div>
      </form>
    </Modal>}
  </>;
}
