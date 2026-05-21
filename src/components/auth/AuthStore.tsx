"use client";

import "@/lib/landingClickBridge";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getAuthDebugState, subscribeAuthBootstrap } from "@/lib/authBootstrap";
import { debugConsole } from "@/lib/debugConsole";
import { bootLog } from "@/lib/bootDebug";
import { isSupabaseConfigured } from "@/lib/supabaseClient";

type AuthStoreValue = {
  user: User | null;
  session: Session | null;
  isAuthReady: boolean;
  isConfigured: boolean;
};

const AuthStoreContext = createContext<AuthStoreValue | null>(null);

export function AuthStoreProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(isSupabaseConfigured ? false : true);

  useEffect(() => {
    bootLog("auth:AuthStore-mount");
    debugConsole("AuthStore.tsx:mount", "AuthStore subscribed", {}, "H8", "post-fix-2");
    return subscribeAuthBootstrap((snapshot) => {
      bootLog(
        "auth:AuthStore-snapshot",
        JSON.stringify({
          isReady: snapshot.isReady,
          hasSession: Boolean(snapshot.session),
          debug: getAuthDebugState(),
        }),
      );
      setSession(snapshot.session);
      setUser(snapshot.user);
      setIsAuthReady(snapshot.isReady);
      debugConsole(
        "AuthStore.tsx:snapshot",
        "Auth state updated",
        {
          isReady: snapshot.isReady,
          hasSession: Boolean(snapshot.session),
        },
        "H8",
        "post-fix-2",
      );
    });
  }, []);

  const value = useMemo<AuthStoreValue>(
    () => ({
      user,
      session,
      isAuthReady,
      isConfigured: isSupabaseConfigured,
    }),
    [user, session, isAuthReady],
  );

  return <AuthStoreContext.Provider value={value}>{children}</AuthStoreContext.Provider>;
}

export function useAuthStore() {
  const context = useContext(AuthStoreContext);
  if (!context) {
    throw new Error("useAuthStore must be used within AuthStoreProvider");
  }
  return context;
}
