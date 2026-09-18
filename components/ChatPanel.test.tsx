import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "./ChatPanel";
import type { EditorHandle } from "./Editor";

class MockEventSource {
  static instances: MockEventSource[] = [];
  listeners: Record<string, ((event: { data: string }) => void)[]> = {};
  closed = false;

  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(name: string, listener: (event: { data: string }) => void) {
    (this.listeners[name] ??= []).push(listener);
  }

  removeEventListener(name: string, listener: (event: { data: string }) => void) {
    this.listeners[name] = (this.listeners[name] ?? []).filter((item) => item !== listener);
  }

  close() {
    this.closed = true;
  }

  emit(name: string, data: unknown) {
    for (const listener of this.listeners[name] ?? []) listener({ data: JSON.stringify(data) });
  }
}

const change = {
  change_id: "c1",
  operation: "edit" as const,
  chunk_id: "chunk-1",
  old_html: "<p>OLD</p>",
  new_html: "<p>NEW</p>",
  ai_explanation: "test edit",
  insert_after_chunk_id: null,
};

const secondChange = {
  ...change,
  change_id: "c2",
  chunk_id: "chunk-2",
  old_html: "<p>OLD 2</p>",
  new_html: "<p>NEW 2</p>",
};

function setup(changes = [change, secondChange]) {
  const currentHtml = new Map(changes.map((item) => [item.chunk_id, item.old_html]));
  const editorHandle: EditorHandle = {
    getHtml: vi.fn(() => "<p>doc</p>"),
    getChunkHtml: vi.fn((chunkId: string) => currentHtml.get(chunkId) ?? null),
    setHtml: vi.fn(),
    replaceChunk: vi.fn((chunkId: string, html: string) => {
      if (!currentHtml.has(chunkId)) return false;
      currentHtml.set(chunkId, html);
      return true;
    }),
    getView: vi.fn(() => null),
  };
  const editorRef = { current: editorHandle } as RefObject<EditorHandle | null>;
  return {
    editorHandle,
    editorRef,
    setCurrentChunkHtml: (chunkId: string, html: string) => currentHtml.set(chunkId, html),
  };
}

async function sendMessage(text = "add a clause") {
  const textarea = screen.getByPlaceholderText(/ask the ai to edit/i);
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
  await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0));
}

function emitChanges(items: typeof change[]) {
  const eventSource = MockEventSource.instances[0];
  for (const item of items) {
    act(() => eventSource.emit("proposed_change", { content: JSON.stringify(item) }));
  }
}

describe("ChatPanel HITL approval reconciliation", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  beforeEach(() => {
    vi.unstubAllGlobals();
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  it("approve success applies the edit once without an error", async () => {
    const { editorHandle, editorRef } = setup([change]);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/chat/async")) return { ok: true, json: async () => ({ job_id: "job-1" }) };
      if (url.includes("/approve")) return { ok: true, status: 200, text: async () => "" };
      throw new Error(`unexpected fetch: ${url}`);
    }));

    render(<ChatPanel editorRef={editorRef} />);
    await sendMessage();
    emitChanges([change]);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(editorHandle.replaceChunk).toHaveBeenCalledTimes(1));
    expect(editorHandle.replaceChunk).toHaveBeenCalledWith("chunk-1", "<p>NEW</p>");
    expect(screen.queryByText(/rejected|couldn't reach/i)).not.toBeInTheDocument();
  });

  it.each([409, 422, 500])("approve HTTP %s applies then reverts and reports status", async (status) => {
    const { editorHandle, editorRef } = setup([change]);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/chat/async")) return { ok: true, json: async () => ({ job_id: "job-1" }) };
      if (url.includes("/approve")) return { ok: false, status, text: async () => "conflict" };
      throw new Error(`unexpected fetch: ${url}`);
    }));

    render(<ChatPanel editorRef={editorRef} />);
    await sendMessage();
    emitChanges([change]);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(editorHandle.replaceChunk).toHaveBeenNthCalledWith(2, "chunk-1", "<p>OLD</p>"));
    expect(await screen.findByText(new RegExp(`${status}.*reverted`, "i"))).toBeInTheDocument();
  });

  it("skips rollback when the user edits the chunk before rejection", async () => {
    const { editorHandle, editorRef, setCurrentChunkHtml } = setup([change]);
    let resolveApproval!: (response: Response) => void;
    const approval = new Promise<Response>((resolve) => { resolveApproval = resolve; });
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/chat/async")) return Promise.resolve({ ok: true, json: async () => ({ job_id: "job-1" }) });
      if (url.includes("/approve")) return approval;
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }));

    render(<ChatPanel editorRef={editorRef} />);
    await sendMessage();
    emitChanges([change]);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    setCurrentChunkHtml("chunk-1", "<p>USER EDIT</p>");
    resolveApproval({ ok: false, status: 409, text: async () => "conflict" } as Response);

    expect(await screen.findByText(/not reverted; please check the section manually/i)).toBeInTheDocument();
    expect(editorHandle.replaceChunk).toHaveBeenCalledTimes(1);
  });

  it("decideAll success applies each edit once without an error", async () => {
    const { editorHandle, editorRef } = setup();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/chat/async")) return { ok: true, json: async () => ({ job_id: "job-1" }) };
      if (url.includes("/approve")) return { ok: true, status: 200, text: async () => "" };
      throw new Error(`unexpected fetch: ${url}`);
    }));

    render(<ChatPanel editorRef={editorRef} />);
    await sendMessage();
    emitChanges([change, secondChange]);
    fireEvent.click(await screen.findByRole("button", { name: "Approve all" }));

    await waitFor(() => expect(editorHandle.replaceChunk).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/rejected|couldn't reach/i)).not.toBeInTheDocument();
  });

  it("decideAll rejection reverts all applied edits", async () => {
    const { editorHandle, editorRef } = setup();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/chat/async")) return { ok: true, json: async () => ({ job_id: "job-1" }) };
      if (url.includes("/approve")) return { ok: false, status: 422, text: async () => "conflict" };
      throw new Error(`unexpected fetch: ${url}`);
    }));

    render(<ChatPanel editorRef={editorRef} />);
    await sendMessage();
    emitChanges([change, secondChange]);
    fireEvent.click(await screen.findByRole("button", { name: "Approve all" }));

    await waitFor(() => expect(editorHandle.replaceChunk).toHaveBeenCalledTimes(4));
    expect(await screen.findByText(/422.*changes were reverted/i)).toBeInTheDocument();
  });

  it("decideAll reports skipped sections when a concurrent edit blocks rollback", async () => {
    const { editorHandle, editorRef, setCurrentChunkHtml } = setup();
    let resolveApproval!: (response: Response) => void;
    const approval = new Promise<Response>((resolve) => { resolveApproval = resolve; });
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/chat/async")) return Promise.resolve({ ok: true, json: async () => ({ job_id: "job-1" }) });
      if (url.includes("/approve")) return approval;
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }));

    render(<ChatPanel editorRef={editorRef} />);
    await sendMessage();
    emitChanges([change, secondChange]);
    fireEvent.click(await screen.findByRole("button", { name: "Approve all" }));
    setCurrentChunkHtml("chunk-1", "<p>USER EDIT</p>");
    resolveApproval({ ok: false, status: 500, text: async () => "conflict" } as Response);

    expect(await screen.findByText(/500.*1 section\(s\) were not reverted/i)).toBeInTheDocument();
    expect(editorHandle.replaceChunk).toHaveBeenCalledTimes(3);
  });

  it("blocks sending after an error SSE while a review remains pending", async () => {
    const { editorRef } = setup([change]);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/chat/async")) return { ok: true, json: async () => ({ job_id: "job-1" }) };
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ChatPanel editorRef={editorRef} />);
    await sendMessage();
    const eventSource = MockEventSource.instances[0];
    emitChanges([change]);
    expect(await screen.findByText("Approve")).toBeInTheDocument();
    act(() => eventSource.emit("error", { error: "job failed" }));
    await waitFor(() => expect(screen.getByPlaceholderText(/ask the ai to edit/i)).not.toBeDisabled());

    const callsBefore = fetchMock.mock.calls.length;
    const textarea = screen.getByPlaceholderText(/ask the ai to edit/i);
    fireEvent.change(textarea, { target: { value: "second message" } });
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(fetchMock).toHaveBeenCalledTimes(callsBefore);
    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(await screen.findByText(/approve or deny the pending changes/i)).toBeInTheDocument();
  });
});
