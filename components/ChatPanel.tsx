"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { EditorHandle } from "@/components/Editor";
import {
  addProposedChange,
  clearProposedChanges,
  removeProposedChange,
  type ProposedChange,
} from "@/lib/proposed-change-decoration";
import { ApprovalSlider, approvalModeValue, useApprovalMode } from "@/components/ApprovalSlider";
import { BatchBar, ReviewCard } from "@/components/ReviewCard";

// Fastest tier per https://docs.superdocs.app/guides/model-selection
// (Speed-critical workflows / Fastest). Swap if a faster tier ships.
const MODEL_TIER = "turbo";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "in_flight" | "complete";
};

type DiffActionEvent = CustomEvent<{ action: "accept" | "deny"; change_id: string }>;

export function ChatPanel({ editorRef }: { editorRef: RefObject<EditorHandle | null> }) {
  const [sessionId] = useState(
    () => `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const [reviewMode, setReviewMode] = useApprovalMode();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [stillProcessing, setStillProcessing] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<ProposedChange[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const listenersRef = useRef<Map<string, (e: Event) => void>>(new Map());
  const jobIdRef = useRef<string | null>(null);
  const inFlightIdRef = useRef<string | null>(null);
  const lastGoodHtmlRef = useRef<string>("");
  const stillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    });
  }, []);

  useEffect(scrollToBottom, [messages, pendingChanges, scrollToBottom]);

  const cleanupStream = useCallback(() => {
    const es = esRef.current;
    const map = listenersRef.current;
    if (es) {
      for (const [name, fn] of map) {
        es.removeEventListener(name, fn as EventListener);
      }
      es.close();
    }
    map.clear();
    esRef.current = null;
    if (stillTimerRef.current) {
      clearTimeout(stillTimerRef.current);
      stillTimerRef.current = null;
    }
    setStillProcessing(false);
  }, []);

  useEffect(() => () => cleanupStream(), [cleanupStream]);

  const finalizeInFlight = useCallback((content: string) => {
    const id = inFlightIdRef.current;
    if (!id) {
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", content, status: "complete" },
      ]);
      return;
    }
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content, status: "complete" } : m)),
    );
    inFlightIdRef.current = null;
  }, []);

  const updateInFlight = useCallback((content: string) => {
    const id = inFlightIdRef.current;
    if (!id) {
      const newId = `a-${Date.now()}`;
      inFlightIdRef.current = newId;
      setMessages((prev) => [
        ...prev,
        { id: newId, role: "assistant", content, status: "in_flight" },
      ]);
      return;
    }
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content, status: "in_flight" } : m)),
    );
  }, []);

  const pushError = useCallback(
    (msg: string) => {
      setError(msg);
      cleanupStream();
      setIsSending(false);
    },
    [cleanupStream],
  );

  const openStream = useCallback(
    (sid: string, jid: string) => {
      cleanupStream();
      const url = `/api/superdocs/v1/chat/${encodeURIComponent(sid)}/stream?job_id=${encodeURIComponent(jid)}`;
      const es = new EventSource(url);
      const map = listenersRef.current;

      const onDocSync = (e: Event) => {
        const me = e as MessageEvent;
        try {
          const data = JSON.parse(me.data);
          if (typeof data.content === "string" && data.content) {
            editorRef.current?.setHtml(data.content);
            lastGoodHtmlRef.current = data.content;
          }
        } catch {
          // ignore parse errors — the next event still delivers
        }
      };

      const onIntermediate = (e: Event) => {
        const me = e as MessageEvent;
        try {
          const data = JSON.parse(me.data);
          if (typeof data.content === "string") updateInFlight(data.content);
        } catch {}
      };

      const onProposed = (e: Event) => {
        const me = e as MessageEvent;
        try {
          const outer = JSON.parse(me.data);
          // Double-parse: content is a JSON-stringified string.
          const change = JSON.parse(outer.content) as ProposedChange;
          setPendingChanges((prev) =>
            prev.some((c) => c.change_id === change.change_id) ? prev : [...prev, change],
          );
          const view = editorRef.current?.getView();
          if (view) addProposedChange(view, change);
        } catch (err) {
          console.error("proposed_change parse failed", err);
        }
      };

      const onFinal = (e: Event) => {
        const me = e as MessageEvent;
        try {
          const data = JSON.parse(me.data);
          const response = data.result?.response ?? data.content ?? "";
          const updatedHtml = data.result?.document_changes?.updated_html;
          finalizeInFlight(response);
          if (typeof updatedHtml === "string" && updatedHtml) {
            editorRef.current?.setHtml(updatedHtml);
            lastGoodHtmlRef.current = updatedHtml;
          }
          setPendingChanges([]);
          const view = editorRef.current?.getView();
          if (view) clearProposedChanges(view);
        } catch (err) {
          console.error("final parse failed", err);
        }
        cleanupStream();
        setIsSending(false);
      };

      const onUsage = (e: Event) => {
        const me = e as MessageEvent;
        try {
          const data = JSON.parse(me.data);
          setUsage({ used: data.monthly_used ?? 0, limit: data.monthly_limit ?? 0 });
        } catch {}
      };

      const onError = (e: Event) => {
        const me = e as MessageEvent;
        let msg = "Stream error";
        if (me.data) {
          try {
            const data = JSON.parse(me.data);
            if (data.error) msg = data.error;
          } catch {}
        }
        pushError(msg);
      };

      map.set("document_sync", onDocSync);
      map.set("intermediate", onIntermediate);
      map.set("proposed_change", onProposed);
      map.set("final", onFinal);
      map.set("usage", onUsage);
      map.set("error", onError);

      for (const [name, fn] of map) {
        es.addEventListener(name, fn as EventListener);
      }
      esRef.current = es;

      stillTimerRef.current = setTimeout(() => setStillProcessing(true), 30_000);
    },
    [cleanupStream, editorRef, finalizeInFlight, pushError, updateInFlight],
  );

  const send = useCallback(async () => {
    if (isSending) return;
    const text = input.trim();
    if (!text) return;

    const html = editorRef.current?.getHtml() || lastGoodHtmlRef.current;
    if (!html) {
      pushError("Editor is empty — nothing to send.");
      return;
    }
    lastGoodHtmlRef.current = html;

    setError(null);
    setInput("");
    setIsSending(true);
    setPendingChanges([]);
    const view = editorRef.current?.getView();
    if (view) clearProposedChanges(view);

    const userId = `u-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: text, status: "complete" },
    ]);
    inFlightIdRef.current = null;

    try {
      const res = await fetch("/api/superdocs/v1/chat/async", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          session_id: sessionId,
          document_html: html,
          approval_mode: approvalModeValue(reviewMode),
          model_tier: MODEL_TIER,
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        pushError(`Chat request failed: ${detail}`);
        return;
      }
      const data = await res.json();
      const jobId: string | undefined = data.job_id;
      if (!jobId) {
        pushError("No job_id returned by the API.");
        return;
      }
      jobIdRef.current = jobId;
      openStream(sessionId, jobId);
    } catch (err) {
      pushError(err instanceof Error ? err.message : "Request failed");
    }
  }, [editorRef, input, isSending, openStream, pushError, reviewMode, sessionId]);

  const decide = useCallback(
    async (changeId: string, approved: boolean) => {
      const jid = jobIdRef.current;
      const change = pendingChanges.find((c) => c.change_id === changeId);

      // Optimistic UI: apply or remove locally before the server responds.
      if (approved && change && change.operation === "edit" && change.chunk_id && change.new_html) {
        editorRef.current?.replaceChunk(change.chunk_id, change.new_html);
      }
      const view = editorRef.current?.getView();
      if (view) removeProposedChange(view, changeId);
      setPendingChanges((prev) => prev.filter((c) => c.change_id !== changeId));

      if (!jid) return;
      try {
        await fetch(
          `/api/superdocs/v1/chat/${encodeURIComponent(sessionId)}/approve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              job_id: jid,
              approved,
              changes: [{ change_id: changeId, approved }],
            }),
          },
        );
      } catch (err) {
        console.error("approve POST failed", err);
      }
    },
    [editorRef, pendingChanges, sessionId],
  );

  const decideAll = useCallback(
    async (approved: boolean) => {
      const jid = jobIdRef.current;
      const snapshot = pendingChanges.slice();
      const view = editorRef.current?.getView();

      if (approved) {
        for (const c of snapshot) {
          if (c.operation === "edit" && c.chunk_id && c.new_html) {
            editorRef.current?.replaceChunk(c.chunk_id, c.new_html);
          }
        }
      }
      if (view) {
        for (const c of snapshot) removeProposedChange(view, c.change_id);
      }
      setPendingChanges([]);

      if (!jid || snapshot.length === 0) return;
      try {
        await fetch(
          `/api/superdocs/v1/chat/${encodeURIComponent(sessionId)}/approve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              job_id: jid,
              approved,
              changes: snapshot.map((c) => ({ change_id: c.change_id, approved })),
            }),
          },
        );
      } catch (err) {
        console.error("batch approve POST failed", err);
      }
    },
    [editorRef, pendingChanges, sessionId],
  );

  // Pattern 2 — inline overlay's Approve/Deny buttons dispatch a window
  // "diff-action" CustomEvent. Both Patterns feed the same decide() path.
  useEffect(() => {
    const onDiffAction = (e: Event) => {
      const detail = (e as DiffActionEvent).detail;
      if (!detail) return;
      void decide(detail.change_id, detail.action === "accept");
    };
    window.addEventListener("diff-action", onDiffAction as EventListener);
    return () => window.removeEventListener("diff-action", onDiffAction as EventListener);
  }, [decide]);

  const exportDocx = useCallback(async () => {
    const html = editorRef.current?.getHtml() || lastGoodHtmlRef.current;
    if (!html) {
      setError("Nothing to export.");
      return;
    }
    try {
      const res = await fetch("/api/superdocs/v1/documents/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html,
          format: "docx",
          filename: "incident-response-procedure",
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        setError(`Export failed: ${detail}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "incident-response-procedure.docx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  }, [editorRef]);

  const usageLabel = useMemo(() => {
    if (!usage || !usage.limit) return null;
    return `${usage.used}/${usage.limit} operations`;
  }, [usage]);

  return (
    <div className="flex h-full flex-col">
      <div
        ref={logRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3"
      >
        {messages.length === 0 && pendingChanges.length === 0 && (
          <div className="text-[13px] text-gray-500 leading-relaxed">
            Ask the AI to edit the document. Try:
            <ul className="mt-2 space-y-1 text-gray-600">
              <li>• &ldquo;Add a PCI-DSS notification clause to Section 4.&rdquo;</li>
              <li>• &ldquo;Tighten Section 3 to a one-line rule.&rdquo;</li>
              <li>• &ldquo;Fix grammar throughout the document.&rdquo;</li>
            </ul>
            <p className="mt-3 text-[12px] text-gray-500">
              Toggle <em>Review Mode</em> below for inline diffs.
            </p>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "ml-auto max-w-[85%] rounded-lg bg-blue-600 px-3 py-2 text-[13px] text-white"
                : "max-w-[92%] rounded-lg bg-white border border-gray-200 px-3 py-2 text-[13px] text-gray-900 shadow-sm"
            }
          >
            {m.role === "assistant" && m.status === "in_flight" && (
              <span className="mr-1 inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500 align-middle" />
            )}
            <span className="whitespace-pre-wrap">{m.content}</span>
          </div>
        ))}

        {stillProcessing && isSending && (
          <div className="text-[12px] italic text-gray-500">
            Still working — large operations can take a minute or two.
          </div>
        )}

        {pendingChanges.length > 0 && (
          <div className="mt-2">
            <BatchBar
              count={pendingChanges.length}
              onApproveAll={() => decideAll(true)}
              onDenyAll={() => decideAll(false)}
            />
            <div className="space-y-2">
              {pendingChanges.map((change) => (
                <ReviewCard
                  key={change.change_id}
                  change={change}
                  onApprove={(id) => decide(id, true)}
                  onDeny={(id) => decide(id, false)}
                />
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
            {error}
          </div>
        )}
      </div>

      <div className="flex-none border-t border-gray-200 bg-white px-4 py-3 space-y-2.5">
        <ApprovalSlider reviewMode={reviewMode} onChange={setReviewMode} />

        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Ask the AI to edit the document…"
            rows={2}
            className="flex-1 resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-[13px] leading-snug text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            disabled={isSending}
          />
          <button
            onClick={() => void send()}
            disabled={isSending || !input.trim()}
            className="rounded-md bg-blue-600 px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {isSending ? "Sending…" : "Send"}
          </button>
        </div>

        <div className="flex items-center justify-between">
          <button
            onClick={() => void exportDocx()}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
          >
            Export .docx
          </button>
          {usageLabel && (
            <span className="text-[11px] text-gray-400">{usageLabel}</span>
          )}
        </div>
      </div>
    </div>
  );
}
