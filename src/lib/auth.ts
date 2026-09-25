import { serverEnv } from "@/lib/server-config";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { AppError } from "./domain";
import { db, isDemo, mutate, readState } from "./store";
import { dummyHash, hashPassword, verifyPassword } from "./passwords";
import { can, safeUser, type Permission } from "./permissions";
import type { Session, State, User } from "./types";

const cookieName = "dskru_session";
const lifetime = 15 * 60_000;
const absoluteLifetime = 8 * 60 * 60_000;
export const tokenId = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function sessionId(request: NextRequest) {
  const token = request.cookies.get(cookieName)?.value;
  return token && /^[a-f0-9]{64}$/.test(token) ? tokenId(token) : "";
}
export function currentUser(state: State, id: string): User | null {
  const session = state.sessions.find((s) => s.id === id);
  if (
    !session ||
    session.expiresAt <= Date.now() ||
    session.createdAt + absoluteLifetime <= Date.now()
  )
    return null;
  return state.users.find((u) => u.id === session.userId && u.active) || null;
}
export async function getUser(request: NextRequest): Promise<User | null> {
  const id = sessionId(request);
  if (!id) return null;
  if (isDemo()) return currentUser(await readState(), id);
  const session = (await db().doc(`sessions/${id}`).get()).data() as
    Session | undefined;
  if (
    !session ||
    session.expiresAt <= Date.now() ||
    session.createdAt + absoluteLifetime <= Date.now()
  )
    return null;
  const user = (await db().doc(`users/${session.userId}`).get()).data() as
    User | undefined;
  return user?.active ? user : null;
}
export async function setupRequired() {
  return isDemo()
    ? !(await readState()).users.length
    : (await db().collection("users").limit(1).get()).empty;
}
export async function requireUser(
  request: NextRequest,
  permission?: Permission,
) {
  const user = await getUser(request);
  if (!user) throw new AppError("กรุณาเข้าสู่ระบบเจ้าหน้าที่", 401);
  if (permission && !can(user.role, permission))
    throw new AppError("บัญชีนี้ไม่มีสิทธิ์ใช้งานส่วนนี้", 403);
  return user;
}
export async function authorizedMutation<T>(
  request: NextRequest,
  permission: Permission,
  operation: (state: State, user: User) => T,
) {
  return mutate((state) => {
    const user = currentUser(state, sessionId(request));
    if (!user) throw new AppError("กรุณาเข้าสู่ระบบเจ้าหน้าที่", 401);
    if (!can(user.role, permission))
      throw new AppError("บัญชีนี้ไม่มีสิทธิ์ใช้งานส่วนนี้", 403);
    return operation(state, user);
  });
}
export function setSession(response: NextResponse, token?: string) {
  response.cookies.set(cookieName, token || "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && !isDemo(),
    sameSite: "strict",
    path: "/",
    maxAge: token ? 15 * 60 : 0,
  });
  // Clear the retired shared PIN cookie during migration.
  response.cookies.set("dskru_admin", "", {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
function newSession(state: State, userId: string, token: string) {
  state.sessions = state.sessions.filter(
    (s) =>
      s.expiresAt > Date.now() && s.createdAt + absoluteLifetime > Date.now(),
  );
  state.sessions.push({
    id: tokenId(token),
    userId,
    expiresAt: Date.now() + lifetime,
    createdAt: Date.now(),
  });
}
export async function rateLimit(key: string, limit = 5) {
  const now = Date.now();
  function next(previous?: { count: number; reset: number }) {
    const bucket =
      previous && previous.reset > now
        ? previous
        : { count: 0, reset: now + 15 * 60_000 };
    if (bucket.count >= limit)
      throw new AppError("ลองเข้าสู่ระบบมากเกินไป กรุณารอ 15 นาที", 429);
    return { ...bucket, count: bucket.count + 1 };
  }
  if (isDemo())
    await mutate((state) => {
      state.attempts = Object.fromEntries(
        Object.entries(state.attempts).filter(([, v]) => v.reset > now),
      );
      state.attempts[key] = next(state.attempts[key]);
    });
  else
    await db().runTransaction(async (tx) => {
      const ref = db().doc(`security/${key}`);
      const snapshot = await tx.get(ref);
      tx.set(
        ref,
        next(snapshot.data() as { count: number; reset: number } | undefined),
      );
    });
}
async function clearAttempts(key: string) {
  if (isDemo())
    await mutate((s) => {
      delete s.attempts[key];
    });
  else await db().doc(`security/${key}`).delete();
}
export async function verifyCurrentPassword(user: User, password: string) {
  const key = `reauth-${user.id}`;
  await rateLimit(key);
  if (!(await verifyPassword(password, user.passwordHash)))
    throw new AppError("รหัสผ่านปัจจุบันไม่ถูกต้อง", 400);
  await clearAttempts(key);
}
export async function login(
  username: string,
  password: string,
  request: NextRequest,
) {
  const key = `login-${tokenId(username)}`;
  await rateLimit("login-global", 100);
  await rateLimit(key);
  const state = await readState();
  const user = state.users.find((u) => u.username === username);
  const valid = await verifyPassword(password, user?.passwordHash || dummyHash);
  if (!user || !user.active || !valid)
    throw new AppError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", 401);
  const token = randomBytes(32).toString("hex");
  const result = await mutate((s) => {
    const current = s.users.find((u) => u.id === user.id);
    if (!current?.active || current.passwordHash !== user.passwordHash)
      throw new AppError("ข้อมูลบัญชีเปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่", 401);
    s.sessions = s.sessions.filter(
      (session) => session.id !== sessionId(request),
    );
    newSession(s, user.id, token);
    return safeUser(current);
  });
  await clearAttempts(key);
  return { token, user: result };
}
export async function firstAdmin(
  request: NextRequest,
  input: {
    username: string;
    displayName: string;
    password: string;
    setupToken?: string;
  },
) {
  await rateLimit("first-admin", 10);
  if (isDemo()) {
    const hostname = new URL(request.url).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname))
      throw new AppError("ตั้งค่าบัญชีแรกผ่านเครื่องที่เปิดระบบเท่านั้น", 403);
  } else {
    const expected = serverEnv("ADMIN_SETUP_TOKEN");
    if (!expected || expected.length < 24)
      throw new AppError(
        "ให้ผู้ติดตั้งกำหนด ADMIN_SETUP_TOKEN อย่างน้อย 24 ตัวอักษรก่อนสร้างบัญชีแรก",
        503,
      );
    if (
      !input.setupToken ||
      !timingSafeEqual(
        Buffer.from(tokenId(input.setupToken), "hex"),
        Buffer.from(tokenId(expected), "hex"),
      )
    )
      throw new AppError("รหัสตั้งค่าระบบไม่ถูกต้อง", 403);
  }
  if (!(await setupRequired()))
    throw new AppError("มีบัญชีผู้ดูแลระบบแล้ว กรุณาเข้าสู่ระบบ", 409);
  const passwordHash = await hashPassword(input.password);
  const token = randomBytes(32).toString("hex");
  const user = await mutate((state) => {
    if (state.users.length)
      throw new AppError("มีบัญชีผู้ดูแลระบบแล้ว กรุณาเข้าสู่ระบบ", 409);
    const timestamp = new Date().toISOString();
    const admin: User = {
      id: randomUUID(),
      username: input.username,
      displayName: input.displayName,
      passwordHash,
      role: "admin",
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    state.users.push(admin);
    newSession(state, admin.id, token);
    return safeUser(admin);
  });
  return { token, user };
}
export async function logout(request: NextRequest) {
  const id = sessionId(request);
  if (!id) return;
  if (isDemo())
    await mutate((s) => {
      s.sessions = s.sessions.filter((session) => session.id !== id);
    });
  else await db().doc(`sessions/${id}`).delete();
}
export async function renew(request: NextRequest) {
  await authorizedMutation(request, "account", (state) => {
    const session = state.sessions.find((s) => s.id === sessionId(request))!;
    session.expiresAt = Math.min(
      Date.now() + lifetime,
      session.createdAt + absoluteLifetime,
    );
  });
  return request.cookies.get(cookieName)!.value;
}
