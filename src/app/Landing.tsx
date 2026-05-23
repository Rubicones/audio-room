"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuthStore } from "@/components/auth/AuthStore";
import { getAuthHint, rememberPasswordLogin } from "@/lib/authIdentityHints";
import { getOAuthRedirectTo } from "@/lib/getURL";
import styles from "./Landing.module.css";

type LandingProps = {
    onStartClean: () => void;
    onStartDemo: () => void;
};

type LandingStep = "entry" | "login" | "register" | "confirm" | "setup";

const KNOWN_EMAILS_KEY = "foam_known_auth_emails";

function runViewTransition(update: () => void) {
    const doc = document as Document & {
        startViewTransition?: (
            callback: () => void,
        ) => { finished?: Promise<void> } | void;
    };
    try {
        if (typeof doc.startViewTransition === "function") {
            doc.startViewTransition(() => {
                update();
            });
            return;
        }
        update();
    } catch {
        update();
    }
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

export function Landing({ onStartClean, onStartDemo }: LandingProps) {
    const { session, isLoading, isConfigured } = useAuthStore();
    const [step, setStep] = useState<LandingStep>(session ? "setup" : "entry");
    const [email, setEmail] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState("");
    const [emailHintMessage, setEmailHintMessage] = useState("");
    const [isBusy, setIsBusy] = useState(false);
    const [confirmMessage, setConfirmMessage] = useState("");
    const [hydrated, setHydrated] = useState(false);
    const transitionInFlightRef = useRef(false);
    const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
    const normalizedUsername = useMemo(() => username.trim(), [username]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setHydrated(true);
    }, []);

    useEffect(() => {
        const next = session ? "setup" : "entry";
        const shouldSyncToSetup = session && step !== "setup";
        const shouldSyncToEntry = !session && step === "setup";
        if (!shouldSyncToSetup && !shouldSyncToEntry) return;
        if (transitionInFlightRef.current) {
            setStep(next);
            return;
        }
        transitionInFlightRef.current = true;
        runViewTransition(() => {
            setStep(next);
        });
        window.setTimeout(() => {
            transitionInFlightRef.current = false;
        }, 350);
    }, [session, step]);

    const transitionTo = (next: LandingStep) => {
        if (transitionInFlightRef.current) {
            setStep(next);
            return;
        }
        transitionInFlightRef.current = true;
        runViewTransition(() => {
            setStep(next);
        });
        window.setTimeout(() => {
            transitionInFlightRef.current = false;
        }, 350);
    };

    const withBusy = async (action: () => Promise<void>) => {
        setError("");
        setIsBusy(true);
        try {
            await action();
        } catch (cause) {
            const message =
                cause instanceof Error
                    ? cause.message
                    : "Unexpected authentication error.";
            setError(message);
        } finally {
            setIsBusy(false);
        }
    };

    const controlsDisabled = !hydrated || isBusy || !isConfigured;

    const handleOAuth = async (provider: "google" | "x") => {
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
        setError("");
        setPassword("");
        setConfirmPassword("");
        setUsername("");
        setEmailHintMessage("");
        const hint = getAuthHint(normalizedEmail);
        const providers = new Set(
            (hint?.providers ?? []).map((provider) => provider.toLowerCase()),
        );
        const hasGoogle = providers.has("google");
        const hasPassword =
            providers.has("email") || Boolean(hint?.seenPasswordLogin);
        const known = readKnownEmails().has(normalizedEmail) || hasPassword;
        transitionTo(known ? "login" : "register");
    };

    const handleLogin = async () => {
        if (!supabase) return;
        if (!password) {
            setError("Please enter your password.");
            return;
        }
        await withBusy(async () => {
            const { error: loginError } =
                await supabase.auth.signInWithPassword({
                    email: normalizedEmail,
                    password,
                });
            if (loginError) {
                if (/invalid login credentials/i.test(loginError.message)) {
                    const hint = getAuthHint(normalizedEmail);
                    const providers = new Set(
                        (hint?.providers ?? []).map((provider) =>
                            provider.toLowerCase(),
                        ),
                    );
                    if (providers.has("google") && !providers.has("email")) {
                        transitionTo("entry");
                        throw new Error(
                            "This email is linked to Google sign-in. Use Google, or register with a different email.",
                        );
                    }
                    throw new Error(
                        "Wrong password. Please try again or reset your password.",
                    );
                }
                throw loginError;
            }
            rememberPasswordLogin(normalizedEmail);
            rememberEmail(normalizedEmail);
        });
    };

    const handleRegister = async () => {
        if (!supabase) return;
        if (!normalizedUsername) {
            setError("Please choose a username.");
            return;
        }
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
                options: {
                    emailRedirectTo: window.location.origin,
                    data: {
                        username: normalizedUsername,
                    },
                },
            });
            if (signUpError) {
                if (
                    /already registered|already been registered/i.test(
                        signUpError.message,
                    )
                ) {
                    const hint = getAuthHint(normalizedEmail);
                    const providers = new Set(
                        (hint?.providers ?? []).map((provider) =>
                            provider.toLowerCase(),
                        ),
                    );
                    if (providers.has("google") && !providers.has("email")) {
                        transitionTo("entry");
                        throw new Error(
                            "This email already exists via Google sign-in. Log in with Google, or use another email.",
                        );
                    }
                    transitionTo("login");
                    throw new Error(
                        "Account already exists. Enter your password to sign in.",
                    );
                }
                throw signUpError;
            }
            rememberPasswordLogin(normalizedEmail);
            rememberEmail(normalizedEmail);
            setConfirmMessage(
                data.session
                    ? "Account ready. You are now signed in."
                    : "Check your email for confirmation link.",
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
            const { error: resetError } =
                await supabase.auth.resetPasswordForEmail(normalizedEmail, {
                    redirectTo: getOAuthRedirectTo(),
                });
            if (resetError) throw resetError;
            setConfirmMessage("Password reset email sent.");
            transitionTo("confirm");
        });
    };

    return (
        <div className={styles.overlay}>
            <section
                className={styles.panel}
                style={{ viewTransitionName: "auth-card" }}
            >
                {isBusy || isLoading ? (
                    <span className={styles.spinner} aria-hidden />
                ) : null}
                <h1
                    className={styles.logo}
                    style={{ viewTransitionName: "auth-title" }}
                >
                    foam
                </h1>
                {step !== "setup" ? (
                    <p className={styles.description}>
                        Sign in to your workspace and continue building spatial
                        audio scenes.
                    </p>
                ) : (
                    <div className={styles.setupCopy}>
                        <p className={styles.description}>
                            The visual room acoustics simulator for the audio
                            community. Foam is designed for educators, students
                            of mixing and sound design, and musicians to explore
                            how sound behaves in physical spaces.
                        </p>
                        <ul className={styles.featureList}>
                            <li>
                                <strong>Dynamic positioning:</strong> Move the
                                listener or sound sources around the virtual room
                                and hear the acoustic reflections shift in
                                real-time.
                            </li>
                            <li>
                                <strong>Acoustic physics made visual:</strong>{" "}
                                See how room dimensions and materials shape the
                                final sound.
                            </li>
                            <li>
                                <strong>Interactive learning:</strong> Stop
                                guessing how a room impacts the mix—see it, move
                                it, and hear it instantly.
                            </li>
                        </ul>
                    </div>
                )}

                {!isConfigured ? (
                    <p className={styles.inlineError}>
                        Configure `NEXT_PUBLIC_SUPABASE_URL` and
                        `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
                    </p>
                ) : null}

                {step === "entry" ? (
                    <div className={styles.authBody}>
                        <p className={styles.dividerText}>
                            login via these services
                        </p>

                        <div className={styles.oauthGrid}>
                            <button
                                type='button'
                                className={styles.oauthBtn}
                                aria-label='Continue with Google'
                                disabled={controlsDisabled}
                                onClick={() => void handleOAuth("google")}
                            >
                                <span className={styles.oauthBtnContent}>
                                    <Image
                                        src='/google_logo.svg'
                                        alt=''
                                        width={24}
                                        height={24}
                                        className={styles.oauthLogoGoogle}
                                        aria-hidden
                                    />
                                    <span>google</span>
                                </span>
                            </button>
                            <button
                                type='button'
                                className={styles.oauthBtn}
                                aria-label='Continue with X'
                                disabled={controlsDisabled}
                                onClick={() => void handleOAuth("x")}
                            >
                                <span className={styles.oauthBtnContent}>
                                    <Image
                                        src='/X_logo.svg'
                                        alt=''
                                        width={24}
                                        height={24}
                                        aria-hidden
                                    />
                                    <span>x</span>
                                </span>
                            </button>
                        </div>
                        <div className={styles.divider}>
                            <span>or continue with email</span>
                        </div>
                        <form
                            className={styles.form}
                            onSubmit={(event) => {
                                event.preventDefault();
                                handleContinueWithEmail();
                            }}
                        >
                            <input
                                className={styles.input}
                                type='email'
                                autoComplete='username email'
                                value={email}
                                onChange={(event) => {
                                    setEmail(event.target.value);
                                    setEmailHintMessage("");
                                }}
                                placeholder='you@company.com'
                                disabled={controlsDisabled}
                            />
                            <button
                                className={styles.startClean}
                                style={{
                                    viewTransitionName: "auth-submit-btn",
                                }}
                                type='submit'
                                disabled={controlsDisabled}
                            >
                                Next
                            </button>
                        </form>
                        {emailHintMessage ? (
                            <p className={styles.inlineError}>
                                {emailHintMessage}
                            </p>
                        ) : null}
                    </div>
                ) : null}

                {step === "login" ? (
                    <form
                        className={styles.form}
                        onSubmit={(event) => {
                            event.preventDefault();
                            void handleLogin();
                        }}
                    >
                        <p className={styles.smallLabel}>{normalizedEmail}</p>
                        <input
                            className={styles.input}
                            type='password'
                            autoComplete='current-password'
                            value={password}
                            onChange={(event) =>
                                setPassword(event.target.value)
                            }
                            placeholder='password'
                            disabled={controlsDisabled}
                        />
                        <button
                            className={styles.startClean}
                            style={{ viewTransitionName: "auth-submit-btn" }}
                            type='submit'
                            disabled={controlsDisabled}
                        >
                            Sign In
                        </button>
                        <button
                            type='button'
                            className={styles.linkBtn}
                            onClick={() => void handleForgotPassword()}
                            disabled={controlsDisabled}
                        >
                            Forgot Password?
                        </button>
                    </form>
                ) : null}

                {step === "register" ? (
                    <form
                        className={styles.form}
                        onSubmit={(event) => {
                            event.preventDefault();
                            void handleRegister();
                        }}
                    >
                        <p className={styles.smallLabel}>{normalizedEmail}</p>
                        <input
                            className={styles.input}
                            type='text'
                            autoComplete='username'
                            value={username}
                            onChange={(event) =>
                                setUsername(event.target.value)
                            }
                            placeholder='username'
                            disabled={controlsDisabled}
                        />
                        <input
                            className={styles.input}
                            type='password'
                            autoComplete='new-password'
                            value={password}
                            onChange={(event) =>
                                setPassword(event.target.value)
                            }
                            placeholder='password'
                            disabled={controlsDisabled}
                        />
                        <input
                            className={styles.input}
                            type='password'
                            autoComplete='new-password'
                            value={confirmPassword}
                            onChange={(event) =>
                                setConfirmPassword(event.target.value)
                            }
                            placeholder='confirm password'
                            disabled={controlsDisabled}
                        />
                        <button
                            className={styles.startClean}
                            style={{ viewTransitionName: "auth-submit-btn" }}
                            type='submit'
                            disabled={controlsDisabled}
                        >
                            Create Account
                        </button>
                        <button
                            type='button'
                            className={styles.linkBtn}
                            onClick={() => transitionTo("login")}
                            disabled={controlsDisabled}
                        >
                            Already have an account? Log in
                        </button>
                    </form>
                ) : null}

                {step === "confirm" ? (
                    <div className={styles.noticeBlock}>
                        {confirmMessage ||
                            "Check your email for confirmation link"}
                        <button
                            type='button'
                            className={styles.startDemo}
                            onClick={() => transitionTo("login")}
                            disabled={controlsDisabled}
                        >
                            Back to sign in
                        </button>
                    </div>
                ) : null}

                {step === "setup" ? (
                    <div className={styles.actions}>
                        <button
                            type='button'
                            className={styles.startClean}
                            onClick={onStartClean}
                        >
                            create empty project
                        </button>
                        <button
                            type='button'
                            className={styles.startDemo}
                            onClick={onStartDemo}
                        >
                            load a demo scene
                        </button>
                    </div>
                ) : null}

                {error ? <p className={styles.inlineError}>{error}</p> : null}
                <p className={styles.contactLine}>
                    Questions or feedback?{" "}
                    <a
                        className={styles.contactLink}
                        href='rubiconhere@gmail.com'
                    >
                        Contact
                    </a>
                </p>
            </section>
        </div>
    );
}
