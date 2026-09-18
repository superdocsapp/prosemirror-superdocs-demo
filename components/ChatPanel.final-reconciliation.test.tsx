import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, cleanup, } from "@testing-library/react";
import type { RefObject } from "react";
import { ChatPanel } from "./ChatPanel";
import type { EditorHandle } from "./Editor";

class MockEventSource {
  static instances: MockEventSource[] = [];
  listeners: Record<string, ((e: { data: string }) => void)[]> = {};
  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }
  addEventListener(name: string, fn: (e: { data: string }) => void) {
    (this.listeners[name] ??= []).push(fn);
  }
  removeEventListener(name: string, fn: (e: { data: string }) => void) {
    this.listeners[name] = (this.listeners[name] ?? []).filter((f) => f !== fn);
  }
  close() {}

  // FINAL is single-JSON-parsed by the real code (unlike proposed_change /
  // proposed_change_batch, which are double-stringified). Mirror that here.
  emitFinal(data: unknown) {
    for (const fn of this.listeners["final"] ?? []) {
      fn({ data: JSON.stringify(data) });
    }
  }
}

// A tiny in-memory "document" of chunk_id -> html, backing a fake
// EditorHandle so we can assert on real reconciliation outcomes rather than
// just spy call counts.
function makeEditor(initialChunks: Record<string, string>) {
  const chunks: Record<string, string> = { ...initialChunks };
  const handle: EditorHandle = {
    getHtml: vi.fn(() => "<p>doc</p>"),
    setHtml: vi.fn(),
    replaceChunk: vi.fn((chunkId: string, html: string) => {
      if (!(chunkId in chunks)) return false;
      chunks[chunkId] = html;
      return true;
    }),
    getChunkHtml: vi.fn((chunkId: string) => chunks[chunkId] ?? null),
    getView: vi.fn(() => null),
  };
  return { handle, chunks };
}

function finalChange(
  n: number,
  status: "approved" | "denied",
  overrides: Partial<{
    old_html: string;
    new_html: string;
    operation: "edit" | "create" | "delete";
  }> = {},
) {
  return {
    status,
    chunk_id: `chunk-${n}`,
    change_id: `c${n}`,
    old_html: overrides.old_html ?? `<p>old${n}</p>`,
    new_html: overrides.new_html ?? `<p>new${n}</p>`,
    operation: overrides.operation ?? "edit",
  };
}

async function sendMessage() {
  const textarea = screen.getByPlaceholderText(/ask the ai to edit/i);
  fireEvent.change(textarea, { target: { value: "fix the doc" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
  await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0));
}

describe("ChatPanel — FINAL event reconciliation", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/chat/async")) {
          return { ok: true, json: async () => ({ job_id: "job-1" }) } as Response;
        }
        throw new Error("unexpected fetch: " + url);
      }),
    );
  });
  afterEach(() => {
  cleanup();
  });
  it("A: applies approved changes that weren't already applied", async () => {
    const { handle } = makeEditor({ "chunk-1": "<p>old1</p>" });
    const editorRef = { current: handle } as RefObject<EditorHandle | null>;
    render(<ChatPanel editorRef={editorRef} />);
    await sendMessage();

    const es = MockEventSource.instances[0];
    act(() =>
      es.emitFinal({
        result: {
          response: "Updated 1 of 1 sections.",
          document_changes: { changes: [finalChange(1, "approved")] },
        },
      }),
    );

    await waitFor(() => expect(handle.getChunkHtml("chunk-1")).toBe("<p>new1</p>"));
  });

  it("B: denied changes end up back at old_html even if optimistically applied", async () => {
    const { handle } = makeEditor({ "chunk-1": "<p>new1</p>" }); // already optimistically applied
    const editorRef = { current: handle } as RefObject<EditorHandle | null>;
    render(<ChatPanel editorRef={editorRef} />);
    await sendMessage();

    const es = MockEventSource.instances[0];
    act(() =>
      es.emitFinal({
        result: {
          response: "1 change denied.",
          document_changes: { changes: [finalChange(1, "denied")] },
        },
      }),
    );

    await waitFor(() => expect(handle.getChunkHtml("chunk-1")).toBe("<p>old1</p>"));
  });

  it("C: does not overwrite a concurrent user edit, and surfaces a conflict", async () => {
    const { handle } = makeEditor({ "chunk-1": "<p>user typed something else</p>" });
    const editorRef = { current: handle } as RefObject<EditorHandle | null>;
    render(<ChatPanel editorRef={editorRef} />);
    await sendMessage();

    const es = MockEventSource.instances[0];
    act(() =>
      es.emitFinal({
        result: {
          response: "Updated.",
          document_changes: { changes: [finalChange(1, "approved")] },
        },
      }),
    );

    expect(handle.getChunkHtml("chunk-1")).toBe("<p>user typed something else</p>");
    expect(await screen.findByText(/could not be reconciled/i)).toBeInTheDocument();
  });

  it("D: is a no-op (no double-apply) when the chunk is already at the approved value", async () => {
    const { handle } = makeEditor({ "chunk-1": "<p>new1</p>" });
    const editorRef = { current: handle } as RefObject<EditorHandle | null>;
    render(<ChatPanel editorRef={editorRef} />);
    await sendMessage();

    const es = MockEventSource.instances[0];
    const callsBefore = (handle.replaceChunk as ReturnType<typeof vi.fn>).mock.calls.length;
    act(() =>
      es.emitFinal({
        result: {
          response: "Updated.",
          document_changes: { changes: [finalChange(1, "approved")] },
        },
      }),
    );

    expect((handle.replaceChunk as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
    expect(handle.getChunkHtml("chunk-1")).toBe("<p>new1</p>");
  });

  it("E: mixed batch reaches the correct state per change", async () => {
    const { handle } = makeEditor({
      "chunk-1": "<p>old1</p>", // approved, not yet applied
      "chunk-2": "<p>new2</p>", // approved, already applied
      "chunk-3": "<p>new3</p>", // denied, optimistic value still showing — must revert
      "chunk-4": "<p>old4</p>", // approved, not yet applied
      "chunk-5": "<p>old5</p>", // denied, correctly untouched
    });
    const editorRef = { current: handle } as RefObject<EditorHandle | null>;
    render(<ChatPanel editorRef={editorRef} />);
    await sendMessage();

    const es = MockEventSource.instances[0];
    act(() =>
      es.emitFinal({
        result: {
          response: "Updated 3 of 5 sections.",
          document_changes: {
            changes: [
              finalChange(1, "approved"),
              finalChange(2, "approved"),
              finalChange(3, "denied"),
              finalChange(4, "approved"),
              finalChange(5, "denied"),
            ],
          },
        },
      }),
    );

    await waitFor(() => {
      expect(handle.getChunkHtml("chunk-1")).toBe("<p>new1</p>");
      expect(handle.getChunkHtml("chunk-2")).toBe("<p>new2</p>");
      expect(handle.getChunkHtml("chunk-3")).toBe("<p>old3</p>");
      expect(handle.getChunkHtml("chunk-4")).toBe("<p>new4</p>");
      expect(handle.getChunkHtml("chunk-5")).toBe("<p>old5</p>");
    });
    // No conflicts in this batch — no error banner.
    expect(screen.queryByText(/could not be reconciled/i)).not.toBeInTheDocument();
  });

  it("skips create/delete changes rather than guessing how to apply them", async () => {
    const { handle } = makeEditor({});
    const editorRef = { current: handle } as RefObject<EditorHandle | null>;
    render(<ChatPanel editorRef={editorRef} />);
    await sendMessage();

    const es = MockEventSource.instances[0];
    act(() =>
      es.emitFinal({
        result: {
          response: "Updated.",
          document_changes: {
            changes: [
              {
                status: "approved",
                chunk_id: null,
                change_id: "c1",
                old_html: null,
                new_html: "<p>brand new section</p>",
                operation: "create",
              },
            ],
          },
        },
      }),
    );

    // Doesn't crash, doesn't call replaceChunk for a chunk it can't find,
    // doesn't raise a false conflict.
    expect(handle.replaceChunk).not.toHaveBeenCalled();
    expect(screen.queryByText(/could not be reconciled/i)).not.toBeInTheDocument();
  });
});