"use client";

type AuthHintRecord = {
  providers: string[];
  seenPasswordLogin?: boolean;
};

const AUTH_HINTS_KEY = "foam_auth_identity_hints_v1";

function readRaw(): Record<string, AuthHintRecord> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(AUTH_HINTS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, AuthHintRecord>;
  } catch {
    return {};
  }
}

function writeRaw(next: Record<string, AuthHintRecord>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTH_HINTS_KEY, JSON.stringify(next));
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function getAuthHint(email: string): AuthHintRecord | null {
  const key = normalizeEmail(email);
  const all = readRaw();
  return all[key] ?? null;
}

export function rememberAuthProviders(email: string, providers: string[]) {
  const key = normalizeEmail(email);
  if (!key) return;
  const all = readRaw();
  const prev = all[key] ?? { providers: [] };
  const merged = new Set([
    ...prev.providers.map((provider) => String(provider).toLowerCase()),
    ...providers.map((provider) => String(provider).toLowerCase()),
  ]);
  all[key] = {
    ...prev,
    providers: Array.from(merged),
  };
  writeRaw(all);
}

export function rememberPasswordLogin(email: string) {
  const key = normalizeEmail(email);
  if (!key) return;
  const all = readRaw();
  const prev = all[key] ?? { providers: [] };
  const providers = new Set(prev.providers.map((provider) => provider.toLowerCase()));
  providers.add("email");
  all[key] = {
    ...prev,
    providers: Array.from(providers),
    seenPasswordLogin: true,
  };
  writeRaw(all);
}
