import type { AcousticColumn, RoomMaterialKey, Vec3 } from "./types";

/** Pedagogical column defaults (world space). */
export const DEFAULT_OBSTACLE_POSITION: Vec3 = [1.85, 0, -1.15];
export const OBSTACLE_RADIUS = 0.48;
export const OBSTACLE_HEIGHT = 3.2;
export const DEFAULT_COLUMN_MATERIAL: RoomMaterialKey = "brick";
export const DEFAULT_COLUMN_COLORS = [
  "#E16A6A",
  "#E5B94A",
  "#5BC489",
  "#4A90E2",
  "#7B5BE6",
  "#E07A5F",
] as const;

export function createDefaultColumn(
  index = 0,
  position: Vec3 = DEFAULT_OBSTACLE_POSITION
): AcousticColumn {
  return {
    id: crypto.randomUUID(),
    position,
    radius: OBSTACLE_RADIUS,
    height: OBSTACLE_HEIGHT,
    color: DEFAULT_COLUMN_COLORS[index % DEFAULT_COLUMN_COLORS.length],
    materialPreset: DEFAULT_COLUMN_MATERIAL,
  };
}
