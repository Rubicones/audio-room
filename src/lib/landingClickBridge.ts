"use client";

import { landingStepLog } from "@/lib/landingStepLog";

export type LandingClickHandlers = {
  handleOAuth: (provider: "google" | "twitter") => void | Promise<void>;
  isBusy: () => boolean;
};

const handlersRef: { current: LandingClickHandlers | null } = { current: null };

export function registerLandingClickHandlers(next: LandingClickHandlers | null) {
  handlersRef.current = next;
}

if (typeof window !== "undefined") {
  const win = window as Window & { __foamLandingClickBridge?: boolean };
  if (!win.__foamLandingClickBridge) {
    win.__foamLandingClickBridge = true;
    document.addEventListener(
      "pointerup",
      (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const actionEl = target.closest("[data-foam-action]");
        if (!actionEl) return;
        const action = actionEl.getAttribute("data-foam-action");
        if (!action?.startsWith("oauth-")) return;

        landingStepLog("L-bridge", "oauth pointerup", { action });
        const handlers = handlersRef.current;
        if (!handlers || handlers.isBusy()) return;

        if (action === "oauth-google") void handlers.handleOAuth("google");
        if (action === "oauth-twitter") void handlers.handleOAuth("twitter");
      },
      true,
    );
  }
}
