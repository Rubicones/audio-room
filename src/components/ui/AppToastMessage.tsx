"use client";

import type { Toast } from "react-hot-toast";
import styles from "./AppToast.module.css";

export type AppToastVariant = "success" | "error" | "info" | "warning";

const variantClass: Record<AppToastVariant, string> = {
  success: styles.iconCircleSuccess,
  error: styles.iconCircleError,
  info: styles.iconCircleInfo,
  warning: styles.iconCircleWarning,
};

function ToastIcon({ variant }: { variant: AppToastVariant }) {
  if (variant === "success") {
    return (
      <svg className={styles.iconSvg} viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M3.5 8.2 6.4 11.1 12.5 5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (variant === "error") {
    return (
      <svg className={styles.iconSvg} viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (variant === "warning") {
    return (
      <svg className={styles.iconSvg} viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M8 4.2v4.4M8 11.4h.01"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg className={styles.iconSvg} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 7.1v3.4M8 4.8h.01"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

type AppToastMessageProps = {
  toastState: Toast;
  message: string;
  variant: AppToastVariant;
};

export function AppToastMessage({ toastState, message, variant }: AppToastMessageProps) {
  return (
    <div
      className={styles.toast}
      style={{
        opacity: toastState.visible ? 1 : 0,
        transform: toastState.visible ? "translateY(0)" : "translateY(8px)",
        transition: "opacity 180ms ease, transform 180ms ease",
      }}
    >
      <span className={`${styles.iconCircle} ${variantClass[variant]}`} aria-hidden>
        <ToastIcon variant={variant} />
      </span>
      <span className={styles.message}>{message}</span>
    </div>
  );
}
