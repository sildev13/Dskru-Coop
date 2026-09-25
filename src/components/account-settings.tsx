"use client";
import { useState } from "react";
import { KeyRound, LoaderCircle } from "lucide-react";
import { post } from "@/lib/client";
import { roleLabels } from "@/lib/permissions";
import type { SafeUser } from "@/lib/types";
export default function AccountSettings({
  user,
  onChanged,
}: {
  user: SafeUser;
  onChanged: () => void;
}) {
  const [currentPassword, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) {
      setError("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน");
      return;
    }
    setBusy(true);
    try {
      await post("admin/password", { currentPassword, password });
      setCurrent("");
      setPassword("");
      setConfirmation("");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admin-columns">
      <section className="panel">
        <div className="panel-heading">
          <h2>บัญชีของฉัน</h2>
          <KeyRound size={20} />
        </div>
        <div className="settings-row">
          <div>
            <strong>{user.displayName}</strong>
            <p>@{user.username}</p>
          </div>
          <span className="status-badge">{roleLabels[user.role]}</span>
        </div>
        <form onSubmit={save}>
          <label className="field">
            รหัสผ่านปัจจุบัน
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrent(e.target.value)}
              maxLength={128}
              required
            />
          </label>
          <label className="field">
            รหัสผ่านใหม่
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={12}
              maxLength={128}
              placeholder="อย่างน้อย 12 ตัวอักษร"
              required
            />
          </label>
          <label className="field">
            ยืนยันรหัสผ่านใหม่
            <input
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              minLength={12}
              maxLength={128}
              required
            />
          </label>
          <p className="muted" style={{ marginBottom: 18 }}>
            เมื่อเปลี่ยนรหัสผ่านสำเร็จ ให้เข้าสู่ระบบใหม่ทุกอุปกรณ์
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" disabled={busy}>
            {busy && <LoaderCircle className="spin" size={18} />}เปลี่ยนรหัสผ่าน
          </button>
        </form>
      </section>
    </div>
  );
}
