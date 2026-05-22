import type { ProjectConfigJSON } from "@/lib/projectConfig";

function normalizeAudioUrlForCompare(audioUrl: string): string {
  if (!audioUrl) return "";
  if (audioUrl.startsWith("blob:")) return "";
  try {
    const parsed = new URL(audioUrl);
    const patterns = [
      "/storage/v1/object/public/audio/",
      "/storage/v1/object/sign/audio/",
      "/storage/v1/object/authenticated/audio/",
    ];
    for (const prefix of patterns) {
      const idx = parsed.pathname.indexOf(prefix);
      if (idx === -1) continue;
      const raw = parsed.pathname.slice(idx + prefix.length);
      if (!raw) return "";
      return decodeURIComponent(raw);
    }
    return parsed.pathname;
  } catch {
    return audioUrl;
  }
}

export function stableConfigSnapshot(config: ProjectConfigJSON): string {
  return JSON.stringify({
    room: config.room,
    globalFlags: config.globalFlags,
    listener: config.listener,
    obstacles: config.obstacles,
    tracks: config.tracks.map((track) => ({
      id: track.id,
      name: track.name,
      color: track.color,
      audioUrl: normalizeAudioUrlForCompare(track.audioUrl),
      position: track.position,
      volumeDb: track.volumeDb,
      muted: track.muted,
      solo: track.solo,
      isDirectivityEnabled: track.isDirectivityEnabled,
      directivityAlpha: track.directivityAlpha,
      directivitySharpness: track.directivitySharpness,
      rotationDeg: track.rotationDeg,
      showShadowsForTrack: track.showShadowsForTrack,
    })),
  });
}

type ProjectTitleRow = { id: string; title: string };

export function isProjectTitleTaken(
  title: string,
  projects: ProjectTitleRow[],
  excludeProjectId?: string | null
): boolean {
  const normalized = title.trim().toLowerCase();
  if (!normalized) return false;
  return projects.some(
    (project) =>
      project.id !== excludeProjectId && project.title.trim().toLowerCase() === normalized
  );
}

export function resolveUniqueProjectTitle(
  preferredTitle: string,
  projects: ProjectTitleRow[],
  excludeProjectId?: string | null
): string {
  const base = preferredTitle.trim() || "Untitled project";
  if (!isProjectTitleTaken(base, projects, excludeProjectId)) return base;

  let suffix = 1;
  while (isProjectTitleTaken(`${base} ${suffix}`, projects, excludeProjectId)) {
    suffix += 1;
  }
  return `${base} ${suffix}`;
}
