import ExcelJS from "exceljs";
import { AppError, cents } from "./domain";
import { allowedExports, exportLabels, type ExportKind } from "./export-options";
import type { Purchase, Role, State } from "./types";
import { shopConfig } from "./shop-config";

const bangkokOffset = 7 * 60 * 60_000;
const moneyFormat = '#,##0.00;[Red](#,##0.00);"–"';
const dateFormat = "dd/mm/yyyy hh:mm:ss";
const statusLabels = { pending: "รอผลชำระ", completed: "ชำระแล้ว", cancelled: "ยกเลิก" };
const categories = { drinks: "เครื่องดื่ม", snacks: "ขนม", food: "อาหาร", supplies: "เครื่องเขียน" };

export type ExportOptions = { kind: ExportKind; from?: string; to?: string };

function validDate(value: string) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value < "1900-01-01") return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function parseExportOptions(params: URLSearchParams): ExportOptions {
  for (const key of ["kind", "from", "to"]) {
    if (params.getAll(key).length > 1) throw new AppError("พารามิเตอร์ส่งออกซ้ำกัน");
  }
  const kind = params.get("kind") || "all";
  if (!["all", "inventory", "sales", "budget"].includes(kind))
    throw new AppError("เลือกประเภทข้อมูลที่ต้องการส่งออก");
  const from = params.get("from") || undefined;
  const to = params.get("to") || undefined;
  if ((from && !validDate(from)) || (to && !validDate(to)))
    throw new AppError("วันที่ไม่ถูกต้อง ใช้รูปแบบ YYYY-MM-DD");
  if (from && to && from > to) throw new AppError("วันเริ่มต้นต้องไม่อยู่หลังวันสิ้นสุด");
  return { kind: kind as ExportKind, from, to };
}

// Excel dates have no timezone. Shift the instant so Excel displays Bangkok wall time.
function excelDate(value: string | Date | undefined) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time + bangkokOffset) : null;
}
function reportDate(order: Purchase) {
  return order.status === "completed" ? order.completedAt || order.timestamp : order.timestamp;
}
function inPeriod(timestamp: string, options: ExportOptions) {
  if (!options.from && !options.to) return true;
  const time = Date.parse(timestamp);
  const start = options.from ? Date.parse(`${options.from}T00:00:00+07:00`) : -Infinity;
  const end = options.to ? Date.parse(`${options.to}T00:00:00+07:00`) + 86_400_000 : Infinity;
  return Number.isFinite(time) && time >= start && time < end;
}

type Column = { header: string; width: number; format?: string };
type Value = string | number | Date | null;
function addSheet(workbook: ExcelJS.Workbook, name: string, columns: Column[], rows: Value[][]) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1" },
  });
  sheet.columns = columns.map((column) => ({
    header: column.header,
    width: column.width,
    style: { font: { name: "Tahoma", size: 11 }, numFmt: column.format || "@", alignment: { vertical: "middle", wrapText: true } },
  }));
  // Only scalar values enter cells; user input is never interpreted as a formula or link.
  sheet.addRows(rows);
  sheet.eachRow((row, index) => {
    let lines = 1;
    row.eachCell((cell, column) => {
      if (typeof cell.value === "string") {
        const charsPerLine = Math.max(1, Math.floor(columns[column - 1].width * 0.8));
        lines = Math.max(lines, cell.value.split(/\r?\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0));
      }
    });
    row.height = index === 1 ? 36 : Math.min(409, Math.max(32, lines * 18 + 8));
    if (index === 1) {
      row.eachCell((cell) => {
        cell.font = { name: "Tahoma", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF315C48" } };
      });
    } else if (index % 2 === 0) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6F0" } };
      });
    }
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: columns.length } };
  return sheet;
}
const textColumn = (header: string, width = 24): Column => ({ header, width });
const numberColumn = (header: string, width = 18): Column => ({ header, width, format: "#,##0" });
const amountColumn = (header: string): Column => ({ header, width: 22, format: moneyFormat });
const dateColumn = (header: string): Column => ({ header, width: 24, format: dateFormat });

export function createExportWorkbook(
  state: State,
  role: Role,
  options: ExportOptions,
  context: { demo: boolean; now?: Date },
) {
  const allowed = allowedExports(role);
  if (!allowed.length || (options.kind !== "all" && !allowed.includes(options.kind)))
    throw new AppError("บัญชีนี้ไม่มีสิทธิ์ส่งออกข้อมูลประเภทนี้", 403);
  const sections = options.kind === "all" ? allowed : [options.kind];
  const includeSales = sections.includes("sales");
  const includeBudget = sections.includes("budget");
  const includeInventory = sections.includes("inventory");
  const orders = includeSales || includeBudget
    ? state.transactions.filter((order) => inPeriod(reportDate(order), options)).sort((a, b) => reportDate(a).localeCompare(reportDate(b)))
    : [];
  const completed = orders.filter((order) => order.status === "completed");
  const entries = includeBudget
    ? state.budget.filter((entry) => inPeriod(entry.timestamp, options)).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    : [];
  const totalRows = (includeInventory ? state.items.length : 0)
    + (includeSales ? orders.length + orders.reduce((sum, order) => sum + order.items.length, 0) : 0)
    + (includeBudget ? completed.length + entries.length : 0);
  if (totalRows > 50_000)
    throw new AppError("ข้อมูลมากกว่า 50,000 แถว กรุณาเลือกประเภทข้อมูลหรือช่วงวันที่ให้แคบลง", 413);

  // Inventory is a current snapshot: reservations include orders outside the report period.
  const reservations = new Map<string, number>();
  if (includeInventory) {
    for (const order of state.transactions) {
      if (order.status !== "pending" || !order.gateway) continue;
      for (const item of order.items) reservations.set(item.id, (reservations.get(item.id) || 0) + item.qty);
    }
  }

  const now = context.now || new Date();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = shopConfig(state.settings).storeName;
  workbook.created = now;
  workbook.modified = now;
  const summaryRows: Value[][] = [
    ["รายงาน", shopConfig(state.settings).schoolName],
    ["ส่งออกเมื่อ (เวลาไทย)", excelDate(now)],
    ["แหล่งข้อมูล", context.demo ? "ข้อมูลทดลอง" : "ฐานข้อมูลร้าน (Firestore)"],
    ["ประเภทข้อมูล", sections.map((section) => exportLabels[section]).join(" / ")],
    ["ช่วงวันที่ (เวลาไทย)", includeSales || includeBudget ? `${options.from || "เริ่มต้น"} ถึง ${options.to || "ล่าสุด"}` : "สต็อกปัจจุบัน ณ เวลาส่งออก"],
    ["หลักการเลือกวันที่", "ยอดขายใช้วันชำระสำเร็จ หากไม่มีใช้วันสร้างรายการ; รายการรอชำระ/ยกเลิกและบัญชีอื่นใช้วันสร้างรายการ"],
    ["สกุลเงิน / เวลา", "บาท (THB) / Asia/Bangkok (UTC+7), ปี ค.ศ."],
  ];
  if (includeInventory) summaryRows.push(["สินค้า (รวมปิดขาย)", state.items.length], ["สต็อก", "เป็นยอดปัจจุบัน ไม่เปลี่ยนตามช่วงวันที่ที่เลือก"]);
  if (includeSales || includeBudget) summaryRows.push(
    ["จำนวนรายการชำระแล้ว", completed.length],
    ["ยอดขายชำระแล้ว (บาท)", completed.reduce((sum, order) => sum + cents(order.total), 0) / 100],
    ["ยอดขาย", "นับเฉพาะชำระแล้ว ก่อนหักค่าธรรมเนียม; ไม่นับรายการรอผลชำระและยกเลิก"],
  );
  if (includeSales) summaryRows.push(["รายการขายทุกสถานะในช่วงวันที่", orders.length]);
  if (includeBudget) summaryRows.push(
    ["รายรับอื่นในช่วงวันที่ (บาท)", entries.reduce((sum, entry) => sum + Math.max(0, cents(entry.amount)), 0) / 100],
    ["รายจ่ายอื่นในช่วงวันที่ (บาท)", entries.reduce((sum, entry) => sum + Math.max(0, -cents(entry.amount)), 0) / 100],
    ["ยอดคงเหลือปัจจุบัน (บาท)", state.settings.cooperativeBalance],
    ["ยอดคงเหลือ", "ยอดปัจจุบันของระบบ ไม่ใช่ยอด ณ วันสิ้นสุดช่วงที่เลือก; บัญชีรวมยอดขายชำระแล้วและรายรับ/รายจ่ายอื่น"],
  );
  if (totalRows === 0) summaryRows.push(["ผลการส่งออก", "ไม่พบข้อมูลตามเงื่อนไขที่เลือก"]);
  const summary = addSheet(workbook, "สรุป", [textColumn("รายการ", 42), textColumn("ข้อมูล", 100)], summaryRows);
  summary.autoFilter = undefined;
  summary.eachRow((row, index) => {
    if (index === 1) return;
    const cell = row.getCell(2);
    cell.numFmt = cell.value instanceof Date ? dateFormat : typeof cell.value === "number" ? (String(row.getCell(1).value).includes("(บาท)") ? moneyFormat : "#,##0") : "@";
  });

  if (includeInventory) addSheet(workbook, "สินค้า", [
    textColumn("รหัสสินค้า", 38), textColumn("ชื่อสินค้า", 32), textColumn("รายละเอียด", 34), textColumn("หมวดหมู่", 18),
    textColumn("บาร์โค้ด", 25), amountColumn("ราคาขาย (บาท)"), numberColumn("คงเหลือ"), numberColumn("จองรอชำระ"),
    numberColumn("พร้อมขาย"), numberColumn("จุดสั่งซื้อเพิ่ม"), textColumn("สถานะ", 16),
  ], [...state.items].sort((a, b) => a.name.localeCompare(b.name, "th")).map((item) => {
    const reserved = reservations.get(item.id) || 0;
    return [item.id, item.name, item.subtitle, categories[item.category], item.barcode, item.price, item.stock, reserved, Math.max(0, item.stock - reserved), item.reorderLevel, item.active ? "เปิดขาย" : "ปิดขาย"];
  }));

  if (includeSales) {
    addSheet(workbook, "รายการขาย", [
      textColumn("เลขรายการ", 38), dateColumn("วันที่ใช้ในรายงาน"), dateColumn("สร้างรายการเมื่อ"), dateColumn("ชำระสำเร็จเมื่อ"),
      textColumn("รหัสนักเรียน", 20), textColumn("การชำระ", 20), textColumn("สถานะ", 20), numberColumn("จำนวนชิ้น"), amountColumn("ยอดรวม (บาท)"),
    ], orders.map((order) => [order.id, excelDate(reportDate(order)), excelDate(order.timestamp), excelDate(order.completedAt), order.studentId || "", order.paymentMethod === "cash" ? "เงินสด (เดิม)" : "พร้อมเพย์", statusLabels[order.status], order.items.reduce((sum, item) => sum + item.qty, 0), order.total]));
    addSheet(workbook, "รายละเอียดการขาย", [
      textColumn("เลขรายการ", 38), dateColumn("วันที่ใช้ในรายงาน"), textColumn("สถานะ", 20), textColumn("รหัสสินค้า", 38),
      textColumn("ชื่อสินค้าขณะขาย", 34), numberColumn("จำนวนชิ้น"), amountColumn("ราคาต่อชิ้น (บาท)"), amountColumn("รวมบรรทัด (บาท)"),
    ], orders.flatMap((order) => order.items.map((item) => [order.id, excelDate(reportDate(order)), statusLabels[order.status], item.id, item.name, item.qty, item.price, cents(item.price) * item.qty / 100])));
  }
  if (includeBudget) {
    const ledger = [
      ...completed.map((order) => ({ id: order.id, timestamp: reportDate(order), type: "ยอดขาย", note: `ยอดขาย ${order.id}`, amount: order.total })),
      ...entries.map((entry) => ({ ...entry, type: entry.amount < 0 ? "รายจ่ายอื่น" : "รายรับอื่น" })),
    ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    addSheet(workbook, "บัญชีสหกรณ์", [textColumn("เลขรายการ", 38), dateColumn("วันที่ (เวลาไทย)"), textColumn("ประเภท", 20), textColumn("รายละเอียด", 60), amountColumn("รายรับ (บาท)"), amountColumn("รายจ่าย (บาท)"), amountColumn("สุทธิ (บาท)")],
      ledger.map((entry) => [entry.id, excelDate(entry.timestamp), entry.type, entry.note, Math.max(0, entry.amount), Math.max(0, -entry.amount), entry.amount]));
  }
  return workbook;
}
