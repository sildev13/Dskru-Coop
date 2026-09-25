import { randomUUID } from "node:crypto";
import { AppError, cents, completePurchase, createPurchase } from "./domain";
import { mutate, readState } from "./store";
import { paymentConfig } from "./payments";
import { assertChargeMatches, createCharge, findCharge, gatewayConfig, OmiseError, qrImage, retrieveCharge, type OmiseCharge } from "./omise";
import type { Purchase, State } from "./types";
import { shopConfig } from "./shop-config";
import { serverConfigChanging, serverConfigView } from "./server-config";

export function publicPurchase(order: Purchase) {
  return {
    id: order.id, timestamp: order.timestamp, completedAt: order.completedAt,
    items: order.items, total: order.total, paymentMethod: order.paymentMethod,
    status: order.status, studentId: order.studentId, recipientName: order.recipientName,
    confirmedBy: order.confirmedBy,
    ...(order.gateway ? { payment: {
      provider: order.gateway.provider, mode: order.gateway.mode, status: order.gateway.status,
      expiresAt: order.gateway.expiresAt, error: order.gateway.error,
      ...(order.status === "pending" && order.gateway.status === "pending" ? { qrImageUrl: order.gateway.qrImageUrl } : {}),
    } } : {}),
  };
}

export function applyCharge(state: State, orderId: string, charge: OmiseCharge) {
  const order = state.transactions.find((p) => p.id === orderId);
  if (!order) throw new AppError("ไม่พบรายการ", 404);
  assertChargeMatches(order, charge);
  const payment = order.gateway!;
  if (state.transactions.some((p) => p.id !== order.id && p.gateway?.chargeId === charge.id))
    throw new AppError("การชำระเงินนี้ถูกใช้กับรายการอื่นแล้ว", 409);
  if (order.status === "completed") return order;
  if (order.status === "cancelled") {
    if (charge.status !== "successful" || !charge.paid) return order;
    // Preserve a late provider correction that says money did arrive. Complete
    // only if inventory still covers every reservation; otherwise flag it.
    order.status = "pending";
  }
  // Ignore delayed pending snapshots after a verified successful payment.
  if (payment.status === "successful" && charge.status !== "successful") return order;
  payment.chargeId = charge.id;
  payment.checkAfter = Date.now() + 8_000;
  if (charge.expires_at && Number.isFinite(Date.parse(charge.expires_at))) payment.expiresAt = charge.expires_at;
  delete payment.error;
  if (charge.status === "successful" && charge.paid) {
    payment.status = "successful";
    delete payment.qrImageUrl;
    try {
      completePurchase(state, order.id);
      order.confirmedBy = "omise";
    } catch (error) {
      // Persist receipt of money even if inventory was changed outside the app.
      // Leave the reservation intact so a retry can fulfill once corrected.
      if (!(error instanceof AppError)) throw error;
      payment.error = "ได้รับเงินแล้ว แต่จัดสินค้าไม่สำเร็จ กรุณาติดต่อร้านพร้อมหมายเลขรายการ ไม่ต้องชำระซ้ำ";
    }
  } else if ((charge.status === "failed" || charge.status === "expired") && !charge.paid) {
    payment.status = charge.status;
    order.status = "cancelled";
    delete payment.qrImageUrl;
  } else if (charge.status === "pending" && !charge.paid) {
    payment.status = "pending";
    const image = qrImage(charge);
    if (image) payment.qrImageUrl = image;
  } else {
    throw new AppError("สถานะการชำระเงินยังไม่ชัดเจน กรุณารอระบบตรวจสอบ", 409);
  }
  return order;
}

export async function startCheckout(input: Parameters<typeof createPurchase>[1]) {
  const config = gatewayConfig();
  const claim = await mutate((state) => {
    const previous = state.transactions.find((p) => p.requestId === input.requestId);
    if (previous) {
      if (JSON.stringify(previous.items.map(({ id, qty }) => ({ id, qty }))) !== JSON.stringify(input.items) || previous.paymentMethod !== input.paymentMethod || (previous.studentId || "") !== (input.studentId || ""))
        throw new AppError("รหัสรายการนี้ถูกใช้งานแล้ว กรุณาเริ่มรายการใหม่", 409);
      return { order: previous, create: false };
    }
    const settings = paymentConfig(state.settings);
    if (serverConfigChanging() || serverConfigView().pendingRestart) throw new AppError("ร้านกำลังปรับการเชื่อมต่อ กรุณารอผู้ดูแลเริ่มระบบใหม่", 409);
    if (input.paymentMethod !== "promptpay") throw new AppError("รับชำระด้วยพร้อมเพย์เท่านั้น");
    if (!settings.enabled || !config.ready) throw new AppError("ยังไม่ได้เปิดรับชำระอัตโนมัติ กรุณาให้ผู้ดูแลตั้งค่า Omise", 409);
    if (state.transactions.filter((p) => p.status === "pending" && p.gateway).length >= 100)
      throw new AppError("มีรายการรอชำระจำนวนมาก กรุณาลองใหม่ภายหลัง", 429);
    const order = createPurchase(state, input);
    const shop = shopConfig(state.settings);
    if (cents(order.total) < cents(shop.minimumOrder) || cents(order.total) > cents(shop.maximumOrder))
      throw new AppError(`ร้านรับยอด ${shop.minimumOrder}–${shop.maximumOrder} บาทต่อรายการ`);
    order.recipientName = settings.recipientName;
    order.gateway = {
      provider: "omise", mode: config.mode, reference: randomUUID(), status: "creating",
      expiresAt: new Date(Date.now() + 300_000).toISOString(), checkAfter: Date.now() + 20_000,
    };
    return { order, create: true };
  });
  if (!claim.create) return reconcilePurchase(claim.order.id);
  try {
    const charge = await createCharge(claim.order);
    return await mutate((state) => applyCharge(state, claim.order.id, charge));
  } catch (error) {
    // A rejected create is terminal. For network/unknown outcomes, preserve the
    // reservation and recover the original charge via its metadata or webhook.
    return mutate((state) => {
      const order = state.transactions.find((p) => p.id === claim.order.id)!;
      if (order.status !== "pending" || order.gateway!.chargeId) return order;
      if (error instanceof OmiseError && error.definitive) {
        order.status = "cancelled";
        order.gateway!.status = "failed";
        order.gateway!.error = "สร้าง QR ไม่สำเร็จ กรุณาให้ผู้ดูแลตรวจการเปิดใช้ PromptPay และคีย์ Omise";
      } else {
        order.gateway!.error = "กำลังกู้คืนสถานะจากผู้ให้บริการ กรุณารอสักครู่ ไม่ต้องสร้างรายการซ้ำ";
      }
      return order;
    });
  }
}

export async function reconcilePurchase(id: string): Promise<Purchase> {
  const snapshot = (await readState()).transactions.find((p) => p.id === id);
  if (!snapshot) throw new AppError("ไม่พบรายการ", 404);
  if (snapshot.status !== "pending" || !snapshot.gateway || snapshot.gateway.checkAfter > Date.now()) return snapshot;
  const claim = await mutate((state) => {
    const order = state.transactions.find((p) => p.id === id)!;
    if (order.status !== "pending" || !order.gateway || order.gateway.checkAfter > Date.now()) return null;
    order.gateway.checkAfter = Date.now() + 20_000;
    return order;
  });
  if (!claim) return (await readState()).transactions.find((p) => p.id === id)!;
  try {
    const charge = claim.gateway!.chargeId ? await retrieveCharge(claim.gateway!.chargeId) : await findCharge(claim);
    return await mutate((state) => {
      if (charge) return applyCharge(state, id, charge);
      const order = state.transactions.find((p) => p.id === id)!;
      // No QR was ever returned, and an exhaustive authenticated list confirms
      // no charge exists after the creation window. Never expire a known charge
      // from the local clock alone: it might already have been paid.
      if (order.status === "pending" && !order.gateway!.chargeId && Date.now() > Date.parse(order.gateway!.expiresAt) + 60_000) {
        order.gateway!.status = "expired";
        order.status = "cancelled";
        delete order.gateway!.error;
      }
      return order;
    });
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return mutate((state) => {
      const order = state.transactions.find((p) => p.id === id)!;
      if (order.status === "pending" && order.gateway!.status !== "successful")
        order.gateway!.error = error.message;
      return order;
    });
  }
}

export function cancelUnpaid(state: State, id: string, actor?: string) {
  const order = state.transactions.find((p) => p.id === id);
  if (!order) throw new AppError("ไม่พบรายการ", 404);
  if (order.status === "completed") throw new AppError("รายการนี้ชำระเงินแล้ว", 409);
  if (order.status === "pending" && order.gateway)
    throw new AppError("QR ที่ออกแล้วต้องรอผลจากผู้ให้บริการหรือหมดอายุ ระบบจะตรวจและปิดรายการอัตโนมัติ", 409);
  order.status = "cancelled";
  if (actor) order.cancelledBy = actor;
  return order;
}
