import { randomUUID } from "node:crypto";
import { AppError } from "./domain";
import type { State, User, Role } from "./types";
import { safeUser } from "./permissions";
export function saveUser(
  state: State,
  actor: User,
  input: {
    id?: string;
    username: string;
    displayName: string;
    role: Role;
    active: boolean;
  },
  passwordHash?: string,
) {
  const current = input.id
    ? state.users.find((u) => u.id === input.id)
    : undefined;
  if (input.id && !current) throw new AppError("ไม่พบบัญชีผู้ใช้", 404);
  if (
    state.users.some((u) => u.username === input.username && u.id !== input.id)
  )
    throw new AppError("ชื่อผู้ใช้นี้ถูกใช้งานแล้ว", 409);
  if (!current && !passwordHash)
    throw new AppError("กรุณากำหนดรหัสผ่านสำหรับบัญชีใหม่");
  if (current?.id === actor.id && (!input.active || input.role !== "admin"))
    throw new AppError(
      "ไม่สามารถปิดบัญชีหรือลดสิทธิ์ผู้ดูแลที่กำลังใช้งานได้",
      409,
    );
  if (
    current?.role === "admin" &&
    current.active &&
    (!input.active || input.role !== "admin") &&
    !state.users.some(
      (u) => u.id !== current.id && u.role === "admin" && u.active,
    )
  )
    throw new AppError(
      "ต้องเหลือผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 บัญชี",
      409,
    );
  if (current) {
    Object.assign(current, input, { updatedAt: new Date().toISOString() });
    if (passwordHash) current.passwordHash = passwordHash;
    // Role / status changes and password resets immediately end all existing sessions.
    state.sessions = state.sessions.filter((s) => s.userId !== current.id);
    return safeUser(current);
  }
  const timestamp = new Date().toISOString();
  const user: User = {
    ...input,
    id: randomUUID(),
    passwordHash: passwordHash!,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  state.users.push(user);
  return safeUser(user);
}
