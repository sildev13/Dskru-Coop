import type { ShopConfig } from "./shop-config";
export type Category = "drinks" | "snacks" | "food" | "supplies";
export type Item = {
  id: string;
  name: string;
  subtitle: string;
  price: number;
  stock: number;
  barcode: string;
  category: Category;
  image: string;
  reorderLevel: number;
  active: boolean;
};
export type Line = { id: string; name: string; qty: number; price: number };
export type GatewayPayment = {
  provider: "omise";
  mode: "test" | "live";
  reference: string;
  status: "creating" | "pending" | "successful" | "failed" | "expired";
  expiresAt: string;
  checkAfter: number;
  chargeId?: string;
  qrImageUrl?: string;
  error?: string;
};
export type PaymentDisplay = Pick<GatewayPayment, "provider" | "mode" | "status" | "expiresAt" | "qrImageUrl" | "error">;
export type Purchase = {
  id: string;
  accessToken: string;
  timestamp: string;
  completedAt?: string;
  items: Line[];
  total: number;
  paymentMethod: "promptpay" | "cash";
  status: "pending" | "completed" | "cancelled";
  studentId?: string;
  requestId: string;
  qrPayload?: string;
  recipientName?: string;
  confirmedBy?: string;
  cancelledBy?: string;
  gateway?: GatewayPayment;
  payment?: PaymentDisplay;
};
export type Role = "admin" | "cashier" | "stock";
export type User = {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: Role;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};
export type SafeUser = Omit<User, "passwordHash">;
export type Session = {
  id: string;
  userId: string;
  expiresAt: number;
  createdAt: number;
};
export type PromptPayConfig = {
  enabled: boolean;
  recipientId: string;
  recipientName: string;
  revision: number;
  updatedAt?: string;
  updatedBy?: string;
};
export type Settings = {
  cooperativeBalance: number;
  dailyTarget: number;
  storeOpen: boolean;
  promptpay?: PromptPayConfig;
  shop?: ShopConfig;
  shopRevision?: number;
};
export type BudgetEntry = {
  id: string;
  timestamp: string;
  amount: number;
  note: string;
  createdBy?: string;
};
export type State = {
  items: Item[];
  transactions: Purchase[];
  settings: Settings;
  budget: BudgetEntry[];
  attempts: Record<string, { count: number; reset: number }>;
  users: User[];
  sessions: Session[];
};
export type PublicConfig = {
  demo: boolean;
  promptpayAvailable: boolean;
  recipientName: string;
  storeOpen: boolean;
  paymentMode?: "test" | "live";
  shop?: ShopConfig;
};
