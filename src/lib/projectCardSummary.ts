import { ACOUSTIC_MATERIALS, DEFAULT_ROOM_MATERIAL, type RoomMaterialPreset } from "@/components/canvas/acousticMaterials";
import type { ProjectConfigJSON } from "@/lib/projectConfig";

export function truncateTrackName(value: string, maxLength = 12): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}…`;
}

export function formatRoomSizeLabel(scale: [number, number, number] | undefined): string {
  const [width = 1, height = 1, depth = 1] = scale ?? [1, 1, 1];
  return `${(10 * width).toFixed(1)} × ${(4 * height).toFixed(1)} × ${(10 * depth).toFixed(1)} m`;
}

export function getProjectCardSummary(config: ProjectConfigJSON | null | undefined) {
  const trackNames = Array.isArray(config?.tracks)
    ? config.tracks.map((track, index) =>
        truncateTrackName(track.name?.trim() || `Track ${index + 1}`)
      )
    : [];

  const materialKey = (config?.room?.materials?.left ?? DEFAULT_ROOM_MATERIAL) as RoomMaterialPreset;
  const roomMaterial = ACOUSTIC_MATERIALS[materialKey]?.name ?? materialKey;

  const scale = config?.room?.scale;
  const roomSize = formatRoomSizeLabel(
    Array.isArray(scale) && scale.length === 3
      ? ([scale[0], scale[1], scale[2]] as [number, number, number])
      : undefined
  );

  return { trackNames, roomMaterial, roomSize };
}
