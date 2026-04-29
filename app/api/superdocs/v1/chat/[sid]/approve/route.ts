import { NextRequest, NextResponse } from "next/server";
import { SUPERDOCS_BASE, superdocsKey } from "@/lib/superdocs-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sid: string }> },
) {
  try {
    const { sid } = await params;
    const body = await req.text();
    const upstream = await fetch(
      `${SUPERDOCS_BASE}/v1/chat/${encodeURIComponent(sid)}/approve`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${superdocsKey()}`,
          "Content-Type": "application/json",
        },
        body,
      },
    );
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Proxy failed" },
      { status: 500 },
    );
  }
}
