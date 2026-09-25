"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, LoaderCircle, ShieldCheck } from "lucide-react";
import { api, post } from "@/lib/client";
import type { PublicConfig, SafeUser } from "@/lib/types";
import { Brand } from "./shared";
export default function StaffLogin({
  setupRequired,
  setupTokenRequired,
  demo,
  onAuthenticated,
}: {
  setupRequired: boolean;
  setupTokenRequired: boolean;
  demo: boolean;
  onAuthenticated: (user: SafeUser) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shop, setShop] = useState<PublicConfig["shop"]>();
  useEffect(() => { void api<{ config: PublicConfig }>("items").then((data) => setShop(data.config.shop)).catch(() => {}); }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (setupRequired && password !== confirmation) {
      setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
      return;
    }
    setBusy(true);
    try {
      const result = await post<{ user: SafeUser }>(
        setupRequired ? "admin/setup" : "admin/login",
        {
          username,
          password,
          ...(setupRequired ? { displayName, setupToken } : {}),
        },
      );
      setPassword("");
      setConfirmation("");
      setSetupToken("");
      onAuthenticated(result.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-card staff-login-card">
        <Brand config={shop} />
        <h1>
          {setupRequired ? "สร้างผู้ดูแลระบบคนแรก" : "เข้าสู่ระบบเจ้าหน้าที่"}
        </h1>
        <p>
          {setupRequired
            ? "เริ่มดูแลสหกรณ์โรงเรียนด้วยบัญชีของคุณ"
            : "ใช้บัญชีตามหน้าที่ที่ได้รับมอบหมาย"}
        </p>
        <form onSubmit={submit}>
          {setupRequired && (
            <label className="field">
              ชื่อที่แสดง
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
                maxLength={80}
                required
              />
            </label>
          )}
          <label className="field">
            ชื่อผู้ใช้
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              minLength={3}
              maxLength={40}
              required
              placeholder="เช่น admin.school"
            />
          </label>
          <label className="field">
            รหัสผ่าน
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={setupRequired ? "new-password" : "current-password"}
              minLength={setupRequired ? 12 : 1}
              maxLength={128}
              required
              placeholder={
                setupRequired ? "อย่างน้อย 12 ตัวอักษร" : "รหัสผ่านของคุณ"
              }
            />
          </label>
          {setupRequired && (
            <>
              <label className="field">
                ยืนยันรหัสผ่าน
                <input
                  type="password"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
              </label>
              {setupTokenRequired && (
                <label className="field">
                  รหัสตั้งค่าระบบ
                  <input
                    type="password"
                    value={setupToken}
                    onChange={(e) => setSetupToken(e.target.value)}
                    autoComplete="off"
                    required
                    maxLength={256}
                  />
                  <span className="small-print">
                    รับรหัสนี้จากผู้ติดตั้งระบบ
                  </span>
                </label>
              )}
              <p className="permission-note">
                <ShieldCheck size={18} />
                บัญชีแรกเป็นผู้ดูแลระบบ
                สามารถสร้างบัญชีพนักงานได้หลังเข้าสู่ระบบ
              </p>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button full-width" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={20} />
            ) : (
              <>
                {setupRequired ? "สร้างบัญชีผู้ดูแล" : "เข้าสู่ระบบ"}
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
        {demo && (
          <p className="demo-login">
            โหมดทดลอง · ข้อมูลบัญชีบันทึกบนเครื่องนี้
          </p>
        )}
        <Link className="back-to-shop" href="/">
          <ArrowLeft size={15} />
          กลับหน้าร้าน
        </Link>
      </div>
    </main>
  );
}
