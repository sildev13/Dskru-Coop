import { z } from "zod";

export const shopConfigSchema = z.object({
  storeName: z.string().trim().min(1).max(60),
  schoolName: z.string().trim().min(1).max(100),
  schoolShortName: z.string().trim().min(1).max(30),
  eyebrow: z.string().trim().max(80),
  welcomeTitle: z.string().trim().min(1).max(80),
  welcomeMessage: z.string().trim().max(180),
  catalogNote: z.string().trim().max(180),
  supportMessage: z.string().trim().max(180),
  footerText: z.string().trim().max(100),
  studentIdMode: z.enum(["hidden", "optional", "required"]),
  studentIdLength: z.number().int().min(0).max(30),
  idleMinutes: z.number().int().min(1).max(60),
  receiptSeconds: z.number().int().min(5).max(300),
  maxItemQuantity: z.number().int().min(1).max(99),
  minimumOrder: z.number().int().min(20).max(150000),
  maximumOrder: z.number().int().min(20).max(150000),
}).strict().refine((v) => v.maximumOrder >= v.minimumOrder, "ยอดสูงสุดต้องไม่น้อยกว่ายอดขั้นต่ำ");

export type ShopConfig = z.infer<typeof shopConfigSchema>;
export const defaultShopConfig: ShopConfig = {
  storeName: "DSKRU CO-OP",
  schoolName: "สหกรณ์โรงเรียน DSKRU",
  schoolShortName: "DSKRU",
  eyebrow: "YOUR EVERYDAY LITTLE STORE",
  welcomeTitle: "วันนี้รับอะไรดี?",
  welcomeMessage: "เลือกของที่ชอบ แล้วไปเติมพลังกัน",
  catalogNote: "ของดีใกล้ตัว เพื่อทุกคนในโรงเรียน",
  supportMessage: "รายได้กลับมาดูแลโรงเรียนของเรา",
  footerText: "Powered By Sin ม.1/2",
  studentIdMode: "optional",
  studentIdLength: 0,
  idleMinutes: 5,
  receiptSeconds: 20,
  maxItemQuantity: 99,
  minimumOrder: 20,
  maximumOrder: 150000,
};
export function shopConfig(settings?: { shop?: Partial<ShopConfig> }): ShopConfig {
  return { ...defaultShopConfig, ...settings?.shop };
}
