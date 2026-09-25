import { NextRequest, NextResponse } from "next/server";
import { currentUser, requireUser, sessionId } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { createExportWorkbook, parseExportOptions } from "@/lib/excel-export";
import { isDemo, readState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };

export async function GET(request: NextRequest) {
  try {
    await requireUser(request);
    const options = parseExportOptions(request.nextUrl.searchParams);
    const state = await readState();
    const user = currentUser(state, sessionId(request));
    if (!user) throw new AppError("กรุณาเข้าสู่ระบบเจ้าหน้าที่", 401);
    const now = new Date();
    const workbook = createExportWorkbook(state, user.role, options, { demo: isDemo(), now });
    const buffer = await workbook.xlsx.writeBuffer();
    const stamp = new Date(now.getTime() + 7 * 60 * 60_000).toISOString().slice(0, 19).replace(/[-:T]/g, "");
    return new Response(new Uint8Array(buffer), {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="dskru-${options.kind}-${stamp}.xlsx"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof AppError ? error.message : "ส่งออก Excel ไม่สำเร็จ กรุณาลองอีกครั้ง" },
      { status: error instanceof AppError ? error.status : 500, headers: privateHeaders },
    );
  }
}
