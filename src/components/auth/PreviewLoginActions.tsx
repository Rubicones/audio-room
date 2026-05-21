"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { storeAuthReturnTo } from "@/lib/authReturnTo";
import { getOAuthRedirectTo } from "@/lib/getURL";
import { appToast } from "@/lib/appToast";
import styles from "./PreviewLoginActions.module.css";

type PreviewLoginActionsProps = {
  primaryButtonClassName?: string;
};

export function PreviewLoginActions({ primaryButtonClassName }: PreviewLoginActionsProps) {
  const router = useRouter();

  const handleGoToLogin = () => {
    storeAuthReturnTo();
    router.push("/");
  };

  const handleOAuth = async (provider: "google" | "x") => {
    if (!supabase) return;
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: getOAuthRedirectTo() },
    });
    if (error) {
      appToast.error(error.message);
    }
  };

  return (
    <div className={styles.group}>
      <button type="button" className={primaryButtonClassName} onClick={handleGoToLogin}>
        log in to edit
      </button>
      <button
        type="button"
        className={styles.oauthBtn}
        aria-label="Continue with Google"
        onClick={() => void handleOAuth("google")}
      >
        <Image
          src="/google_logo.svg"
          alt=""
          width={22}
          height={22}
          className={styles.oauthLogoGoogle}
          aria-hidden
        />
      </button>
      <button
        type="button"
        className={styles.oauthBtn}
        aria-label="Continue with X"
        onClick={() => void handleOAuth("x")}
      >
        <Image src="/X_logo.svg" alt="" width={18} height={18} aria-hidden />
      </button>
    </div>
  );
}
