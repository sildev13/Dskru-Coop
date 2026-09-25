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
}: {
  title: string;
  children: React.ReactNode;
  onClose?: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
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
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        {onClose && (
          <button className="icon-button" aria-label="ปิด" onClick={onClose}>
            <X />
          </button>
        )}
      </div>
      {children}
    </dialog>
  );
}
