"use client";

import { debugSessionLog } from "@/lib/debugSession";

/** Always mirrors to browser console — use when fetch-based debug logs are not visible yet. */
export function debugConsole(
  location: string,
  message: string,
  data?: Record<string, unknown>,
  hypothesisId = "H0",
  runId = "pre-fix",
) {
  const payload = data ?? {};
  console.info(`[foam-debug] ${location} — ${message}`, payload);
  debugSessionLog(location, message, payload, hypothesisId, runId);
}

if (typeof window !== "undefined") {
  console.info("[foam-debug] debugConsole module loaded", {
    readyState: document.readyState,
    path: window.location.pathname,
  });
}
