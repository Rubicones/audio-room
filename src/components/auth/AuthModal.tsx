"use client";

import { useMemo, useState } from "react";
import { getOAuthRedirectTo } from "@/lib/getURL";
import { supabase } from "@/lib/supabaseClient";
import { useAuthStore } from "./AuthStore";
import styles from "./AuthModal.module.css";

type AuthStep = "entry" | "login" | "register" | "confirm";

const KNOWN_EMAILS_KEY = "foam_known_auth_emails";

function runViewTransition(update: () => void) {
  const doc = document as Document & {
    startViewTransition?: (callback: () => void) => void;
  };
  if (typeof doc.startViewTransition === "function") {
    doc.startViewTransition(() => {
      update();
    });
    return;
  }
  update();
}

function readKnownEmails() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const raw = window.localStorage.getItem(KNOWN_EMAILS_KEY);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw) as string[];
    return new Set(parsed.map((email) => email.trim().toLowerCase()));
  } catch {
    return new Set<string>();
  }
}

function rememberEmail(email: string) {
  if (typeof window === "undefined") return;
  const normalized = email.trim().toLowerCase();
  const next = Array.from(readKnownEmails().add(normalized));
  window.localStorage.setItem(KNOWN_EMAILS_KEY, JSON.stringify(next));
}

export function AuthModal() {
  const { session, isLoading, isConfigured } = useAuthStore();
  const [step, setStep] = useState<AuthStep>("entry");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState("");

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const showModal = !session;

  if (!showModal) return null;

  const transitionTo = (next: AuthStep) => {
    runViewTransition(() => {
      setStep(next);
    });
  };

  const withBusy = async (action: () => Promise<void>) => {
    setIsBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unexpected authentication error.";
      setError(message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleOAuth = async (provider: "google" | "apple" | "facebook") => {
    if (!supabase) return;
    await withBusy(async () => {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: getOAuthRedirectTo() },
      });
      if (oauthError) throw oauthError;
    });
  };

  const handleContinueWithEmail = () => {
    if (!normalizedEmail) {
      setError("Please enter an email.");
      return;
    }
    setPassword("");
    setConfirmPassword("");
    const known = readKnownEmails().has(normalizedEmail);
    transitionTo(known ? "login" : "register");
  };

  const handleLogin = async () => {
    if (!supabase) return;
    if (!password) {
      setError("Please enter your password.");
      return;
    }
    await withBusy(async () => {
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (loginError) {
        if (/invalid login credentials/i.test(loginError.message)) {
          setError("No account found with this email. Create one below.");
          transitionTo("register");
          return;
        }
        throw loginError;
      }
      rememberEmail(normalizedEmail);
    });
  };

  const handleRegister = async () => {
    if (!supabase) return;
    if (!password || !confirmPassword) {
      setError("Please enter and confirm your password.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    await withBusy(async () => {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (signUpError) throw signUpError;
      rememberEmail(normalizedEmail);
      setConfirmMessage(
        data.session
          ? "Your account is ready. You are now signed in."
          : "Check your email for a confirmation link to finish account setup."
      );
      transitionTo("confirm");
    });
  };

  const handleForgotPassword = async () => {
    if (!supabase) return;
    if (!normalizedEmail) {
      setError("Please enter your email first.");
      return;
    }
    await withBusy(async () => {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: getOAuthRedirectTo(),
      });
      if (resetError) throw resetError;
      setConfirmMessage("Password reset link sent. Check your email.");
      transitionTo("confirm");
    });
  };

  return (
    <div className={styles.overlay}>
      <section className={styles.card} aria-live="polite">
        {(isLoading || isBusy) && <span className={styles.spinner} aria-hidden />}
        <h2 className={styles.title}>Sign in to continue</h2>
        {!isConfigured ? (
          <p className={styles.notice}>
            Supabase is not configured yet. Set `NEXT_PUBLIC_SUPABASE_URL` and
            `NEXT_PUBLIC_SUPABASE_ANON_KEY` to enable authentication.
          </p>
        ) : null}

        {step === "entry" ? (
          <>
            <p className={styles.subtitle}>Choose a provider or continue with email.</p>
            <div className={styles.grid}>
              <button
                type="button"
                className={styles.button}
                onClick={() => void handleOAuth("google")}
                disabled={isBusy || isLoading || !isConfigured}
              >
                Google
              </button>
              <button
                type="button"
                className={styles.button}
                onClick={() => void handleOAuth("apple")}
                disabled={isBusy || isLoading || !isConfigured}
              >
                Apple
              </button>
              <button
                type="button"
                className={styles.button}
                onClick={() => void handleOAuth("facebook")}
                disabled={isBusy || isLoading || !isConfigured}
              >
                Meta
              </button>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="auth-email-entry">
                Or continue with email
              </label>
              <input
                id="auth-email-entry"
                className={styles.input}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                disabled={isBusy || isLoading || !isConfigured}
              />
            </div>
            <button
              type="button"
              className={styles.primary}
              onClick={handleContinueWithEmail}
              disabled={isBusy || isLoading || !isConfigured}
            >
              Next
            </button>
          </>
        ) : null}

        {step === "login" ? (
          <>
            <p className={styles.subtitle}>{normalizedEmail}</p>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="auth-password-login">
                Password
              </label>
              <input
                id="auth-password-login"
                className={styles.input}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isBusy || isLoading || !isConfigured}
              />
            </div>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void handleLogin()}
              disabled={isBusy || isLoading || !isConfigured}
            >
              Login
            </button>
            <button
              type="button"
              className={styles.ghost}
              onClick={() => void handleForgotPassword()}
              disabled={isBusy || isLoading || !isConfigured}
            >
              Forgot password?
            </button>
            <button
              type="button"
              className={styles.ghost}
              onClick={() => transitionTo("register")}
              disabled={isBusy || isLoading || !isConfigured}
            >
              New here? Create account
            </button>
          </>
        ) : null}

        {step === "register" ? (
          <>
            <p className={styles.subtitle}>{normalizedEmail}</p>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="auth-password-register">
                Password
              </label>
              <input
                id="auth-password-register"
                className={styles.input}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isBusy || isLoading || !isConfigured}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="auth-password-confirm">
                Confirm password
              </label>
              <input
                id="auth-password-confirm"
                className={styles.input}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={isBusy || isLoading || !isConfigured}
              />
            </div>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void handleRegister()}
              disabled={isBusy || isLoading || !isConfigured}
            >
              Register
            </button>
            <button
              type="button"
              className={styles.ghost}
              onClick={() => transitionTo("login")}
              disabled={isBusy || isLoading || !isConfigured}
            >
              Already have an account? Log in
            </button>
          </>
        ) : null}

        {step === "confirm" ? (
          <>
            <p className={styles.notice}>
              {confirmMessage || "Check your email for confirmation link."}
            </p>
            <button
              type="button"
              className={styles.primary}
              onClick={() => transitionTo("login")}
              disabled={isBusy || isLoading || !isConfigured}
            >
              Back to login
            </button>
          </>
        ) : null}

        {error ? <p className={styles.error}>{error}</p> : null}
      </section>
    </div>
  );
}
