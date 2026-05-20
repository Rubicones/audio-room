"use client";

import { Billboard, Line, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import { Group, Object3D, Vector3 } from "three";
import {
  setTrackDiffractionOverride,
  setTrackDynamicAcoustics,
  updateTrackShadowOcclusion,
} from "./audioEngine";
import {
  OBSTACLE_RADIUS,
  getObstacleSegments2D,
  getWallWithWindowGeometry2D,
} from "./obstacleConstants";
import type { AcousticObstacle } from "./types";
import { useItimFontUrl } from "./sketch";
import { getDirectivityRayAnchors } from "./directivity";

const INK = "#1a1a1a";
const FLOOR_Y = 0.012;
const R0 = 1;
const DIRECTIVITY_Q = 1;
const GAIN_EPSILON = 1e-4;
const PENUMBRA_BASE = 0.22;

const tempWorld = new Vector3();
const tempListener = new Vector3();
const MAX_OCCLUSION_DB = 6.0;

function ringPointsXZ(
  radius: number,
  segments = 72
): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push([Math.cos(a) * radius, 0, Math.sin(a) * radius]);
  }
  return pts;
}

function gainDbToLinear(gainDb: number) {
  if (!Number.isFinite(gainDb)) return 0;
  return Math.pow(10, gainDb / 20);
}

type WallHit = {
  hx: number;
  hz: number;
  nx: number;
  nz: number;
};

function firstWallHit(
  sx: number,
  sz: number,
  dx: number,
  dz: number,
  halfW: number,
  halfD: number
): WallHit | null {
  let bestT = Number.POSITIVE_INFINITY;
  let best: WallHit | null = null;
  const eps = 1e-4;

  if (Math.abs(dx) > eps) {
    const txLeft = (-halfW - sx) / dx;
    const zLeft = sz + dz * txLeft;
    if (txLeft > eps && zLeft >= -halfD - eps && zLeft <= halfD + eps && txLeft < bestT) {
      bestT = txLeft;
      best = { hx: -halfW, hz: zLeft, nx: 1, nz: 0 };
    }
    const txRight = (halfW - sx) / dx;
    const zRight = sz + dz * txRight;
    if (
      txRight > eps &&
      zRight >= -halfD - eps &&
      zRight <= halfD + eps &&
      txRight < bestT
    ) {
      bestT = txRight;
      best = { hx: halfW, hz: zRight, nx: -1, nz: 0 };
    }
  }

  if (Math.abs(dz) > eps) {
    const tzFront = (-halfD - sz) / dz;
    const xFront = sx + dx * tzFront;
    if (
      tzFront > eps &&
      xFront >= -halfW - eps &&
      xFront <= halfW + eps &&
      tzFront < bestT
    ) {
      bestT = tzFront;
      best = { hx: xFront, hz: -halfD, nx: 0, nz: 1 };
    }
    const tzBack = (halfD - sz) / dz;
    const xBack = sx + dx * tzBack;
    if (tzBack > eps && xBack >= -halfW - eps && xBack <= halfW + eps && tzBack < bestT) {
      bestT = tzBack;
      best = { hx: xBack, hz: halfD, nx: 0, nz: -1 };
    }
  }

  return best;
}

function distancePointToSegment2D(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
) {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const denom = abx * abx + abz * abz;
  if (denom <= 1e-6) return Math.hypot(apx, apz);
  const t = Math.max(0, Math.min(1, (apx * abx + apz * abz) / denom));
  const cx = ax + abx * t;
  const cz = az + abz * t;
  return Math.hypot(px - cx, pz - cz);
}

function reflectVector(ix: number, iz: number, nx: number, nz: number) {
  const dot = ix * nx + iz * nz;
  const rx = ix - 2 * dot * nx;
  const rz = iz - 2 * dot * nz;
  const length = Math.hypot(rx, rz);
  if (length <= 1e-5) return { x: ix, z: iz };
  return { x: rx / length, z: rz / length };
}

function intersectSegment2D(
  xs: number,
  zs: number,
  xl: number,
  zl: number,
  xa: number,
  za: number,
  xb: number,
  zb: number
): [number, number] | null {
  const denominator = (zl - zs) * (xb - xa) - (xl - xs) * (zb - za);
  if (Math.abs(denominator) <= 1e-9) return null;

  const ua = ((xl - xs) * (za - zs) - (zl - zs) * (xa - xs)) / denominator;
  const ub = ((xb - xa) * (za - zs) - (zb - za) * (xa - xs)) / denominator;
  if (ua < -1e-6 || ua > 1 + 1e-6 || ub < -1e-6 || ub > 1 + 1e-6) return null;

  const xp = xa + ua * (xb - xa);
  const zp = za + ua * (zb - za);
  return [xp, zp];
}

function smoothstep(edge0: number, edge1: number, x: number) {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Continuous shadow clarity for source->listener path against a cylindrical obstacle.
 * 1.0 = fully clear, 0.0 = fully blocked.
 */
function computeObstacleShadowClarity(
  sx: number,
  sz: number,
  lx: number,
  lz: number,
  ox: number,
  oz: number,
  radius: number
) {
  const vx = lx - sx;
  const vz = lz - sz;
  const lenSq = vx * vx + vz * vz;
  if (lenSq <= 1e-6) return 1;

  const wx = ox - sx;
  const wz = oz - sz;
  const t = (wx * vx + wz * vz) / lenSq;
  if (t <= 0.001 || t >= 0.999) return 1;

  const cx = sx + vx * t;
  const cz = sz + vz * t;
  const clearance = Math.hypot(ox - cx, oz - cz);

  const pathLength = Math.sqrt(lenSq);
  const fullBlockRadius = radius * 0.85;
  const penumbraRadius = radius + Math.min(0.95, PENUMBRA_BASE + pathLength * 0.08);
  const blockedByClearance = 1 - smoothstep(fullBlockRadius, penumbraRadius, clearance);

  // Fade hard blocking near segment endpoints for smoother diffraction-like behavior.
  const edgeFade =
    smoothstep(0.03, 0.15, t) * smoothstep(0.03, 0.15, 1 - t);
  const blocked = Math.max(0, Math.min(1, blockedByClearance * edgeFade));
  return 1 - blocked;
}


function projectRayToRoomBoundary(
  sx: number,
  sz: number,
  tx: number,
  tz: number,
  halfW: number,
  halfD: number
): [number, number] | null {
  const dx = tx - sx;
  const dz = tz - sz;
  const eps = 1e-5;
  if (Math.abs(dx) <= eps && Math.abs(dz) <= eps) return null;

  let bestT = Number.POSITIVE_INFINITY;
  let hitX = tx;
  let hitZ = tz;

  const tryHit = (candidateT: number, x: number, z: number) => {
    if (candidateT <= eps || !Number.isFinite(candidateT)) return;
    if (x < -halfW - eps || x > halfW + eps || z < -halfD - eps || z > halfD + eps) return;
    if (candidateT < bestT) {
      bestT = candidateT;
      hitX = Math.max(-halfW, Math.min(halfW, x));
      hitZ = Math.max(-halfD, Math.min(halfD, z));
    }
  };

  if (Math.abs(dx) > eps) {
    const rightT = (halfW - sx) / dx;
    tryHit(rightT, halfW, sz + dz * rightT);
    const leftT = (-halfW - sx) / dx;
    tryHit(leftT, -halfW, sz + dz * leftT);
  }

  if (Math.abs(dz) > eps) {
    const backT = (halfD - sz) / dz;
    tryHit(backT, sx + dx * backT, halfD);
    const frontT = (-halfD - sz) / dz;
    tryHit(frontT, sx + dx * frontT, -halfD);
  }

  if (!Number.isFinite(bestT)) return null;
  return [hitX, hitZ];
}

type TrackLite = {
  id: string;
  gainDb: number;
  isDirectivityEnabled: boolean;
  rotationDeg: number;
  showShadows: boolean;
};

type Flags = {
  attenuation: boolean;
  shadows: boolean;
  critical: boolean;
};

type RoomDims = {
  rt60Sec: number;
  width: number;
  height: number;
  depth: number;
  materialAlpha: number;
};

type AcousticEducationVizProps = {
  tracks: TrackLite[];
  roomScale: [number, number, number];
  listenerRef: RefObject<Object3D | null>;
  trackRefs: RefObject<Map<string, Object3D>>;
  tracksRef: MutableRefObject<TrackLite[]>;
  gainDbMapRef: MutableRefObject<Map<string, number>>;
  flagsRef: MutableRefObject<Flags>;
  roomRef: MutableRefObject<RoomDims>;
  obstacles: AcousticObstacle[];
  activeSourceTrackId: string | null;
  showAttenuation: boolean;
  showShadows: boolean;
  showCritical: boolean;
};

type ShadowRayLine = {
  id: string;
  color: string;
  points: [number, number, number][];
};

type DiffractionCandidate = {
  virtualSourceX: number;
  virtualSourceZ: number;
  gain: number;
  cutoffHz: number;
  totalDistance: number;
  blend: number;
  blockedByWall: boolean;
};

function normalizeAngle(rad: number) {
  let value = rad;
  while (value <= -Math.PI) value += Math.PI * 2;
  while (value > Math.PI) value -= Math.PI * 2;
  return value;
}

function lerpShortestAngle(a: number, b: number, t: number) {
  const delta = normalizeAngle(b - a);
  return normalizeAngle(a + delta * t);
}

function uniqueVerticesFromSegments(segments: { start: [number, number]; end: [number, number] }[]) {
  const vertices: [number, number][] = [];
  const eps = 1e-4;
  for (const segment of segments) {
    const points = [segment.start, segment.end] as const;
    for (const point of points) {
      const exists = vertices.some(
        (existing) =>
          Math.abs(existing[0] - point[0]) <= eps && Math.abs(existing[1] - point[1]) <= eps
      );
      if (!exists) vertices.push([point[0], point[1]]);
    }
  }
  return vertices;
}

function maxAngularSpreadPair(
  points: [number, number][],
  sx: number,
  sz: number
): [[number, number], [number, number]] | null {
  if (points.length < 2) return null;
  let bestPair: [[number, number], [number, number]] | null = null;
  let bestSpread = -1;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a1 = Math.atan2(points[i][1] - sz, points[i][0] - sx);
      const a2 = Math.atan2(points[j][1] - sz, points[j][0] - sx);
      const spread = Math.abs(normalizeAngle(a2 - a1));
      if (spread > bestSpread) {
        bestSpread = spread;
        bestPair = [points[i], points[j]];
      }
    }
  }
  return bestPair;
}

function cylinderTangentPair(
  sx: number,
  sz: number,
  cx: number,
  cz: number,
  radius: number
): [[number, number], [number, number]] | null {
  const dx = cx - sx;
  const dz = cz - sz;
  const dist = Math.hypot(dx, dz);
  if (dist <= 1e-6) return null;
  const baseAngle = Math.atan2(dz, dx);
  if (dist <= radius + 1e-6) {
    const p1: [number, number] = [
      cx + radius * Math.cos(baseAngle + Math.PI / 2),
      cz + radius * Math.sin(baseAngle + Math.PI / 2),
    ];
    const p2: [number, number] = [
      cx + radius * Math.cos(baseAngle - Math.PI / 2),
      cz + radius * Math.sin(baseAngle - Math.PI / 2),
    ];
    return [p1, p2];
  }
  const offset = Math.acos(Math.max(-1, Math.min(1, radius / dist)));
  const t1 = baseAngle + offset;
  const t2 = baseAngle - offset;
  const p1: [number, number] = [cx + radius * Math.cos(t1), cz + radius * Math.sin(t1)];
  const p2: [number, number] = [cx + radius * Math.cos(t2), cz + radius * Math.sin(t2)];
  return [p1, p2];
}

function perimeterTFromPoint(x: number, z: number, halfW: number, halfD: number) {
  const eps = 1e-4;
  if (Math.abs(z + halfD) <= eps) return x + halfW;
  if (Math.abs(x - halfW) <= eps) return 2 * halfW + (z + halfD);
  if (Math.abs(z - halfD) <= eps) return 2 * halfW + 2 * halfD + (halfW - x);
  return 4 * halfW + 2 * halfD + (halfD - z);
}

function pointFromPerimeterT(t: number, halfW: number, halfD: number): [number, number] {
  const perimeter = 4 * (halfW + halfD);
  let value = t % perimeter;
  if (value < 0) value += perimeter;
  const e1 = 2 * halfW;
  const e2 = e1 + 2 * halfD;
  const e3 = e2 + 2 * halfW;
  if (value <= e1) return [-halfW + value, -halfD];
  if (value <= e2) return [halfW, -halfD + (value - e1)];
  if (value <= e3) return [halfW - (value - e2), halfD];
  return [-halfW, halfD - (value - e3)];
}

function boundaryPathBetween(
  start: [number, number],
  end: [number, number],
  sx: number,
  sz: number,
  halfW: number,
  halfD: number
): [number, number][] {
  const perimeter = 4 * (halfW + halfD);
  const startT = perimeterTFromPoint(start[0], start[1], halfW, halfD);
  const endT = perimeterTFromPoint(end[0], end[1], halfW, halfD);
  const cw = (endT - startT + perimeter) % perimeter;
  const ccw = perimeter - cw;
  const buildPath = (direction: 1 | -1, travel: number) => {
    const samples = Math.max(2, Math.ceil(travel / 1.5));
    const points: [number, number][] = [];
    for (let i = 0; i <= samples; i++) {
      const t = startT + direction * (travel * (i / samples));
      points.push(pointFromPerimeterT(t, halfW, halfD));
    }
    return points;
  };
  const cwPath = buildPath(1, cw);
  const ccwPath = buildPath(-1, ccw);
  const scorePath = (path: [number, number][]) => {
    let minDistance = Number.POSITIVE_INFINITY;
    for (const [x, z] of path) {
      minDistance = Math.min(minDistance, Math.hypot(x - sx, z - sz));
    }
    return minDistance;
  };
  // Use the perimeter branch farther from the source so the cap closes
  // the shadow on the "away" side rather than around the source.
  return scorePath(cwPath) >= scorePath(ccwPath) ? cwPath : ccwPath;
}

function classifyWallWindowPath(
  sx: number,
  sz: number,
  lx: number,
  lz: number,
  geometry: NonNullable<ReturnType<typeof getWallWithWindowGeometry2D>>
) {
  const wallNormalX = -geometry.dirZ;
  const wallNormalZ = geometry.dirX;
  const sourceSignedDistance =
    (sx - geometry.centerX) * wallNormalX + (sz - geometry.centerZ) * wallNormalZ;
  const listenerSignedDistance =
    (lx - geometry.centerX) * wallNormalX + (lz - geometry.centerZ) * wallNormalZ;
  const oppositeSides = sourceSignedDistance * listenerSignedDistance < 0;
  if (!oppositeSides) {
    return { crosses: false, blockedStrength: 0, blocked: false };
  }
  const sideCrossStrength = smoothstep(
    0.02,
    0.35,
    Math.min(Math.abs(sourceSignedDistance), Math.abs(listenerSignedDistance))
  );
  const vX = lx - sx;
  const vZ = lz - sz;
  const rX = geometry.centerX - sx;
  const rZ = geometry.centerZ - sz;
  const den = vX * geometry.dirZ - vZ * geometry.dirX;
  const eps = 1e-6;
  if (Math.abs(den) <= eps) {
    return { crosses: false, blockedStrength: 0, blocked: false };
  }
  const u = (rX * geometry.dirZ - rZ * geometry.dirX) / den;
  const t = (rX * vZ - rZ * vX) / den;
  if (u <= eps || u >= 1 - eps) {
    return { crosses: false, blockedStrength: 0, blocked: false };
  }
  if (t < geometry.tMin - 1e-4 || t > geometry.tMax + 1e-4) {
    return { crosses: false, blockedStrength: 0, blocked: false };
  }
  const distanceToEdge = Math.min(
    Math.abs(t - geometry.tGapStart),
    Math.abs(t - geometry.tGapEnd)
  );
  const blocked = t < geometry.tGapStart || t > geometry.tGapEnd;
  if (blocked) {
    const blockedStrength = smoothstep(0.02, 0.45, distanceToEdge) * sideCrossStrength;
    return { crosses: true, blockedStrength, blocked: blockedStrength > 0.02 };
  }
  // Through the opening: allow a small edge blend for continuity,
  // but mostly keep direct path behavior when centered in the window.
  const edgeBlend = (1 - smoothstep(0.03, 0.28, distanceToEdge)) * sideCrossStrength;
  return { crosses: true, blockedStrength: edgeBlend * 0.3, blocked: false };
}

function AttenuationRings({
  trackId,
  trackRefs,
  gainDbMapRef,
  flagsRef,
  roomRef,
}: {
  trackId: string;
  trackRefs: RefObject<Map<string, Object3D>>;
  gainDbMapRef: MutableRefObject<Map<string, number>>;
  flagsRef: MutableRefObject<Flags>;
  roomRef: MutableRefObject<RoomDims>;
}) {
  const groupRef = useRef<Group>(null);
  const ringScaleRefs = useRef<(Group | null)[]>([null, null, null, null, null]);
  const ringLineRefs = useRef<({ material?: { opacity?: number } } | null)[]>([
    null,
    null,
    null,
    null,
    null,
  ]);
  const unitRings = useMemo(
    () => [0, 1, 2, 3, 4].map(() => ringPointsXZ(1, 64)),
    []
  );

  useFrame(() => {
    const g = groupRef.current;
    const obj = trackRefs.current?.get(trackId);
    if (!g || !obj) return;
    obj.getWorldPosition(tempWorld);
    g.position.set(tempWorld.x, FLOOR_Y, tempWorld.z);

    const flags = flagsRef.current;
    g.visible = flags.attenuation;
    if (!flags.attenuation) return;

    const gainDb = gainDbMapRef.current.get(trackId) ?? -Infinity;
    const gainMultiplier = gainDbToLinear(gainDb);
    if (gainMultiplier <= GAIN_EPSILON) {
      g.visible = false;
      return;
    }

    const { width, depth } = roomRef.current;
    const halfW = width / 2;
    const halfD = depth / 2;
    const maxRadius = Math.max(
      0,
      Math.min(
        halfW - Math.abs(tempWorld.x),
        halfD - Math.abs(tempWorld.z)
      )
    );

    // r_n = (baseDistance * 2^n) * currentGainValue
    for (let k = 0; k < 5; k++) {
      const r = R0 * Math.pow(2, k) * gainMultiplier;
      const ringG = ringScaleRefs.current[k];
      const visibleRadius = Math.min(r, maxRadius);
      if (ringG) {
        ringG.visible = visibleRadius > GAIN_EPSILON;
        ringG.scale.setScalar(Math.max(visibleRadius, GAIN_EPSILON));
      }
      const line = ringLineRefs.current[k];
      if (line?.material) {
        const fadeByBoundary = r > GAIN_EPSILON ? visibleRadius / r : 0;
        const baseOpacity = Math.pow(0.5, k);
        line.material.opacity = baseOpacity * fadeByBoundary;
      }
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      {[0, 1, 2, 3, 4].map((k) => (
        <group key={k} ref={(el) => { ringScaleRefs.current[k] = el; }}>
          <Line
            ref={(el) => {
              ringLineRefs.current[k] = el as unknown as { material?: { opacity?: number } };
            }}
            points={unitRings[k]}
            color={INK}
            lineWidth={1.2}
            dashed
            dashSize={0.09}
            gapSize={0.07}
            transparent
            opacity={Math.pow(0.5, k)}
            depthWrite={false}
          />
        </group>
      ))}
    </group>
  );
}

function CriticalDistanceRing({
  trackId,
  trackRefs,
  flagsRef,
  roomRef,
  fontUrl,
}: {
  trackId: string;
  trackRefs: RefObject<Map<string, Object3D>>;
  flagsRef: MutableRefObject<Flags>;
  roomRef: MutableRefObject<RoomDims>;
  fontUrl?: string;
}) {
  const groupRef = useRef<Group>(null);
  const ringScaleRef = useRef<Group>(null);
  const [label, setLabel] = useState("Critical Distance: —");
  const lastDcTick = useRef(-1);

  const circle = useMemo(() => ringPointsXZ(1, 80), []);

  useFrame(() => {
    const g = groupRef.current;
    const obj = trackRefs.current?.get(trackId);
    if (!g || !obj) return;
    obj.getWorldPosition(tempWorld);
    g.position.set(tempWorld.x, FLOOR_Y, tempWorld.z);

    const flags = flagsRef.current;
    g.visible = flags.critical;
    if (!flags.critical) return;

    const { width, height, depth, rt60Sec } = roomRef.current;
    const V = width * height * depth;
    const T60 = Math.max(0.08, rt60Sec);
    const Q = DIRECTIVITY_Q;
    let dc = 0.057 * Math.sqrt(V / (T60 * Q));
    const span = Math.max(width, depth);
    dc = Math.min(dc, span * 0.42);
    dc = Math.max(0.15, dc);

    ringScaleRef.current?.scale.setScalar(dc);

    const tick = Math.round(dc * 20);
    if (tick !== lastDcTick.current) {
      lastDcTick.current = tick;
      setLabel(`Critical Distance: ${dc.toFixed(1)}m`);
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      <group ref={ringScaleRef} scale={1}>
        <Line
          points={circle}
          color={INK}
          lineWidth={2.2}
          dashed
          dashSize={0.12}
          gapSize={0.08}
          transparent
          opacity={0.9}
          depthWrite={false}
        />
      </group>
      <Billboard position={[0, 0.35, 0]}>
        <Text
          fontSize={0.22}
          color={INK}
          anchorX="center"
          anchorY="middle"
          font={fontUrl}
          outlineWidth={0}
        >
          {label}
        </Text>
      </Billboard>
    </group>
  );
}

function ReflectionRays({
  trackId,
  listenerRef,
  trackRefs,
  roomRef,
  isDirectivityEnabled,
  rotationDeg,
}: {
  trackId: string;
  listenerRef: RefObject<Object3D | null>;
  trackRefs: RefObject<Map<string, Object3D>>;
  roomRef: MutableRefObject<RoomDims>;
  isDirectivityEnabled: boolean;
  rotationDeg: number;
}) {
  const groupRef = useRef<Group>(null);
  const [bouncePoints, setBouncePoints] = useState<[number, number, number][]>([
    [0, FLOOR_Y + 0.02, 0],
    [0.01, FLOOR_Y + 0.02, 0.01],
    [0.02, FLOOR_Y + 0.02, 0.02],
  ]);
  const [reflectionPoints, setReflectionPoints] = useState<[number, number, number][]>([
    [0.02, FLOOR_Y + 0.02, 0.02],
    [0.03, FLOOR_Y + 0.02, 0.03],
  ]);
  const [forwardHighlight, setForwardHighlight] = useState(false);
  const [reflectionOpacity, setReflectionOpacity] = useState(0.1);
  const lastKey = useRef("");
  const lastUpdateMs = useRef(0);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    g.visible = isDirectivityEnabled;
    if (!isDirectivityEnabled) return;

    const sourceObj = trackRefs.current?.get(trackId);
    const listenerObj = listenerRef.current;
    if (!sourceObj || !listenerObj) return;

    sourceObj.getWorldPosition(tempWorld);
    listenerObj.getWorldPosition(tempListener);

    const sx = tempWorld.x;
    const sz = tempWorld.z;
    const lx = tempListener.x;
    const lz = tempListener.z;
    const now = performance.now();
    if (now - lastUpdateMs.current < 80) return;

    const { width, depth } = roomRef.current;
    const halfW = width / 2;
    const halfD = depth / 2;
    const key = `${(Math.round(sx * 5) / 5).toFixed(2)}_${(Math.round(sz * 5) / 5).toFixed(2)}_${(Math.round(lx * 5) / 5).toFixed(2)}_${(Math.round(lz * 5) / 5).toFixed(2)}_${Math.round(rotationDeg)}_${width.toFixed(2)}_${depth.toFixed(2)}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    lastUpdateMs.current = now;

    const { dir, tipX, tipZ } = getDirectivityRayAnchors(
      sx,
      sz,
      rotationDeg
    );
    const hit = firstWallHit(tipX, tipZ, dir.x, dir.z, halfW, halfD);
    if (!hit) return;

    const listenerDistanceFromForward = distancePointToSegment2D(
      lx,
      lz,
      tipX,
      tipZ,
      hit.hx,
      hit.hz
    );
    const listenerForwardDot =
      (lx - tipX) * dir.x + (lz - tipZ) * dir.z;
    const listenerOnForwardPath =
      listenerForwardDot > 0 && listenerDistanceFromForward <= 0.35;

    const reflected = reflectVector(dir.x, dir.z, hit.nx, hit.nz);
    const reflectionLen = Math.max(width, depth) * 0.6;
    const reflectionEndX = hit.hx + reflected.x * reflectionLen;
    const reflectionEndZ = hit.hz + reflected.z * reflectionLen;
    const listenerDistanceFromReflection = distancePointToSegment2D(
      lx,
      lz,
      hit.hx,
      hit.hz,
      reflectionEndX,
      reflectionEndZ
    );
    const listenerReflectDot =
      (lx - hit.hx) * reflected.x + (lz - hit.hz) * reflected.z;
    const canReachListener =
      listenerReflectDot > 0 && listenerDistanceFromReflection <= 0.35;

    setBouncePoints([
      [tipX, FLOOR_Y + 0.02, tipZ],
      [hit.hx, FLOOR_Y + 0.02, hit.hz],
    ]);
    setReflectionPoints([
      [hit.hx, FLOOR_Y + 0.02, hit.hz],
      [lx, FLOOR_Y + 0.02, lz],
    ]);
    setForwardHighlight(listenerOnForwardPath);
    setReflectionOpacity(canReachListener ? 0.75 : 0.1);
  });

  return (
    <group ref={groupRef} visible={false}>
      <Line
        points={bouncePoints}
        color={INK}
        lineWidth={2.2}
        transparent
        opacity={forwardHighlight ? 0.95 : 0.2}
        depthWrite={false}
      />
      <Line
        points={reflectionPoints}
        color={INK}
        lineWidth={1.2}
        dashed
        dashSize={0.12}
        gapSize={0.09}
        transparent
        opacity={reflectionOpacity}
        depthWrite={false}
      />
    </group>
  );
}

export function AcousticEducationViz({
  tracks,
  roomScale,
  listenerRef,
  trackRefs,
  tracksRef,
  gainDbMapRef,
  flagsRef,
  roomRef,
  obstacles,
  activeSourceTrackId,
  showAttenuation,
  showShadows,
  showCritical,
}: AcousticEducationVizProps) {
  const fontUrl = useItimFontUrl();
  const frameOccluderCountByTrackRef = useRef<Map<string, number>>(new Map());
  const [shadowRayLines, setShadowRayLines] = useState<ShadowRayLine[]>([]);
  const shadowRayKeyRef = useRef("");
  const diffractionPositionRef = useRef<Map<string, { x: number; y: number; z: number }>>(new Map());

  useFrame(() => {
    const flags = flagsRef.current;
    const listener = listenerRef.current;
    if (!listener) return;
    listener.getWorldPosition(tempListener);
    const materialAlpha = roomRef.current.materialAlpha;
    const roomWidth = roomScale[0] * 10;
    const fallbackTrackId =
      tracksRef.current.find((track) => track.showShadows)?.id ?? tracksRef.current[0]?.id ?? null;
    const activeTrackId = activeSourceTrackId ?? fallbackTrackId;
    const frameOccluderCounts = frameOccluderCountByTrackRef.current;
    frameOccluderCounts.clear();

    for (const t of tracksRef.current) {
      const obj = trackRefs.current?.get(t.id);
      if (!obj) {
        setTrackDiffractionOverride(t.id, null);
        continue;
      }
      obj.getWorldPosition(tempWorld);
      const sx = tempWorld.x;
      const sz = tempWorld.z;
      const segX = tempListener.x - sx;
      const segZ = tempListener.z - sz;
      const segLenSq = segX * segX + segZ * segZ;
      if (segLenSq <= 1e-6) {
        setTrackDiffractionOverride(t.id, null);
        diffractionPositionRef.current.delete(t.id);
        setTrackDynamicAcoustics(t.id, 20000, 1);
        if (flags.shadows) {
          updateTrackShadowOcclusion(t.id, 1, materialAlpha, false, 20000, 0, 0);
        }
        continue;
      }

      let lineBlocked = false;
      let minIntersectClarity = 1;
      let cutoffHz = 20000;
      let maxPenetration = 0;
      let blockingObstacleCount = 0;
      let bestDiffraction: DiffractionCandidate | null = null;
      const targetDx = tempListener.x - sx;
      const targetDz = tempListener.z - sz;
      const targetLen = Math.hypot(targetDx, targetDz);
      const rad = (t.rotationDeg * Math.PI) / 180;
      const forwardX = Math.sin(rad);
      const forwardZ = -Math.cos(rad);
      const targetDirX = targetLen > 1e-5 ? targetDx / targetLen : forwardX;
      const targetDirZ = targetLen > 1e-5 ? targetDz / targetLen : forwardZ;
      const dot = Math.max(-1, Math.min(1, forwardX * targetDirX + forwardZ * targetDirZ));
      const alpha = t.isDirectivityEnabled ? Math.acos(dot) : 0;
      const directivityFilterMultiplier = t.isDirectivityEnabled
        ? 1 - 0.5 * (alpha / Math.PI)
        : 1;
      const directivityGainMultiplier = t.isDirectivityEnabled
        ? 1 - 0.35 * (alpha / Math.PI)
        : 1;

      for (const obstacle of obstacles) {
        const ox = obstacle.position[0];
        const oz = obstacle.position[2];
        const radius = obstacle.radius || OBSTACLE_RADIUS;
        let penetration = 0;
        let diffractionForObstacle: DiffractionCandidate | null = null;
        let intersectsObstacle = false;

        if (obstacle.type === "wall-with-window") {
          const wallGeometry = getWallWithWindowGeometry2D(
            obstacle,
            roomWidth,
            roomScale[2] * 10
          );
          if (wallGeometry) {
            const wallPath = classifyWallWindowPath(
              sx,
              sz,
              tempListener.x,
              tempListener.z,
              wallGeometry
            );
            intersectsObstacle = wallPath.crosses;
            if (!intersectsObstacle) continue;
            penetration = wallPath.blockedStrength * 0.85;
            if (wallPath.blocked && wallPath.blockedStrength > 0.08) {
              lineBlocked = true;
            }
            if (wallPath.blockedStrength > 0.02) {
              blockingObstacleCount += 1;
            }
            const windowCenterX = wallGeometry.centerX + wallGeometry.tWindowCenter * wallGeometry.dirX;
            const windowCenterZ = wallGeometry.centerZ + wallGeometry.tWindowCenter * wallGeometry.dirZ;
            const distanceSourceToWindow = Math.hypot(windowCenterX - sx, windowCenterZ - sz);
            const distanceWindowToListener = Math.hypot(
              tempListener.x - windowCenterX,
              tempListener.z - windowCenterZ
            );
            if (distanceSourceToWindow > 1e-5 && distanceWindowToListener > 1e-5) {
              const directDistance = Math.hypot(tempListener.x - sx, tempListener.z - sz);
              const pathDifference = Math.max(
                0,
                distanceSourceToWindow + distanceWindowToListener - directDistance
              );
              const totalAcousticDistance = distanceSourceToWindow + distanceWindowToListener;
              const dirX = (windowCenterX - tempListener.x) / distanceWindowToListener;
              const dirZ = (windowCenterZ - tempListener.z) / distanceWindowToListener;
              const virtualSourceX = tempListener.x + dirX * totalAcousticDistance;
              const virtualSourceZ = tempListener.z + dirZ * totalAcousticDistance;
              const wallNormalX = -wallGeometry.dirZ;
              const wallNormalZ = wallGeometry.dirX;
              const rayX = (tempListener.x - windowCenterX) / distanceWindowToListener;
              const rayZ = (tempListener.z - windowCenterZ) / distanceWindowToListener;
              const cosTheta = Math.abs(rayX * wallNormalX + rayZ * wallNormalZ);
              const diffractionGain = Math.max(
                0.02,
                cosTheta * Math.exp(-pathDifference * 0.4)
              );
              const diffractionCutoff = 20000 * Math.max(0.04, cosTheta * Math.exp(-pathDifference * 0.2));
              const blend = Math.max(0, Math.min(1, wallPath.blockedStrength));
              const blendedVirtualSourceX = sx + (virtualSourceX - sx) * blend;
              const blendedVirtualSourceZ = sz + (virtualSourceZ - sz) * blend;
              diffractionForObstacle = {
                virtualSourceX: blendedVirtualSourceX,
                virtualSourceZ: blendedVirtualSourceZ,
                totalDistance: totalAcousticDistance,
                gain: 1 - (1 - diffractionGain) * blend,
                cutoffHz: 20000 - (20000 - diffractionCutoff) * blend,
                blend,
                blockedByWall: wallPath.blocked,
              };
            }
          }
        } else {
          const segments = getObstacleSegments2D(obstacle, roomWidth, roomScale[2] * 10);
          if (segments.length === 0) continue;
          for (const segment of segments) {
            const hit = intersectSegment2D(
              sx,
              sz,
              tempListener.x,
              tempListener.z,
              segment.start[0],
              segment.start[1],
              segment.end[0],
              segment.end[1]
            );
            if (!hit) continue;
            intersectsObstacle = true;
            break;
          }
          if (!intersectsObstacle) continue;
          lineBlocked = true;
          blockingObstacleCount += 1;
          const obsX = ox - sx;
          const obsZ = oz - sz;
          const tSeg = Math.max(0, Math.min(1, (obsX * segX + obsZ * segZ) / segLenSq));
          const closestX = sx + segX * tSeg;
          const closestZ = sz + segZ * tSeg;
          const dist = Math.hypot(ox - closestX, oz - closestZ);
          if (obstacle.type === "box") {
            const width = obstacle.width ?? 1;
            const depth = obstacle.depth ?? 1;
            const effectiveRadius = Math.max(0.001, (width + depth) / 4);
            penetration = Math.max(0, Math.min(1, (effectiveRadius - dist) / effectiveRadius));
          } else {
            penetration = Math.max(0, Math.min(1, (radius - dist) / Math.max(0.001, radius)));
          }
        }
        if (!intersectsObstacle) continue;
        const clarity = computeObstacleShadowClarity(
          sx,
          sz,
          tempListener.x,
          tempListener.z,
          ox,
          oz,
          radius
        );
        minIntersectClarity = Math.min(minIntersectClarity, clarity);
        maxPenetration = Math.max(maxPenetration, penetration);
        cutoffHz *= Math.max(0.05, 1 - 0.45 * penetration);
        if (diffractionForObstacle && diffractionForObstacle.blend > 0.01) {
          if (
            !bestDiffraction ||
            diffractionForObstacle.gain > bestDiffraction.gain ||
            (Math.abs(diffractionForObstacle.gain - bestDiffraction.gain) < 1e-4 &&
              diffractionForObstacle.totalDistance < bestDiffraction.totalDistance)
          ) {
            bestDiffraction = diffractionForObstacle;
          }
        }
      }

      const totalLossMagnitudeDb =
        blockingObstacleCount > 0 ? Math.min(MAX_OCCLUSION_DB, maxPenetration * MAX_OCCLUSION_DB) : 0;
      const totalLossDb = -totalLossMagnitudeDb;

      const clarityFromLoss =
        blockingObstacleCount > 0 ? Math.pow(10, totalLossDb / 20) : 1;
      const combinedClarity = Math.max(
        0,
        Math.min(1, Math.min(minIntersectClarity, clarityFromLoss))
      );
      const targetCutoffHz = Math.max(250, cutoffHz);
      let finalAudioCutoff = Math.max(
        250,
        Math.min(20000, targetCutoffHz * directivityFilterMultiplier)
      );
      const targetGain = Math.pow(10, totalLossDb / 20);
      let finalAudioGain = Math.max(
        0.03,
        Math.min(1.2, targetGain * directivityGainMultiplier)
      );
      if (bestDiffraction) {
        finalAudioGain = Math.max(
          0.03,
          Math.min(1.2, bestDiffraction.gain * directivityGainMultiplier)
        );
        finalAudioCutoff = Math.max(
          250,
          Math.min(20000, bestDiffraction.cutoffHz * directivityFilterMultiplier)
        );
        const current = diffractionPositionRef.current.get(t.id) ?? {
          x: sx,
          y: tempWorld.y,
          z: sz,
        };
        const blend = 0.22;
        const next = {
          x: current.x + (bestDiffraction.virtualSourceX - current.x) * blend,
          y: current.y + (tempWorld.y - current.y) * blend,
          z: current.z + (bestDiffraction.virtualSourceZ - current.z) * blend,
        };
        diffractionPositionRef.current.set(t.id, next);
        setTrackDiffractionOverride(t.id, next);
      } else {
        const current = diffractionPositionRef.current.get(t.id);
        if (!current) {
          setTrackDiffractionOverride(t.id, null);
        } else {
          const blendOut = 0.18;
          const next = {
            x: current.x + (sx - current.x) * blendOut,
            y: current.y + (tempWorld.y - current.y) * blendOut,
            z: current.z + (sz - current.z) * blendOut,
          };
          if (Math.hypot(next.x - sx, next.z - sz) <= 0.03) {
            diffractionPositionRef.current.delete(t.id);
            setTrackDiffractionOverride(t.id, null);
          } else {
            diffractionPositionRef.current.set(t.id, next);
            setTrackDiffractionOverride(t.id, next);
          }
        }
      }
      frameOccluderCounts.set(t.id, blockingObstacleCount);
      setTrackDynamicAcoustics(t.id, finalAudioCutoff, finalAudioGain);

      if (flags.shadows) {
        const uiOccluderCount = t.id === activeTrackId ? blockingObstacleCount : 0;
        const bypassBinaryShadow = Boolean(bestDiffraction?.blockedByWall);
        updateTrackShadowOcclusion(
          t.id,
          bypassBinaryShadow ? 1 : combinedClarity,
          materialAlpha,
          bypassBinaryShadow ? false : lineBlocked,
          bypassBinaryShadow ? 20000 : targetCutoffHz,
          bypassBinaryShadow ? 0 : Math.abs(totalLossDb),
          uiOccluderCount
        );
      }
    }

    if (!flags.shadows || !showShadows || obstacles.length === 0) {
      if (shadowRayKeyRef.current !== "") {
        shadowRayKeyRef.current = "";
        setShadowRayLines([]);
      }
      return;
    }

    const shadowSourceTrackIds = tracksRef.current
      .filter((track) => track.showShadows)
      .map((track) => track.id);
    if (shadowSourceTrackIds.length === 0) {
      if (shadowRayKeyRef.current !== "") {
        shadowRayKeyRef.current = "";
        setShadowRayLines([]);
      }
      return;
    }

    const roomDepth = roomScale[2] * 10;
    const halfW = roomWidth * 0.5;
    const halfD = roomDepth * 0.5;
    const lineY = FLOOR_Y + 0.02;
    const lines: ShadowRayLine[] = [];
    const hatchCount = 4;

    for (const sourceTrackId of shadowSourceTrackIds) {
      const sourceObject = trackRefs.current?.get(sourceTrackId);
      if (!sourceObject) continue;
      sourceObject.getWorldPosition(tempWorld);
      const sx = tempWorld.x;
      const sz = tempWorld.z;

      const pushShadowCone = (
        obstacleId: string,
        obstacleColor: string,
        coneId: string,
        pair: [[number, number], [number, number]]
      ) => {
        const [p1, p2] = pair;
        const projected1 = projectRayToRoomBoundary(sx, sz, p1[0], p1[1], halfW, halfD);
        const projected2 = projectRayToRoomBoundary(sx, sz, p2[0], p2[1], halfW, halfD);
        if (!projected1 || !projected2) return;
        lines.push({
          id: `${sourceTrackId}-${obstacleId}-${coneId}-boundary-left-${lines.length}`,
          color: obstacleColor,
          points: [
            [p1[0], lineY, p1[1]],
            [projected1[0], lineY, projected1[1]],
          ],
        });
        lines.push({
          id: `${sourceTrackId}-${obstacleId}-${coneId}-boundary-right-${lines.length}`,
          color: obstacleColor,
          points: [
            [p2[0], lineY, p2[1]],
            [projected2[0], lineY, projected2[1]],
          ],
        });

        const capPoints = boundaryPathBetween(projected1, projected2, sx, sz, halfW, halfD).map(
          ([x, z]) => [x, lineY, z] as [number, number, number]
        );
        if (capPoints.length >= 2) {
          lines.push({
            id: `${sourceTrackId}-${obstacleId}-${coneId}-cap-${lines.length}`,
            color: obstacleColor,
            points: capPoints,
          });
        }

        const angle1 = Math.atan2(p1[1] - sz, p1[0] - sx);
        const angle2 = Math.atan2(p2[1] - sz, p2[0] - sx);
        for (let hatch = 1; hatch <= hatchCount; hatch++) {
          const t = hatch / (hatchCount + 1);
          const hatchAngle = lerpShortestAngle(angle1, angle2, t);
          const rayTargetX = sx + Math.cos(hatchAngle);
          const rayTargetZ = sz + Math.sin(hatchAngle);
          const hatchFar = projectRayToRoomBoundary(sx, sz, rayTargetX, rayTargetZ, halfW, halfD);
          if (!hatchFar) continue;
          const hatchNearX = p1[0] + (p2[0] - p1[0]) * t;
          const hatchNearZ = p1[1] + (p2[1] - p1[1]) * t;
          lines.push({
            id: `${sourceTrackId}-${obstacleId}-${coneId}-hatch-${hatch}-${lines.length}`,
            color: obstacleColor,
            points: [
              [hatchNearX, lineY, hatchNearZ],
              [hatchFar[0], lineY, hatchFar[1]],
            ],
          });
        }
      };

      for (const obstacle of obstacles) {
        if (obstacle.type === "cylinder") {
          const pair = cylinderTangentPair(
            sx,
            sz,
            obstacle.position[0],
            obstacle.position[2],
            obstacle.radius
          );
          if (!pair) continue;
          pushShadowCone(obstacle.id, obstacle.color, "cone", pair);
          continue;
        }

        if (obstacle.type === "wall-with-window") {
          const wallSegments = getObstacleSegments2D(obstacle, roomWidth, roomDepth);
          for (let index = 0; index < wallSegments.length; index++) {
            const segment = wallSegments[index];
            pushShadowCone(obstacle.id, obstacle.color, `wall-segment-${index}`, [
              [segment.start[0], segment.start[1]],
              [segment.end[0], segment.end[1]],
            ]);
          }
          continue;
        }

        const segments = getObstacleSegments2D(obstacle, roomWidth, roomDepth);
        const vertices = uniqueVerticesFromSegments(segments);
        const pair = maxAngularSpreadPair(vertices, sx, sz);
        if (!pair) continue;
        pushShadowCone(obstacle.id, obstacle.color, "cone", pair);
      }
    }

    const nextKey = JSON.stringify(
      lines.map((line) =>
        line.points.map(([x, y, z]) => [x.toFixed(3), y.toFixed(3), z.toFixed(3)])
      )
    );
    if (nextKey !== shadowRayKeyRef.current) {
      shadowRayKeyRef.current = nextKey;
      setShadowRayLines(lines);
    }
  });

  return (
    <group>
      {showShadows
        ? shadowRayLines.map((line) => (
            <Line
              key={line.id}
              points={line.points}
              color={line.color}
              lineWidth={1.2}
              dashed
              dashSize={0.2}
              gapSize={0.15}
              transparent
              opacity={0.4}
              depthWrite={false}
            />
          ))
        : null}
      {tracks.map((t) => (
        <group key={t.id}>
          {showAttenuation ? (
            <AttenuationRings
              trackId={t.id}
              trackRefs={trackRefs}
              gainDbMapRef={gainDbMapRef}
              flagsRef={flagsRef}
              roomRef={roomRef}
            />
          ) : null}
          {showCritical ? (
            <CriticalDistanceRing
              trackId={t.id}
              trackRefs={trackRefs}
              flagsRef={flagsRef}
              roomRef={roomRef}
              fontUrl={fontUrl}
            />
          ) : null}
          <ReflectionRays
            trackId={t.id}
            listenerRef={listenerRef}
            trackRefs={trackRefs}
            roomRef={roomRef}
            isDirectivityEnabled={t.isDirectivityEnabled}
            rotationDeg={t.rotationDeg}
          />
        </group>
      ))}
    </group>
  );
}
