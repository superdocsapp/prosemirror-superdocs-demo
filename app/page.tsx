"use client";

import { useRef } from "react";
import { Editor, type EditorHandle } from "@/components/Editor";
import { ChatPanel } from "@/components/ChatPanel";
import { SAMPLE_DOC_HTML } from "@/lib/sample-doc";

export default function Page() {
  const editorRef = useRef<EditorHandle>(null);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white">
      <section
        className="flex flex-col min-w-0 border-r border-gray-200 bg-white"
        style={{ flex: 7 }}
      >
        <header className="flex-none border-b border-gray-200 bg-white px-6 py-3">
          <h1 className="text-[17px] font-semibold leading-tight text-gray-900">
            ProseMirror
          </h1>
          <p className="text-[12px] text-gray-500">open-source rich-text editor</p>
        </header>
        <div className="flex-1 min-h-0 overflow-hidden">
          <Editor ref={editorRef} initialHtml={SAMPLE_DOC_HTML} />
        </div>
      </section>

      <section className="flex flex-col min-w-0 bg-gray-50" style={{ flex: 3 }}>
        <header className="flex-none border-b border-gray-200 bg-white px-5 py-3">
          <h1 className="text-[17px] font-semibold leading-tight text-gray-900">
            SuperDocs Chat
          </h1>
          <p className="text-[12px] text-gray-500">AI editor — powered by SuperDocs</p>
        </header>
        <div className="flex-1 min-h-0 overflow-hidden">
          <ChatPanel editorRef={editorRef} />
        </div>
      </section>
    </div>
  );
}
