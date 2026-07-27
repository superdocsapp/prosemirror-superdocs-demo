// Pattern 2 — inline editor overlay (Cursor-style).
// Copied verbatim from https://docs.superdocs.app/guides/human-in-the-loop
// #rendering-diffs-inline-in-your-editor. Collects proposed_change events,
// builds a DecorationSet keyed by data-chunk-id, dispatches window-level
// "diff-action" events when Approve/Deny is clicked.
//
// Requires the chunk_wrapper Node + per-block data-chunk-id attr in
// lib/schema.ts — without both, findChunkRange silently returns null.
import { Plugin, PluginKey, Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import type { Node as ProseMirrorNode } from "prosemirror-model";

export type ProposedChange = {
  change_id: string;
  operation: "edit" | "create" | "delete";
  chunk_id: string | null;
  old_html: string | null;
  new_html: string | null;
  ai_explanation: string;
  insert_after_chunk_id: string | null;
};

const META_ADD = "proposedChangeAdd";
const META_REMOVE = "proposedChangeRemove";
const META_CLEAR = "proposedChangeClear";

export const proposedChangeKey = new PluginKey("proposedChangeOverlay");

type State = {
  decorations: DecorationSet;
  pending: Map<string, ProposedChange>;
};

type ChunkRange = { from: number; to: number };

function findChunkRange(doc: ProseMirrorNode, chunkId: string): ChunkRange | null {
  let hit: ChunkRange | null = null;
  doc.descendants((node, pos) => {
    if (hit) return false;
    if (node.attrs?.["data-chunk-id"] === chunkId) {
      hit = { from: pos, to: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  return hit;
}

function stripHtml(html: string) {
  const withSpaces = html.replace(/<\/(p|div|li|h[1-6]|tr|td|th)>/gi, " ");
  const tmp = document.createElement("div");
  tmp.innerHTML = withSpaces;
  return (tmp.textContent ?? "").replace(/\s+/g, " ").trim();
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wordDiff(oldText: string, newText: string) {
  const A = oldText.split(/(\s+)/);
  const B = newText.split(/(\s+)/);
  const m = A.length, n = B.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = A[i - 1] === B[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const parts: { t: "same" | "del" | "add"; s: string }[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && A[i - 1] === B[j - 1]) { parts.unshift({ t: "same", s: A[i - 1] }); i--; j--; }
    else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) { parts.unshift({ t: "add", s: B[j - 1] }); j--; }
    else { parts.unshift({ t: "del", s: A[i - 1] }); i--; }
  }
  return parts.map((p) => {
    const e = escapeHtml(p.s);
    if (p.t === "del") return `<span class="diff-word-deleted">${e}</span>`;
    if (p.t === "add") return `<span class="diff-word-added">${e}</span>`;
    return e;
  }).join("");
}

function controls(change: ProposedChange): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "inline-diff-controls";
  wrap.contentEditable = "false";
  for (const action of ["accept", "deny"] as const) {
    const btn = document.createElement("button");
    btn.className = `inline-diff-btn inline-diff-btn--${action}`;
    btn.textContent = action === "accept" ? "\u2713" : "\u2717";
    btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      window.dispatchEvent(new CustomEvent("diff-action", {
        detail: { action, change_id: change.change_id },
      }));
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

function editWidget(pos: number, change: ProposedChange): Decoration {
  return Decoration.widget(pos, () => {
    const wrap = document.createElement("div");
    wrap.className = "diff-edit-wrapper";
    wrap.contentEditable = "false";
    wrap.setAttribute("data-diff-widget", "true");
    wrap.appendChild(controls(change));
    const preview = document.createElement("div");
    preview.className = "diff-preview-content";
    preview.innerHTML = wordDiff(stripHtml(change.old_html ?? ""), stripHtml(change.new_html ?? ""));
    wrap.appendChild(preview);
    return wrap;
  }, { side: -1, key: `diff-edit-${change.change_id}` });
}

function ghostCreateWidget(pos: number, change: ProposedChange): Decoration {
  return Decoration.widget(pos, () => {
    const ghost = document.createElement("div");
    ghost.className = "diff-ghost-create";
    ghost.contentEditable = "false";
    ghost.appendChild(controls(change));
    const body = document.createElement("div");
    body.className = "diff-ghost-content";
    body.innerHTML = change.new_html ?? "<p><em>New section</em></p>";
    ghost.appendChild(body);
    return ghost;
  }, { side: 1, key: `diff-ghost-${change.change_id}` });
}

function build(doc: ProseMirrorNode, pending: Map<string, ProposedChange>): DecorationSet {
  const out: Decoration[] = [];
  for (const change of pending.values()) {
    if (change.operation === "create") {
      if (!change.insert_after_chunk_id) continue;
      const after = findChunkRange(doc, change.insert_after_chunk_id);
      if (after) out.push(ghostCreateWidget(after.to, change));
      continue;
    }
    if (!change.chunk_id) continue;
    const range = findChunkRange(doc, change.chunk_id);
    if (!range) continue;
    if (change.operation === "edit") {
      const hasPreview = !!(change.old_html && change.new_html);
      out.push(Decoration.node(range.from, range.to, {
        class: hasPreview ? "diff-chunk-edit diff-chunk-has-preview" : "diff-chunk-edit",
      }));
      if (hasPreview) out.push(editWidget(range.from + 1, change));
    } else if (change.operation === "delete") {
      out.push(Decoration.node(range.from, range.to, { class: "diff-chunk-delete" }));
    }
  }
  return DecorationSet.create(doc, out);
}

export function proposedChangeDecoration(): Plugin<State> {
  return new Plugin<State>({
    key: proposedChangeKey,
    state: {
      init() { return { decorations: DecorationSet.empty, pending: new Map() }; },
      apply(tr: Transaction, value: State): State {
        let pending = value.pending;
        const add = tr.getMeta(META_ADD) as ProposedChange | undefined;
        const remove = tr.getMeta(META_REMOVE) as string | undefined;
        const clear = tr.getMeta(META_CLEAR) as boolean | undefined;
        if (clear) return { decorations: DecorationSet.empty, pending: new Map() };
        if (add) { pending = new Map(pending); pending.set(add.change_id, add); }
        if (remove) { pending = new Map(pending); pending.delete(remove); }
        if (add || remove) return { decorations: build(tr.doc, pending), pending };
        if (tr.docChanged) return { decorations: value.decorations.map(tr.mapping, tr.doc), pending };
        return value;
      },
    },
    props: { decorations(state) { return proposedChangeKey.getState(state)?.decorations ?? DecorationSet.empty; } },
  });
}

export const addProposedChange = (view: EditorView, change: ProposedChange) => {
  if (!view || !view.state) return;
  view.dispatch(view.state.tr.setMeta(META_ADD, change));
};

export const removeProposedChange = (view: EditorView, change_id: string) => {
  if (!view || !view.state) return;
  view.dispatch(view.state.tr.setMeta(META_REMOVE, change_id));
};

export const clearProposedChanges = (view: EditorView) => {
  if (!view || !view.state) return;
  view.dispatch(view.state.tr.setMeta(META_CLEAR, true));
};
