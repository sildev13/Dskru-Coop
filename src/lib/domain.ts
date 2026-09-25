import { randomUUID } from "node:crypto";
import type { State, Purchase } from "./types";
import { shopConfig } from "./shop-config";
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const cents = (amount: number) => Math.round(amount * 100);
// Keep reservations until the provider confirms a terminal outcome. A local
// clock or a customer's cancel request cannot establish that no money moved.
export function reservedStock(state: State, itemId: string) {
  return state.transactions.reduce((sum, order) => sum + (
    order.status === "pending" && order.gateway
      ? order.items.filter((line) => line.id === itemId).reduce((n, line) => n + line.qty, 0)
      : 0
  ), 0);
}
export function createPurchase(
  state: State,
  input: {
    items: { id: string; qty: number }[];
    paymentMethod: "cash" | "promptpay";
    studentId?: string;
    requestId: string;
  },
): Purchase {
  const existing = state.transactions.find(
    (t) => t.requestId === input.requestId,
  );
  if (existing) return existing;
  if (!state.settings.storeOpen)
    throw new AppError("ร้านปิดชั่วคราว กรุณาติดต่อเจ้าหน้าที่", 409);
  const shop = shopConfig(state.settings);
  if (shop.studentIdMode === "hidden" && input.studentId) throw new AppError("ร้านปิดการรับรหัสนักเรียนแล้ว กรุณาโหลดหน้าร้านใหม่");
  const studentId = shop.studentIdMode === "hidden" ? "" : input.studentId || "";
  if (shop.studentIdMode === "required" && !studentId) throw new AppError("กรุณากรอกรหัสนักเรียน");
  if (studentId && (!/^[0-9]{1,30}$/.test(studentId) || (shop.studentIdLength > 0 && studentId.length !== shop.studentIdLength)))
    throw new AppError(shop.studentIdLength ? `รหัสนักเรียนต้องเป็นตัวเลข ${shop.studentIdLength} หลัก` : "รหัสนักเรียนต้องเป็นตัวเลขไม่เกิน 30 หลัก");
  if (
    !input.items.length ||
    new Set(input.items.map((i) => i.id)).size !== input.items.length
  )
    throw new AppError("รายการสินค้าไม่ถูกต้อง");
  const items = input.items.map((line) => {
    const item = state.items.find((i) => i.id === line.id && i.active);
    if (!item || !Number.isInteger(line.qty) || line.qty < 1 || line.qty > shop.maxItemQuantity)
      throw new AppError("รายการสินค้าไม่ถูกต้อง");
    if (item.stock - reservedStock(state, item.id) < line.qty)
      throw new AppError(`${item.name} มีสินค้าไม่เพียงพอ`, 409);
    return { id: item.id, name: item.name, price: item.price, qty: line.qty };
  });
  const purchase: Purchase = {
    id: randomUUID(),
    accessToken: randomUUID(),
    requestId: input.requestId,
    items,
    total: items.reduce((sum, i) => sum + cents(i.price) * i.qty, 0) / 100,
    paymentMethod: input.paymentMethod,
    status: "pending",
    timestamp: new Date().toISOString(),
    ...(studentId ? { studentId } : {}),
  };
  state.transactions.unshift(purchase);
  return purchase;
}
export function completePurchase(state: State, id: string): Purchase {
  const purchase = state.transactions.find((t) => t.id === id);
  if (!purchase) throw new AppError("ไม่พบรายการ", 404);
  if (purchase.status === "completed") return purchase;
  if (purchase.status !== "pending")
    throw new AppError("รายการนี้ถูกยกเลิกแล้ว", 409);
  for (const line of purchase.items) {
    const item = state.items.find((i) => i.id === line.id);
    const otherReservations = reservedStock(state, line.id) - (purchase.gateway ? line.qty : 0);
    if (!item || !item.active || item.stock < line.qty + otherReservations)
      throw new AppError(
        `${line.name} มีสินค้าไม่เพียงพอ กรุณาตรวจสอบและคืนเงินหากรับชำระแล้ว`,
        409,
      );
  }
  for (const line of purchase.items)
    state.items.find((i) => i.id === line.id)!.stock -= line.qty;
  state.settings.cooperativeBalance =
    (cents(state.settings.cooperativeBalance) + cents(purchase.total)) / 100;
  purchase.status = "completed";
  purchase.completedAt = new Date().toISOString();
  return purchase;
}
