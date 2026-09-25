"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import JsBarcode from "jsbarcode";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Barcode,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Edit3,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Package,
  Plus,
  ReceiptText,
  Search,
  Settings2,
  Users,
  UserRound,
  ShoppingBag,
  Store,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Wallet,
  X,
} from "lucide-react";
import { api, ApiError, dateTime, dayKey, money, post } from "@/lib/client";
import type { Item, Purchase, State, SafeUser } from "@/lib/types";
import { can, roleLabels } from "@/lib/permissions";
import StaffLogin from "./staff-login";
import StaffUsers from "./staff-users";
import AccountSettings from "./account-settings";
import PromptPaySettings from "./promptpay-settings";
import ShopSettings from "./shop-settings";
import ServerSettings from "./server-settings";
import ExportData from "./export-data";
import { Brand, Modal, ProductImage } from "./shared";
type Overview = Pick<
  State,
  "items" | "transactions" | "settings" | "budget"
> & {
  user: SafeUser;
  demo: boolean;
  promptpayAvailable: boolean;
  recipientName: string;
};
type Section =
  | "dashboard"
  | "inventory"
  | "transactions"
  | "analytics"
  | "budget"
  | "settings"
  | "users"
  | "account";
const navigation = [
  { id: "dashboard", label: "ภาพรวมร้าน", icon: LayoutDashboard },
  { id: "inventory", label: "จัดการสินค้า", icon: Package },
  { id: "transactions", label: "รายการขาย", icon: ReceiptText },
  { id: "analytics", label: "สถิติการขาย", icon: BarChart3 },
  { id: "budget", label: "บัญชีสหกรณ์", icon: Wallet },
  { id: "settings", label: "ตั้งค่าระบบ", icon: Settings2 },
  { id: "users", label: "บัญชีเจ้าหน้าที่", icon: Users },
  { id: "account", label: "บัญชีของฉัน", icon: UserRound },
] as const;
const categoryLabels: Record<string, string> = {
  drinks: "เครื่องดื่ม",
  snacks: "ขนม",
  food: "อาหาร",
  supplies: "เครื่องเขียน",
};
const statusLabels: Record<string, string> = {
  pending: "รอผลชำระ",
  completed: "ชำระแล้ว",
  cancelled: "ยกเลิก",
};
const blankItem: Omit<Item, "id"> = {
  name: "",
  subtitle: "",
  price: 0,
  stock: 0,
  barcode: "",
  category: "snacks",
  image: "",
  reorderLevel: 10,
  active: true,
};
export default function Admin() {
  const [session, setSession] = useState<boolean | null>(null);
  const [demo, setDemo] = useState(false);
  const [currentUser, setCurrentUser] = useState<SafeUser>();
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupTokenRequired, setSetupTokenRequired] = useState(false);
  const [data, setData] = useState<Overview>();
  const [section, setSection] = useState<Section>("dashboard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Partial<Item> | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Purchase | null>(null);
  const [labelItem, setLabelItem] = useState<Item | null>(null);
  const [entry, setEntry] = useState(false);
  const [entryType, setEntryType] = useState("expense");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [target, setTarget] = useState("500");
  const lastActivity = useRef(Date.now());
  const lastRenew = useRef(Date.now());
  const barcodeRef = useRef<SVGSVGElement>(null);
  const refresh = useCallback(async () => {
    try {
      const next = await api<Overview>("admin/overview");
      setData(next);
      setCurrentUser(next.user);
      setDemo(next.demo);
      setError("");
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      if (e instanceof ApiError && e.status === 401) {
        setSession(false);
        setCurrentUser(undefined);
        setData(undefined);
        setSelectedOrder(null);
        setEditing(null);
        setEntry(false);
        setDeleting(null);
        setLabelItem(null);
      }
    }
  }, []);
  useEffect(() => {
    api<{
      authenticated: boolean;
      demo: boolean;
      user?: SafeUser;
      setupRequired: boolean;
      setupTokenRequired: boolean;
    }>("admin/session")
      .then((value) => {
        setSession(value.authenticated);
        setDemo(value.demo);
        setCurrentUser(value.user);
        setSetupRequired(value.setupRequired);
        setSetupTokenRequired(value.setupTokenRequired);
        if (value.user?.role === "stock") setSection("inventory");
      })
      .catch((e) => {
        setError((e as Error).message);
        setSession(false);
      });
  }, []);
  useEffect(() => {
    if (currentUser && !can(currentUser.role, section)) {
      setSection(currentUser.role === "stock" ? "inventory" : "dashboard");
    }
  }, [currentUser, section]);
  useEffect(() => {
    if (!session) return;
    void refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [session, refresh]);
  useEffect(() => {
    if (data) setTarget(String(data.settings.dailyTarget));
  }, [data?.settings.dailyTarget]);
  const logout = useCallback(async () => {
    try {
      await post("admin/logout", {});
    } finally {
      setSession(false);
      setData(undefined);
      setCurrentUser(undefined);
      setSelectedOrder(null);
      setEditing(null);
      setEntry(false);
      setDeleting(null);
      setLabelItem(null);
    }
  }, []);
  useEffect(() => {
    if (!session) return;
    lastActivity.current = Date.now();
    const activity = () => {
      lastActivity.current = Date.now();
    };
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    const timer = setInterval(() => {
      const now = Date.now();
      if (now - lastActivity.current > 15 * 60_000) {
        void logout();
        setNotice("ออกจากระบบเนื่องจากไม่ได้ใช้งาน 15 นาที");
      } else if (
        now - lastActivity.current < 60_000 &&
        now - lastRenew.current > 60_000
      ) {
        lastRenew.current = now;
        void post("admin/session", {}).catch(() => void logout());
      }
    }, 15_000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
    };
  }, [session, logout]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    if (labelItem && barcodeRef.current)
      JsBarcode(barcodeRef.current, labelItem.barcode, {
        format: "CODE128",
        width: 2,
        height: 65,
        fontSize: 15,
        margin: 15,
      });
  }, [labelItem]);
  function signedIn(user: SafeUser) {
    setData(undefined);
    setSelectedOrder(null);
    setEditing(null);
    setEntry(false);
    setDeleting(null);
    setLabelItem(null);
    setCurrentUser(user);
    setSession(true);
    setSetupRequired(false);
    setSection(user.role === "stock" ? "inventory" : "dashboard");
    setError("");
    lastActivity.current = Date.now();
    lastRenew.current = Date.now();
  }
  async function saveAction(
    url: string,
    payload: unknown,
    success: string,
    onSuccess?: () => void,
  ) {
    setBusy(true);
    setError("");
    try {
      await post(url, payload);
      onSuccess?.();
      setNotice(success);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function navigate(next: Section) {
    if (!currentUser || !can(currentUser.role, next)) return;
    setSection(next);
    setSearch("");
    setFilter("all");
    setPage(1);
    setError("");
  }
  const today = dayKey(new Date());
  const completed = (data?.transactions || []).filter(
    (t) => t.status === "completed",
  );
  const todays = completed.filter(
    (t) => dayKey(t.completedAt || t.timestamp) === today,
  );
  const revenue =
    todays.reduce((sum, t) => sum + Math.round(t.total * 100), 0) / 100;
  const pending = (data?.transactions || []).filter(
    (t) => t.status === "pending",
  );
  const activeItems = (data?.items || []).filter((i) => i.active);
  const alerts = activeItems.filter((i) => i.stock <= i.reorderLevel);
  const topItems = useMemo(() => {
    const totals = new Map<
      string,
      { qty: number; total: number; name: string }
    >();
    for (const t of completed)
      for (const i of t.items) {
        const previous = totals.get(i.id) || { qty: 0, total: 0, name: i.name };
        totals.set(i.id, {
          qty: previous.qty + i.qty,
          total: previous.total + i.qty * i.price,
          name: i.name,
        });
      }
    return [...totals].sort((a, b) => b[1].qty - a[1].qty);
  }, [data]);
  const stockItems = activeItems.filter(
    (i) =>
      `${i.name} ${i.barcode}`.toLowerCase().includes(search.toLowerCase()) &&
      (filter !== "low" || i.stock <= i.reorderLevel),
  );
  const orders = (data?.transactions || []).filter(
    (t) =>
      (filter === "all" || t.status === filter) &&
      `${t.id} ${t.studentId || ""} ${t.items.map((i) => i.name).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const pageCount = Math.max(1, Math.ceil(orders.length / 10));
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [pageCount, page]);
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    label: hour % 3 === 0 ? `${String(hour).padStart(2, "0")}:00` : "",
    value: todays
      .filter(
        (t) =>
          Number(
            new Intl.DateTimeFormat("en-GB", {
              hour: "2-digit",
              hour12: false,
              timeZone: "Asia/Bangkok",
            }).format(new Date(t.completedAt || t.timestamp)),
          ) === hour,
      )
      .reduce((sum, t) => sum + t.total, 0),
  }));
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400_000);
    return {
      label: new Intl.DateTimeFormat("th-TH", {
        weekday: "short",
        timeZone: "Asia/Bangkok",
      }).format(d),
      value: completed
        .filter((t) => dayKey(t.completedAt || t.timestamp) === dayKey(d))
        .reduce((sum, t) => sum + t.total, 0),
    };
  });
  function OrderTable({
    values,
    compact = false,
  }: {
    values: Purchase[];
    compact?: boolean;
  }) {
    return (
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>เลขรายการ / เวลา</th>
              <th>สินค้า</th>
              {!compact && <th>รหัสนักเรียน</th>}
              <th>การชำระ</th>
              <th>ยอดรวม</th>
              <th>สถานะ</th>
              <th>
                <span className="sr-only">จัดการ</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {values.map((t) => (
              <tr key={t.id}>
                <td>
                  #{t.id.slice(0, 8).toUpperCase()}
                  <small>{dateTime(t.timestamp)}</small>
                </td>
                <td>
                  {t.items[0]?.name}
                  {t.items.length > 1 && ` +${t.items.length - 1}`}
                  <small>
                    {t.items.reduce((sum, i) => sum + i.qty, 0)} ชิ้น
                  </small>
                </td>
                {!compact && <td>{t.studentId || "—"}</td>}
                <td>{t.paymentMethod === "cash" ? "เงินสด" : "พร้อมเพย์"}</td>
                <td>
                  <strong>{money(t.total)}</strong>
                </td>
                <td>
                  <span className={`status-badge ${t.status}`}>
                    {statusLabels[t.status]}
                  </span>
                </td>
                <td>
                  <button
                    className={
                      t.status === "pending" ? "primary-button" : "text-button"
                    }
                    onClick={() => {
                      setSelectedOrder(t);
                      setError("");
                    }}
                  >
                    {t.status === "pending" ? "ดูสถานะ" : "ดูรายการ"}
                    <ChevronRight size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!values.length && (
          <div className="chart-empty">ยังไม่มีรายการในหมวดนี้</div>
        )}
      </div>
    );
  }
  const metricCards = (
    <div className="metric-grid">
      <Metric
        label="ยอดขายวันนี้"
        value={money(revenue)}
        subtitle={`เป้าหมาย ${money(data?.settings.dailyTarget || 0)} / วัน`}
        icon={CircleDollarSign}
        highlight
      />
      <Metric
        label="รายการขายวันนี้"
        value={String(todays.length)}
        subtitle={`${todays.reduce((sum, t) => sum + t.items.reduce((n, i) => n + i.qty, 0), 0)} ชิ้นที่ขายแล้ว`}
        icon={ShoppingBag}
      />
      <Metric
        label="รอผลการชำระ"
        value={String(pending.length)}
        subtitle="ระบบตรวจยอดจากผู้ให้บริการอัตโนมัติ"
        icon={Clock3}
      />
      <Metric
        label="สินค้าใกล้หมด"
        value={String(alerts.length)}
        subtitle={`จากทั้งหมด ${activeItems.length} รายการ`}
        icon={Package}
      />
    </div>
  );
  if (session === null)
    return (
      <div className="login-page">
        <LoaderCircle className="spin" />
      </div>
    );
  if (!session || !currentUser)
    return (
      <StaffLogin
        setupRequired={setupRequired}
        setupTokenRequired={setupTokenRequired}
        demo={demo}
        onAuthenticated={signedIn}
      />
    );
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Brand small config={data?.settings.shop} />
        <div className="sidebar-label">COOPERATIVE WORKSPACE</div>
        <nav className="admin-nav" aria-label="เมนูเจ้าหน้าที่">
          {navigation
            .filter(({ id }) => can(currentUser.role, id))
            .map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={section === id ? "active" : ""}
                onClick={() => navigate(id)}
                aria-current={section === id ? "page" : undefined}
              >
                <Icon size={19} />
                {label}
                {id === "transactions" && pending.length > 0 && (
                  <span>{pending.length}</span>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <Link href="/">
            <Store size={18} /> กลับหน้าร้าน <ArrowUpRight size={14} />
          </Link>
          <button onClick={() => void logout()}>
            <LogOut size={17} /> ออกจากระบบ
          </button>
          <div className="sidebar-profile">
            <span className="profile-avatar">
              {currentUser.displayName.slice(0, 2)}
            </span>
            <div>
              <strong>{currentUser.displayName}</strong>
              <small>{roleLabels[currentUser.role]}</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="admin-content">
        <header className="admin-topbar">
          <span>
            พื้นที่เจ้าหน้าที่ <ChevronRight size={12} />{" "}
            {navigation.find((n) => n.id === section)?.label}
          </span>
          <div>
            {demo && <span className="demo-badge">โหมดทดลอง</span>}
            <span
              className={`store-status ${data && !data.settings.storeOpen ? "closed" : ""}`}
            >
              <span />
              {data?.settings.storeOpen ? "เปิดร้าน" : "ปิดร้าน"}
            </span>
            <Link className="icon-button" href="/" aria-label="กลับหน้าร้าน">
              <Store size={18} />
            </Link>
            <button
              className="icon-button"
              onClick={() => void logout()}
              aria-label="ออกจากระบบ"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="admin-workspace">
          <div className="page-heading">
            <div>
              <h1>
                {section === "dashboard"
                  ? "ร้านเล็ก ๆ ของเรา"
                  : navigation.find((n) => n.id === section)?.label}
              </h1>
              <p>
                {section === "dashboard"
                  ? "ทุกยอดขาย เติมสิ่งดี ๆ ให้โรงเรียนของเรา"
                  : section === "inventory"
                    ? "เช็กสินค้า เติมสต็อก แล้วพร้อมขายต่อ"
                    : section === "transactions"
                      ? "ตรวจสอบการชำระเงินและย้อนดูทุกรายการ"
                      : section === "analytics"
                        ? "รู้จักสินค้าขายดี วางแผนเติมของได้พอดี"
                        : section === "budget"
                          ? "รายรับ รายจ่าย และเงินคงเหลือของสหกรณ์โรงเรียน"
                          : section === "users"
                            ? "กำหนดบัญชีและสิทธิ์ตามหน้าที่ของแต่ละคน"
                            : section === "account"
                              ? "ข้อมูลบัญชีและรหัสผ่านของคุณ"
                              : "จัดการเวลาเปิดร้าน เป้าหมาย และบัญชีรับเงิน"}
              </p>
            </div>
            <div className="page-heading-actions">
              <ExportData
                key={`${currentUser.id}-${currentUser.role}`}
                role={currentUser.role}
                initialKind={section === "inventory" || section === "budget" ? section : section === "transactions" || section === "analytics" ? "sales" : "all"}
                onExported={() => setNotice("เริ่มดาวน์โหลดไฟล์ Excel แล้ว")}
                onSessionExpired={() => void logout()}
              />
            {section === "inventory" ? (
              <button
                className="primary-button"
                onClick={() => {
                  setEditing({ ...blankItem });
                  setError("");
                }}
              >
                <Plus size={18} /> เพิ่มสินค้า
              </button>
            ) : section === "budget" ? (
              <button
                className="primary-button"
                onClick={() => {
                  setEntry(true);
                  setAmount("");
                  setNote("");
                  setError("");
                }}
              >
                <Plus size={18} /> บันทึกรายการ
              </button>
            ) : section === "dashboard" &&
              can(currentUser.role, "inventory") ? (
              <button
                className="secondary-button"
                onClick={() => navigate("inventory")}
              >
                <Package size={16} /> จัดการสต็อก
              </button>
            ) : null}
            </div>
          </div>
          {error && !editing && !deleting && !selectedOrder && !entry && (
            <div className="error-banner" role="alert">
              {error}
              <button onClick={() => void refresh()}>ลองอีกครั้ง</button>
            </div>
          )}
          {!data ? (
            <div className="loading-state">
              <LoaderCircle className="spin" />
              กำลังโหลดข้อมูลร้าน...
            </div>
          ) : (
            <>
              {section === "dashboard" && (
                <>
                  {metricCards}
                  <div className="admin-columns">
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>ยอดขายระหว่างวัน</h2>
                        <span>วันนี้ · บาท</span>
                      </div>
                      <BarChart values={hourly} />
                      <p className="chart-note">
                        เฉพาะรายการที่ยืนยันการชำระแล้ว · เวลาไทย
                      </p>
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>สินค้าขายดี</h2>
                        <button
                          className="text-button"
                          onClick={() => navigate("analytics")}
                        >
                          ดูทั้งหมด <ArrowUpRight size={13} />
                        </button>
                      </div>
                      {topItems.slice(0, 4).map(([id, value], index) => (
                        <div className="top-item" key={id}>
                          <span className="rank">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          {data.items.find((i) => i.id === id) && (
                            <ProductImage
                              item={data.items.find((i) => i.id === id)!}
                            />
                          )}
                          <div>
                            <strong>{value.name}</strong>
                            <div className="summary-line">
                              <span>{value.qty} ชิ้น</span>
                              <span>{money(value.total)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                      {!topItems.length && (
                        <div className="chart-empty">
                          สินค้าขายดีจะแสดงเมื่อมีการขายครั้งแรก
                        </div>
                      )}
                    </section>
                  </div>
                  <section className="panel" style={{ marginBottom: 24 }}>
                    <div className="panel-heading">
                      <h2>
                        {pending.length
                          ? "รอผลการชำระเงินอัตโนมัติ"
                          : "รายการล่าสุด"}
                      </h2>
                      <button
                        className="text-button"
                        onClick={() => navigate("transactions")}
                      >
                        ดูทุกรายการ <ArrowRight size={13} />
                      </button>
                    </div>
                    <OrderTable
                      values={(pending.length
                        ? pending
                        : data.transactions
                      ).slice(0, 5)}
                      compact
                    />
                  </section>
                  {alerts.length > 0 && (
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>ได้เวลาเติมของแล้ว</h2>
                        <span>{alerts.length} รายการ</span>
                      </div>
                      <div className="low-stock-list">
                        {alerts.map((item) => (
                          <button
                            key={item.id}
                            className="stock-alert"
                            disabled={!can(currentUser.role, "inventory")}
                            onClick={() => {
                              setEditing(item);
                              setError("");
                            }}
                          >
                            <TriangleAlert size={22} />
                            <div>
                              <strong>{item.name}</strong>
                              <span>
                                คงเหลือ {item.stock} ชิ้น
                                {can(currentUser.role, "inventory") && (
                                  <>
                                    {" "}
                                    · เติมสต็อก <ArrowRight size={11} />
                                  </>
                                )}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
              {section === "inventory" && (
                <>
                  <div className="admin-toolbar">
                    <label className="admin-search">
                      <Search size={18} />
                      <input
                        aria-label="ค้นหาสินค้าหรือบาร์โค้ด"
                        placeholder="ค้นหาสินค้าหรือบาร์โค้ด..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <div className="filter-tabs">
                      <button
                        className={filter === "all" ? "active" : ""}
                        onClick={() => setFilter("all")}
                      >
                        สินค้าทั้งหมด ({activeItems.length})
                      </button>
                      <button
                        className={filter === "low" ? "active" : ""}
                        onClick={() => setFilter("low")}
                      >
                        ใกล้หมด ({alerts.length})
                      </button>
                    </div>
                  </div>
                  <section className="panel">
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>สินค้า</th>
                            <th>หมวดหมู่</th>
                            <th>ราคา</th>
                            <th>คงเหลือ</th>
                            <th>สถานะ</th>
                            <th>จัดการ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stockItems.map((item) => (
                            <tr key={item.id}>
                              <td>
                                <div className="row-product">
                                  <ProductImage item={item} />
                                  <div>
                                    {item.name}
                                    <small>{item.barcode}</small>
                                  </div>
                                </div>
                              </td>
                              <td>{categoryLabels[item.category]}</td>
                              <td>{money(item.price)}</td>
                              <td>{item.stock} ชิ้น</td>
                              <td>
                                <span
                                  className={`status-badge ${!item.stock ? "out" : item.stock <= item.reorderLevel ? "low" : ""}`}
                                >
                                  {!item.stock
                                    ? "หมด"
                                    : item.stock <= item.reorderLevel
                                      ? "ใกล้หมด"
                                      : "พร้อมขาย"}
                                </span>
                              </td>
                              <td>
                                <div className="table-actions">
                                  <button
                                    className="icon-button"
                                    aria-label={`แก้ไข ${item.name}`}
                                    onClick={() => {
                                      setEditing(item);
                                      setError("");
                                    }}
                                  >
                                    <Edit3 size={16} />
                                  </button>
                                  <button
                                    className="icon-button"
                                    aria-label={`บาร์โค้ด ${item.name}`}
                                    onClick={() => setLabelItem(item)}
                                  >
                                    <Barcode size={18} />
                                  </button>
                                  <button
                                    className="icon-button"
                                    aria-label={`ลบ ${item.name}`}
                                    onClick={() => {
                                      setDeleting(item);
                                      setError("");
                                    }}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!stockItems.length && (
                        <div className="chart-empty">ไม่พบสินค้า</div>
                      )}
                    </div>
                  </section>
                </>
              )}
              {section === "transactions" && (
                <>
                  <div className="admin-toolbar">
                    <label className="admin-search">
                      <Search size={18} />
                      <input
                        aria-label="ค้นหารายการหรือรหัสนักเรียน"
                        placeholder="เลขรายการ สินค้า หรือรหัสนักเรียน..."
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value);
                          setPage(1);
                        }}
                      />
                    </label>
                    <div className="filter-tabs">
                      {["all", "pending", "completed", "cancelled"].map(
                        (value) => (
                          <button
                            key={value}
                            className={filter === value ? "active" : ""}
                            onClick={() => {
                              setFilter(value);
                              setPage(1);
                            }}
                          >
                            {value === "all" ? "ทั้งหมด" : statusLabels[value]}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                  <section className="panel">
                    <OrderTable
                      values={orders.slice((page - 1) * 10, page * 10)}
                    />
                    <div className="pagination">
                      <span>{orders.length} รายการ</span>
                      <div>
                        <button
                          aria-label="หน้าก่อนหน้า"
                          disabled={page <= 1}
                          onClick={() => setPage((p) => p - 1)}
                        >
                          <ChevronLeft size={15} />
                        </button>
                        <span>
                          หน้า {page} / {pageCount}
                        </span>
                        <button
                          aria-label="หน้าถัดไป"
                          disabled={page >= pageCount}
                          onClick={() => setPage((p) => p + 1)}
                        >
                          <ChevronRight size={15} />
                        </button>
                      </div>
                    </div>
                  </section>
                </>
              )}
              {section === "analytics" && (
                <>
                  {metricCards}
                  <section className="panel" style={{ marginBottom: 24 }}>
                    <div className="panel-heading">
                      <h2>ยอดขาย 7 วันล่าสุด</h2>
                      <span>บาท · เฉพาะยอดชำระแล้ว</span>
                    </div>
                    <BarChart values={week} showValues />
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>ยอดขายแยกตามสินค้า</h2>
                      <span>สะสมทั้งหมด</span>
                    </div>
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>อันดับ</th>
                            <th>สินค้า</th>
                            <th>จำนวนที่ขาย</th>
                            <th>ยอดขายรวม</th>
                          </tr>
                        </thead>
                        <tbody>
                          {topItems.map(([id, value], index) => (
                            <tr key={id}>
                              <td>{String(index + 1).padStart(2, "0")}</td>
                              <td>{value.name}</td>
                              <td>{value.qty} ชิ้น</td>
                              <td>{money(value.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!topItems.length && (
                        <div className="chart-empty">
                          ข้อมูลจะแสดงเมื่อมีรายการชำระสำเร็จ
                        </div>
                      )}
                    </div>
                  </section>
                </>
              )}
              {section === "budget" && (
                <>
                  <div className="admin-columns">
                    <section className="panel budget-card">
                      <div className="panel-heading">
                        <h2>ยอดคงเหลือสหกรณ์</h2>
                        <Wallet size={23} />
                      </div>
                      <div className="budget-value">
                        {money(data.settings.cooperativeBalance)}
                      </div>
                      <p className="small-print">
                        ยอดขายที่ยืนยันแล้ว + รายรับอื่น − รายจ่าย
                      </p>
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>สรุปบัญชี</h2>
                        <span>สะสมทั้งหมด</span>
                      </div>
                      <div className="summary-line">
                        <span>รายรับจากการขาย</span>
                        <strong>
                          {money(
                            completed.reduce((sum, t) => sum + t.total, 0),
                          )}
                        </strong>
                      </div>
                      <div className="summary-line">
                        <span>รายรับอื่น</span>
                        <strong>
                          {money(
                            data.budget
                              .filter((e) => e.amount > 0)
                              .reduce((sum, e) => sum + e.amount, 0),
                          )}
                        </strong>
                      </div>
                      <div className="summary-line">
                        <span>รายจ่าย</span>
                        <strong>
                          {money(
                            -data.budget
                              .filter((e) => e.amount < 0)
                              .reduce((sum, e) => sum + e.amount, 0),
                          )}
                        </strong>
                      </div>
                    </section>
                  </div>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>รายรับและรายจ่ายอื่น</h2>
                      <span>ยอดขายดูได้ในรายการขาย</span>
                    </div>
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>วันที่</th>
                            <th>รายละเอียด</th>
                            <th>ประเภท</th>
                            <th>จำนวนเงิน</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...data.budget]
                            .sort((a, b) =>
                              b.timestamp.localeCompare(a.timestamp),
                            )
                            .map((e) => (
                              <tr key={e.id}>
                                <td>{dateTime(e.timestamp)}</td>
                                <td>{e.note}</td>
                                <td>
                                  <span
                                    className={`status-badge ${e.amount < 0 ? "low" : ""}`}
                                  >
                                    {e.amount < 0 ? "รายจ่าย" : "รายรับ"}
                                  </span>
                                </td>
                                <td>
                                  {e.amount > 0 ? "+" : ""}
                                  {money(e.amount)}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                      {!data.budget.length && (
                        <div className="chart-empty">
                          ยังไม่มีรายรับหรือรายจ่ายเพิ่มเติม
                        </div>
                      )}
                    </div>
                  </section>
                </>
              )}
              {section === "users" && (
                <StaffUsers
                  currentUser={currentUser}
                  onSelfChanged={() => void logout()}
                />
              )}
              {section === "account" && (
                <AccountSettings
                  user={currentUser}
                  onChanged={() => void logout()}
                />
              )}
              {section === "settings" && (
                <div className="admin-columns">
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>การเปิดร้าน</h2>
                      <Store size={20} />
                    </div>
                    <div className="settings-row">
                      <div>
                        <strong>เปิดรับรายการซื้อ</strong>
                        <p>เมื่อปิดร้าน นักเรียนจะยังดูสินค้าได้</p>
                      </div>
                      <button
                        role="switch"
                        aria-label="เปิดรับรายการซื้อ"
                        aria-checked={data.settings.storeOpen}
                        className={`toggle ${data.settings.storeOpen ? "on" : ""}`}
                        disabled={busy}
                        onClick={() =>
                          void saveAction(
                            "settings",
                            {
                              dailyTarget: data.settings.dailyTarget,
                              storeOpen: !data.settings.storeOpen,
                            },
                            "อัปเดตสถานะร้านแล้ว",
                          )
                        }
                      >
                        <span />
                      </button>
                    </div>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveAction(
                          "settings",
                          {
                            dailyTarget: Number(target),
                            storeOpen: data.settings.storeOpen,
                          },
                          "บันทึกเป้าหมายแล้ว",
                        );
                      }}
                    >
                      <label className="field">
                        เป้าหมายยอดขายต่อวัน (บาท)
                        <input
                          type="number"
                          min="0"
                          max="100000"
                          step="0.01"
                          value={target}
                          onChange={(e) => setTarget(e.target.value)}
                          required
                        />
                      </label>
                      <button className="primary-button" disabled={busy}>
                        บันทึกเป้าหมาย
                      </button>
                    </form>
                  </section>
                  <PromptPaySettings />
                  <ShopSettings />
                  <ServerSettings />
                </div>
              )}
            </>
          )}
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={18} />
          {notice}
        </div>
      )}
      {editing && (
        <Modal
          title={editing.id ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่"}
          wide
          onClose={() => {
            if (!busy) {
              setEditing(null);
              setError("");
            }
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveAction("stock/update", editing, "บันทึกสินค้าแล้ว", () =>
                setEditing(null),
              );
            }}
          >
            <div className="form-grid">
              <label className="field span-2">
                ชื่อสินค้า
                <input
                  value={editing.name || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                  required
                  maxLength={100}
                />
              </label>
              <label className="field span-2">
                รายละเอียดสั้น ๆ
                <input
                  value={editing.subtitle || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, subtitle: e.target.value })
                  }
                  maxLength={100}
                />
              </label>
              <label className="field">
                ราคา (บาท)
                <input
                  type="number"
                  min="0"
                  max="100000"
                  step="0.01"
                  required
                  value={editing.price ?? 0}
                  onChange={(e) =>
                    setEditing({ ...editing, price: Number(e.target.value) })
                  }
                />
              </label>
              <label className="field">
                จำนวนคงเหลือ
                <input
                  type="number"
                  min="0"
                  max="100000"
                  required
                  value={editing.stock ?? 0}
                  onChange={(e) =>
                    setEditing({ ...editing, stock: Number(e.target.value) })
                  }
                />
              </label>
              <label className="field">
                บาร์โค้ด
                <input
                  value={editing.barcode || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, barcode: e.target.value })
                  }
                  required
                  maxLength={80}
                  pattern="[0-9A-Za-z\-]+"
                />
              </label>
              <label className="field">
                หมวดหมู่
                <select
                  value={editing.category}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      category: e.target.value as Item["category"],
                    })
                  }
                >
                  {Object.entries(categoryLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                แจ้งเตือนเมื่อเหลือ (ชิ้น)
                <input
                  type="number"
                  min="0"
                  max="100000"
                  required
                  value={editing.reorderLevel ?? 10}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      reorderLevel: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="field">
                ลิงก์ภาพ (ไม่บังคับ)
                <input
                  value={editing.image || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, image: e.target.value })
                  }
                  placeholder="https://..."
                  maxLength={1000}
                />
              </label>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setEditing(null)}
                disabled={busy}
              >
                ยกเลิก
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <Check size={18} />
                )}
                บันทึกสินค้า
              </button>
            </div>
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal
          title="นำสินค้าออกจากร้าน?"
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
        >
          <p>
            <strong>{deleting.name}</strong> จะไม่แสดงในหน้าร้าน
            ประวัติการขายยังคงอยู่
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              เก็บไว้
            </button>
            <button
              className="danger-button"
              disabled={busy}
              onClick={() =>
                void saveAction(
                  "stock/delete",
                  { id: deleting.id },
                  "นำสินค้าออกแล้ว",
                  () => setDeleting(null),
                )
              }
            >
              นำสินค้าออก
            </button>
          </div>
        </Modal>
      )}
      {selectedOrder && (
        <Modal
          title={`รายการ #${selectedOrder.id.slice(0, 8).toUpperCase()}`}
          onClose={() => {
            if (!busy) {
              setSelectedOrder(null);
              setError("");
            }
          }}
        >
          <div className="summary-line">
            <span>{dateTime(selectedOrder.timestamp)}</span>
            <span className={`status-badge ${selectedOrder.status}`}>
              {statusLabels[selectedOrder.status]}
            </span>
          </div>
          {selectedOrder.studentId && (
            <p className="muted">รหัสนักเรียน: {selectedOrder.studentId}</p>
          )}
          <div className="details-items">
            {selectedOrder.items.map((i) => (
              <div className="summary-line" key={i.id}>
                <span>
                  {i.name} × {i.qty}
                </span>
                <strong>{money(i.price * i.qty)}</strong>
              </div>
            ))}
            <div className="summary-total">
              <span>
                {selectedOrder.paymentMethod === "cash"
                  ? "เงินสด"
                  : "พร้อมเพย์"}
              </span>
              <strong>{money(selectedOrder.total)}</strong>
            </div>
          </div>
          {selectedOrder.status === "pending" && (
            <p className="muted" style={{ lineHeight: 1.8 }}>
              {selectedOrder.payment
                ? selectedOrder.payment.error || "ระบบตรวจยอดจาก Omise แล้วออกใบเสร็จและตัดสต็อกอัตโนมัติ QR ที่ยังรอชำระจะปิดเมื่อผู้ให้บริการยืนยันว่าหมดอายุ"
                : "รายการจากระบบเดิมไม่มีการยืนยันอัตโนมัติ หากยังไม่โอนให้ยกเลิกและเริ่มใหม่ หากโอนแล้วให้ตรวจยอดกับร้านก่อนจัดการเงินคืน"}
            </p>
          )}
          {selectedOrder.payment?.mode === "test" && <p className="form-error">รายการทดสอบ — ไม่ใช่เงินจริง</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {selectedOrder.status === "pending" ? (
            <div className="modal-actions">
              {!selectedOrder.payment && <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void saveAction(
                    "transactions/cancel",
                    { id: selectedOrder.id },
                    "ยกเลิกรายการแล้ว",
                    () => setSelectedOrder(null),
                  )
                }
              >
                ยกเลิกรายการ
              </button>}
              {selectedOrder.payment && <button
                className="primary-button"
                disabled={busy}
                onClick={() =>
                  void saveAction(
                    "transactions/check",
                    { id: selectedOrder.id },
                    "อัปเดตสถานะจากผู้ให้บริการแล้ว",
                    () => setSelectedOrder(null),
                  )
                }
              >
                <Check size={18} /> ตรวจสถานะจาก Omise
              </button>}
            </div>
          ) : (
            <button
              className="secondary-button full-width"
              onClick={() => setSelectedOrder(null)}
            >
              ปิดรายละเอียด
            </button>
          )}
        </Modal>
      )}
      {labelItem && (
        <Modal title="บาร์โค้ดสินค้า" onClose={() => setLabelItem(null)}>
          <p className="center">
            {labelItem.name} · {money(labelItem.price)}
          </p>
          <div className="barcode-preview">
            <svg ref={barcodeRef} />
          </div>
          <p className="center muted">สแกนเพื่อเพิ่มสินค้านี้ลงตะกร้า</p>
        </Modal>
      )}
      {entry && (
        <Modal
          title="บันทึกรายรับ / รายจ่าย"
          onClose={() => {
            if (!busy) setEntry(false);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveAction(
                "budget",
                {
                  amount: Number(amount) * (entryType === "expense" ? -1 : 1),
                  note,
                },
                "บันทึกบัญชีแล้ว",
                () => setEntry(false),
              );
            }}
          >
            <label className="field">
              ประเภทรายการ
              <select
                value={entryType}
                onChange={(e) => setEntryType(e.target.value)}
              >
                <option value="expense">รายจ่าย เช่น ซื้อสินค้าเติมร้าน</option>
                <option value="income">รายรับอื่น เช่น เงินตั้งต้น</option>
              </select>
            </label>
            <label className="field">
              จำนวนเงิน (บาท)
              <input
                type="number"
                min="0.01"
                max="100000"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="field">
              รายละเอียด
              <input
                required
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                placeholder="เช่น ซื้อขนมเติมสต็อก"
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <p className="muted">
              รายการบัญชีที่บันทึกแล้วจะแก้ไขไม่ได้
              หากผิดพลาดให้บันทึกรายการปรับปรุง
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setEntry(false)}
                disabled={busy}
              >
                ยกเลิก
              </button>
              <button type="submit" className="primary-button" disabled={busy}>
                บันทึกรายการ
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  subtitle,
  icon: Icon,
  highlight = false,
}: {
  label: string;
  value: string;
  subtitle: string;
  icon: typeof Wallet;
  highlight?: boolean;
}) {
  return (
    <div className={`metric ${highlight ? "highlight" : ""}`}>
      <div className="metric-top">
        <span>{label}</span>
        <Icon />
      </div>
      <strong>{value}</strong>
      <small>{subtitle}</small>
    </div>
  );
}
function BarChart({
  values,
  showValues = false,
}: {
  values: { label: string; value: number }[];
  showValues?: boolean;
}) {
  const max = Math.max(1, ...values.map((v) => v.value));
  return (
    <div
      className="hourly-chart"
      role="img"
      aria-label={values
        .map((v, index) => `${v.label || `${index}:00`}: ${v.value} บาท`)
        .join(", ")}
    >
      {values.map((v, i) => (
        <div className="chart-column" key={i}>
          <div
            className="bar"
            style={{ height: `${Math.max(2, (v.value / max) * 85)}%` }}
            title={`${v.label || `${i}:00`} · ${money(v.value)}`}
          >
            {showValues && v.value > 0 && <span>{money(v.value)}</span>}
          </div>
          <span>{v.label || "\u00a0"}</span>
        </div>
      ))}
    </div>
  );
}
