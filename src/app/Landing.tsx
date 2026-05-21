"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { debugConsole } from "@/lib/debugConsole";
import { getNavigationDebugInfo } from "@/lib/debugSession";
import { registerLandingClickHandlers } from "@/lib/landingClickBridge";
import { landingStepLog } from "@/lib/landingStepLog";
import { supabase } from "@/lib/supabaseClient";
import { useAuthStore } from "@/components/auth/AuthStore";
import { getEmailAuthGuidance } from "@/lib/authEmailFlow";
import { rememberPasswordLogin } from "@/lib/authIdentityHints";
import { getOAuthRedirectTo, getURL } from "@/lib/getURL";
import styles from "./Landing.module.css";

type LandingProps = {
    onStartClean: () => void;
    onStartDemo: () => void;
};

type LandingStep = "entry" | "login" | "register" | "confirm" | "setup";

const PENDING_AUTH_EMAIL_KEY = "foam_pending_auth_email";

function readPendingAuthEmail() {
    if (typeof window === "undefined") return "";
    return window.sessionStorage.getItem(PENDING_AUTH_EMAIL_KEY) ?? "";
}

function writePendingAuthEmail(email: string) {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(PENDING_AUTH_EMAIL_KEY, email);
}

function clearPendingAuthEmail() {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(PENDING_AUTH_EMAIL_KEY);
}

if (typeof window !== "undefined") {
    landingStepLog("L01", "Landing.tsx module evaluated (client bundle)");
}

export function Landing({ onStartClean, onStartDemo }: LandingProps) {
    const { session, isConfigured } = useAuthStore();
    const panelRef = useRef<HTMLElement | null>(null);
    const emailInputRef = useRef<HTMLInputElement | null>(null);
    const mountIdRef = useRef(
        typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : "landing-unknown",
    );
    const [step, setStep] = useState<LandingStep>("entry");
    const [email, setEmail] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState("");
    const [emailHintMessage, setEmailHintMessage] = useState("");
    const [isBusy, setIsBusy] = useState(false);
    const [confirmMessage, setConfirmMessage] = useState("");
    const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
    const normalizedUsername = useMemo(() => username.trim(), [username]);
    const displayStep = useMemo((): LandingStep => {
        if (!session) {
            return step === "setup" ? "entry" : step;
        }
        if (step === "confirm") return "confirm";
        if (step === "entry" || step === "login" || step === "register") {
            return "setup";
        }
        return step;
    }, [session, step]);

    useEffect(() => {
        landingStepLog("L05", "Landing displayStep changed", {
            displayStep,
            step,
            hasSession: Boolean(session),
        });
    }, [displayStep, step, session]);

    useEffect(() => {
        landingStepLog("L06", "Landing mount effect start");
        debugConsole(
            "Landing.tsx:mount",
            "Landing mounted — React handlers active",
            {
                mountId: mountIdRef.current,
                nav: getNavigationDebugInfo(),
                step,
                hasSession: Boolean(session),
                isConfigured,
            },
            "H6",
            "post-fix-2",
        );

        const panel = panelRef.current;
        landingStepLog("L07", "Landing panel ref after mount", {
            hasPanel: Boolean(panel),
        });
        if (!panel) return;

        const logNativePointer = (event: PointerEvent) => {
            const target = event.target;
            const el =
                target instanceof HTMLElement ? target : null;
            debugConsole(
                "Landing.tsx:native-pointer",
                "Pointer reached auth panel (capture)",
                {
                    mountId: mountIdRef.current,
                    type: event.type,
                    tag: el?.tagName ?? "unknown",
                    className: el?.className?.slice?.(0, 80) ?? "",
                    defaultPrevented: event.defaultPrevented,
                },
                "H6",
                "post-fix-2",
            );
        };

        panel.addEventListener("pointerdown", logNativePointer, true);
        panel.addEventListener("click", logNativePointer, true);

        return () => {
            panel.removeEventListener("pointerdown", logNativePointer, true);
            panel.removeEventListener("click", logNativePointer, true);
            landingStepLog("L08", "Landing unmount");
            debugConsole(
                "Landing.tsx:unmount",
                "Landing unmounted",
                { mountId: mountIdRef.current, step },
                "H4",
                "post-fix-2",
            );
        };
    }, [isConfigured, session, step]);

    const transitionTo = (next: LandingStep) => {
        landingStepLog("L09", "transitionTo", { from: step, to: next });
        debugConsole(
            "Landing.tsx:transition",
            "Step transition",
            { from: step, to: next, mountId: mountIdRef.current },
            "H4",
        );
        setStep(next);
    };

    const withBusy = async (action: () => Promise<void>) => {
        landingStepLog("L10", "Landing withBusy start");
        setError("");
        setIsBusy(true);
        try {
            await action();
            landingStepLog("L11", "Landing withBusy success");
        } catch (cause) {
            const message =
                cause instanceof Error
                    ? cause.message
                    : "Unexpected authentication error.";
            landingStepLog("L12", "Landing withBusy error", { message });
            setError(message);
        } finally {
            setIsBusy(false);
            landingStepLog("L13", "Landing withBusy end");
        }
    };

    const controlsDisabled = isBusy;
    const busyClass = controlsDisabled ? ` ${styles.controlBusy}` : "";

    const handleOAuth = async (provider: "google" | "twitter") => {
        landingStepLog("L15", "handleOAuth called", { provider });
        debugConsole(
            "Landing.tsx:oauth-click",
            "OAuth handler invoked",
            { provider, hasSupabase: Boolean(supabase), isConfigured },
            "H2",
        );
        if (!supabase) return;
        await withBusy(async () => {
            const { error: oauthError } = await supabase.auth.signInWithOAuth({
                provider,
                options: { redirectTo: getOAuthRedirectTo() },
            });
            if (oauthError) throw oauthError;
        });
    };

    const handleContinueWithEmail = (emailFromDom = "") => {
        const emailToUse = (emailFromDom || email).trim().toLowerCase();
        landingStepLog("L16", "handleContinueWithEmail called", {
            emailLength: emailToUse.length,
            fromDom: Boolean(emailFromDom),
        });
        if (emailFromDom && emailFromDom !== email) {
            setEmail(emailFromDom);
        }
        debugConsole(
            "Landing.tsx:continue-email",
            "Continue with email handler",
            {
                mountId: mountIdRef.current,
                emailLength: emailToUse.length,
                step,
            },
            "H1",
        );
        if (!emailToUse) {
            setError("Please enter an email.");
            return;
        }
        setError("");
        setPassword("");
        setConfirmPassword("");
        setUsername("");
        const guidance = getEmailAuthGuidance(emailToUse);
        if (guidance.route === "oauth-only") {
            setEmailHintMessage(guidance.message ?? "");
            return;
        }
        setEmailHintMessage(guidance.message ?? "");
        writePendingAuthEmail(emailToUse);
        transitionTo("login");
    };

    const handleLogin = async () => {
        landingStepLog("L17", "handleLogin called");
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
                    const guidance = getEmailAuthGuidance(normalizedEmail);
                    if (guidance.route === "oauth-only") {
                        transitionTo("entry");
                        throw new Error(
                            guidance.message ??
                                "This email uses a social sign-in provider.",
                        );
                    }
                    throw new Error(
                        "Wrong email or password. Try again, use Forgot Password, or create an account below.",
                    );
                }
                throw loginError;
            }
            rememberPasswordLogin(normalizedEmail);
            clearPendingAuthEmail();
        });
    };

    const handleRegister = async () => {
        landingStepLog("L18", "handleRegister called");
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
                    emailRedirectTo: getURL(),
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
                    const guidance = getEmailAuthGuidance(normalizedEmail);
                    if (guidance.route === "oauth-only") {
                        transitionTo("entry");
                        throw new Error(
                            guidance.message ??
                                "This email already uses a social sign-in provider.",
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
            clearPendingAuthEmail();
            setConfirmMessage(
                data.session
                    ? "Account ready. You are now signed in."
                    : "Check your email for confirmation link.",
            );
            transitionTo("confirm");
        });
    };

    const handleForgotPassword = async () => {
        landingStepLog("L19", "handleForgotPassword called");
        if (!supabase) return;
        if (!normalizedEmail) {
            setError("Please enter your email first.");
            return;
        }
        await withBusy(async () => {
            const { error: resetError } =
                await supabase.auth.resetPasswordForEmail(normalizedEmail, {
                    redirectTo: getURL(),
                });
            if (resetError) throw resetError;
            setConfirmMessage("Password reset email sent.");
            transitionTo("confirm");
        });
    };

    useEffect(() => {
        registerLandingClickHandlers({
            handleOAuth,
            isBusy: () => isBusy,
        });
    });

    useEffect(() => {
        const firstButton = panelRef.current?.querySelector("button");
        const firstInput = panelRef.current?.querySelector("input");
        landingStepLog("L21", "DOM controls probe", {
            buttonDisabled: firstButton?.hasAttribute("disabled") ?? null,
            inputDisabled: firstInput?.hasAttribute("disabled") ?? null,
            controlsDisabled,
        });
    }, [controlsDisabled, displayStep]);

    return (
        <div className={styles.overlay} data-foam-auth-root>
            <section ref={panelRef} className={styles.panel}>
                {isBusy ? (
                    <span className={styles.spinner} aria-hidden />
                ) : null}
                <h1 className={styles.logo}>
                    foam
                </h1>
                {displayStep !== "setup" ? (
                    <p className={styles.description}>
                        Sign in to your workspace and continue building spatial
                        audio scenes.
                    </p>
                ) : (
                    <p className={styles.description}>
                        A professional-grade spatial audio simulator for sound
                        engineers and educators. Calculate acoustic
                        distribution, critical distance, and occlusion with
                        engineering precision.
                    </p>
                )}

                {!isConfigured ? (
                    <p className={styles.inlineError}>
                        Configure `NEXT_PUBLIC_SUPABASE_URL` and
                        `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
                    </p>
                ) : null}

                {displayStep === "entry" ? (
                    <div className={styles.authBody}>
                        <p className={styles.dividerText}>login via these services</p>

                        <div className={styles.oauthGrid}>
                            <button
                                type='button'
                                className={`${styles.oauthBtn}${busyClass}`}
                                aria-label='Continue with Google'
                                data-foam-action='oauth-google'
                                aria-disabled={controlsDisabled}
                                onClick={() => {
                                    landingStepLog("L15", "google onClick");
                                    void handleOAuth("google");
                                }}
                            >
                                <span className={styles.oauthBtnContent}>
                                    <img
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
                                className={`${styles.oauthBtn}${busyClass}`}
                                aria-label='Continue with X'
                                data-foam-action='oauth-twitter'
                                aria-disabled={controlsDisabled}
                                onClick={() => {
                                    landingStepLog("L15", "x onClick");
                                    void handleOAuth("twitter");
                                }}
                            >
                                <span className={styles.oauthBtnContent}>
                                    <img
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
                                const fromRef =
                                    emailInputRef.current?.value ?? "";
                                const fromForm = String(fromRef).trim();
                                landingStepLog("L-form", "email form submit", {
                                    emailLength: fromForm.length,
                                });
                                handleContinueWithEmail(fromForm);
                            }}
                        >
                            <input
                                ref={emailInputRef}
                                className={styles.input}
                                name='email'
                                type='email'
                                autoComplete='username email'
                                defaultValue={email}
                                onInput={(event) => {
                                    setEmail(event.currentTarget.value);
                                    setEmailHintMessage("");
                                }}
                                placeholder='you@company.com'
                                readOnly={controlsDisabled}
                                required
                            />
                            <button
                                className={`${styles.startClean}${busyClass}`}
                                type='submit'
                                aria-disabled={controlsDisabled}
                            >
                                Next
                            </button>
                        </form>
                        {emailHintMessage ? (
                            <p className={styles.inlineError} role="status">
                                {emailHintMessage}
                            </p>
                        ) : null}
                    </div>
                ) : null}

                {displayStep === "login" ? (
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
                            readOnly={controlsDisabled}
                        />
                        <button
                            className={`${styles.startClean}${busyClass}`}
                            type='submit'
                            data-foam-action='login-submit'
                            aria-disabled={controlsDisabled}
                        >
                            Sign In
                        </button>
                        <button
                            type='button'
                            className={`${styles.linkBtn}${busyClass}`}
                            data-foam-action='forgot-password'
                            onClick={() => void handleForgotPassword()}
                            aria-disabled={controlsDisabled}
                        >
                            Forgot Password?
                        </button>
                        <button
                            type='button'
                            className={`${styles.linkBtn}${busyClass}`}
                            data-foam-action='to-register'
                            onClick={() => transitionTo("register")}
                            aria-disabled={controlsDisabled}
                        >
                            New here? Create an account
                        </button>
                    </form>
                ) : null}

                {displayStep === "register" ? (
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
                            readOnly={controlsDisabled}
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
                            readOnly={controlsDisabled}
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
                            readOnly={controlsDisabled}
                        />
                        <button
                            className={`${styles.startClean}${busyClass}`}
                            type='submit'
                            data-foam-action='register-submit'
                            aria-disabled={controlsDisabled}
                        >
                            Create Account
                        </button>
                        <button
                            type='button'
                            className={`${styles.linkBtn}${busyClass}`}
                            data-foam-action='to-login'
                            onClick={() => transitionTo("login")}
                            aria-disabled={controlsDisabled}
                        >
                            Already have an account? Sign in
                        </button>
                    </form>
                ) : null}

                {displayStep === "confirm" ? (
                    <div className={styles.noticeBlock}>
                        {confirmMessage ||
                            "Check your email for confirmation link"}
                        <button
                            type='button'
                            className={`${styles.startDemo}${busyClass}`}
                            data-foam-action='to-login-from-confirm'
                            onClick={() => transitionTo("login")}
                            aria-disabled={controlsDisabled}
                        >
                            Back to sign in
                        </button>
                    </div>
                ) : null}

                {displayStep === "setup" ? (
                    <div className={styles.actions}>
                        <button
                            type='button'
                            className={styles.startClean}
                            onClick={onStartClean}
                        >
                            start clean
                        </button>
                        <button
                            type='button'
                            className={styles.startDemo}
                            onClick={onStartDemo}
                        >
                            demo scene
                        </button>
                    </div>
                ) : null}

                {error ? <p className={styles.inlineError}>{error}</p> : null}
                <p className={styles.contactLine}>
                    Questions or feedback?{" "}
                    <a
                        className={styles.contactLink}
                        href='mailto:hello@foam.audio'
                    >
                        Contact us
                    </a>
                </p>
            </section>
        </div>
    );
}
