"use client";

import { useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getUserAvatarUrl } from "@/lib/userAvatar";

type ProfileAvatarProps = {
  user: User | null;
  fallbackLetter: string;
  className?: string;
  onClick: () => void;
  "aria-label"?: string;
};

export function ProfileAvatar({
  user,
  fallbackLetter,
  className,
  onClick,
  "aria-label": ariaLabel = "Open profile menu",
}: ProfileAvatarProps) {
  const avatarUrl = useMemo(() => getUserAvatarUrl(user), [user]);
  const [loadFailed, setLoadFailed] = useState(false);
  const showImage = Boolean(avatarUrl) && !loadFailed;

  return (
    <button type="button" className={className} onClick={onClick} aria-label={ariaLabel}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={avatarUrl ?? "avatar"}
          src={avatarUrl ?? ""}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setLoadFailed(true)}
        />
      ) : (
        <span>{fallbackLetter}</span>
      )}
    </button>
  );
}
