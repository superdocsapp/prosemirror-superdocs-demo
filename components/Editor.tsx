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
  getView: () => EditorView | null;
};

function htmlToDoc(html: string) {
  const el = document.createElement("div");
  el.innerHTML = html;
  return DOMParser.fromSchema(schema).parse(el);
}

function docToHtml(state: EditorState): string {
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content);
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
      hit = { from: pos, to: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  return hit;
}

export const Editor = forwardRef<EditorHandle, { initialHtml: string }>(function Editor(
  { initialHtml },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    const doc = htmlToDoc(initialHtml);
    const state = EditorState.create({
      doc,
      plugins: [
        history(),
        keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
        keymap(baseKeymap),
        proposedChangeDecoration(),
      ],
    });
    const view = new EditorView(mountRef.current, { state });
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
        const v = viewRef.current;
        if (!v) return "";
        return docToHtml(v.state);
      },
      setHtml(html) {
        const v = viewRef.current;
        if (!v) return;
        const doc = htmlToDoc(html);
        const newState = EditorState.create({ doc, plugins: v.state.plugins });
        v.updateState(newState);
      },
      replaceChunk(chunkId, newHtml) {
        const v = viewRef.current;
        if (!v) return false;
        const target = findChunkRangeInDoc(v, chunkId);
        if (!target) return false;
        const parsed = htmlToDoc(newHtml);
        const tr = v.state.tr.replaceWith(target.from, target.to, parsed.content);
        v.dispatch(tr);
        return true;
      },
      getView() {
        return viewRef.current;
      },
    }),
    [],
  );

  return <div ref={mountRef} className="h-full overflow-y-auto bg-white" />;
});
