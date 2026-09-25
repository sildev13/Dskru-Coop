import type { Role, User, SafeUser } from "./types";
export const roleLabels: Record<Role, string> = {
  admin: "ผู้ดูแลระบบ",
  cashier: "พนักงานขาย",
  stock: "ผู้ดูแลสต็อก",
};
export const permissions = {
  dashboard: ["admin", "cashier"],
  inventory: ["admin", "stock"],
  transactions: ["admin", "cashier"],
  analytics: ["admin", "cashier"],
  budget: ["admin"],
  settings: ["admin"],
  users: ["admin"],
  account: ["admin", "cashier", "stock"],
} satisfies Record<string, Role[]>;
export type Permission = keyof typeof permissions;
export function can(role: Role, permission: Permission) {
  return (permissions[permission] as readonly Role[]).includes(role);
}
export function safeUser(user: User): SafeUser {
  const { passwordHash, ...safe } = user;
  return safe;
}
