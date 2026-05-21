"use client";

import type { Session, User } from "@supabase/supabase-js";
import { bootLog } from "@/lib/bootDebug";
import { rememberAuthProviders } from "@/lib/authIdentityHints";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

export type AuthSnapshot = {
  session: Session | null;
  user: User | null;
  isReady: boolean;
};

type AuthListener = (snapshot: AuthSnapshot) => void;

const BOOTSTRAP_FALLBACK_MS = 2500;

let bootstrapStarted = false;
let bootstrapFinished = false;
let bootstrapFinishReason = "pending";
let listenerNotifyCount = 0;
let fallbackTimeoutId: number | null = null;
let authSubscription: { unsubscribe: () => void } | null = null;

let latestSnapshot: AuthSnapshot = {
  session: null,
  user: null,
  isReady: false,
};

const listeners = new Set<AuthListener>();

export function getAuthDebugState() {
  return {
    bootstrapStarted,
    bootstrapFinished,
    bootstrapFinishReason,
    listenerCount: listeners.size,
    listenerNotifyCount,
    isReady: latestSnapshot.isReady,
    hasSession: Boolean(latestSnapshot.session),
    userId: latestSnapshot.user?.id?.slice(0, 8) ?? null,
  };
}

function notifyListeners() {
  listenerNotifyCount += 1;
  listeners.forEach((listener) => {
    try {
      listener(latestSnapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "listener error";
      bootLog("auth:listener-error", message);
    }
  });
}

function providersFromUser(user: User): string[] {
  const merged = new Set<string>();
  for (const identity of user.identities ?? []) {
    if (identity.provider) merged.add(identity.provider.toLowerCase());
  }
  const provider = user.app_metadata?.provider;
  if (provider) merged.add(String(provider).toLowerCase());
  const providers = user.app_metadata?.providers;
  if (Array.isArray(providers)) {
    for (const entry of providers) {
      merged.add(String(entry).toLowerCase());
    }
  }
  return Array.from(merged);
}

function applySession(session: Session | null, source: string) {
  bootLog(
    "auth:applySession",
    `${source} session=${session ? "yes" : "no"} listeners=${listeners.size}`,
  );

  if (session?.user?.email) {
    rememberAuthProviders(session.user.email, providersFromUser(session.user));
  }

  latestSnapshot = {
    session,
    user: session?.user ?? null,
    isReady: true,
  };
  notifyListeners();
}

function markReady(session: Session | null, reason: string) {
  if (bootstrapFinished) {
    applySession(session, `reapply:${reason}`);
    return;
  }

  bootstrapFinished = true;
  bootstrapFinishReason = reason;
  clearBootstrapFallback();

  if (session?.user?.email) {
    rememberAuthProviders(session.user.email, providersFromUser(session.user));
  }

  latestSnapshot = {
    session,
    user: session?.user ?? null,
    isReady: true,
  };

  bootLog("auth:bootstrap-finish", reason);
  notifyListeners();
}

function clearBootstrapFallback() {
  if (fallbackTimeoutId !== null) {
    window.clearTimeout(fallbackTimeoutId);
    fallbackTimeoutId = null;
  }
}

function scheduleBootstrapFallback() {
  if (typeof window === "undefined" || bootstrapFinished) return;
  clearBootstrapFallback();
  fallbackTimeoutId = window.setTimeout(() => {
    if (bootstrapFinished) return;
    bootLog("auth:fallback", "timeout — resolving session without blocking UI");
    void resolveSessionFallback("fallback-timeout");
  }, BOOTSTRAP_FALLBACK_MS);
}

async function resolveSessionFallback(source: string) {
  if (!supabase || bootstrapFinished) return;

  try {
    const getSessionTask = supabase.auth.getSession();
    const timeoutTask = new Promise<null>((resolve) => {
      window.setTimeout(() => resolve(null), 1500);
    });
    const result = await Promise.race([getSessionTask, timeoutTask]);

    if (result === null) {
      bootLog("auth:getSession-slow", "unblocking UI without session");
      markReady(null, `${source}:slow`);
      return;
    }

    const { data, error } = result;
    if (error) {
      bootLog("auth:getSession-error", error.message);
      markReady(null, `${source}:error`);
      return;
    }
    markReady(data.session, `${source}:getSession`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    bootLog("auth:getSession-failed", message);
    markReady(null, `${source}:failed`);
  }
}

function handleAuthEvent(event: string, nextSession: Session | null) {
  bootLog(
    "auth:event",
    `${event} session=${nextSession ? "yes" : "no"} finished=${bootstrapFinished}`,
  );

  if (!bootstrapFinished) {
    markReady(nextSession, event);
    return;
  }

  applySession(nextSession, event);
}

function startAuthBootstrap() {
  if (!supabase || !isSupabaseConfigured) {
    bootLog("auth:start-skipped", "supabase missing or not configured");
    markReady(null, "not-configured");
    return;
  }

  if (bootstrapFinished) {
    return;
  }

  if (bootstrapStarted) {
    bootLog("auth:bootstrap-in-flight", `listeners=${listeners.size}`);
    if (!bootstrapFinished) {
      markReady(null, "re-subscribe");
    }
    scheduleBootstrapFallback();
    return;
  }

  bootstrapStarted = true;
  bootLog("auth:bootstrap-start", "unblock UI first, then onAuthStateChange");

  // Unblock UI before onAuthStateChange — it can synchronously block and stall isAuthReady.
  markReady(null, "pre-listener");

  if (authSubscription) {
    authSubscription.unsubscribe();
    authSubscription = null;
  }

  try {
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      handleAuthEvent(event, nextSession);
    });
    authSubscription = data.subscription;
    bootLog("auth:listener-registered", "ok");
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    bootLog("auth:listener-register-failed", message);
    void resolveSessionFallback("register-failed");
    return;
  }

  scheduleBootstrapFallback();
}

export function subscribeAuthBootstrap(listener: AuthListener) {
  bootLog("auth:subscribe", `listeners=${listeners.size} finished=${bootstrapFinished}`);

  if (!isSupabaseConfigured || !supabase) {
    latestSnapshot = { session: null, user: null, isReady: true };
    listener(latestSnapshot);
    return () => undefined;
  }

  listeners.add(listener);
  listener(latestSnapshot);

  if (!bootstrapFinished) {
    startAuthBootstrap();
  }

  return () => {
    listeners.delete(listener);
    bootLog("auth:subscribe-removed", `listeners=${listeners.size}`);
  };
}
