import { can } from "./permissions";
import type { Role } from "./types";

export const exportLabels = {
  inventory: "สินค้าและสต็อก",
  sales: "รายการขายและรายละเอียดสินค้า",
  budget: "บัญชีรายรับ–รายจ่าย",
} as const;
export type ExportSection = keyof typeof exportLabels;
export type ExportKind = "all" | ExportSection;

export function allowedExports(role: Role): ExportSection[] {
  return (Object.keys(exportLabels) as ExportSection[]).filter((section) =>
    can(role, section === "sales" ? "transactions" : section),
  );
}
