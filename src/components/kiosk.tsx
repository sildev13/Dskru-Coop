"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Barcode,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Coffee,
  Cookie,
  Grid2X2,
  Keyboard,
  LoaderCircle,
  Maximize,
  Minus,
  Package,
  Pencil,
  Plus,
  QrCode,
  RotateCcw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Soup,
  Trash2,
  X,
} from "lucide-react";
import { api, ApiError, dateTime, money, post } from "@/lib/client";
import type { Item, PublicConfig, Purchase } from "@/lib/types";
import { Brand, Modal, ProductImage } from "./shared";
import StudentIdKeypad from "./student-id-keypad";
import { shopConfig } from "@/lib/shop-config";
type Order = Omit<Purchase, "qrPayload"> & { qrPayload?: string | null };
type CheckoutIntent = { items: { id: string; qty: number }[]; paymentMethod: "promptpay"; studentId?: string; requestId: string };
const categories = [
  { id: "all", label: "ทั้งหมด", english: "All items", icon: Grid2X2 },
  { id: "drinks", label: "เครื่องดื่ม", english: "Drinks", icon: Coffee },
  { id: "snacks", label: "ขนม", english: "Snacks", icon: Cookie },
  { id: "food", label: "อาหาร", english: "Food", icon: Soup },
  { id: "supplies", label: "เครื่องเขียน", english: "Supplies", icon: Pencil },
];
export default function Kiosk() {
  const [items, setItems] = useState<Item[]>([]);
  const [config, setConfig] = useState<PublicConfig>();
  const shop = shopConfig({ shop: config?.shop });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState(0);
  const [selectionTarget, setSelectionTarget] = useState<"products" | "checkout">("products");
  const [quantity, setQuantity] = useState(1);
  const [adminVisible, setAdminVisible] = useState(false);
  const [help, setHelp] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [clearConfirm, setClearConfirm] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const lastActivity = useRef(Date.now());
  const upCombo = useRef({ count: 0, time: 0 });
  const scanner = useRef({ value: "", time: 0 });
  const enterArmed = useRef(false);
  const requestId = useRef("");
  const checkoutIntent = useRef<CheckoutIntent | null>(null);
  const scanInput = useRef<HTMLInputElement>(null);
  const productRefs = useRef<Record<string, HTMLElement | null>>({});
  const checkoutButton = useRef<HTMLButtonElement>(null);
  const confirmOrderButton = useRef<HTMLButtonElement>(null);
  const refresh = useCallback(async () => {
    try {
      const data = await api<{ items: Item[]; config: PublicConfig }>("items");
      setItems(data.items);
      setConfig(data.config);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const events = new EventSource("/api/events");
    events.onmessage = () => void refresh();
    return () => events.close();
  }, [refresh]);
  useEffect(() => {
    if (!config || hydrated) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem("dskru-kiosk") || "null");
      if (saved && (Date.now() - saved.time < shop.idleMinutes * 60_000 || ((saved.order?.status === "pending" || saved.intent) && Date.now() - saved.time < 86_400_000))) {
        setCart(saved.cart || {});
        const savedStudentId = saved.order?.studentId ?? saved.intent?.studentId ?? saved.studentId;
        if (typeof savedStudentId === "string" && /^[0-9]{0,30}$/.test(savedStudentId)) setStudentId(savedStudentId);
        if (saved.order) {
          setOrder(saved.order);
          setCheckout(true);
        } else if (saved.intent) {
          checkoutIntent.current = saved.intent;
          requestId.current = saved.intent.requestId;
          setCheckout(true);
          setBusy(true);
          void post<Order>("purchase", saved.intent).then((created) => {
            checkoutIntent.current = null;
            setOrder(created);
          }).catch((error) => {
            if (error instanceof ApiError && error.status < 500) checkoutIntent.current = null;
            setPaymentError((error as Error).message);
          }).finally(() => setBusy(false));
        }
      }
    } catch {}
    setHydrated(true);
  }, [config, hydrated, shop.idleMinutes]);
  useEffect(() => { document.title = `${shop.storeName} · ${shop.schoolName}`; }, [shop.storeName, shop.schoolName]);
  useEffect(() => {
    if (hydrated)
      sessionStorage.setItem(
        "dskru-kiosk",
        JSON.stringify({ cart, order, studentId, intent: checkoutIntent.current, time: Date.now() }),
      );
  }, [cart, order, studentId, busy, hydrated]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(id);
  }, [notice]);
  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (category === "all" || item.category === category) &&
          (!query ||
            `${item.name} ${item.subtitle} ${item.barcode}`
              .toLowerCase()
              .includes(query.toLowerCase())),
      ),
    [items, category, query],
  );
  const lines = items.filter((item) => cart[item.id] > 0);
  useEffect(() => {
    if (!config || busy || checkoutIntent.current || order?.status === "pending") return;
    const available: Record<string, number> = {};
    for (const [id, qty] of Object.entries(cart)) {
      const item = items.find((product) => product.id === id);
      if (item && item.stock > 0 && Number.isInteger(qty) && qty > 0) {
        available[id] = Math.min(qty, item.stock, shop.maxItemQuantity);
      }
    }
    if (JSON.stringify(available) !== JSON.stringify(cart)) {
      setCart(available);
      requestId.current = "";
      setNotice("อัปเดตตะกร้าตามจำนวนสินค้าที่มีแล้ว");
    }
  }, [items, cart, config, order?.status, busy, shop.maxItemQuantity]);
  useEffect(() => {
    setQuantity((value) => Math.min(value, shop.maxItemQuantity));
    if (shop.studentIdMode === "hidden" && !order && !checkoutIntent.current) setStudentId("");
  }, [shop.maxItemQuantity, shop.studentIdMode, order]);
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const canCheckout = count > 0 && !!config?.storeOpen && !busy;
  const total =
    lines.reduce(
      (sum, item) => sum + Math.round(item.price * 100) * cart[item.id],
      0,
    ) / 100;
  const reset = useCallback(() => {
    setCart({});
    setOrder(null);
    setCheckout(false);
    setQuery("");
    setCategory("all");
    setSelected(0);
    setSelectionTarget("products");
    setStudentId("");
    setPaymentError("");
    setAdminVisible(false);
    requestId.current = "";
    checkoutIntent.current = null;
    enterArmed.current = false;
    sessionStorage.removeItem("dskru-kiosk");
  }, []);
  useEffect(() => {
    const activity = () => {
      lastActivity.current = Date.now();
    };
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    const interval = setInterval(() => {
      if (!busy && !checkoutIntent.current && order?.status !== "pending" && Date.now() - lastActivity.current > shop.idleMinutes * 60_000) {
        reset();
        setNotice("เริ่มรายการใหม่แล้ว");
        lastActivity.current = Date.now();
      }
    }, 1000);
    return () => {
      clearInterval(interval);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
    };
  }, [reset, order?.status, busy, shop.idleMinutes]);
  useEffect(() => {
    if (order?.status !== "pending") return;
    const interval = setInterval(async () => {
      try {
        const current = await api<Order>(`purchase/${order.id}`, {
          headers: { "x-order-token": order.accessToken },
        });
        setOrder((previous) => (previous?.id === current.id ? { ...previous, ...current } : previous));
        setPaymentError("");
        if (current.status === "completed") {
          setCart({});
          void refresh();
        }
      } catch (e) {
        setPaymentError((e as Error).message);
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [order?.id, order?.accessToken, order?.status, refresh]);
  useEffect(() => {
    if (order?.status !== "completed") return;
    const id = setTimeout(reset, shop.receiptSeconds * 1000);
    return () => clearTimeout(id);
  }, [order?.status, reset, shop.receiptSeconds]);
  function add(item: Item, qty = 1) {
    if (!config?.storeOpen) {
      setNotice("ร้านปิดชั่วคราว");
      return;
    }
    if ((cart[item.id] || 0) + qty > item.stock) {
      setNotice(`เหลือ ${item.stock} ชิ้นในร้าน`);
      return;
    }
    if ((cart[item.id] || 0) + qty > shop.maxItemQuantity) {
      setNotice(`ซื้อสินค้าแต่ละชนิดได้ไม่เกิน ${shop.maxItemQuantity} ชิ้นต่อรายการ`);
      return;
    }
    setCart((previous) => ({
      ...previous,
      [item.id]: (previous[item.id] || 0) + qty,
    }));
    setNotice(`เพิ่ม ${item.name} แล้ว`);
    requestId.current = "";
  }
  function adjust(item: Item, delta: number) {
    if (delta > 0 && cart[item.id] >= shop.maxItemQuantity) {
      setNotice(`ซื้อสินค้าแต่ละชนิดได้ไม่เกิน ${shop.maxItemQuantity} ชิ้นต่อรายการ`);
      return;
    }
    if (delta > 0 && cart[item.id] >= item.stock) {
      setNotice("จำนวนสินค้าถึงสต็อกที่มีแล้ว");
      return;
    }
    setCart((previous) => {
      const next = {
        ...previous,
        [item.id]: Math.max(0, (previous[item.id] || 0) + delta),
      };
      if (!next[item.id]) delete next[item.id];
      return next;
    });
    requestId.current = "";
  }
  function scan(value: string) {
    const item = items.find((i) => i.barcode === value.trim());
    if (item) {
      add(item);
      setQuery("");
    } else setNotice("ไม่พบบาร์โค้ดนี้ ลองค้นหาด้วยชื่อสินค้า");
  }
  function openCheckout() {
    if (!canCheckout) return;
    setPaymentError("");
    setCheckout(true);
    enterArmed.current = false;
  }
  function selectProduct(index: number) {
    setSelectionTarget("products");
    setSelected(index);
    setQuantity(1);
    enterArmed.current = false;
    const item = filtered[index];
    const element = item && productRefs.current[item.id];
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "nearest" });
  }
  function selectCheckout() {
    if (!canCheckout) return;
    setSelectionTarget("checkout");
    enterArmed.current = false;
    checkoutButton.current?.focus({ preventScroll: true });
    checkoutButton.current?.scrollIntoView({ block: "nearest" });
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const editing =
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.isContentEditable;
      if (checkout || help || clearConfirm || editing) return;
      if (event.key === "ArrowUp") {
        upCombo.current = {
          count:
            Date.now() - upCombo.current.time < 1500
              ? upCombo.current.count + 1
              : 1,
          time: Date.now(),
        };
        if (upCombo.current.count === 5) {
          setAdminVisible(true);
          setNotice("เปิดทางเข้าสำหรับเจ้าหน้าที่แล้ว");
          upCombo.current.count = 0;
        }
      } else upCombo.current.count = 0;
      if (event.key === "/") {
        event.preventDefault();
        scanInput.current?.focus();
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
        scanner.current = {
          value:
            Date.now() - scanner.current.time < 100
              ? scanner.current.value + event.key
              : event.key,
          time: Date.now(),
        };
        return;
      }
      if (
        event.key === "Enter" &&
        scanner.current.value.length >= 4 &&
        Date.now() - scanner.current.time < 250
      ) {
        event.preventDefault();
        scan(scanner.current.value);
        scanner.current.value = "";
        return;
      }
      if (event.key === "Enter" && target.closest("button,a")) return;
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].includes(
          event.key,
        )
      )
        event.preventDefault();
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const forward = event.key === "ArrowDown";
        if (selectionTarget === "checkout") {
          if (filtered.length) selectProduct(forward ? 0 : filtered.length - 1);
        } else if (!filtered.length) {
          selectCheckout();
        } else {
          const nextIndex = selected + (forward ? 1 : -1);
          if ((nextIndex < 0 || nextIndex >= filtered.length) && canCheckout) {
            selectCheckout();
          } else {
            selectProduct(Math.max(0, Math.min(filtered.length - 1, nextIndex)));
          }
        }
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (selectionTarget === "checkout") return;
        setQuantity((q) =>
          Math.max(
            1,
            Math.min(
              shop.maxItemQuantity,
              filtered[selected]?.stock || 1,
              q + (event.key === "ArrowRight" ? 1 : -1),
            ),
          ),
        );
        enterArmed.current = false;
      }
      if (event.key === "Enter") {
        if (selectionTarget === "checkout" || enterArmed.current) {
          openCheckout();
        } else if (filtered[selected]) {
          add(filtered[selected], quantity);
          enterArmed.current = true;
        }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
  useEffect(() => {
    if (selected >= filtered.length) setSelected(0);
    if (selectionTarget === "checkout" && !canCheckout) {
      selectProduct(Math.max(0, Math.min(selected, filtered.length - 1)));
    }
  }, [filtered.length, selected, selectionTarget, canCheckout]);
  async function createOrder() {
    setBusy(true);
    setPaymentError("");
    if (!requestId.current) requestId.current = crypto.randomUUID();
    try {
      const intent: CheckoutIntent = checkoutIntent.current || {
        items: lines.map((i) => ({ id: i.id, qty: cart[i.id] })),
        paymentMethod: "promptpay",
        studentId: shop.studentIdMode === "hidden" ? undefined : studentId || undefined,
        requestId: requestId.current,
      };
      checkoutIntent.current = intent;
      sessionStorage.setItem("dskru-kiosk", JSON.stringify({ cart, intent, time: Date.now() }));
      const created = await post<Order>("purchase", intent);
      checkoutIntent.current = null;
      setOrder(created);
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) {
        checkoutIntent.current = null;
        requestId.current = "";
      }
      setPaymentError((e as Error).message);
      void refresh();
    } finally {
      setBusy(false);
    }
  }
  async function cancelOrder() {
    if (!order) {
      setCheckout(false);
      return;
    }
    setBusy(true);
    try {
      await api(`purchase/${order.id}`, {
        method: "DELETE",
        headers: { "x-order-token": order.accessToken },
      });
      setOrder(null);
      setCheckout(false);
      requestId.current = "";
    } catch (e) {
      setPaymentError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setNotice("เบราว์เซอร์นี้ไม่รองรับการแสดงผลเต็มจอ");
    }
  }
  return (
    <div className="kiosk-shell">
      <header className="topbar">
        <Brand config={shop} />
        <div className="topbar-right">
          {config?.demo && <span className="demo-badge">โหมดทดลอง</span>}
          <span
            className={`store-status ${config && !config.storeOpen ? "closed" : ""}`}
          >
            <span />
            {config?.storeOpen ? "ร้านเปิดแล้ว" : "ร้านสหกรณ์"}
          </span>
          <span className="topbar-divider" />
          <button
            className="icon-button"
            onClick={() => setHelp(true)}
            aria-label="วิธีใช้งาน"
          >
            <CircleHelp size={21} />
          </button>
          <button
            className="icon-button"
            onClick={fullscreen}
            aria-label="เต็มหน้าจอ"
          >
            <Maximize size={21} />
          </button>
        </div>
      </header>
      <main className="kiosk-main">
        <section className="catalog">
          <div className="catalog-heading">
            <div>
              <div className="eyebrow">{shop.eyebrow}</div>
              <h1>
                {shop.welcomeTitle}
              </h1>
              <p>{shop.welcomeMessage}</p>
            </div>
            <div className="school-stamp">
              <span>โรงเรียนของเรา</span>
              <strong>{shop.schoolShortName}</strong>
              <span>{shop.storeName}</span>
            </div>
          </div>
          <form
            className="scan-search"
            onSubmit={(event) => {
              event.preventDefault();
              scan(query);
            }}
          >
            <Barcode size={25} />
            <input
              ref={scanInput}
              aria-label="สแกนบาร์โค้ดหรือค้นหาสินค้า"
              placeholder="สแกนบาร์โค้ด หรือค้นหาสินค้า..."
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected(0);
              }}
            />
            {query ? (
              <button
                type="button"
                aria-label="ล้างการค้นหา"
                onClick={() => setQuery("")}
              >
                <X size={19} />
              </button>
            ) : (
              <span className="scan-label">
                SCAN & GO <ArrowUpRight size={14} />
              </span>
            )}
          </form>
          <nav className="category-tabs" aria-label="หมวดสินค้า">
            {categories.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={category === id ? "active" : ""}
                onClick={() => {
                  setCategory(id);
                  setSelected(0);
                  setQuantity(1);
                }}
                aria-pressed={category === id}
              >
                <Icon size={20} />
                <span>{label}</span>
                {id === "all" && (
                  <span className="category-count">{items.length}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="catalog-meta">
            <h2>
              {categories.find((c) => c.id === category)?.label}
              <span>{filtered.length} รายการ</span>
            </h2>
            <span>
              <ShieldCheck size={16} /> ราคานักเรียน สบายกระเป๋า
            </span>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button onClick={() => void refresh()}>ลองอีกครั้ง</button>
            </div>
          )}
          {config && !config.storeOpen && (
            <div className="error-banner">
              ร้านปิดชั่วคราว กรุณาติดต่อเจ้าหน้าที่
            </div>
          )}
          {loading ? (
            <div className="loading-state">
              <LoaderCircle className="spin" /> กำลังโหลดสินค้า...
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-results">
              <Search size={36} />
              <h3>ไม่พบสินค้าที่ค้นหา</h3>
              <p>ลองใช้ชื่อสินค้าอื่น หรือเลือกหมวดทั้งหมด</p>
              <button
                className="secondary-button"
                onClick={() => {
                  setQuery("");
                  setCategory("all");
                }}
              >
                ดูสินค้าทั้งหมด
              </button>
            </div>
          ) : (
            <div className="product-grid">
              {filtered.map((item, index) => (
                <article
                  key={item.id}
                  ref={(element) => {
                    productRefs.current[item.id] = element;
                  }}
                  className={`product-card ${!item.stock ? "sold-out" : ""} ${selectionTarget === "products" && selected === index ? "keyboard-selected" : ""}`}
                  tabIndex={-1}
                  aria-current={selectionTarget === "products" && selected === index ? "true" : undefined}
                  onFocus={() => {
                    setSelectionTarget("products");
                    setSelected(index);
                  }}
                  onPointerMove={() => {
                    if (selectionTarget === "products" && selected === index) return;
                    checkoutButton.current?.blur();
                    setSelectionTarget("products");
                    setSelected(index);
                    setQuantity(1);
                    enterArmed.current = false;
                  }}
                >
                  <div className="product-image-wrap">
                    <ProductImage item={item} />
                    <span
                      className={`stock-pill ${item.stock <= item.reorderLevel ? "low" : ""}`}
                    >
                      {item.stock === 0
                        ? "สินค้าหมด"
                        : item.stock <= item.reorderLevel
                          ? `เหลือ ${item.stock} ชิ้น`
                          : "พร้อมหยิบ"}
                    </span>
                    {cart[item.id] > 0 && (
                      <span className="in-cart-badge">
                        <ShoppingBag size={13} />
                        {cart[item.id]}
                      </span>
                    )}
                    {selectionTarget === "products" && selected === index && (
                      <span className="keyboard-qty">
                        <CheckCircle2 size={20} aria-hidden="true" />
                        <span>
                          กำลังเลือก
                          <small>
                            {!item.stock
                              ? "สินค้าหมด"
                              : !config?.storeOpen
                                ? "ร้านปิดชั่วคราว"
                                : `Enter เพื่อเพิ่ม ${quantity} ชิ้น`}
                          </small>
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="product-info">
                    <h3>{item.name}</h3>
                    <p>{item.subtitle}</p>
                    <div className="product-bottom">
                      <strong>
                        {money(item.price)}
                        <span>/ ชิ้น</span>
                      </strong>
                      <button
                        aria-label={`เพิ่ม ${item.name}`}
                        disabled={!item.stock || !config?.storeOpen}
                        onClick={() => add(item)}
                      >
                        <Plus size={22} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="catalog-footnote">
            <span>{shop.catalogNote}</span>
            <a href="/products/ATTRIBUTION.md" target="_blank" rel="noreferrer">
              เครดิตภาพสินค้า
            </a>
          </div>
        </section>
        <aside className="cart-panel" aria-label="ตะกร้าสินค้า">
          <div className="cart-heading">
            <div>
              <ShoppingBag size={23} />
              <h2>ตะกร้าของฉัน</h2>
              <span>{count}</span>
            </div>
            {count > 0 && (
              <button
                className="icon-button"
                aria-label="ล้างตะกร้า"
                onClick={() => setClearConfirm(true)}
              >
                <Trash2 size={18} />
              </button>
            )}
          </div>
          <p className="cart-subtitle">อีกนิดเดียว ก็ได้อร่อยแล้ว</p>
          {!count ? (
            <div className="empty-cart">
              <div className="empty-cart-icon">
                <ShoppingBag size={45} strokeWidth={1.4} />
                <span>+</span>
              </div>
              <h3>ตะกร้ายังว่างอยู่</h3>
              <p>
                แตะ <span className="inline-plus">+</span> ที่สินค้า
                หรือสแกนบาร์โค้ด
                <br />
                เพื่อเริ่มเลือกของที่ชอบ
              </p>
            </div>
          ) : (
            <div className="cart-lines">
              {lines.map((item) => (
                <div className="cart-line" key={item.id}>
                  <ProductImage item={item} />
                  <div className="cart-line-body">
                    <h3>{item.name}</h3>
                    <span>{money(item.price)} / ชิ้น</span>
                    <div className="quantity-control">
                      <button
                        aria-label={`ลด ${item.name}`}
                        onClick={() => adjust(item, -1)}
                      >
                        <Minus size={14} />
                      </button>
                      <strong>{cart[item.id]}</strong>
                      <button
                        aria-label={`เพิ่มจำนวน ${item.name}`}
                        onClick={() => adjust(item, 1)}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                  <strong>{money(item.price * cart[item.id])}</strong>
                </div>
              ))}
            </div>
          )}
          <div className="cart-summary">
            <div className="summary-line">
              <span>จำนวนสินค้า</span>
              <span>{count} ชิ้น</span>
            </div>
            <div className="summary-total">
              <span>ยอดรวม</span>
              <strong>{money(total)}</strong>
            </div>
            <button
              ref={checkoutButton}
              className={`checkout-button ${selectionTarget === "checkout" ? "keyboard-selected" : ""}`}
              disabled={!canCheckout}
              aria-label="ไปชำระเงิน"
              onFocus={() => {
                setSelectionTarget("checkout");
                enterArmed.current = false;
              }}
              onBlur={() => setSelectionTarget("products")}
              onClick={openCheckout}
            >
              <span>
                ไปชำระเงิน
                {selectionTarget === "checkout" && <small>กำลังเลือก · กด Enter</small>}
              </span>
              {selectionTarget === "checkout" ? <CheckCircle2 size={23} /> : <ArrowRight size={23} />}
            </button>
            {canCheckout && <p className="checkout-keyboard-hint">กด ↑ จากสินค้าชิ้นแรก หรือ ↓ จากชิ้นสุดท้าย เพื่อเลือกชำระเงิน</p>}
            <div className="payment-logos">
              <QrCode size={16} />
              <span>พร้อมเพย์ · ขั้นต่ำ {shop.minimumOrder} บาท</span>
            </div>
          </div>
          <div className="cooperative-note">
            <span className="note-icon">
              <ShoppingBag size={18} />
            </span>
            <p>
              ทุกการอุดหนุน มีความหมาย
              <br />
              <strong>{shop.supportMessage}</strong>
            </p>
          </div>
        </aside>
      </main>
      <footer className="kiosk-footer">
        <div>
          <Keyboard size={19} />
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> เลือกสินค้า / ปุ่มชำระเงิน
          </span>
          <span>
            <kbd>←</kbd>
            <kbd>→</kbd> ปรับจำนวน
          </span>
          <span>
            <kbd>Enter</kbd> เพิ่มลงตะกร้า / ชำระเงิน
          </span>
        </div>
        <div>
          {adminVisible && (
            <Link className="staff-link" href="/admin">
              สำหรับเจ้าหน้าที่ <ChevronRight size={14} />
            </Link>
          )}
          <span>
            {shop.footerText} <span className="orange-heart">♡</span>
          </span>
        </div>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <Check size={18} />
          {notice}
        </div>
      )}
      {help && (
        <Modal
          title="ซื้อของง่าย ๆ ใน 3 ขั้นตอน"
          onClose={() => setHelp(false)}
        >
          <ol className="help-steps">
            <li>
              <strong>เลือกสินค้า</strong>
              <p>แตะ + หรือใช้เครื่องสแกนบาร์โค้ดแบบ USB ที่ลงท้ายด้วย Enter</p>
            </li>
            <li>
              <strong>ตรวจสอบตะกร้า</strong>
              <p>ปรับจำนวน แล้วชำระด้วยการโอนผ่านพร้อมเพย์</p>
              <p>ใช้ ↑ ↓ เลือกสินค้าและปุ่มชำระเงิน · ← → ปรับจำนวนสินค้า · Enter เพื่อเลือก</p>
              <p>กด ↑ จากสินค้าชิ้นแรก หรือ ↓ จากชิ้นสุดท้าย เพื่อไปที่ปุ่มชำระเงิน แล้วกด Enter</p>
            </li>
            <li>
              <strong>รอผลการชำระอัตโนมัติ</strong>
              <p>สแกนจ่าย แล้วรอใบเสร็จบนหน้าจอ จากนั้นรับสินค้าได้เลย</p>
            </li>
          </ol>
          <p className="muted">รับโอนผ่านพร้อมเพย์ ยอดขั้นต่ำ {shop.minimumOrder} บาทต่อรายการ</p>
          <button
            className="primary-button full-width"
            onClick={() => setHelp(false)}
          >
            เข้าใจแล้ว
          </button>
        </Modal>
      )}
      {clearConfirm && (
        <Modal title="ล้างตะกร้าสินค้า?" onClose={() => setClearConfirm(false)}>
          <p>นำสินค้าทั้งหมดออกเพื่อเริ่มเลือกใหม่</p>
          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => setClearConfirm(false)}
            >
              เลือกต่อ
            </button>
            <button
              className="primary-button"
              onClick={() => {
                setCart({});
                setStudentId("");
                requestId.current = "";
                setClearConfirm(false);
              }}
            >
              ล้างตะกร้า
            </button>
          </div>
        </Modal>
      )}
      {checkout && (
        <Modal
          wide={!order}
          arrowNavigation
          title={
            order?.status === "completed"
              ? "ขอบคุณที่อุดหนุน"
              : order
                ? order.status === "cancelled" ? "รายการสิ้นสุดแล้ว" : "รอผลการชำระเงิน"
                : "ชำระเงิน"
          }
          onClose={!order && !busy && !checkoutIntent.current ? () => setCheckout(false) : undefined}
        >
          {order?.studentId && order.status !== "completed" && (
            <p className="student-id-receipt">รหัสนักเรียน <strong>{order.studentId}</strong></p>
          )}
          {!order ? (
            <>
              <div className="checkout-amount">
                <span>ยอดชำระทั้งหมด · {count} ชิ้น</span>
                <strong>{money(total)}</strong>
              </div>
              <div className={shop.studentIdMode === "hidden" ? "" : "checkout-input-grid"}>
                {shop.studentIdMode !== "hidden" && <StudentIdKeypad
                  required={shop.studentIdMode === "required"}
                  exactLength={shop.studentIdLength}
                  value={checkoutIntent.current ? checkoutIntent.current.studentId || "" : studentId}
                  disabled={busy || !!checkoutIntent.current}
                  onContinue={() => {
                    if (!confirmOrderButton.current?.disabled) {
                      confirmOrderButton.current?.focus({ preventScroll: true });
                      confirmOrderButton.current?.scrollIntoView({ block: "nearest" });
                    }
                  }}
                  onChange={(value) => {
                    setStudentId(value);
                    requestId.current = "";
                  }}
                />}
                <div className="checkout-payment-details">
              <div className="payment-choices transfer-only">
                <div className="transfer-choice">
                  <QrCode />
                  <strong>โอนผ่านพร้อมเพย์</strong>
                  <span>{config?.promptpayAvailable ? "สแกน QR ด้วยแอปธนาคาร" : "ยังไม่เปิดให้บริการ"}</span>
                </div>
              </div>
              <p className="payment-notice">
                <ShieldCheck size={18} />{" "}
                ตรวจยอดอัตโนมัติ จ่ายสำเร็จแล้วรับใบเสร็จบนหน้าจอ
              </p>
              <p className="small-print center">ยอด {shop.minimumOrder}–{shop.maximumOrder} บาทต่อรายการ • QR มีอายุ 5 นาที</p>
              {shop.studentIdMode === "required" && !studentId && <p className="small-print center">กรอกรหัสนักเรียนก่อนยืนยันรายการ</p>}
              {shop.studentIdMode !== "hidden" && studentId && shop.studentIdLength > 0 && studentId.length !== shop.studentIdLength && <p className="form-error">รหัสนักเรียนต้องมี {shop.studentIdLength} หลัก</p>}
              {config?.paymentMode === "test" && <p className="form-error">โหมดทดสอบ — ไม่มีการรับเงินจริง</p>}
              {paymentError && (
                <p className="form-error" role="alert">
                  {paymentError}
                </p>
              )}
              <button
                ref={confirmOrderButton}
                className="primary-button full-width"
                disabled={busy || (!checkoutIntent.current && (!config?.promptpayAvailable || total < shop.minimumOrder || total > shop.maximumOrder || (shop.studentIdMode === "required" && !studentId) || (shop.studentIdMode !== "hidden" && !!studentId && shop.studentIdLength > 0 && studentId.length !== shop.studentIdLength)))}
                onClick={createOrder}
              >
                {busy ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <>
                    {checkoutIntent.current ? "ตรวจสถานะรายการเดิมอีกครั้ง" : "ยืนยันรายการ"} <ArrowRight size={20} />
                  </>
                )}
              </button>
                </div>
              </div>
            </>
          ) : order.status === "completed" ? (
            <>
              <div className="receipt-heading">
                <span className="success-icon">
                  <CheckCircle2 size={43} />
                </span>
                <h3>ชำระเงินเรียบร้อยแล้ว</h3>
                {order.payment?.mode === "test" && <p className="form-error">ใบเสร็จทดสอบ — ไม่ใช่การชำระเงินจริง</p>}
                <p>รับสินค้าได้เลย แล้วพบกันใหม่นะ</p>
              </div>
              <div className="receipt">
                <div className="receipt-meta">
                  <strong>{shop.storeName}</strong>
                  <span>#{order.id.slice(0, 8).toUpperCase()}</span>
                </div>
                <p>{dateTime(order.completedAt || order.timestamp)}</p>
                {order.studentId && <p className="student-id-receipt">รหัสนักเรียน <strong>{order.studentId}</strong></p>}
                {order.items.map((i) => (
                  <div className="summary-line" key={i.id}>
                    <span>
                      {i.name} × {i.qty}
                    </span>
                    <span>{money(i.price * i.qty)}</span>
                  </div>
                ))}
                <div className="summary-total">
                  <span>
                    ชำระแล้ว ·{" "}
                    {order.paymentMethod === "cash" ? "เงินสด" : "พร้อมเพย์"}
                  </span>
                  <strong>{money(order.total)}</strong>
                </div>
              </div>
              <button className="primary-button full-width" onClick={reset}>
                เริ่มรายการใหม่ <ArrowRight size={20} />
              </button>
              <p className="center muted">กลับหน้าร้านอัตโนมัติใน 20 วินาที</p>
            </>
          ) : order.status === "cancelled" ? (
            <>
              <div className="empty-results">
                <X size={40} />
                <h3>{order.payment?.status === "expired" ? "QR หมดอายุแล้ว" : "รายการไม่สำเร็จ"}</h3>
                <p>{order.payment?.error || "ยังไม่ได้รับชำระสำหรับรายการนี้ เริ่มรายการใหม่ได้เลย"}</p>
              </div>
              <button className="primary-button full-width" onClick={reset}>
                กลับไปเลือกสินค้า
              </button>
            </>
          ) : (
            <>
              <div className="checkout-amount">
                <span>รายการ #{order.id.slice(0, 8).toUpperCase()}</span>
                <strong>{money(order.total)}</strong>
              </div>
              {order.payment?.qrImageUrl && !order.payment.error ? (
                <>
                  <div className="qr-wrap">
                    <img src={order.payment.qrImageUrl} width={230} height={230} alt="QR พร้อมเพย์สำหรับรายการนี้" referrerPolicy="no-referrer" />
                  </div>
                  <p className="center">
                    <strong>
                      {order.recipientName || "ตรวจสอบชื่อผู้รับในแอปธนาคาร"}
                    </strong>
                    <br />
                    <span className="muted">
                      ตรวจสอบยอดและชื่อผู้รับก่อนโอน
                    </span>
                  </p>
                </>
              ) : (
                <div className="cash-instruction">
                  <QrCode size={44} />
                  <h3>{order.payment ? "กำลังตรวจสถานะการชำระเงิน" : "รายการจากระบบเดิม"}</h3>
                  <p>{order.payment?.error || (order.payment ? "กรุณารอสักครู่" : "หากยังไม่ได้โอน ให้ยกเลิกแล้วเริ่มรายการใหม่ หากโอนแล้วให้ติดต่อร้าน")}</p>
                </div>
              )}
              <div className="waiting-note">
                <LoaderCircle className="spin" size={20} />
                <span>ระบบตรวจการชำระเงินอัตโนมัติ</span>
              </div>
              <p className="center muted">
                เมื่อชำระสำเร็จ ใบเสร็จจะแสดงบนหน้านี้เอง
              </p>
              {order.payment && <p className="small-print center">QR หมดอายุ {dateTime(order.payment.expiresAt)} • รอผลจากผู้ให้บริการก่อนเริ่มใหม่</p>}
              {order.payment?.mode === "test" && <p className="form-error">โหมดทดสอบ — ไม่มีการรับเงินจริง</p>}
              {paymentError && (
                <p role="alert" className="form-error">
                  {paymentError}
                </p>
              )}
              {!order.payment && <button
                className="secondary-button full-width"
                disabled={busy}
                onClick={cancelOrder}
              >
                ยกเลิก · ยังไม่ได้ชำระเงิน
              </button>}
              <p className="small-print center">
                หากโอนเงินแล้ว กรุณารอผลบนหน้าจอ ไม่ต้องชำระซ้ำ
              </p>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
