"use client";

import { getAuthHint } from "@/lib/authIdentityHints";

export type EmailAuthRoute = "password" | "oauth-only";

export type EmailAuthGuidance = {
  route: EmailAuthRoute;
  message: string | null;
};

/** Email step always continues to password; hints only affect messaging. */
export function getEmailAuthGuidance(email: string): EmailAuthGuidance {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return { route: "password", message: null };
  }

  const hint = getAuthHint(normalized);
  const providers = new Set(
    (hint?.providers ?? []).map((provider) => provider.toLowerCase()),
  );
  const hasGoogle = providers.has("google");
  const hasTwitter = providers.has("twitter") || providers.has("x");
  const hasOAuth = hasGoogle || hasTwitter;
  const hasPassword = providers.has("email") || Boolean(hint?.seenPasswordLogin);

  if (hasOAuth && !hasPassword) {
    const oauthNames = [
      hasGoogle ? "Google" : null,
      hasTwitter ? "X" : null,
    ].filter(Boolean);
    return {
      route: "oauth-only",
      message: `This email uses ${oauthNames.join(" or ")} sign-in. Continue with that provider, or use a different email.`,
    };
  }

  if (hasPassword || hasOAuth) {
    return { route: "password", message: "Enter your password to sign in." };
  }

  return {
    route: "password",
    message: "Enter your password, or create an account if you're new here.",
  };
}
