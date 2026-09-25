"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Delete, Keyboard } from "lucide-react";

const maxLength = 30;
const digits = ["7", "8", "9", "4", "5", "6", "1", "2", "3"];

export default function StudentIdKeypad({ value, onChange, onContinue, disabled, required = false, exactLength = 0 }: {
  value: string;
  onChange: (value: string) => void;
  onContinue: () => void;
  disabled: boolean;
  required?: boolean;
  exactLength?: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const keys = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const [error, setError] = useState("");
  useEffect(() => {
    // The containing dialog must be open before moving focus into it.
    const frame = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);

  function update(next: string, caret?: number, keepKeypadFocus = false) {
    if (disabled) return;
    if (!/^[0-9]*$/.test(next)) {
      setError("กรอกรหัสนักเรียนด้วยตัวเลข 0–9 เท่านั้น");
      return;
    }
    if (next.length > (exactLength || maxLength)) {
      setError(`รหัสนักเรียนต้องไม่เกิน ${exactLength || maxLength} หลัก`);
      return;
    }
    setError("");
    onChange(next);
    if (caret !== undefined) requestAnimationFrame(() => {
      if (!keepKeypadFocus) input.current?.focus({ preventScroll: true });
      input.current?.setSelectionRange(caret, caret);
      // Clearing the last digit disables the action buttons. Keep focus on the keypad.
      if (keepKeypadFocus && !next) keys.current[10]?.focus({ preventScroll: true });
    });
  }
  function press(key: string, keepKeypadFocus = false) {
    if (disabled) return;
    const start = input.current?.selectionStart ?? value.length;
    const end = input.current?.selectionEnd ?? value.length;
    if (key === "clear") update("", 0, keepKeypadFocus);
    else if (key === "backspace") {
      const from = start === end ? Math.max(0, start - 1) : start;
      update(value.slice(0, from) + value.slice(end), from, keepKeypadFocus);
    } else update(value.slice(0, start) + key + value.slice(end), start + 1, keepKeypadFocus);
  }
  function moveFocus(index: number, direction: string) {
    const row = Math.floor(index / 3);
    const column = index % 3;
    if (direction === "ArrowUp" || direction === "ArrowDown") {
      const nextRow = row + (direction === "ArrowDown" ? 1 : -1);
      if (nextRow < 0) {
        input.current?.focus({ preventScroll: true });
        return;
      }
      if (nextRow > 3) {
        if (!error) onContinue();
        return;
      }
      // Prefer the same column, falling back to the nearest enabled key in that row.
      const columns = [0, 1, 2].sort((a, b) => Math.abs(a - column) - Math.abs(b - column));
      for (const nextColumn of columns) {
        const button = keys.current[nextRow * 3 + nextColumn];
        if (button && !button.disabled) {
          button.focus({ preventScroll: true });
          button.scrollIntoView({ block: "nearest" });
          return;
        }
      }
    } else {
      const delta = direction === "ArrowRight" ? 1 : -1;
      for (let nextColumn = column + delta; nextColumn >= 0 && nextColumn < 3; nextColumn += delta) {
        const button = keys.current[row * 3 + nextColumn];
        if (button && !button.disabled) {
          button.focus({ preventScroll: true });
          return;
        }
      }
    }
  }

  return <section className="student-id-keypad" aria-label="กรอกรหัสนักเรียน"
    onKeyDown={(event) => {
      if (disabled || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target === input.current) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          keys.current[0]?.focus({ preventScroll: true });
          keys.current[0]?.scrollIntoView({ block: "nearest" });
        }
        return;
      }
      const index = keys.current.findIndex((button) => button === event.target);
      if (index >= 0 && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        moveFocus(index, event.key);
        return;
      }
      // Continue accepting physical keypad digits after a keypad button receives focus.
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        press(event.key);
      }
    }}>
    <label className="field" htmlFor={id}>
      รหัสนักเรียน <span className="muted">({required ? "จำเป็น" : "ไม่บังคับ"}{exactLength ? ` · ${exactLength} หลัก` : ""})</span>
    </label>
    <input
      ref={input}
      id={id}
      className="student-id-input"
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      spellCheck={false}
      value={value}
      disabled={disabled}
      required={required}
      aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
      aria-invalid={!!error}
      onChange={(event) => update(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (!event.repeat && !error) onContinue();
        }
      }}
      placeholder="เช่น 00123"
    />
    <p className="student-id-help" id={`${id}-help`}>
      <Keyboard size={16} aria-hidden="true" /> จากช่องรหัส: ↓ เข้าแป้นตัวเลข · ↑ เลือก × แล้ว Enter เพื่อปิด
    </p>
    <div className="student-number-grid" role="group" aria-label="แป้นตัวเลขรหัสนักเรียน">
      {digits.map((digit, index) => <button key={digit} type="button" disabled={disabled}
        ref={(element) => { keys.current[index] = element; }}
        onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => press(digit, event.detail === 0)}>{digit}</button>)}
      <button type="button" className="student-key-action" disabled={disabled || !value}
        ref={(element) => { keys.current[9] = element; }}
        aria-label="ล้างรหัสนักเรียน" onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => press("clear", event.detail === 0)}>ล้าง</button>
      <button type="button" disabled={disabled} onPointerDown={(event) => event.preventDefault()}
        ref={(element) => { keys.current[10] = element; }}
        onClick={(event) => press("0", event.detail === 0)}>0</button>
      <button type="button" className="student-key-action" disabled={disabled || !value}
        ref={(element) => { keys.current[11] = element; }}
        aria-label="ลบหนึ่งหลัก" onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => press("backspace", event.detail === 0)}><Delete size={24} aria-hidden="true" /></button>
    </div>
    <p className="small-print">↑ ↓ ← → เลือกปุ่ม · Enter ใส่เลข · ↓ จากแถวล่างไปปุ่มยืนยันเมื่อพร้อมชำระ · ↑ จากแถวบนกลับช่องรหัส<br />{required ? "ต้องกรอกรหัสก่อนชำระเงิน" : "เว้นว่างได้"} · รหัสจะบันทึกพร้อมรายการขายเมื่อยืนยันรายการ</p>
    {error && <p className="form-error" id={`${id}-error`} role="alert">{error}</p>}
  </section>;
}
