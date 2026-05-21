"use client";

import { debugSessionLog } from "@/lib/debugSession";

/** Numbered landing boot/auth step — uses warn so Firefox/devtools always show it. */
export function landingStepLog(
  step: string,
  message: string,
  data: Record<string, unknown> = {},
  hypothesisId = "L-step",
) {
  const payload = { step, ...data };
  console.warn(`[foam-landing] ${step} — ${message}`, payload);
  debugSessionLog(`landing:${step}`, message, payload, hypothesisId, "post-fix-8");
}
