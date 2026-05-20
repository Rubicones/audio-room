"use client";

import type { AcousticObstacle, Track, Vec3 } from "@/components/canvas/types";
import type { RoomMaterialPreset } from "@/components/canvas/acousticMaterials";

export type ProjectConfigJSON = {
  room: {
    scale: [number, number, number];
    materials: {
      left: string;
      right: string;
      front: string;
      back: string;
      down: string;
      up: string;
    };
  };
  globalFlags: {
    showShadows: boolean;
    showAttenuation: boolean;
    showCriticalDistance: boolean;
    airAbsorptionEnabled: boolean;
  };
  listener: {
    position: [number, number, number];
    rotationDeg: number;
  };
  obstacles: Array<{
    id: string;
    type: "cylinder" | "box" | "wall-with-window";
    position: [number, number, number];
    rotationDeg: number;
    radius: number;
    height: number;
    width?: number;
    depth?: number;
    windowOffsetPct?: number;
    color: string;
    materialPreset: string;
  }>;
  tracks: Array<{
    id: string;
    name: string;
    color?: string;
    audioUrl: string;
    position: [number, number, number];
    volumeDb: number;
    muted: boolean;
    solo: boolean;
    isDirectivityEnabled: boolean;
    directivityAlpha: number;
    directivitySharpness: number;
    rotationDeg: number;
    showShadowsForTrack: boolean;
  }>;
};

type SerializeInput = {
  roomScale: [number, number, number];
  roomMaterial: RoomMaterialPreset;
  showShadows: boolean;
  showAttenuation: boolean;
  showCriticalDistance: boolean;
  airAbsorptionEnabled: boolean;
  listenerPosition: [number, number, number];
  listenerRotationDeg: number;
  obstacles: AcousticObstacle[];
  tracks: Track[];
};

export function serializeProjectConfig(input: SerializeInput): ProjectConfigJSON {
  const material = input.roomMaterial;
  return {
    room: {
      scale: input.roomScale,
      materials: {
        left: material,
        right: material,
        front: material,
        back: material,
        down: material,
        up: material,
      },
    },
    globalFlags: {
      showShadows: input.showShadows,
      showAttenuation: input.showAttenuation,
      showCriticalDistance: input.showCriticalDistance,
      airAbsorptionEnabled: input.airAbsorptionEnabled,
    },
    listener: {
      position: input.listenerPosition,
      rotationDeg: input.listenerRotationDeg,
    },
    obstacles: input.obstacles.map((obstacle) => ({
      id: obstacle.id,
      type: obstacle.type,
      position: obstacle.position,
      rotationDeg: obstacle.rotationDeg,
      radius: obstacle.radius,
      height: obstacle.height,
      width: obstacle.width,
      depth: obstacle.depth,
      windowOffsetPct: obstacle.windowOffsetPct,
      color: obstacle.color,
      materialPreset: obstacle.materialPreset,
    })),
    tracks: input.tracks.map((track) => ({
      id: track.id,
      name: track.name,
      color: track.color,
      audioUrl: track.audioUrl,
      position: track.position,
      volumeDb: Number.isFinite(track.gainDb) ? track.gainDb : -Infinity,
      muted: track.muted,
      solo: track.solo,
      isDirectivityEnabled: track.isDirectivityEnabled,
      directivityAlpha: track.directivityAlpha,
      directivitySharpness: track.directivitySharpness,
      rotationDeg: track.rotationDeg,
      showShadowsForTrack: track.showShadows,
    })),
  };
}

export type ProjectHydrationState = {
  roomScale: [number, number, number];
  roomMaterial: RoomMaterialPreset;
  showShadows: boolean;
  showAttenuation: boolean;
  showCriticalDistance: boolean;
  airAbsorptionEnabled: boolean;
  listenerPosition: Vec3;
  listenerRotationDeg: number;
  obstacles: AcousticObstacle[];
  tracks: Track[];
};

function asVec3(value: unknown, fallback: Vec3): Vec3 {
  if (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  ) {
    return [value[0], value[1], value[2]];
  }
  return fallback;
}

export function deserializeProjectConfig(config: ProjectConfigJSON): ProjectHydrationState {
  const roomMaterialRaw = config.room?.materials?.left;
  const roomMaterial = (roomMaterialRaw ?? "brick") as RoomMaterialPreset;
  const tracks: Track[] = Array.isArray(config.tracks)
    ? config.tracks.map((track, index) => ({
        id: track.id || crypto.randomUUID(),
        name: track.name || `Track ${index + 1}`,
        color:
          typeof track.color === "string" && track.color.trim().length > 0
            ? track.color
            : "#4A90E2",
        audioUrl: track.audioUrl || "",
        position: asVec3(track.position, [0, 0.5, 0]),
        muted: Boolean(track.muted),
        solo: Boolean(track.solo),
        gainDb: Number.isFinite(track.volumeDb) ? track.volumeDb : -Infinity,
        isDirectivityEnabled: Boolean(track.isDirectivityEnabled),
        directivityAlpha: Number.isFinite(track.directivityAlpha)
          ? Math.max(0, Math.min(1, Number(track.directivityAlpha)))
          : Boolean(track.isDirectivityEnabled)
            ? 0.5
            : 0,
        directivitySharpness: Number.isFinite(track.directivitySharpness)
          ? Math.max(0, Math.min(1, Number(track.directivitySharpness)))
          : 1,
        rotationDeg: Number.isFinite(track.rotationDeg)
          ? ((Math.round(Number(track.rotationDeg)) % 360) + 360) % 360
          : 0,
        showShadows: Boolean(track.showShadowsForTrack),
      }))
    : [];
  const obstacles: AcousticObstacle[] = Array.isArray(config.obstacles)
    ? config.obstacles.map((obstacle, index) => ({
        id: obstacle.id || crypto.randomUUID(),
        type: obstacle.type ?? "cylinder",
        position: asVec3(obstacle.position, [0, 0.5, 0]),
        rotationDeg: Number.isFinite(obstacle.rotationDeg) ? obstacle.rotationDeg : 0,
        windowOffsetPct: Number.isFinite(obstacle.windowOffsetPct)
          ? Math.max(0.05, Math.min(0.95, obstacle.windowOffsetPct as number))
          : 0.5,
        radius: Number.isFinite(obstacle.radius) ? obstacle.radius : 0.6,
        height: Number.isFinite(obstacle.height) ? obstacle.height : 2.2,
        color: obstacle.color || "#7B5BE6",
        materialPreset: (obstacle.materialPreset || "brick") as RoomMaterialPreset,
        width: Number.isFinite(obstacle.width) ? obstacle.width : undefined,
        depth: Number.isFinite(obstacle.depth) ? obstacle.depth : undefined,
      }))
    : [];
  return {
    roomScale: asVec3(config.room?.scale, [1, 1, 1]),
    roomMaterial,
    showShadows: Boolean(config.globalFlags?.showShadows),
    showAttenuation: Boolean(config.globalFlags?.showAttenuation),
    showCriticalDistance: Boolean(config.globalFlags?.showCriticalDistance),
    airAbsorptionEnabled: Boolean(config.globalFlags?.airAbsorptionEnabled),
    listenerPosition: asVec3(config.listener?.position, [0, 0.5, 0]),
    listenerRotationDeg: Number.isFinite(config.listener?.rotationDeg)
      ? Number(config.listener.rotationDeg)
      : 0,
    obstacles,
    tracks,
  };
}
