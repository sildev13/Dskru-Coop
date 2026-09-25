import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { GET } from "../src/app/api/admin/export/route";
import { tokenId } from "../src/lib/auth";
import { createExportWorkbook, parseExportOptions } from "../src/lib/excel-export";
import type { Purchase, Role, State } from "../src/lib/types";

test("Excel downloads preserve report data and enforce staff permissions", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dskru-export-test-"));
  process.env.SYSTEM_CONFIG_PATH = path.join(directory, "server-config.json");
  process.env.DATA_BACKEND = "demo";
  process.env.DEMO_DATA_PATH = path.join(directory, "demo.json");
  const roles: Role[] = ["admin", "cashier", "stock"];
  const tokens = { admin: "a".repeat(64), cashier: "b".repeat(64), stock: "c".repeat(64) };
  const now = Date.now();
  const order = (id: string, overrides: Partial<Purchase> = {}): Purchase => ({
    id, timestamp: "2026-09-25T01:00:00Z", accessToken: "DO_NOT_EXPORT_RECEIPT_TOKEN",
    requestId: "DO_NOT_EXPORT_REQUEST_ID", studentId: "00102", paymentMethod: "promptpay",
    status: "completed", items: [{ id: "water", name: "=1+1", price: 10.1, qty: 3 }], total: 30.3,
    ...overrides,
  });
  const state: State = {
    items: [
      { id: "water", name: "น้ำ ม.1/2", subtitle: "ทดสอบภาษาไทย", barcode: "0000123456789", category: "drinks", price: 10.1, stock: 20, reorderLevel: 5, active: true, image: "" },
      { id: "archived", name: "+สินค้าปิดขาย", subtitle: "", barcode: "0000002", category: "supplies", price: 0.1, stock: 1, reorderLevel: 2, active: false, image: "" },
    ],
    transactions: [
      order("paid", { timestamp: "2026-09-24T16:00:00Z", completedAt: "2026-09-24T17:00:00Z" }),
      order("next-day", { completedAt: "2026-09-25T17:00:00Z", total: 50 }),
      order("legacy", { timestamp: "2026-09-25T16:59:59.999Z", paymentMethod: "cash", total: 0.2, items: [{ id: "archived", name: "สินค้าเดิม", price: 0.1, qty: 2 }] }),
      order("pending", { status: "pending", total: 800, gateway: { provider: "omise", mode: "live", status: "pending", reference: "DO_NOT_EXPORT_GATEWAY_REFERENCE", chargeId: "DO_NOT_EXPORT_CHARGE", expiresAt: "2026-09-24T00:00:00Z", checkAfter: 0 } }),
      order("cancelled", { status: "cancelled", total: 700 }),
    ],
    budget: [
      { id: "income", timestamp: "2026-09-24T17:00:00Z", amount: 12.5, note: "เงินสนับสนุน" },
      { id: "expense", timestamp: "2026-09-25T16:59:59.999Z", amount: -2.25, note: '=HYPERLINK("https://example.test","click")' },
      { id: "later", timestamp: "2026-09-25T17:00:00Z", amount: 500, note: "วันถัดไป" },
    ],
    settings: { cooperativeBalance: 999.99, dailyTarget: 500, storeOpen: true, promptpay: { enabled: false, recipientId: "DO_NOT_EXPORT_BANK", recipientName: "School", revision: 1 } },
    users: roles.map((role) => ({ id: role, username: role, displayName: role, role, active: true, passwordHash: "DO_NOT_EXPORT_PASSWORD", createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() })),
    sessions: roles.map((role) => ({ id: tokenId(tokens[role]), userId: role, createdAt: now, expiresAt: now + 60_000 })),
    attempts: { "DO_NOT_EXPORT_SECURITY": { count: 1, reset: now + 60_000 } },
  };
  await writeFile(process.env.DEMO_DATA_PATH, JSON.stringify(state));
  async function request(query = "", role?: Role, cookie?: string) {
    return GET(new NextRequest(`http://localhost:3000/api/admin/export?${query}`, {
      headers: role || cookie ? { cookie: cookie || `dskru_session=${tokens[role!]}` } : {},
    }));
  }
  async function workbook(response: Response) {
    assert.equal(response.status, 200);
    const result = new ExcelJS.Workbook();
    await result.xlsx.load(await response.arrayBuffer());
    return result;
  }
  function summaryValue(book: ExcelJS.Workbook, label: string) {
    let value: ExcelJS.CellValue;
    book.getWorksheet("สรุป")!.eachRow((row) => { if (row.getCell(1).value === label) value = row.getCell(2).value; });
    return value;
  }
  try {
    await t.test("requires an active session and restricts export types on the server", async () => {
      assert.equal((await request()).status, 401);
      assert.equal((await request("kind=sales", undefined, "dskru_session=invalid")).status, 401);
      for (const [role, kinds] of [["cashier", ["inventory", "budget"]], ["stock", ["sales", "budget"]]] as const) {
        for (const kind of kinds) assert.equal((await request(`kind=${kind}`, role)).status, 403);
      }
      const cashier = await workbook(await request("kind=all", "cashier"));
      assert.deepEqual(cashier.worksheets.map((sheet) => sheet.name), ["สรุป", "รายการขาย", "รายละเอียดการขาย"]);
      assert.equal(summaryValue(cashier, "ยอดคงเหลือปัจจุบัน (บาท)"), undefined);
      const stock = await workbook(await request("kind=all", "stock"));
      assert.deepEqual(stock.worksheets.map((sheet) => sheet.name), ["สรุป", "สินค้า"]);
      assert.equal(summaryValue(stock, "ยอดขายชำระแล้ว (บาท)"), undefined);
    });
    await t.test("validates real calendar dates and reversed or ambiguous ranges", async () => {
      for (const query of ["kind=users", "from=2026-02-30", "to=2026-9-25", "from=2026-09-26&to=2026-09-25", "kind=all&kind=sales", "from=2026-09-25&from=2026-09-24"]) {
        assert.equal((await request(query, "admin")).status, 400, query);
      }
      assert.equal(parseExportOptions(new URLSearchParams("from=2024-02-29")).from, "2024-02-29");
    });
    await t.test("creates a typed, Thai, filtered workbook without secrets or database writes", async () => {
      const before = await readFile(process.env.DEMO_DATA_PATH!, "utf8");
      const response = await request("kind=all&from=2026-09-25&to=2026-09-25", "admin");
      assert.match(response.headers.get("content-type")!, /spreadsheetml.sheet/);
      assert.match(response.headers.get("content-disposition")!, /^attachment; filename="dskru-all-\d{14}\.xlsx"$/);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("vary"), "Cookie");
      const book = await workbook(response);
      assert.deepEqual(book.worksheets.map((sheet) => sheet.name), ["สรุป", "สินค้า", "รายการขาย", "รายละเอียดการขาย", "บัญชีสหกรณ์"]);
      assert.equal(summaryValue(book, "ยอดขายชำระแล้ว (บาท)"), 30.5);
      assert.equal(summaryValue(book, "จำนวนรายการชำระแล้ว"), 2);
      assert.equal(summaryValue(book, "รายรับอื่นในช่วงวันที่ (บาท)"), 12.5);
      assert.equal(summaryValue(book, "รายจ่ายอื่นในช่วงวันที่ (บาท)"), 2.25);
      assert.equal(summaryValue(book, "ยอดคงเหลือปัจจุบัน (บาท)"), 999.99);
      const sales = book.getWorksheet("รายการขาย")!;
      assert.equal(sales.rowCount, 5);
      const paid = sales.findRow(2)!;
      assert.equal(paid.getCell(1).value, "paid");
      assert.equal((paid.getCell(2).value as Date).toISOString(), "2026-09-25T00:00:00.000Z");
      assert.equal(paid.getCell(5).value, "00102");
      assert.equal(paid.getCell(5).type, ExcelJS.ValueType.String);
      assert.equal(paid.getCell(9).value, 30.3);
      assert.equal(paid.getCell(9).type, ExcelJS.ValueType.Number);
      assert.equal(sales.getCell("F5").value, "เงินสด (เดิม)");
      const inventory = book.getWorksheet("สินค้า")!;
      assert.equal(inventory.rowCount, 3);
      let water: ExcelJS.Row | undefined;
      inventory.eachRow((row) => { if (row.getCell(1).value === "water") water = row; });
      assert.equal(water!.getCell(2).value, "น้ำ ม.1/2");
      assert.equal(water!.getCell(5).value, "0000123456789");
      assert.equal(water!.getCell(8).value, 3);
      assert.equal(water!.getCell(9).value, 17);
      const lines = book.getWorksheet("รายละเอียดการขาย")!;
      assert.equal(lines.getCell("E2").value, "=1+1");
      assert.equal(lines.getCell("E2").type, ExcelJS.ValueType.String);
      assert.equal(lines.getCell("H2").value, 30.3);
      const ledger = book.getWorksheet("บัญชีสหกรณ์")!;
      assert.equal(ledger.rowCount, 5);
      const allCells: unknown[] = [];
      for (const sheet of book.worksheets) {
        assert.equal(sheet.views[0].state, "frozen");
        sheet.eachRow((row) => row.eachCell((cell) => {
          assert.notEqual(cell.type, ExcelJS.ValueType.Formula);
          assert.notEqual(cell.type, ExcelJS.ValueType.Hyperlink);
          allCells.push(cell.value);
        }));
      }
      assert.doesNotMatch(JSON.stringify(allCells), /DO_NOT_EXPORT|next-day|วันถัดไป/);
      assert.equal(await readFile(process.env.DEMO_DATA_PATH!, "utf8"), before);
    });
    await t.test("empty periods keep useful headers and current inventory; one-sided ranges work", async () => {
      const empty = await workbook(await request("kind=sales&from=2030-01-01", "admin"));
      assert.equal(empty.getWorksheet("รายการขาย")!.rowCount, 1);
      assert.equal(summaryValue(empty, "ยอดขายชำระแล้ว (บาท)"), 0);
      assert.equal(summaryValue(empty, "ผลการส่งออก"), "ไม่พบข้อมูลตามเงื่อนไขที่เลือก");
      const inventory = await workbook(await request("kind=inventory&from=2030-01-01", "stock"));
      assert.equal(inventory.getWorksheet("สินค้า")!.rowCount, 3);
      const earlier = await workbook(await request("kind=sales&to=2026-09-24", "cashier"));
      assert.equal(earlier.getWorksheet("รายการขาย")!.rowCount, 1);
      const budget = await workbook(await request("kind=budget", "admin"));
      assert.deepEqual(budget.worksheets.map((sheet) => sheet.name), ["สรุป", "บัญชีสหกรณ์"]);
    });
    await t.test("oversized reports fail explicitly instead of silently truncating", () => {
      assert.throws(() => createExportWorkbook({ ...state, items: Array(50_001).fill(state.items[0]) }, "admin", { kind: "inventory" }, { demo: true }), /50,000/);
    });
    await t.test("revoked or disabled accounts cannot reuse an old export cookie", async () => {
      state.users.find((user) => user.role === "stock")!.active = false;
      state.sessions = state.sessions.filter((session) => session.userId !== "cashier");
      await writeFile(process.env.DEMO_DATA_PATH!, JSON.stringify(state));
      assert.equal((await request("kind=inventory", "stock")).status, 401);
      assert.equal((await request("kind=sales", "cashier")).status, 401);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
