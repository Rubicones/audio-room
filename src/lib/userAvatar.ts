import type { User } from "@supabase/supabase-js";

function readUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getUserAvatarUrl(user: User | null | undefined): string | null {
  if (!user) return null;

  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  const metadataCandidates = [
    metadata?.avatar_url,
    metadata?.picture,
    metadata?.profile_image_url,
    metadata?.photo_url,
    metadata?.image,
  ];

  for (const candidate of metadataCandidates) {
    const url = readUrl(candidate);
    if (url) return url;
  }

  for (const identity of user.identities ?? []) {
    const identityData = identity.identity_data as Record<string, unknown> | undefined;
    const identityCandidates = [
      identityData?.avatar_url,
      identityData?.picture,
      identityData?.profile_image_url,
      identityData?.photo_url,
    ];
    for (const candidate of identityCandidates) {
      const url = readUrl(candidate);
      if (url) return url;
    }
  }

  return null;
}
