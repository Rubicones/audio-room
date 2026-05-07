"use client";

import { Billboard, Line, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import { Group, Object3D, Vector3 } from "three";
import { updateTrackShadowOcclusion } from "./audioEngine";
import {
  OBSTACLE_CENTER,
  OBSTACLE_RADIUS,
} from "./obstacleConstants";
import { useItimFontUrl } from "./sketch";
import { getDirectivityRayAnchors } from "./directivity";

const INK = "#1a1a1a";
const FLOOR_Y = 0.012;
const R0 = 1;
const DIRECTIVITY_Q = 1;
const GAIN_EPSILON = 1e-4;

const tempWorld = new Vector3();
const tempListener = new Vector3();
const sampleOffset = 0.18;

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


function inShadowWedge(
  px: number,
  pz: number,
  sx: number,
  sz: number,
  ox: number,
  oz: number,
  R: number
): boolean {
  const vx = ox - sx;
  const vz = oz - sz;
  const d = Math.hypot(vx, vz);
  if (d <= R + 0.02) return false;
  const ux = vx / d;
  const uz = vz / d;
  const wx = px - sx;
  const wz = pz - sz;
  const wlen = Math.hypot(wx, wz);
  if (wlen < 1e-4) return false;
  const along = wx * ux + wz * uz;
  const tangentDist = Math.sqrt(d * d - R * R);
  if (along < tangentDist - 0.05) return false;
  const cosang = along / wlen;
  const cosalpha = Math.sqrt(1 - (R / d) * (R / d));
  return cosang >= cosalpha - 0.02;
}

function buildHatchSegmentPoints(
  sx: number,
  sz: number,
  halfW: number,
  halfD: number,
  ox: number,
  oz: number,
  R: number,
  step: number
): [number, number, number][] {
  const out: [number, number, number][] = [];
  const xmin = -halfW;
  const xmax = halfW;
  const zmin = -halfD;
  const zmax = halfD;
  const diag = step * 0.55;

  for (let gx = xmin; gx < xmax; gx += step) {
    for (let gz = zmin; gz < zmax; gz += step) {
      const cx = gx + step * 0.35;
      const cz = gz + step * 0.35;
      if (!inShadowWedge(cx, cz, sx, sz, ox, oz, R)) continue;
      const x0 = gx;
      const z0 = gz;
      const x1 = gx + diag;
      const z1 = gz + diag;
      if (x1 > xmax || z1 > zmax) continue;
      out.push([x0, FLOOR_Y, z0], [x1, FLOOR_Y, z1]);
      if (out.length >= 240) return out;
    }
  }

  if (out.length < 4) {
    out.push([-0.01, FLOOR_Y, -0.01], [0.01, FLOOR_Y, 0.01]);
  }
  return out;
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
  trackId,
  trackRefs,
  flagsRef,
  roomRef,
}: {
  trackId: string;
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

    const obj = trackRefs.current?.get(trackId);
    if (!obj) return;

    obj.getWorldPosition(tempWorld);
    const sx = tempWorld.x;
    const sz = tempWorld.z;
    const { width, depth } = roomRef.current;
    const halfW = width / 2;
    const halfD = depth / 2;
    const ox = OBSTACLE_CENTER.x;
    const oz = OBSTACLE_CENTER.z;

    const now = performance.now();
    if (now - lastUpdateMs.current < 120) return;

    const key = `${(Math.round(sx * 5) / 5).toFixed(2)}_${(Math.round(sz * 5) / 5).toFixed(2)}_${halfW.toFixed(1)}_${halfD.toFixed(1)}_${roomRef.current.materialAlpha.toFixed(2)}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    lastUpdateMs.current = now;
    const nextOpacity = Math.min(1, Math.max(0.08, 1 - roomRef.current.materialAlpha));
    setHatchOpacity((current) =>
      Math.abs(current - nextOpacity) > 0.02 ? nextOpacity : current
    );

    setPoints(
      buildHatchSegmentPoints(
        sx,
        sz,
        halfW,
        halfD,
        ox,
        oz,
        OBSTACLE_RADIUS,
        0.55
      )
    );
  });

  return (
    <group ref={groupRef} visible={false}>
      <Line
        segments
        points={points}
        color={INK}
        lineWidth={1}
        dashed
        dashSize={0.12}
        gapSize={0.09}
        transparent
        opacity={hatchOpacity}
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
  showAttenuation,
  showShadows,
  showCritical,
}: AcousticEducationVizProps) {
  const fontUrl = useItimFontUrl();

  const listenerSamples = useMemo<[number, number][]>(() => {
    return [
      [0, 0],
      [sampleOffset, 0],
      [-sampleOffset, 0],
      [0, sampleOffset],
      [0, -sampleOffset],
    ];
  }, []);

  useFrame(() => {
    const flags = flagsRef.current;
    if (!flags.shadows) return;
    const listener = listenerRef.current;
    if (!listener) return;
    listener.getWorldPosition(tempListener);
    const ox = OBSTACLE_CENTER.x;
    const oz = OBSTACLE_CENTER.z;
    const materialAlpha = roomRef.current.materialAlpha;

    for (const t of tracksRef.current) {
      const obj = trackRefs.current?.get(t.id);
      if (!obj) continue;
      obj.getWorldPosition(tempWorld);
      const sx = tempWorld.x;
      const sz = tempWorld.z;
      let blocked = 0;
      for (const [dx, dz] of listenerSamples) {
        const lx = tempListener.x + dx;
        const lz = tempListener.z + dz;
        if (inShadowWedge(lx, lz, sx, sz, ox, oz, OBSTACLE_RADIUS)) blocked += 1;
      }
      const occlusionFactor = 1 - blocked / listenerSamples.length;
      updateTrackShadowOcclusion(t.id, occlusionFactor, materialAlpha);
    }
  });

  return (
    <group>
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
          {showShadows ? (
            <ShadowHatch
              trackId={t.id}
              trackRefs={trackRefs}
              flagsRef={flagsRef}
              roomRef={roomRef}
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
