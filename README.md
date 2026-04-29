# ProseMirror × SuperDocs Demo

Two-pane AI document editor. Raw ProseMirror on the left, SuperDocs chat on the right. Surgical edits via inline diff overlay + side-by-side review cards.

## Setup

```bash
cp .env.example .env.local
# edit .env.local and set SUPERDOCS_API_KEY=sk_...

npm install
npm run dev
```

Open <http://localhost:3000>.

## Architecture

- **Browser** — ProseMirror editor (left, 70%) + SuperDocs chat panel (right, 30%).
- **Backend** — Next.js App Router API routes under `app/api/superdocs/*` proxy calls to `https://api.superdocs.app`. The `sk_` API key lives in `.env.local` and never reaches the browser. For SSE, `EventSource` cannot set custom headers, so the proxy injects `api_key` as a query parameter when forwarding to SuperDocs.
- **Per turn** — chat serialises editor HTML → `POST /v1/chat/async` → opens `EventSource` → receives `document_sync`, `intermediate`, `proposed_change`, `final`, `usage`, `error` events → renders inline diffs → user approves → `POST /v1/chat/{sid}/approve` → AI resumes on the open stream → `final` reconciles the editor.

## Review Mode vs. Auto Approve

The iOS-style slider above the chat input sets the approval mode, persisted to `localStorage` as `superdocs:reviewMode`.

- **Auto Approve** (default, thumb on left) — sends `approval_mode: "approve_all"`. Changes apply immediately on `final`.
- **Review Mode** (thumb on right) — sends `approval_mode: "ask_every_time"`. Every proposed change renders in **two places simultaneously**:
  - **Pattern 1** — side-by-side `ReviewCard` in the chat panel with Before (red) / After (green) + per-card Approve / Deny + a batch Approve-all / Deny-all bar when ≥2 changes are pending.
  - **Pattern 2** — inline editor overlay — red-strikethrough + green-highlight on the targeted chunk with floating Approve / Deny buttons.

Approving or denying in either UI hits the same `POST /v1/chat/{sid}/approve` endpoint with the same `change_id` and clears the change from both surfaces. Approvals optimistically apply `new_html` to the editor immediately — the `final` event arriving 3–6 s later reconciles.

## Demo prompts

The seeded document (`lib/sample-doc.ts`) is a 5-section Incident Response SOP with 16 intentional grammar errors distributed across all sections (manifest at the top of the file). Flip Review Mode **ON** before prompts 1–3.

1. **"Add a PCI-DSS notification clause to Section 4 — any card-data-involved incident must notify the acquiring bank within 72 hours."** — Section 4 grows one paragraph; other sections untouched.
2. **"Update the SEV1 escalation chain in Section 2 to include the Data Protection Officer between the Engineering Manager and the VP Engineering."** — Section 2's numbered list gains one item mid-list.
3. **"Tighten Section 3 — remove the second paragraph and replace with a one-line rule: 'Service restoration precedes root-cause analysis, always.'"** — Section 3 shrinks to one line.

Flip Review Mode **OFF** for the grammar sweep:

4. **"Fix grammar and spelling throughout the entire document — every section."** — parallel multi-section edit; every section lights up with red/green diff highlights as the seeded errors are corrected.

After all four turns, click **Export .docx** to download the final document.

## Key files

| File | What it does |
|---|---|
| `lib/schema.ts` | ProseMirror schema with per-block `data-chunk-id` preservation + `chunk_wrapper` Node for `<div data-chunk-id>` — both required or multi-element chunks silently lose their id. |
| `lib/proposed-change-decoration.ts` | Plugin that renders the Pattern 2 inline overlay. Dispatches `window`-level `diff-action` events when the inline Approve / Deny buttons are clicked. |
| `lib/diff-overlay.css` | Visual styling for the inline diff overlay — imported once from `app/globals.css`. |
| `lib/sample-doc.ts` | Seeded SOP document + grammar-error manifest. |
| `components/Editor.tsx` | ProseMirror view wrapper. Exposes `getHtml`, `setHtml`, `replaceChunk(chunkId, newHtml)` via `useImperativeHandle`. |
| `components/ChatPanel.tsx` | SSE lifecycle, six event handlers, approve/deny flow, optimistic apply, batch bar, Export `.docx` button, Still-processing indicator. |
| `components/ApprovalSlider.tsx` | iOS-style segmented slider with `role="switch"`, arrow-key / Space / Enter toggle, `localStorage` persist. |
| `components/ReviewCard.tsx` | Pattern 1 chat-side review card + batch Approve-all / Deny-all bar. |
| `app/api/superdocs/v1/chat/async/route.ts` | `POST` proxy for `/v1/chat/async`. |
| `app/api/superdocs/v1/chat/[sid]/stream/route.ts` | `GET` SSE proxy — injects `api_key` query param and pipes `text/event-stream` through unchanged. |
| `app/api/superdocs/v1/chat/[sid]/approve/route.ts` | `POST` proxy for per-change approve/deny. |
| `app/api/superdocs/v1/documents/export/route.ts` | `POST` proxy that streams the binary `.docx` response back to the browser. |

## Model tier

All `/v1/chat/async` requests send `model_tier: "turbo"` — the fastest tier per [Model Selection](https://docs.superdocs.app/guides/model-selection) ("Speed-critical workflows / Fastest"). Change the constant in `components/ChatPanel.tsx` if a faster tier ships.

## Coding-quality safeguards baked in

- `EventSource` lifecycle: handler refs stored in a `Map`; `removeEventListener` is called for each before `close()` (no stale-listener leak across turns).
- `document_html` non-empty validation with a `lastGoodHtmlRef` fallback — guards against React Strict Mode / Fast Refresh transients.
- `intermediate` SSE events render live as an in-flight chat bubble that updates in place, then promote to the final reply on `final`.
- Optimistic apply on Approve — `new_html` is applied to the targeted chunk via a surgical transaction; the `final.updated_html` that follows reconciles.
- A "still working" caption appears after 30 s of no `final` event so long operations on large documents don't look crashed.
- `proposed_change.content` is double-parsed (envelope, then the JSON-stringified `content` field) per the SSE guide.

## Content safety

Repo uses `sk_YOUR_API_KEY` as the placeholder in `.env.example`. The real key only lives in `.env.local`, which is `.gitignore`d. The chat UI refers to the model as "SuperDocs' AI" or "the AI" — never names a specific provider.
