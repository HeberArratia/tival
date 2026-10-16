import { NextRequest, NextResponse } from "next/server";
import { searchDirectory } from "@/lib/search";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get("q") ?? "";
    const limitRaw = request.nextUrl.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const results = await searchDirectory(q, {
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return NextResponse.json({ ok: true, q, results });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "error" },
      { status: 500 }
    );
  }
}
