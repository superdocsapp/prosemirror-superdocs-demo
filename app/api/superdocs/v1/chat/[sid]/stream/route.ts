import { NextRequest } from "next/server";
import { SUPERDOCS_BASE, superdocsKey } from "@/lib/superdocs-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sid: string }> },
) {
  const { sid } = await params;
  const url = new URL(req.url);
  const jobId = url.searchParams.get("job_id") ?? "";
  if (!jobId) {
    return new Response("missing job_id", { status: 400 });
  }

  const upstreamUrl =
    `${SUPERDOCS_BASE}/v1/chat/${encodeURIComponent(sid)}/stream` +
    `?job_id=${encodeURIComponent(jobId)}` +
    `&api_key=${encodeURIComponent(superdocsKey())}`;

  const upstream = await fetch(upstreamUrl, {
    headers: { Accept: "text/event-stream" },
    signal: req.signal,
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return new Response(detail || `upstream ${upstream.status}`, {
      status: upstream.status,
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
