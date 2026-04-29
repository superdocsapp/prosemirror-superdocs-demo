import { NextRequest } from "next/server";
import { SUPERDOCS_BASE, superdocsKey } from "@/lib/superdocs-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const upstream = await fetch(`${SUPERDOCS_BASE}/v1/documents/export`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${superdocsKey()}`,
      "Content-Type": "application/json",
    },
    body,
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return new Response(detail || `upstream ${upstream.status}`, {
      status: upstream.status,
    });
  }

  const headers = new Headers();
  const ct = upstream.headers.get("content-type");
  if (ct) headers.set("Content-Type", ct);
  const cd = upstream.headers.get("content-disposition");
  if (cd) headers.set("Content-Disposition", cd);
  const cl = upstream.headers.get("content-length");
  if (cl) headers.set("Content-Length", cl);
  return new Response(upstream.body, { status: 200, headers });
}
