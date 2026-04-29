// ---------------------------------------------------------------------------
// Seeded Incident Response SOP (5 sections) with intentional grammar errors.
//
// Demo prompt 4 ("Fix grammar and spelling throughout the entire document")
// exercises the AI's parallel multi-section editor. Without seeded errors
// the AI either no-ops or hallucinates. The manifest below lets anyone
// verify post-recording that the AI caught real issues.
//
// SEEDED ERRORS PER SECTION (16 total; error types mixed per CLAUDE.md):
//
// Section 1 — Detection and Triage
//   * "the team are responsible"        — subject-verb disagreement
//   * "logs, metrics and traces"        — missing Oxford comma
//   * "different than a full ..."       — wrong preposition (should be "from")
//
// Section 2 — Escalation Matrix
//   * "it's primary responsibilities"   — it's / its misuse
//   * "rate of occurence"               — misspelling (occurrence)
//   * "engineer must page on-call ..."  — missing article "the"
//   * "each engineers must acknowledge" — subject-verb disagreement
//
// Section 3 — Response Protocol
//   * "It is important to be noting"    — awkward progressive
//   * "chase the root cause, this ..."  — comma splice
//   * "effect recovery time negatively" — wrong word (should be "affect")
//
// Section 4 — Compliance and Regulatory Notification
//   * "comply to PCI-DSS"               — wrong preposition (with)
//   * "is notified ... was logged"      — tense inconsistency
//   * "notification which must be ..."  — missing comma, non-restrictive clause
//
// Section 5 — Post-Incident Review and Approval
//   * "acknowledgement"                 — misspelling vs. American English
//   * "their is no formal closure"      — their / there misuse
//   * "tracked seperately"              — misspelling (separately)
//
// Do NOT clean these up by hand — they are the AI's on-camera work product.
// Headings, SEV tiers, compliance acronyms, code blocks, and URLs are
// deliberately left clean per CLAUDE.md.
// ---------------------------------------------------------------------------

export const SAMPLE_DOC_HTML = `
<h1>Incident Response Procedure</h1>
<p>This Standard Operating Procedure (SOP) defines how engineering, security, and compliance respond to production incidents. It is the authoritative reference during any SEV1, SEV2, or SEV3 event and must be followed in order.</p>

<h2>1. Detection and Triage</h2>
<p>Incidents are detected through alerting pipelines, customer reports, or internal monitoring. Within the first five minutes of detection, the team are responsible for confirming scope, impact, and blast radius before escalation.</p>
<p>Triage is not diagnosis — it is about ranking severity fast, not finding the root cause. A good triage pass is different than a full investigation.</p>
<ol>
  <li>Confirm the alert against logs, metrics and traces to rule out a false positive.</li>
  <li>Assign a severity tier (SEV1, SEV2, or SEV3) based on user impact.</li>
  <li>Page the primary on-call and open an incident Slack channel named <code>#incident-YYYYMMDD-NN</code>.</li>
  <li>Record the detection timestamp and the source signal in the incident tracker.</li>
</ol>

<h2>2. Escalation Matrix</h2>
<p>Every incident carries it's primary responsibilities up a defined chain. The rate of occurence of a severity class determines how aggressively we mobilise.</p>
<p>When a SEV1 is declared, engineer must page on-call manager within ten minutes of confirmation. At each escalation tier, each engineers must acknowledge the page within five minutes.</p>
<ol>
  <li><strong>SEV1</strong> — Primary on-call engineer → Engineering Manager → VP Engineering.</li>
  <li><strong>SEV2</strong> — Primary on-call engineer → Engineering Manager.</li>
  <li><strong>SEV3</strong> — Primary on-call engineer; escalate only if unresolved in 24 hours.</li>
</ol>

<h2>3. Response Protocol</h2>
<p>It is important to be noting that during an active incident the primary objective is service restoration, not investigation. Stabilise first, analyse later.</p>
<p>Responders should resist the temptation to chase the root cause, this requires calm focus and a willingness to revert suspicious changes without waiting for full confirmation. Premature deep-dives often effect recovery time negatively by burning the first critical hour on a theory that may be wrong.</p>

<h2>4. Compliance and Regulatory Notification</h2>
<p>Depending on the data involved, an incident may trigger external notification obligations. Engineering must coordinate with Legal and Compliance before any external communication is sent.</p>
<p>Card-data handling environments must comply to PCI-DSS requirements. When personal data is involved under GDPR jurisdiction, the Data Protection Officer is notified within 24 hours of confirmation, and the event was logged in the compliance register.</p>
<p>HIPAA-covered entities follow a separate 60-day notification window for breaches of protected health information. Any notification which must be issued to regulators is reviewed by outside counsel before transmission.</p>

<h2>5. Post-Incident Review and Approval</h2>
<p>Within 72 hours of resolution, the incident commander schedules a blameless post-mortem. An acknowledgement of the review is required from Engineering, Security, and Compliance before the ticket is closed.</p>
<p>Until all three sign-offs are recorded, their is no formal closure and the incident remains open in the tracker. Follow-up remediation work is tracked seperately from the original ticket to preserve audit integrity.</p>
<hr>
<p><em>Approved by: VP Engineering · Head of Security · Head of Compliance</em></p>
`.trim();
