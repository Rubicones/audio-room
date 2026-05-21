"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import { rememberAuthProviders } from "@/lib/authIdentityHints";

type AuthStoreValue = {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isConfigured: boolean;
};

const AuthStoreContext = createContext<AuthStoreValue | null>(null);

export function AuthStoreProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loadingState, setLoadingState] = useState(true);
  const isLoading = isSupabaseConfigured ? loadingState : false;

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured) return;

    let active = true;

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        console.warn("Supabase session bootstrap failed:", error.message);
      }
      if (data.session?.user?.email) {
        const providerList = Array.isArray(data.session.user.app_metadata?.providers)
          ? (data.session.user.app_metadata.providers as string[])
          : data.session.user.app_metadata?.provider
            ? [String(data.session.user.app_metadata.provider)]
            : [];
        rememberAuthProviders(data.session.user.email, providerList);
      }
      setSession(data.session ?? null);
      setUser(data.session?.user ?? null);
      setLoadingState(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (nextSession?.user?.email) {
        const providerList = Array.isArray(nextSession.user.app_metadata?.providers)
          ? (nextSession.user.app_metadata.providers as string[])
          : nextSession.user.app_metadata?.provider
            ? [String(nextSession.user.app_metadata.provider)]
            : [];
        rememberAuthProviders(nextSession.user.email, providerList);
      }
      setSession(nextSession ?? null);
      setUser(nextSession?.user ?? null);
      setLoadingState(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthStoreValue>(
    () => ({
      user,
      session,
      isLoading,
      isConfigured: isSupabaseConfigured,
    }),
    [user, session, isLoading]
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
