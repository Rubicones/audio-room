"use client";

const DEBUG_ENDPOINT =
  "http://127.0.0.1:7865/ingest/139e546b-7bf6-4496-a52a-21b77b1625bc";
const DEBUG_SESSION_ID = "753289";

export function debugSessionLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
  runId = "pre-fix",
) {
  // #region agent log
  fetch(DEBUG_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": DEBUG_SESSION_ID,
    },
    body: JSON.stringify({
      sessionId: DEBUG_SESSION_ID,
      runId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

export function getNavigationDebugInfo() {
  if (typeof window === "undefined") {
    return { type: "ssr", hydrated: false };
  }
  const nav = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  return {
    type: nav?.type ?? "unknown",
    hydrated: true,
    readyState: document.readyState,
    path: window.location.pathname,
    hasNextData: Boolean(
      (window as Window & { __NEXT_DATA__?: unknown }).__NEXT_DATA__,
    ),
  };
}
