# CLAUDE.md — ProseMirror × SuperDocs demo

**Read this first.** Everything below is authoritative for what we're building. The _how to implement_ is in the public SuperDocs docs — this file tells you where to look.

## Our product

We're building a ProseMirror + Next.js document editor with AI editing via SuperDocs. The app has an editor on the left and a chat panel on the right. Users type a natural-language instruction; the AI proposes a surgical edit to a specific section; the user reviews an inline red/green diff inside the editor and approves or denies it.

## Architecture

- **Browser:** ProseMirror editor (left), chat panel (right). Both in a single Next.js page.
- **Backend:** Next.js API routes act as a thin proxy to `https://api.superdocs.app`. The `sk_` API key lives in `.env.local` and never touches the browser.
- **Communication:** Browser → Next.js proxy → SuperDocs API. SSE stream from SuperDocs flows back through the proxy to the browser as a text/event-stream.
- **Data flow per turn:** chat reads HTML from editor → POSTs to `/api/superdocs/v1/chat/async` → opens EventSource → receives `proposed_change` events → renders inline diff in editor → user approves → `POST /api/superdocs/v1/chat/{sid}/approve` → AI resumes on the open stream → `final` event applies updated HTML to editor.

## Two-pane layout — widths and titles

### Pane widths (NOT 50/50)

The two-pane layout uses a **70 / 30 split**, NOT 50 / 50:

- **Left pane (ProseMirror editor): 70 % of viewport width.** The document is the star of the demo — the on-camera viewer needs to see paragraphs, lists, and the inline diff overlay clearly without text wrapping prematurely.
- **Right pane (SuperDocs Chat): 30 % of viewport width.** Wide enough for chat bubbles, the iOS-style approval-mode slider, the input field, and the Export `.docx` button — but no wider. A 50 / 50 split forces the editor's text into a narrow column and makes the chat pane feel oversized for the few short messages it actually displays.

Implementation notes:

- Use a CSS Flexbox container with `flex: 7` on the editor pane and `flex: 3` on the chat pane, OR a Grid container with `grid-template-columns: 7fr 3fr`. Either works — pick whichever fits the rest of the layout cleanly.
- Add a thin 1px vertical divider between the two panes (e.g. `border-right: 1px solid #e5e7eb` on the editor, or a `<div role="separator">`).
- Both panes fill the full viewport height (`h-screen` or `100dvh`) — no wasted space at top or bottom.
- The 70 / 30 ratio is fixed for the demo recording. Do NOT add a draggable splitter or responsive breakpoint that re-sizes the panes — those add motion / layout shift that distracts on camera.
- Below the desktop breakpoint (e.g. tablet portrait), it's fine to stack the panes vertically — but the demo runs at desktop (1920×1080 or larger), so the 70 / 30 horizontal layout is what gets recorded.

### Pane titles (visible labels on screen — required for the demo)

Each pane carries a small but clearly visible **title bar** at the top so the on-camera viewer immediately understands what they're looking at. These titles are the visual proof of the integration story — left side is the open-source editor (ProseMirror), right side is the AI integration (SuperDocs).

- **Left pane (editor) title:** **`ProseMirror`** — small heading rendered above the editor canvas. Optional dimmed sub-line: *"open-source rich-text editor"*.
- **Right pane (chat) title:** **`SuperDocs Chat`** — small heading rendered above the chat input. Optional dimmed sub-line: *"AI editor — powered by SuperDocs"*.

Visual spec for both titles:

- Sized to be **legible on a 1080p recording** — heading 16–18px, optional sub-line 12–13px muted gray.
- Positioned in a **dedicated header row** at the top of each pane, with a thin bottom border separating header from content.
- Aligned consistently (both left-aligned within their pane, both same vertical height, both same font weight) so the two panes feel like sibling headers, not afterthoughts.
- Stay fixed when the pane scrolls — they're sticky pane headers, not in-document text.

These titles must NOT be commented out, hidden behind a settings toggle, or tucked into a tooltip. They are first-class UI on every page load. If you scaffold a layout without them, redo the layout — the demo recording depends on these labels being on screen the entire time.

## Stack

- Next.js 16+ with the App Router and TypeScript.
- Tailwind CSS (Tailwind v4 is the default in Next.js 16 — use the `@plugin` directive in `app/globals.css` if you need the typography plugin; there is no `tailwind.config.ts` in the default v4 scaffold).
- Raw **ProseMirror** — vanilla packages only (`prosemirror-state prosemirror-view prosemirror-model prosemirror-schema-basic prosemirror-schema-list prosemirror-history prosemirror-keymap prosemirror-commands`). Not TipTap, not BlockNote, not any wrapper.
- Native `fetch`. No SDKs.
- Plain React state (`useState`, `useRef`, `useEffect`). No state library.

## Conventions

- **API key in `.env.local` only — never in browser.** Proxy SuperDocs calls through `/api/superdocs/*` Next.js API routes. For SSE auth, follow the EventSource pattern at https://docs.superdocs.app/guides/streaming (the key moves from env into the `api_key` query parameter because `EventSource` can't set custom headers).
- **For ProseMirror chunk-id preservation**, follow https://docs.superdocs.app/guides/editor-integration → ProseMirror tab. Copy the schema snippet verbatim into `lib/schema.ts`. The schema must include **both** the per-block `data-chunk-id` attribute *and* the `chunk_wrapper` Node spec for `<div data-chunk-id="…">` elements — both are in the guide. Without the wrapper Node, multi-element chunks lose their chunk-id during parsing and the inline overlay (Pattern 2) silently renders nothing.
- **For HITL diff rendering, implement BOTH Pattern 1 AND Pattern 2** — see https://docs.superdocs.app/guides/human-in-the-loop#rendering-diffs-inline-in-your-editor. They are independent first-class options, both visible at the same time. Use `approval_mode: "ask_every_time"`.
  - **Pattern 1 — chat-side `ReviewCard`** (one per pending change in `components/ReviewCard.tsx`): show `ai_explanation`, `old_html` ("Before", red background), `new_html` ("After", green background), per-card Approve / Deny buttons. Above the list, render a batch "Approve all / Deny all" bar.
  - **Pattern 2 — inline editor overlay**: port the decoration plugin into `lib/proposed-change-decoration.ts` and the CSS into `lib/diff-overlay.css`. Import the CSS once from `app/globals.css`. Renders red-strikethrough + green-highlight on the targeted chunk with floating Approve / Deny buttons.
  - **Both UIs call the same `POST /v1/chat/{sid}/approve` endpoint with the same `change_id`.** Approving in either place commits the change and clears it from both UIs.
  - **Verification before declaring done:** for each demo prompt, both the chat-side card AND the editor overlay must visibly render. If only the chat card renders, the schema is missing the `chunk_wrapper` Node — fix the schema before moving on.
- **`document_sync` event** fires at the start of every turn with prepared HTML containing chunk IDs. Apply it to the editor immediately so chunk IDs round-trip cleanly before any `proposed_change` arrives.
- **Double-parse on `proposed_change.content`.** The SSE `content` field is a JSON-stringified string — parse `event.data` first, then `JSON.parse` the `content` field again. See the warning callout in the streaming guide.

## Approval-mode toggle — iOS-style segmented slider

Above the chat input, render a compact **two-segment iOS-style slider** (the shape used in iPhone Settings, Messages, Safari toolbar). Both labels are visible at all times: **"Auto Approve"** on the left half, **"Review Mode"** on the right half. A filled capsule "thumb" slides between the two halves when the user clicks, indicating the active mode. Do NOT build a plain on/off toggle, a checkbox, or a dropdown — it must be a two-label segmented slider with the thumb animating left/right.

Visual spec:

- **Track:** rounded pill (`border-radius: 9999px`), fixed width ~260px, height ~32px, light-gray background (e.g. `bg-gray-100`), 1px subtle border.
- **Thumb:** filled capsule that occupies 50% of the track width; slides under the active label. Animate with a `transform: translateX(...)` transition over 180ms ease-out. Thumb uses the app's accent fill (e.g. `bg-white` over the gray track, with a small shadow for lift).
- **Labels:** inline inside each half, centred, 13–14px medium weight. The active half's label uses primary foreground (`text-gray-900`); the inactive half uses muted gray (`text-gray-500`). Labels never move — only the thumb slides.
- **Interaction:** click anywhere on the left half to set Auto Approve; click anywhere on the right half to set Review Mode. Cursor: pointer. No separate button — the whole track is the control.
- **Keyboard / a11y:** `role="switch"`, `aria-checked` reflects Review Mode (true when Review Mode is active, false when Auto Approve). `aria-label="Approval mode"`. Left / right arrow keys toggle when focused; Space and Enter also toggle.

Behaviour:

- **Auto Approve active (default, thumb on left).** Send `approval_mode: "approve_all"` (or omit the field). Changes apply immediately on the `final` event. ReviewCards and inline overlays do not render.
- **Review Mode active (thumb on right).** Send `approval_mode: "ask_every_time"`. Pattern 1 ReviewCards and Pattern 2 inline overlays render; the user approves/denies each change before it applies.

Directly below the slider, render a single subtle caption (12px muted gray) that updates with the state:

- Auto Approve active → *"Changes apply immediately."*
- Review Mode active → *"You'll approve each change before it applies."*

Persist the slider state in `localStorage` under the key `superdocs:reviewMode` so it survives page reload. Initialise by reading that key on mount; default to Auto Approve if missing.

For the three demo prompts in this file, slide to Review Mode before sending them — that's how the HITL UI gets exercised. For casual prompts, leave the slider on Auto Approve and changes apply automatically.

## What to build

1. Scaffold Next.js 16 + TS + Tailwind + install ProseMirror packages.
2. ProseMirror editor with chunk-id preservation per the editor-integration guide — must include both the per-block attribute *and* the `chunk_wrapper` Node spec.
3. Two-pane layout (editor left, chat right) with the SOP sample document pre-seeded.
4. Next.js API route proxy to SuperDocs — one route family for POST/DELETE, a separate route for the SSE stream.
5. Chat flow: `POST /v1/chat/async`, open `EventSource`, handle all six SSE event types.
6. `document_sync` handling — apply the prepared HTML before any `proposed_change` lands.
7. **Pattern 1 — chat-side `ReviewCard`** in `components/ReviewCard.tsx`: per-change card with ai_explanation + Before/After HTML + per-card Approve/Deny + batch Approve-all/Deny-all bar.
8. **Pattern 2 — inline editor overlay**: port the ProseMirror decoration plugin per the human-in-the-loop guide.
9. Word export via `POST /v1/documents/export`.
10. Approval-mode iOS-style segmented slider above the chat input per the spec in the **Approval-mode toggle** section above (two labels visible: "Auto Approve" / "Review Mode"; animated thumb; `role="switch"`; `localStorage` persistence). Default thumb on left (Auto Approve active) → `approval_mode: "approve_all"`. Right → `approval_mode: "ask_every_time"`.
11. Minimal README + run the three demo prompts end-to-end with Review Mode ON. For each prompt, both the chat-side card AND the editor overlay must visibly render. Then switch Review Mode OFF and confirm a casual prompt auto-applies with no diff UI.

## Sample document

Generate a 5-section Incident Response Procedure SOP at `lib/sample-doc.ts`. Each section needs a heading + 2-3 short paragraphs. Section 1: numbered list of triage steps. Section 2: numbered list with SEV1/SEV2/SEV3 escalation tiers. Section 4: compliance and regulatory notification (PCI/HIPAA/GDPR). End with an approval footer. The structure must support the three demo prompts below — Section 4 must accept a new compliance clause, Section 2's escalation chain must be growable by one item, Section 3 must be tightenable to a one-line rule.

### CRITICAL — sprinkle intentional grammatical errors throughout every section

The demo includes a **"Fix grammar throughout the entire document"** prompt that exercises the AI's parallel multi-section editing. For that prompt to have visible work to do in every section, the seeded document MUST contain intentional grammar / spelling / punctuation issues spread across all 5 sections.

**Requirements:**

- **At least 3 distinct errors per section** (15+ total across the document). Spread them evenly — not all clustered in one section.
- **Mix the error types** so the AI shows breadth, not just one trick:
  - Subject-verb agreement (*"the team are responsible"*, *"each engineers must follow"*)
  - Wrong preposition (*"comply to PCI-DSS"* instead of *"comply with"*, *"different than"* instead of *"different from"*)
  - Missing or misplaced commas (Oxford comma, comma splices, restrictive vs non-restrictive clauses)
  - Misspellings on real but uncommon words (*"acknowledgement"* → *"acknowledgment"* swap, *"separately"* → *"seperately"*, *"occurence"*, *"recieve"*, *"definately"*)
  - Wrong word choice (*"affect"* vs *"effect"*, *"its"* vs *"it's"*, *"their"* vs *"there"* vs *"they're"*, *"loose"* vs *"lose"*)
  - Missing articles (*"engineer must page on-call"* — missing *"the"*)
  - Tense inconsistency within a paragraph (mixing past and present where one tense is correct)
  - Awkward phrasing that's technically grammatical but obviously rough (*"It is important to be noting that"*)
- **Errors must be SUBTLE but real.** They should not change the technical meaning of the document — a security engineer reading this SOP should still understand the procedure correctly. They should also not be so glaring that they become the focus of the demo (no all-caps mistakes, no obviously broken sentences). Think *"a busy junior engineer wrote this in 30 minutes"*, not *"someone failed an English test."*
- **Do NOT introduce errors in:**
  - Section headings (those need to look clean for navigation)
  - Code blocks, file paths, URLs, version numbers, or technical identifiers
  - Sample API keys, hostnames, or compliance acronyms (PCI-DSS, HIPAA, GDPR, SEV1/SEV2/SEV3 — keep these correct)
- Add a comment block at the top of `lib/sample-doc.ts` listing the seeded errors per section so the founder can verify post-recording that the AI actually fixed them.

**Why this matters:** without seeded errors, the "fix grammar throughout" demo prompt would either no-op (AI sees a clean document and reports "no errors found") or invent fake fixes (AI hallucinates errors to justify the prompt). Both fail on camera. With seeded errors, the AI does real visible work in every section and the diff overlay lights up across the whole document — which is exactly the demo moment we want.

## Demo prompts (for validation)

**Toggle Review Mode ON** (slider on right above the chat input) before sending the first three prompts — each must produce both a chat-side `ReviewCard` AND a visible inline diff in the editor.

1. **"Add a PCI-DSS notification clause to Section 4 — any card-data-involved incident must notify the acquiring bank within 72 hours."** → Section 4 grows a new paragraph; inline green-highlight new text; other sections untouched.
2. **"Update the SEV1 escalation chain in Section 2 to include the Data Protection Officer between the Engineering Manager and the VP Engineering."** → Section 2's numbered list gets one new item mid-list; surrounding text unchanged.
3. **"Tighten Section 3 — remove the second paragraph and replace with a one-line rule: 'Service restoration precedes root-cause analysis, always.'"** → Section 3 shrinks from two paragraphs to one line.

After the first three approvals, **toggle Review Mode OFF** (slider on left — Auto Approve) and send the wide prompt:

4. **"Fix grammar and spelling throughout the entire document — every section."** → AI dispatches a multi-section fix in parallel; every one of the 5 sections shows visible green/red diff strikes as the seeded grammatical errors get corrected one by one; final state has the same content meaning but clean grammar. With Auto Approve, all corrections apply automatically — the on-camera moment is watching the diff highlights flash across all 5 sections almost simultaneously.

After all four prompts, clicking **Export .docx** downloads a Word file that opens in Pages/Word with all four edits present (3 structural + 1 grammar pass).

## Model tier — use the fastest

Every chat / async request body must include `model_tier` set to the **fastest** model tier published in [Model Selection](https://docs.superdocs.app/guides/model-selection). The docs explicitly identify which tier is fastest — read them and use that exact tier name verbatim. Do not hard-code a particular tier name in this brief; the brief stays forward-compatible if the fastest tier name ever changes.

This is the single most important latency lever in the demo — the perceived gap between "I clicked send" and "the proposed change card appears" is dominated by the model's inference time. Always pass `model_tier` explicitly; do not rely on the default.

```javascript
// every POST to /v1/chat/async — example shape, the agent fills in the actual tier name
{
  message,
  session_id,
  document_html,
  approval_mode,
  model_tier: "<fastest-tier-name-from-docs>"
}
```

If the docs ever describe a tier as "best for speed-critical workflows" or "lowest latency", that's the one — even if it's labeled differently. Surface the chosen tier name in a code comment so the founder can swap it on camera if a future tier becomes faster.

## Coding-quality reminders

Implement these from the start. Each links to the canonical pattern in the public SuperDocs docs.

- **EventSource lifecycle.** `es.close()` does NOT remove the event listeners — reusing the same EventSource pattern without `removeEventListener` accumulates stale listeners and leaks the old `EventSource` object. Either store the handler refs and call `removeEventListener` for each one before `close()`, or use the `AbortController` pattern (`new EventSource(url, { signal: controller.signal })` is not supported by the standard EventSource — use a wrapping AbortController + an explicit `controller.abort()` in your cleanup function that triggers your own `removeEventListener` loop). Do this in the same `useEffect` cleanup as `es.close()`.
- **`document_html` non-empty validation before send.** Editor refs can be transiently `null` during React 19 Strict Mode double-invoke or Next.js Fast Refresh. Cache the last successful `document_html` (from the previous `final.updated_html` or your editor's confirmed state) and validate non-empty before every POST to `/v1/chat/async`. See [Integration Starter Prompt — Part 7 checklist](https://docs.superdocs.app/guides/integration-starter-prompt#part-7-self-review-checklist).
- **Render `intermediate` SSE events to the UI in real time.** Don't only `console.log` them. Show every event as an in-flight chat bubble that updates in place; promote it to the final response on the `final` event. See [Streaming → Rendering intermediate events in your UI](https://docs.superdocs.app/guides/streaming#rendering-intermediate-events-in-your-ui). Without this, the chat looks frozen during 30s+ operations.
- **Optimistic UI on Approve — apply `proposed_change.new_html` immediately, don't wait for `final`.** When the user clicks Approve in Review Mode, the new content is already in `proposed_change.new_html` — apply it to the editor immediately (replace the chunk's content via a surgical editor transaction targeting the matching `data-chunk-id`). The next `final` event arrives shortly after carrying the same `updated_html`; reconcile then. Without optimistic apply, the user clicks Approve and waits — feels broken on camera. With optimistic apply, the change appears instantly. See [HITL → Render diffs inline](https://docs.superdocs.app/guides/human-in-the-loop) for the chunk-id targeting pattern.
- **Latency budget.** Single-section edits should complete in <10s; multi-section in 30–90s; full-document operations in 60–180s. Show a "still processing" indicator after 30s, not after the operation already feels stuck. See [Async Jobs → Latency expectations and timeout strategy](https://docs.superdocs.app/guides/async-jobs#latency-expectations-and-timeout-strategy).

## Brand notes

Voice for UI copy: direct, second person, no marketing fluff. Refer to the model as **"SuperDocs' AI"** or **"the AI"** — never name a specific provider.

## Content safety

Repo is public on GitHub. Don't reference how SuperDocs works internally — the demo talks to the public API only. Use placeholder API keys (`sk_YOUR_API_KEY`) in example code. Don't speculate about what's behind the SuperDocs API.

## Where to find everything else

- **`llms-full.txt`** (in this folder) — full SuperDocs API reference; authoritative for every request/response shape.
- [Editor Integration](https://docs.superdocs.app/guides/editor-integration) — ProseMirror chunk-id schema snippet + round-trip verification test.
- [Human-in-the-Loop](https://docs.superdocs.app/guides/human-in-the-loop) — inline diff overlay plugin + CSS.
- [SSE Streaming](https://docs.superdocs.app/guides/streaming) — event types, `proposed_change.content` double-parse, `api_key` query-param pattern.
- [JavaScript Examples](https://docs.superdocs.app/examples/javascript) — two-pane Frontend Layout + working HITL flow code.
