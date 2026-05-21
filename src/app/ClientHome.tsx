"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { useAuthStore } from "@/components/auth/AuthStore";
import { debugConsole } from "@/lib/debugConsole";
import { getNavigationDebugInfo } from "@/lib/debugSession";
import { landingStepLog } from "@/lib/landingStepLog";
import { Landing } from "./Landing";
import styles from "./page.module.css";

if (typeof window !== "undefined") {
  landingStepLog("P01", "ClientHome module evaluated", {
    readyState: document.readyState,
    path: window.location.pathname,
  });

  const win = window as Window & { __foamDocClickBound?: boolean };
}

const MixerWorkspace = dynamic(() => import("./MixerWorkspace"), {
  ssr: false,
  loading: () => (
    <main className={styles.page}>
      <div className={styles.appInitializing}>
        <span className={styles.spinner} aria-hidden />
        <p>Loading workspace...</p>
      </div>
    </main>
  ),
});

function GuestAuthLanding() {
  return (
    <main className={styles.page}>
      <Landing
        onStartClean={() => undefined}
        onStartDemo={() => undefined}
      />
    </main>
  );
}

export default function ClientHome() {
  const { session } = useAuthStore();

  const pathname =
    typeof window !== "undefined" ? window.location.pathname : "/";
  const needsWorkspaceShell = /^\/(?:p|project)\/[0-9a-fA-F-]+$/.test(pathname);
  const showGuestLanding = !needsWorkspaceShell && !session;

  useEffect(() => {
    landingStepLog("P05", "ClientHome mounted", {
      showGuestLanding,
      pathname,
    });
    debugConsole(
      "ClientHome.tsx:effect",
      "ClientHome committed",
      {
        showGuestLanding,
        pathname: window.location.pathname,
        nav: getNavigationDebugInfo(),
      },
      "H12",
      "post-fix-8",
    );
  }, [showGuestLanding, pathname]);

  if (showGuestLanding) {
    return <GuestAuthLanding />;
  }

  return <MixerWorkspace />;
}
