"use client";
import { useEffect, useState } from "react";
import { Check, Edit3, LoaderCircle, Plus, Users } from "lucide-react";
import { api, dateTime, post } from "@/lib/client";
import { roleLabels } from "@/lib/permissions";
import type { Role, SafeUser } from "@/lib/types";
import { Modal } from "./shared";
type Draft = {
  id?: string;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
  password: string;
};
export default function StaffUsers({
  currentUser,
  onSelfChanged,
}: {
  currentUser: SafeUser;
  onSelfChanged: () => void;
}) {
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  async function refresh() {
    try {
      setUsers(await api<SafeUser[]>("admin/users"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setError("");
    setBusy(true);
    try {
      await post("admin/users/save", {
        ...draft,
        password: draft.password || undefined,
      });
      if (draft.id === currentUser.id) {
        onSelfChanged();
        return;
      }
      setDraft(null);
      setNotice("บันทึกบัญชีแล้ว");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>
          <Users size={19} /> บัญชีเจ้าหน้าที่
        </h2>
        <button
          className="primary-button"
          onClick={() => {
            setDraft({
              username: "",
              displayName: "",
              role: "cashier",
              active: true,
              password: "",
            });
            setError("");
            setNotice("");
          }}
        >
          <Plus size={17} />
          เพิ่มบัญชี
        </button>
      </div>
      <div className="role-cards">
        {Object.entries(roleLabels).map(([key, label]) => (
          <div key={key}>
            <strong>{label}</strong>
            <p>
              {key === "admin"
                ? "จัดการทุกส่วน บัญชีผู้ใช้ และการรับเงิน"
                : key === "cashier"
                  ? "ดูรายการขาย สถิติ และยืนยันการชำระเงิน"
                  : "เพิ่มสินค้า แก้ไขราคา และเติมสต็อก"}
            </p>
          </div>
        ))}
      </div>
      {notice && (
        <p className="success-banner" role="status">
          <Check size={17} />
          {notice}
        </p>
      )}
      {error && !draft && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <div className="loading-state">
          <LoaderCircle className="spin" />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ชื่อ / บัญชี</th>
                <th>สิทธิ์</th>
                <th>สถานะ</th>
                <th>แก้ไขล่าสุด</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    {user.displayName}
                    {user.id === currentUser.id && " (คุณ)"}
                    <small>@{user.username}</small>
                  </td>
                  <td>{roleLabels[user.role]}</td>
                  <td>
                    <span
                      className={`status-badge ${user.active ? "" : "cancelled"}`}
                    >
                      {user.active ? "ใช้งานได้" : "ปิดใช้งาน"}
                    </span>
                  </td>
                  <td>{dateTime(user.updatedAt)}</td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`แก้ไขบัญชี ${user.username}`}
                      onClick={() => {
                        setDraft({ ...user, password: "" });
                        setError("");
                        setNotice("");
                      }}
                    >
                      <Edit3 size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {draft && (
        <Modal
          title={draft.id ? "แก้ไขบัญชีเจ้าหน้าที่" : "เพิ่มบัญชีเจ้าหน้าที่"}
          onClose={() => {
            if (!busy) setDraft(null);
          }}
        >
          <form onSubmit={save}>
            <label className="field">
              ชื่อที่แสดง
              <input
                value={draft.displayName}
                onChange={(e) =>
                  setDraft({ ...draft, displayName: e.target.value })
                }
                required
                maxLength={80}
              />
            </label>
            <label className="field">
              ชื่อผู้ใช้
              <input
                value={draft.username}
                onChange={(e) =>
                  setDraft({ ...draft, username: e.target.value })
                }
                required
                minLength={3}
                maxLength={40}
                autoComplete="off"
                autoCapitalize="none"
              />
            </label>
            <label className="field">
              สิทธิ์
              <select
                disabled={draft.id === currentUser.id}
                value={draft.role}
                onChange={(e) =>
                  setDraft({ ...draft, role: e.target.value as Role })
                }
              >
                {Object.entries(roleLabels).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {draft.id
                ? "ตั้งรหัสผ่านใหม่ (เว้นว่างเพื่อใช้รหัสเดิม)"
                : "รหัสผ่านเริ่มต้น"}
              <input
                type="password"
                value={draft.password}
                onChange={(e) =>
                  setDraft({ ...draft, password: e.target.value })
                }
                required={!draft.id}
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                placeholder="อย่างน้อย 12 ตัวอักษร"
              />
            </label>
            <label className="verification-check">
              <input
                type="checkbox"
                checked={draft.active}
                disabled={draft.id === currentUser.id}
                onChange={(e) =>
                  setDraft({ ...draft, active: e.target.checked })
                }
              />
              เปิดใช้งานบัญชี
            </label>
            {draft.id && (
              <p className="small-print" style={{ marginTop: 15 }}>
                เมื่อบันทึก บัญชีนี้จะต้องเข้าสู่ระบบใหม่ทุกอุปกรณ์
              </p>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                ยกเลิก
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <Check size={18} />
                )}
                บันทึกบัญชี
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
