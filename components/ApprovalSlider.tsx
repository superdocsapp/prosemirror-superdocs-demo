"use client";

import { useEffect, useState } from "react";

export type ApprovalMode = "approve_all" | "ask_every_time";

const STORAGE_KEY = "superdocs:reviewMode";

export function useApprovalMode(): [boolean, (next: boolean) => void] {
  const [reviewMode, setReviewMode] = useState<boolean>(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "true") setReviewMode(true);
    } catch {
      // localStorage unavailable — fall back to default
    }
  }, []);

  const setMode = (next: boolean) => {
    setReviewMode(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // localStorage unavailable
    }
  };

  return [reviewMode, setMode];
}

export function approvalModeValue(reviewMode: boolean): ApprovalMode {
  return reviewMode ? "ask_every_time" : "approve_all";
}

export function ApprovalSlider({
  reviewMode,
  onChange,
}: {
  reviewMode: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="w-full">
      <div
        role="switch"
        aria-checked={reviewMode}
        aria-label="Approval mode"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            onChange(false);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            onChange(true);
          } else if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onChange(!reviewMode);
          }
        }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          onChange(x > rect.width / 2);
        }}
        className="relative h-8 cursor-pointer select-none rounded-full border border-gray-200 bg-gray-100 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        style={{ width: 260 }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute top-0.5 h-7 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-transform duration-200 ease-out"
          style={{
            width: "calc(50% - 2px)",
            left: 2,
            transform: reviewMode ? "translateX(100%)" : "translateX(0)",
          }}
        />
        <span
          className={`pointer-events-none absolute inset-y-0 left-0 z-10 flex w-1/2 items-center justify-center text-[13px] font-medium transition-colors ${
            reviewMode ? "text-gray-500" : "text-gray-900"
          }`}
        >
          Auto Approve
        </span>
        <span
          className={`pointer-events-none absolute inset-y-0 right-0 z-10 flex w-1/2 items-center justify-center text-[13px] font-medium transition-colors ${
            reviewMode ? "text-gray-900" : "text-gray-500"
          }`}
        >
          Review Mode
        </span>
      </div>
      <p className="mt-1.5 text-[12px] text-gray-500">
        {reviewMode
          ? "You'll approve each change before it applies."
          : "Changes apply immediately."}
      </p>
    </div>
  );
}
