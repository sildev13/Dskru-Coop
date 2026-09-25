"use client";
import { useEffect, useRef, useState } from "react";
import {
  ShoppingBag,
  Droplets,
  Milk,
  CupSoda,
  Cookie,
  Soup,
  Pencil,
  BookOpen,
  X,
  Package,
} from "lucide-react";
import type { Item } from "@/lib/types";
import { defaultShopConfig, type ShopConfig } from "@/lib/shop-config";
export function Brand({ small = false, config = defaultShopConfig }: { small?: boolean; config?: Pick<ShopConfig, "storeName" | "schoolName"> }) {
  return (
    <div className={`brand ${small ? "small" : ""}`}>
      <span className="brand-mark">
        <ShoppingBag size={27} strokeWidth={2.2} />
      </span>
      <div>
        <strong>
          {config.storeName}
        </strong>
        <span className="brand-caption">{config.schoolName}</span>
      </div>
    </div>
  );
}
export function ProductImage({ item }: { item: Item }) {
  const [failed, setFailed] = useState(false);
  const Icon =
    (
      {
        water: Droplets,
        milk: Milk,
        juice: CupSoda,
        cookies: Cookie,
        noodles: Soup,
        pencil: Pencil,
        notebook: BookOpen,
      } as Record<string, typeof Package>
    )[item.id] || Package;
  return (
    <div className={`product-visual visual-${item.category}`}>
      {item.image && !failed ? (
        <img
          src={item.image}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon size={60} strokeWidth={1.3} />
      )}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  arrowNavigation = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose?: () => void;
  wide?: boolean;
  arrowNavigation?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-label={title}
      onKeyDown={(event) => {
        if (!arrowNavigation || !onClose || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
        if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
        if (event.target === closeButton.current) {
          event.preventDefault();
          if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
            const firstControl = Array.from(ref.current?.querySelectorAll<HTMLElement>(
              'input:not(:disabled):not([type="hidden"]), button:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]',
            ) || []).find((element) => !element.closest(".modal-header") && element.getClientRects().length > 0);
            firstControl?.focus({ preventScroll: true });
            firstControl?.scrollIntoView({ block: "nearest" });
          }
        } else if (event.key === "ArrowUp") {
          // The keypad handles its own arrows first. Its input leaves Up for the close button.
          event.preventDefault();
          closeButton.current?.focus({ preventScroll: true });
          closeButton.current?.scrollIntoView({ block: "nearest" });
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        {onClose && (
          <button ref={closeButton} type="button" className="icon-button modal-close" aria-label="ปิด" onClick={onClose}>
            <X />
          </button>
        )}
      </div>
      {children}
    </dialog>
  );
}
