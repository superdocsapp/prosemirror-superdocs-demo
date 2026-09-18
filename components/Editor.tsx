"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { DOMParser, DOMSerializer } from "prosemirror-model";
import { history, undo, redo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { schema } from "@/lib/schema";
import { proposedChangeDecoration } from "@/lib/proposed-change-decoration";

export type EditorHandle = {
  getHtml: () => string;
  setHtml: (html: string) => void;
  replaceChunk: (chunkId: string, newHtml: string) => boolean;
  getChunkHtml: (chunkId: string) => string | null;
  getView: () => EditorView | null;
};

// Create fresh plugin instances for every EditorState.
// Reusing the old decoration plugin across a new document
// can leave stale DecorationSet state attached to that document.
function createPlugins() {
  return [
    history(),
    keymap({
      "Mod-z": undo,
      "Mod-y": redo,
      "Mod-Shift-z": redo,
    }),
    keymap(baseKeymap),
    proposedChangeDecoration(),
  ];
}

function htmlToDoc(html: string) {
  const el = document.createElement("div");
  el.innerHTML = html;

  try {
    return DOMParser.fromSchema(schema).parse(el);
  } catch (err) {
    console.error("htmlToDoc parse failed:", err);


    // Return an empty document as a fallback.
    return DOMParser.fromSchema(schema).parse(
      document.createElement("div"),
    );
  }
}

function docToHtml(state: EditorState): string {
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(
    state.doc.content,
  );

  const container = document.createElement("div");
  container.appendChild(fragment);

  return container.innerHTML;
}

function findChunkRangeInDoc(
  view: EditorView,
  chunkId: string,
): { from: number; to: number } | null {
  let hit: { from: number; to: number } | null = null;

  view.state.doc.descendants((node, pos) => {
    if (hit) return false;

    if (node.attrs?.["data-chunk-id"] === chunkId) {
      hit = {
        from: pos,
        to: pos + node.nodeSize,
      };
      return false;
    }

    return true;
  });

  return hit;
}

function chunkToHtml(
  view: EditorView,
  chunkId: string,
): string | null {
  const target = findChunkRangeInDoc(view, chunkId);

  if (!target) return null;

  const node = view.state.doc.nodeAt(target.from);

  if (!node) return null;

  const container = document.createElement("div");

  container.appendChild(
    DOMSerializer.fromSchema(schema).serializeNode(node),
  );

  return container.innerHTML;
}

export const Editor = forwardRef<
  EditorHandle,
  { initialHtml: string }
>(function Editor({ initialHtml }, ref) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const getCurrentView = () => viewRef.current;

  useEffect(() => {
    if (!mountRef.current) return;

    const doc = htmlToDoc(initialHtml);

    const state = EditorState.create({
      doc,
      plugins: createPlugins(),
    });

    const view = new EditorView(mountRef.current, {
      state,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [initialHtml]);

  useImperativeHandle(
    ref,
    () => ({
      getHtml() {
        const v = getCurrentView();

        if (!v) return "";

        return docToHtml(v.state);
      },

      setHtml(html) {
        const currentView = getCurrentView();

        // IMPORTANT:
        // Get the actual mount element from the current EditorView
        // before destroying it. This is the lifecycle behavior from
        // the already-tested PR1 fix.
        if (!currentView?.dom.parentElement) return;

        const mount = currentView.dom.parentElement;

        currentView.destroy();

        const doc = htmlToDoc(html);

        const newState = EditorState.create({
          doc,
          plugins: createPlugins(),
        });

        const newView = new EditorView(mount, {
          state: newState,
        });

        viewRef.current = newView;
      },

      replaceChunk(chunkId, newHtml) {
        const v = getCurrentView();

        if (!v || v.isDestroyed) return false;

        const target = findChunkRangeInDoc(v, chunkId);

        if (!target) return false;

        const parsed = htmlToDoc(newHtml);

        const tr = v.state.tr.replaceWith(
          target.from,
          target.to,
          parsed.content,
        );

        v.dispatch(tr);

        return true;
      },

      getChunkHtml(chunkId) {
        const v = getCurrentView();

        if (!v || v.isDestroyed) return null;

        return chunkToHtml(v, chunkId);
      },

      getView() {
        return getCurrentView();
      },
    }),
    [],
  );

  return (
    <div
      ref={mountRef}
      className="h-full overflow-y-auto bg-white"
    />
  );
});