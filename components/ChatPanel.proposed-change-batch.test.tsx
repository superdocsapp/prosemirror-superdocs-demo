
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  act,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import type { RefObject } from "react";
import { ChatPanel } from "./ChatPanel";
import type { EditorHandle } from "./Editor";

class MockEventSource {
  static instances: MockEventSource[] = [];
  listeners: Record<string, ((e: { data: string }) => void)[]> = {};

  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(
    name: string,
    fn: (e: { data: string }) => void,
  ) {
    (this.listeners[name] ??= []).push(fn);
  }

  removeEventListener(
    name: string,
    fn: (e: { data: string }) => void,
  ) {
    this.listeners[name] = (this.listeners[name] ?? []).filter(
      (f) => f !== fn,
    );
  }

  close() {}

  // Emits exactly the wire shape from docs/guides/streaming.mdx:
  // data: {"type": "proposed_change_batch", "content": "<json string>", "sequence": N}
  emitBatch(batch: unknown, sequence = 1) {
    const envelope = {
      type: "proposed_change_batch",
      content: JSON.stringify(batch),
      sequence,
    };

    for (const fn of this.listeners["proposed_change_batch"] ?? []) {
      fn({ data: JSON.stringify(envelope) });
    }
  }
}

describe(
  "proposed_change_batch — real payload shape from the docs",
  () => {
    afterEach(() => {
      cleanup();
      vi.restoreAllMocks();
    });

    beforeEach(() => {
      MockEventSource.instances = [];

      vi.stubGlobal("EventSource", MockEventSource);

      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url.includes("/chat/async")) {
            return {
              ok: true,
              json: async () => ({ job_id: "job-1" }),
            } as Response;
          }

          throw new Error("unexpected fetch: " + url);
        }),
      );
    });

    it(
      "renders review cards from a real single_approval batch " +
        "(documented single-change shape)",
      async () => {
        const editorHandle: EditorHandle = {
          getHtml: vi.fn(() => "<p>doc</p>"),
          setHtml: vi.fn(),
          replaceChunk: vi.fn(() => true),
          getChunkHtml: vi.fn(() => null),
          getView: vi.fn(() => null),
        };

        const editorRef = {
          current: editorHandle,
        } as RefObject<EditorHandle | null>;

        render(<ChatPanel editorRef={editorRef} />);

        const textarea = screen.getByPlaceholderText(
          /ask the ai to edit/i,
        );

        fireEvent.change(textarea, {
          target: { value: "fix grammar" },
        });

        fireEvent.click(
          screen.getByRole("button", { name: /send/i }),
        );

        await waitFor(() =>
          expect(
            MockEventSource.instances.length,
          ).toBeGreaterThan(0),
        );

        const es = MockEventSource.instances[0];

        act(() =>
          es.emitBatch({
            type: "single_approval",
            batch_id: "ch_1",
            batch_total: 1,
            changes: [
              {
                change_id: "c1",
                operation: "edit",
                chunk_id: "chunk-1",
                old_html: "<p>old</p>",
                new_html: "<p>new</p>",
                ai_explanation: "grammar fix",
                document_id: "doc-1",
                insert_after_chunk_id: null,
              },
            ],
          }),
        );

        expect(
          await screen.findByText("Approve"),
        ).toBeInTheDocument();
      },
    );

    it(
      "renders ALL cards from a real batch_approval with multiple " +
        "changes (the actual 'fix grammar throughout' shape)",
      async () => {
        const editorHandle: EditorHandle = {
          getHtml: vi.fn(() => "<p>doc</p>"),
          setHtml: vi.fn(),
          replaceChunk: vi.fn(() => true),
          getChunkHtml: vi.fn(() => null),
          getView: vi.fn(() => null),
        };

        const editorRef = {
          current: editorHandle,
        } as RefObject<EditorHandle | null>;

        render(<ChatPanel editorRef={editorRef} />);

        const textarea = screen.getByPlaceholderText(
          /ask the ai to edit/i,
        );

        fireEvent.change(textarea, {
          target: {
            value: "fix grammar throughout the document",
          },
        });

        fireEvent.click(
          screen.getByRole("button", { name: /send/i }),
        );

        await waitFor(() =>
          expect(
            MockEventSource.instances.length,
          ).toBeGreaterThan(0),
        );

        const es = MockEventSource.instances[0];

        const changes = Array.from(
          { length: 14 },
          (_, i) => ({
            change_id: `c${i}`,
            operation: "edit" as const,
            chunk_id: `chunk-${i}`,
            old_html: `<p>old ${i}</p>`,
            new_html: `<p>new ${i}</p>`,
            ai_explanation: "grammar fix",
            document_id: "doc-1",
            insert_after_chunk_id: null,
          }),
        );

        act(() =>
          es.emitBatch({
            type: "batch_approval",
            batch_id: "ch_1",
            batch_total: 14,
            changes,
          }),
        );

        // All 14 must be in pendingChanges — check via the
        // "Approve" buttons count. Each ReviewCard renders one,
        // so this proves the whole array made it through the
        // double-parse, not just the first item.
        await waitFor(() => {
          const approveButtons =
            screen.getAllByText("Approve");

          expect(approveButtons.length).toBe(14);
        });
      },
    );

    it(
      "the OLD standalone 'proposed_change' event still does " +
        "nothing harmful if it somehow fired " +
        "(forward-compat no-op check)",
      async () => {
        const editorHandle: EditorHandle = {
          getHtml: vi.fn(() => "<p>doc</p>"),
          setHtml: vi.fn(),
          replaceChunk: vi.fn(() => true),
          getChunkHtml: vi.fn(() => null),
          getView: vi.fn(() => null),
        };

        const editorRef = {
          current: editorHandle,
        } as RefObject<EditorHandle | null>;

        render(<ChatPanel editorRef={editorRef} />);

        const textarea = screen.getByPlaceholderText(
          /ask the ai to edit/i,
        );

        fireEvent.change(textarea, {
          target: { value: "fix grammar" },
        });

        fireEvent.click(
          screen.getByRole("button", { name: /send/i }),
        );

        await waitFor(() =>
          expect(
            MockEventSource.instances.length,
          ).toBeGreaterThan(0),
        );

        const es = MockEventSource.instances[0];

        act(() => {
          for (const fn of es.listeners["proposed_change"] ??
            []) {
            fn({
              data: JSON.stringify({
                content: JSON.stringify({
                  change_id: "legacy1",
                  operation: "edit",
                  chunk_id: "chunk-x",
                  old_html: "<p>a</p>",
                  new_html: "<p>b</p>",
                  ai_explanation: "x",
                  insert_after_chunk_id: null,
                }),
              }),
            });
          }
        });

        // Doesn't crash, and still works (both listeners are
        // legitimately registered).
        expect(
          await screen.findByText("Approve"),
        ).toBeInTheDocument();
      },
    );
  },
);
