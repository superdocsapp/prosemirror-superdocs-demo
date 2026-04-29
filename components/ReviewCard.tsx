"use client";

import type { ProposedChange } from "@/lib/proposed-change-decoration";

export function ReviewCard({
  change,
  onApprove,
  onDeny,
}: {
  change: ProposedChange;
  onApprove: (changeId: string) => void;
  onDeny: (changeId: string) => void;
}) {
  const label =
    change.operation === "create"
      ? "New section"
      : change.operation === "delete"
      ? "Delete section"
      : "Edit";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-700">
          {label}
        </span>
      </div>
      {change.ai_explanation && (
        <p className="mb-2 text-[13px] leading-snug text-gray-900">
          {change.ai_explanation}
        </p>
      )}
      {change.old_html && (
        <div className="mb-1.5 overflow-hidden rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-red-700">
            Before
          </div>
          <div
            className="max-h-40 overflow-y-auto text-[12px] leading-snug text-gray-900"
            dangerouslySetInnerHTML={{ __html: change.old_html }}
          />
        </div>
      )}
      {change.new_html && (
        <div className="mb-2 overflow-hidden rounded-md border border-green-200 bg-green-50 px-2.5 py-1.5">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-green-700">
            After
          </div>
          <div
            className="max-h-40 overflow-y-auto text-[12px] leading-snug text-gray-900"
            dangerouslySetInnerHTML={{ __html: change.new_html }}
          />
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => onApprove(change.change_id)}
          className="flex-1 rounded-md bg-green-600 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-green-700"
        >
          Approve
        </button>
        <button
          onClick={() => onDeny(change.change_id)}
          className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          Deny
        </button>
      </div>
    </div>
  );
}

export function BatchBar({
  count,
  onApproveAll,
  onDenyAll,
}: {
  count: number;
  onApproveAll: () => void;
  onDenyAll: () => void;
}) {
  if (count <= 1) return null;
  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 p-2">
      <span className="flex-1 text-[12px] font-medium text-blue-900">
        {count} changes proposed
      </span>
      <button
        onClick={onApproveAll}
        className="rounded-md bg-green-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-green-700"
      >
        Approve all
      </button>
      <button
        onClick={onDenyAll}
        className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
      >
        Deny all
      </button>
    </div>
  );
}
