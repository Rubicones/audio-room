import type {
  AcousticObstacle,
  LineSegment2D,
  RoomMaterialKey,
  Vec3,
} from "./types";

export type WallWithWindowGeometry2D = {
  centerX: number;
  centerZ: number;
  rotationRad: number;
  dirX: number;
  dirZ: number;
  tMin: number;
  tMax: number;
  tWindowCenter: number;
  tGapStart: number;
  tGapEnd: number;
  windowWidth: number;
  segments: LineSegment2D[];
};

/** Pedagogical obstacle defaults (world space). */
export const ROOM_CENTER_POSITION: Vec3 = [0, 0, 0];
export const DEFAULT_OBSTACLE_POSITION: Vec3 = [1.85, 0, -1.15];
export const OBSTACLE_RADIUS = 0.48;
export const OBSTACLE_HEIGHT = 3.2;
export const DEFAULT_OBSTACLE_MATERIAL: RoomMaterialKey = "brick";
export const DEFAULT_OBSTACLE_COLORS = [
  "#E16A6A",
  "#E5B94A",
  "#5BC489",
  "#4A90E2",
  "#7B5BE6",
  "#E07A5F",
] as const;

export function createDefaultObstacle(
  index = 0,
  position: Vec3 = DEFAULT_OBSTACLE_POSITION
): AcousticObstacle {
  return {
    id: crypto.randomUUID(),
    type: "cylinder",
    position,
    rotationDeg: 0,
    windowOffsetPct: 0.5,
    radius: OBSTACLE_RADIUS,
    height: OBSTACLE_HEIGHT,
    color: DEFAULT_OBSTACLE_COLORS[index % DEFAULT_OBSTACLE_COLORS.length],
    materialPreset: DEFAULT_OBSTACLE_MATERIAL,
  };
}

export function createDefaultBoxObstacle(
  index = 0,
  position: Vec3 = DEFAULT_OBSTACLE_POSITION
): AcousticObstacle {
  return {
    id: crypto.randomUUID(),
    type: "box",
    position,
    rotationDeg: 0,
    windowOffsetPct: 0.5,
    radius: OBSTACLE_RADIUS,
    width: 1.2,
    depth: 1.2,
    height: OBSTACLE_HEIGHT,
    color: DEFAULT_OBSTACLE_COLORS[index % DEFAULT_OBSTACLE_COLORS.length],
    materialPreset: DEFAULT_OBSTACLE_MATERIAL,
  };
}

export function createDefaultWallObstacle(
  index = 0,
  position: Vec3 = DEFAULT_OBSTACLE_POSITION
): AcousticObstacle {
  return {
    id: crypto.randomUUID(),
    type: "wall-with-window",
    position,
    rotationDeg: 0,
    windowOffsetPct: 0.5,
    radius: OBSTACLE_RADIUS,
    width: 2.0,
    depth: 0.45,
    height: OBSTACLE_HEIGHT,
    color: DEFAULT_OBSTACLE_COLORS[index % DEFAULT_OBSTACLE_COLORS.length],
    materialPreset: DEFAULT_OBSTACLE_MATERIAL,
  };
}

export function getObstacleSegments2D(
  obstacle: AcousticObstacle,
  roomWidth = 10,
  roomDepth = roomWidth
): LineSegment2D[] {
  if (obstacle.type === "box") {
    const [xc, , zc] = obstacle.position;
    const width = obstacle.width ?? 1;
    const depth = obstacle.depth ?? 1;
    const hw = width / 2;
    const hd = depth / 2;
    const p1: [number, number] = [xc - hw, zc - hd];
    const p2: [number, number] = [xc + hw, zc - hd];
    const p3: [number, number] = [xc + hw, zc + hd];
    const p4: [number, number] = [xc - hw, zc + hd];
    return [
      { start: p1, end: p2 },
      { start: p2, end: p3 },
      { start: p3, end: p4 },
      { start: p4, end: p1 },
    ];
  }
  if (obstacle.type === "wall-with-window") {
    return getWallWithWindowGeometry2D(obstacle, roomWidth, roomDepth)?.segments ?? [];
  }

  const segmentCount = 12;
  const [cx, , cz] = obstacle.position;
  const points: [number, number][] = [];
  for (let i = 0; i < segmentCount; i++) {
    const angle = (i / segmentCount) * Math.PI * 2;
    points.push([
      cx + obstacle.radius * Math.cos(angle),
      cz + obstacle.radius * Math.sin(angle),
    ]);
  }
  const segments: LineSegment2D[] = [];
  for (let i = 0; i < segmentCount; i++) {
    segments.push({
      start: points[i],
      end: points[(i + 1) % segmentCount],
    });
  }
  return segments;
}

export function getWallWithWindowGeometry2D(
  obstacle: AcousticObstacle,
  roomWidth = 10,
  roomDepth = roomWidth
): WallWithWindowGeometry2D | null {
  if (obstacle.type !== "wall-with-window") return null;
  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;
  const centerX = obstacle.position[0];
  const centerZ = obstacle.position[2];
  const rotationRad = (obstacle.rotationDeg * Math.PI) / 180;
  const dirX = Math.cos(rotationRad);
  const dirZ = Math.sin(rotationRad);
  const eps = 1e-6;
  const tCandidates: number[] = [];

  if (Math.abs(dirX) > eps) {
    tCandidates.push((-halfW - centerX) / dirX);
    tCandidates.push((halfW - centerX) / dirX);
  }
  if (Math.abs(dirZ) > eps) {
    tCandidates.push((-halfD - centerZ) / dirZ);
    tCandidates.push((halfD - centerZ) / dirZ);
  }

  const validTs = tCandidates
    .filter((t) => {
      const ix = centerX + t * dirX;
      const iz = centerZ + t * dirZ;
      return (
        ix >= -halfW - 1e-3 &&
        ix <= halfW + 1e-3 &&
        iz >= -halfD - 1e-3 &&
        iz <= halfD + 1e-3
      );
    })
    .sort((a, b) => a - b);

  if (validTs.length < 2) return null;

  const tMin = validTs[0];
  const tMax = validTs[validTs.length - 1];
  const span = Math.max(eps, tMax - tMin);
  const windowOffsetPct = Math.max(0.05, Math.min(0.95, obstacle.windowOffsetPct));
  const windowWidth = Math.max(0.2, Math.min(span * 0.9, obstacle.width ?? 2));
  const tWindowCenter = tMin + span * windowOffsetPct;
  const tGapStart = tWindowCenter - windowWidth / 2;
  const tGapEnd = tWindowCenter + windowWidth / 2;
  const leftStartT = tMin;
  const leftEndT = Math.max(tMin, Math.min(tGapStart, tMax));
  const rightStartT = Math.min(tMax, Math.max(tGapEnd, tMin));
  const rightEndT = tMax;
  const pointFromT = (t: number): [number, number] => [centerX + t * dirX, centerZ + t * dirZ];
  const segments: LineSegment2D[] = [];

  if (leftEndT - leftStartT > 1e-4) {
    segments.push({ start: pointFromT(leftStartT), end: pointFromT(leftEndT) });
  }
  if (rightEndT - rightStartT > 1e-4) {
    segments.push({ start: pointFromT(rightStartT), end: pointFromT(rightEndT) });
  }
  if (segments.length === 0) return null;

  return {
    centerX,
    centerZ,
    rotationRad,
    dirX,
    dirZ,
    tMin,
    tMax,
    tWindowCenter,
    tGapStart,
    tGapEnd,
    windowWidth,
    segments,
  };
}
