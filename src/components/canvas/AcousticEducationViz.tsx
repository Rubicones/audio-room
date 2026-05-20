"use client";

import { Billboard, Line, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import { Group, Object3D, Vector3 } from "three";
import { setTrackDynamicAcoustics, updateTrackShadowOcclusion } from "./audioEngine";
import {
  OBSTACLE_RADIUS,
} from "./obstacleConstants";
import { MATERIAL_REGISTRY, type AcousticColumn } from "./types";
import { useItimFontUrl } from "./sketch";
import { getDirectivityRayAnchors } from "./directivity";

const INK = "#1a1a1a";
const FLOOR_Y = 0.012;
const R0 = 1;
const DIRECTIVITY_Q = 1;
const GAIN_EPSILON = 1e-4;

const tempWorld = new Vector3();
const tempListener = new Vector3();
const PENUMBRA_BASE = 0.22;

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


function buildConeHatchSegmentPoints(
  sx: number,
  sy: number,
  sz: number,
  halfW: number,
  halfD: number,
  column: AcousticColumn
): [number, number, number][] {
  const out: [number, number, number][] = [];
  const ox = column.position[0];
  const oz = column.position[2];
  const dx = ox - sx;
  const dz = oz - sz;
  const dist2D = Math.hypot(dx, dz);
  if (dist2D <= 1e-4) {
    out.push([-0.01, FLOOR_Y, -0.01], [0.01, FLOOR_Y, 0.01]);
    return out;
  }
  const dirX = dx / dist2D;
  const dirZ = dz / dist2D;
  const perpX = -dirZ;
  const perpZ = dirX;

  const sourceY = Math.max(0.25, Math.abs(sy));
  const startX = ox + dirX * (column.radius + 0.02);
  const startZ = oz + dirZ * (column.radius + 0.02);
  const coneSlope = column.radius / Math.max(dist2D, column.radius * 1.2);
  const perspectiveLen = (column.height * dist2D) / sourceY;
  const hit = firstWallHit(startX, startZ, dirX, dirZ, halfW, halfD);
  const wallLen = hit
    ? Math.hypot(hit.hx - startX, hit.hz - startZ)
    : Math.max(1, Math.hypot(halfW * 2, halfD * 2) * 1.8);
  // Keep the hatch stretching to room bounds so the shadow never clips in the play zone.
  const projectedLen = Math.max(perspectiveLen, wallLen + 0.35);

  const clampX = (x: number) => Math.max(-halfW, Math.min(halfW, x));
  const clampZ = (z: number) => Math.max(-halfD, Math.min(halfD, z));
  const push = (ax: number, az: number, bx: number, bz: number) => {
    out.push([clampX(ax), FLOOR_Y, clampZ(az)], [clampX(bx), FLOOR_Y, clampZ(bz)]);
  };

  const stepAlong = 0.26;
  for (let along = 0; along <= projectedLen; along += stepAlong) {
    const halfWidth = column.radius + along * coneSlope;
    const stepAcross = Math.max(0.13, halfWidth * 0.24);
    for (let across = -halfWidth + 0.05; across <= halfWidth - 0.05; across += stepAcross) {
      const bx = startX + dirX * along + perpX * across;
      const bz = startZ + dirZ * along + perpZ * across;
      const segLen = 0.14 + halfWidth * 0.16;
      const tx = bx + dirX * segLen + perpX * 0.07;
      const tz = bz + dirZ * segLen + perpZ * 0.07;
      push(bx, bz, tx, tz);
      if (out.length >= 900) return out;
    }
  }

  if (out.length < 2) {
    out.push([-0.01, FLOOR_Y, -0.01], [0.01, FLOOR_Y, 0.01]);
  }
  return out;
}

function darkenHex(hex: string, factor = 0.9) {
  const normalized = hex.trim().replace(/^#/, "");
  const short = /^[0-9a-fA-F]{3}$/;
  const long = /^[0-9a-fA-F]{6}$/;
  if (!short.test(normalized) && !long.test(normalized)) return "#1a1a1a";
  const full = short.test(normalized)
    ? normalized
        .split("")
        .map((ch) => ch + ch)
        .join("")
    : normalized;
  const rBase = Number.parseInt(full.slice(0, 2), 16);
  const gBase = Number.parseInt(full.slice(2, 4), 16);
  const bBase = Number.parseInt(full.slice(4, 6), 16);
  const r = Math.max(0, Math.min(255, Math.round(rBase * factor)));
  const g = Math.max(0, Math.min(255, Math.round(gBase * factor)));
  const b = Math.max(0, Math.min(255, Math.round(bBase * factor)));
  return `#${r.toString(16).padStart(2, "0")}${g
    .toString(16)
    .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

type TrackLite = {
  id: string;
  gainDb: number;
  isDirectivityEnabled: boolean;
  rotationDeg: number;
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
  listenerRef: RefObject<Object3D | null>;
  trackRefs: RefObject<Map<string, Object3D>>;
  tracksRef: MutableRefObject<TrackLite[]>;
  gainDbMapRef: MutableRefObject<Map<string, number>>;
  flagsRef: MutableRefObject<Flags>;
  roomRef: MutableRefObject<RoomDims>;
  columns: AcousticColumn[];
  activeSourceTrackId: string | null;
  showAttenuation: boolean;
  showShadows: boolean;
  showCritical: boolean;
};

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

function ShadowHatch({
  sourceTrackId,
  fallbackTrackId,
  column,
  trackRefs,
  flagsRef,
  roomRef,
}: {
  sourceTrackId: string | null;
  fallbackTrackId: string | null;
  column: AcousticColumn;
  trackRefs: RefObject<Map<string, Object3D>>;
  flagsRef: MutableRefObject<Flags>;
  roomRef: MutableRefObject<RoomDims>;
}) {
  const groupRef = useRef<Group>(null);
  const [points, setPoints] = useState<[number, number, number][]>([
    [0, FLOOR_Y, 0],
    [0.01, FLOOR_Y, 0.01],
  ]);
  const [hatchOpacity, setHatchOpacity] = useState(0.7);
  const lastKey = useRef("");
  const lastUpdateMs = useRef(0);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    g.visible = flagsRef.current.shadows;
    if (!flagsRef.current.shadows) return;

    const trackId = sourceTrackId ?? fallbackTrackId;
    if (!trackId) return;
    const obj = trackRefs.current?.get(trackId);
    if (!obj) return;

    obj.getWorldPosition(tempWorld);
    const sx = tempWorld.x;
    const sy = tempWorld.y;
    const sz = tempWorld.z;
    const { width, depth } = roomRef.current;
    const halfW = width / 2;
    const halfD = depth / 2;
    const ox = column.position[0];
    const oz = column.position[2];

    const now = performance.now();
    if (now - lastUpdateMs.current < 120) return;

    const key = `${trackId}_${(Math.round(sx * 5) / 5).toFixed(2)}_${(Math.round(sy * 5) / 5).toFixed(2)}_${(Math.round(sz * 5) / 5).toFixed(2)}_${(Math.round(ox * 5) / 5).toFixed(2)}_${(Math.round(oz * 5) / 5).toFixed(2)}_${halfW.toFixed(1)}_${halfD.toFixed(1)}_${roomRef.current.materialAlpha.toFixed(2)}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    lastUpdateMs.current = now;
    const nextOpacity = Math.min(1, Math.max(0.08, 1 - roomRef.current.materialAlpha));
    setHatchOpacity((current) =>
      Math.abs(current - nextOpacity) > 0.02 ? nextOpacity : current
    );

    setPoints(
      buildConeHatchSegmentPoints(
        sx,
        sy,
        sz,
        halfW,
        halfD,
        column
      )
    );
  });

  return (
    <group ref={groupRef} visible={false}>
      <Line
        segments
        points={points}
        color={darkenHex(column.color)}
        lineWidth={1}
        dashed
        dashSize={0.12}
        gapSize={0.09}
        transparent
        opacity={hatchOpacity * 0.5}
        depthWrite={false}
      />
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
  listenerRef,
  trackRefs,
  tracksRef,
  gainDbMapRef,
  flagsRef,
  roomRef,
  columns,
  activeSourceTrackId,
  showAttenuation,
  showShadows,
  showCritical,
}: AcousticEducationVizProps) {
  const fontUrl = useItimFontUrl();
  const frameOccluderCountByTrackRef = useRef<Map<string, number>>(new Map());

  useFrame(() => {
    const flags = flagsRef.current;
    const listener = listenerRef.current;
    if (!listener) return;
    listener.getWorldPosition(tempListener);
    const materialAlpha = roomRef.current.materialAlpha;
    const fallbackTrackId = tracksRef.current[0]?.id ?? null;
    const activeTrackId = activeSourceTrackId ?? fallbackTrackId;
    const frameOccluderCounts = frameOccluderCountByTrackRef.current;
    frameOccluderCounts.clear();

    for (const t of tracksRef.current) {
      const obj = trackRefs.current?.get(t.id);
      if (!obj) continue;
      obj.getWorldPosition(tempWorld);
      const sx = tempWorld.x;
      const sz = tempWorld.z;
      const segX = tempListener.x - sx;
      const segZ = tempListener.z - sz;
      const segLenSq = segX * segX + segZ * segZ;

      let lineBlocked = false;
      let minIntersectClarity = 1;
      const losses: number[] = [];
      let cutoffProduct = 1;
      const intersections: { penetration: number; clarity: number; absorption: number }[] = [];
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

      for (const column of columns) {
        const ox = column.position[0];
        const oz = column.position[2];
        const radius = column.radius || OBSTACLE_RADIUS;
        if (segLenSq <= 1e-6) continue;

        const obsX = ox - sx;
        const obsZ = oz - sz;
        const tSeg = (obsX * segX + obsZ * segZ) / segLenSq;
        if (tSeg <= 0.001 || tSeg >= 0.999) continue;

        const closestX = sx + segX * tSeg;
        const closestZ = sz + segZ * tSeg;
        const clearance = Math.hypot(ox - closestX, oz - closestZ);
        if (clearance > radius) continue;

        lineBlocked = true;
        const penetration = Math.max(0, Math.min(1, 1 - clearance / Math.max(0.001, radius)));
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
        const absorption =
          MATERIAL_REGISTRY[column.materialPreset]?.absorption ?? materialAlpha;
        intersections.push({ penetration, clarity, absorption });
        const nominalLossDb = -(3 + penetration * 3) * (1 - absorption * 0.35);
        losses.push(nominalLossDb);
        cutoffProduct *= Math.max(0.05, 1 - 0.45 * penetration);
      }

      let totalLossDb = 0;
      if (losses.length > 0) {
        const sorted = [...losses].sort((a, b) => a - b);
        const strongest = sorted[0] ?? 0;
        const rest = sorted.slice(1).reduce((sum, v) => sum + v * 0.3, 0);
        totalLossDb = strongest + rest;
      }

      const clarityFromLoss = intersections.length > 0 ? Math.pow(10, totalLossDb / 20) : 1;
      const combinedClarity = Math.max(
        0,
        Math.min(1, Math.min(minIntersectClarity, clarityFromLoss))
      );
      const targetCutoffHz = Math.max(250, 20000 * cutoffProduct);
      const finalAudioCutoff = Math.max(
        250,
        Math.min(20000, targetCutoffHz * directivityFilterMultiplier)
      );
      const targetGain = Math.pow(10, totalLossDb / 20);
      const finalAudioGain = Math.max(
        0.03,
        Math.min(1.2, targetGain * directivityGainMultiplier)
      );
      frameOccluderCounts.set(t.id, intersections.length);
      setTrackDynamicAcoustics(t.id, finalAudioCutoff, finalAudioGain);

      if (flags.shadows) {
        // Keep legacy educational shadow telemetry but scope the debug count to active source track.
        const uiOccluderCount = t.id === activeTrackId ? intersections.length : 0;
        updateTrackShadowOcclusion(
          t.id,
          combinedClarity,
          materialAlpha,
          lineBlocked,
          targetCutoffHz,
          Math.abs(totalLossDb),
          uiOccluderCount
        );
      }
    }
  });

  const fallbackTrackId = tracks[0]?.id ?? null;

  return (
    <group>
      {showShadows && columns.length > 0 ? (
        <>
          {columns.map((column) => (
            <ShadowHatch
              key={`column-shadow-${column.id}`}
              sourceTrackId={activeSourceTrackId}
              fallbackTrackId={fallbackTrackId}
              column={column}
              trackRefs={trackRefs}
              flagsRef={flagsRef}
              roomRef={roomRef}
            />
          ))}
        </>
      ) : null}
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
