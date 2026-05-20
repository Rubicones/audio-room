"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AcousticObstacle, ObstacleType, Track, TrackConfig, Vec3 } from "./types";
import type { RoomMaterialPreset } from "./acousticMaterials";
import {
  createDefaultBoxObstacle,
  createDefaultObstacle,
  createDefaultWallObstacle,
} from "./obstacleConstants";
export { ACOUSTIC_MATERIALS } from "./acousticMaterials";

type RoomScale = [number, number, number];

type AcousticSettings = {
  roomMaterial: RoomMaterialPreset;
  enableRoomReverb: boolean;
  enableAirAbsorption: boolean;
  rt60Ms: number;
  showAttenuationZones: boolean;
  showAcousticShadows: boolean;
  showCriticalDistance: boolean;
};

type TrackStoreValue = {
  tracks: Track[];
  roomScale: RoomScale;
  obstacles: AcousticObstacle[];
  acousticSettings: AcousticSettings;
  addTracks: (configs: TrackConfig[]) => void;
  removeTrack: (trackId: string) => void;
  updateTrackPosition: (trackId: string, position: Vec3) => void;
  updateTrackName: (trackId: string, name: string) => void;
  updateTrackColor: (trackId: string, color: string) => void;
  updateTrackAudioUrl: (trackId: string, audioUrl: string) => void;
  toggleTrackMute: (trackId: string) => void;
  toggleTrackSolo: (trackId: string) => void;
  setRoomScale: (scale: RoomScale) => void;
  setRoomMaterial: (preset: RoomMaterialPreset) => void;
  setEnableRoomReverb: (enabled: boolean) => void;
  setEnableAirAbsorption: (enabled: boolean) => void;
  setRt60Ms: (value: number) => void;
  setShowAttenuationZones: (enabled: boolean) => void;
  setShowAcousticShadows: (enabled: boolean) => void;
  setShowCriticalDistance: (enabled: boolean) => void;
  setTrackGainDb: (trackId: string, gainDb: number) => void;
  toggleTrackDirectivity: (trackId: string) => void;
  toggleTrackShadows: (trackId: string) => void;
  setTrackRotationDeg: (trackId: string, value: number) => void;
  setObstacleRotationDeg: (obstacleId: string, value: number) => void;
  addObstacle: (position?: Vec3, type?: ObstacleType) => string;
  removeObstacle: (obstacleId: string) => void;
  updateObstacle: (obstacleId: string, updates: Partial<AcousticObstacle>) => void;
  replaceProjectState: (state: {
    tracks: Track[];
    roomScale: RoomScale;
    obstacles: AcousticObstacle[];
    acousticSettings: Partial<AcousticSettings>;
  }) => void;
  resetProjectState: () => void;
};

const TrackStoreContext = createContext<TrackStoreValue | null>(null);
const DEFAULT_ROOM_SCALE: RoomScale = [1, 1, 1];
const DEFAULT_ACOUSTIC_SETTINGS: AcousticSettings = {
  roomMaterial: "brick",
  enableRoomReverb: true,
  enableAirAbsorption: false,
  rt60Ms: 850,
  showAttenuationZones: false,
  showAcousticShadows: false,
  showCriticalDistance: false,
};

function randomSpawnPosition(): Vec3 {
  const range = 3.8;
  const x = (Math.random() * 2 - 1) * range;
  const z = (Math.random() * 2 - 1) * range;
  return [x, 0.5, z];
}

function createTrack(config: TrackConfig, trackIndex: number): Track {
  const {
    gainDb: _g,
    isDirectivityEnabled,
    directivityAlpha,
    directivitySharpness,
    rotationDeg,
    showShadows,
    ...rest
  } = config;
  const normalizedRotation = Number.isFinite(rotationDeg)
    ? ((((Math.round(rotationDeg as number) % 360) + 360) % 360) as number)
    : 0;
  const directivityEnabled = Boolean(isDirectivityEnabled);
  const alpha = Number.isFinite(directivityAlpha)
    ? Math.max(0, Math.min(1, directivityAlpha as number))
    : directivityEnabled
      ? 0.5
      : 0;
  const sharpness = Number.isFinite(directivitySharpness)
    ? Math.max(0, Math.min(1, directivitySharpness as number))
    : 1;
  return {
    ...rest,
    id: config.id ?? crypto.randomUUID(),
    position: randomSpawnPosition(),
    muted: false,
    solo: false,
    gainDb: Number.isFinite(config.gainDb) ? (config.gainDb as number) : 0,
    isDirectivityEnabled: directivityEnabled,
    directivityAlpha: alpha,
    directivitySharpness: sharpness,
    rotationDeg: normalizedRotation,
    showShadows: typeof showShadows === "boolean" ? showShadows : trackIndex === 0,
  };
}

export function TrackStoreProvider({ children }: { children: ReactNode }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [roomScale, setRoomScale] = useState<RoomScale>(DEFAULT_ROOM_SCALE);
  const [obstacles, setObstacles] = useState<AcousticObstacle[]>([createDefaultObstacle(0)]);
  const [acousticSettings, setAcousticSettings] = useState<AcousticSettings>(
    DEFAULT_ACOUSTIC_SETTINGS
  );

  const value = useMemo<TrackStoreValue>(
    () => ({
      tracks,
      roomScale,
      obstacles,
      acousticSettings,
      addTracks: (configs) => {
        setTracks((current) => {
          const startIndex = current.length;
          return [
            ...current,
            ...configs.map((config, idx) => createTrack(config, startIndex + idx)),
          ];
        });
      },
      removeTrack: (trackId) => {
        setTracks((current) => current.filter((track) => track.id !== trackId));
      },
      updateTrackPosition: (trackId, position) => {
        setTracks((current) =>
          current.map((track) => (track.id === trackId ? { ...track, position } : track))
        );
      },
      updateTrackName: (trackId, name) => {
        setTracks((current) =>
          current.map((track) => (track.id === trackId ? { ...track, name } : track))
        );
      },
      updateTrackColor: (trackId, color) => {
        setTracks((current) =>
          current.map((track) => (track.id === trackId ? { ...track, color } : track))
        );
      },
      updateTrackAudioUrl: (trackId, audioUrl) => {
        setTracks((current) =>
          current.map((track) => (track.id === trackId ? { ...track, audioUrl } : track))
        );
      },
      toggleTrackMute: (trackId) => {
        setTracks((current) =>
          current.map((track) =>
            track.id === trackId ? { ...track, muted: !track.muted } : track
          )
        );
      },
      toggleTrackSolo: (trackId) => {
        setTracks((current) =>
          current.map((track) =>
            track.id === trackId ? { ...track, solo: !track.solo } : track
          )
        );
      },
      setRoomScale,
      setRoomMaterial: (preset) => {
        setAcousticSettings((current) => ({ ...current, roomMaterial: preset }));
      },
      setEnableRoomReverb: (enabled) => {
        setAcousticSettings((current) => ({ ...current, enableRoomReverb: enabled }));
      },
      setEnableAirAbsorption: (enabled) => {
        setAcousticSettings((current) => ({ ...current, enableAirAbsorption: enabled }));
      },
      setRt60Ms: (value) => {
        setAcousticSettings((current) => ({ ...current, rt60Ms: value }));
      },
      setShowAttenuationZones: (enabled) => {
        setAcousticSettings((current) => ({ ...current, showAttenuationZones: enabled }));
      },
      setShowAcousticShadows: (enabled) => {
        setAcousticSettings((current) => ({ ...current, showAcousticShadows: enabled }));
      },
      setShowCriticalDistance: (enabled) => {
        setAcousticSettings((current) => ({ ...current, showCriticalDistance: enabled }));
      },
      setTrackGainDb: (trackId, gainDb) => {
        const normalized =
          gainDb <= -60 || !Number.isFinite(gainDb)
            ? -Infinity
            : Math.max(-59, Math.min(12, gainDb));
        setTracks((current) =>
          current.map((track) =>
            track.id === trackId ? { ...track, gainDb: normalized } : track
          )
        );
      },
      toggleTrackDirectivity: (trackId) => {
        setTracks((current) =>
          current.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  isDirectivityEnabled: !track.isDirectivityEnabled,
                  directivityAlpha: !track.isDirectivityEnabled
                    ? track.directivityAlpha > 0
                      ? track.directivityAlpha
                      : 0.5
                    : 0,
                }
              : track
          )
        );
      },
      toggleTrackShadows: (trackId) => {
        setTracks((current) =>
          current.map((track) =>
            track.id === trackId ? { ...track, showShadows: !track.showShadows } : track
          )
        );
      },
      setTrackRotationDeg: (trackId, value) => {
        const normalized = ((Math.round(value) % 360) + 360) % 360;
        setTracks((current) =>
          current.map((track) =>
            track.id === trackId ? { ...track, rotationDeg: normalized } : track
          )
        );
      },
      setObstacleRotationDeg: (obstacleId, value) => {
        const normalized = ((Math.round(value) % 360) + 360) % 360;
        setObstacles((current) =>
          current.map((obstacle) =>
            obstacle.id === obstacleId ? { ...obstacle, rotationDeg: normalized } : obstacle
          )
        );
      },
      addObstacle: (position, type = "cylinder") => {
        const index = obstacles.length;
        const next =
          type === "box"
            ? createDefaultBoxObstacle(index, position)
            : type === "wall-with-window"
              ? createDefaultWallObstacle(index, position)
              : createDefaultObstacle(index, position);
        setObstacles((current) => [...current, next]);
        return next.id;
      },
      removeObstacle: (obstacleId) => {
        setObstacles((current) => current.filter((obstacle) => obstacle.id !== obstacleId));
      },
      updateObstacle: (obstacleId, updates) => {
        setObstacles((current) =>
          current.map((obstacle) => {
            if (obstacle.id !== obstacleId) return obstacle;
            const hasRotation = Object.prototype.hasOwnProperty.call(updates, "rotationDeg");
            const hasWindowOffset = Object.prototype.hasOwnProperty.call(
              updates,
              "windowOffsetPct"
            );
            const normalizedRotation = hasRotation
              ? (((Math.round(updates.rotationDeg ?? 0) % 360) + 360) % 360)
              : obstacle.rotationDeg;
            const normalizedWindowOffset = hasWindowOffset
              ? Math.max(0.05, Math.min(0.95, updates.windowOffsetPct ?? 0.5))
              : obstacle.windowOffsetPct;
            return {
              ...obstacle,
              ...updates,
              position: updates.position ?? obstacle.position,
              rotationDeg: normalizedRotation,
              windowOffsetPct: normalizedWindowOffset,
            };
          })
        );
      },
      replaceProjectState: (state) => {
        setTracks(state.tracks);
        setRoomScale(state.roomScale);
        setObstacles(state.obstacles);
        setAcousticSettings((current) => ({
          ...current,
          ...state.acousticSettings,
        }));
      },
      resetProjectState: () => {
        setTracks([]);
        setRoomScale(DEFAULT_ROOM_SCALE);
        setObstacles([createDefaultObstacle(0)]);
        setAcousticSettings(DEFAULT_ACOUSTIC_SETTINGS);
      },
    }),
    [tracks, roomScale, obstacles, acousticSettings]
  );

  return <TrackStoreContext.Provider value={value}>{children}</TrackStoreContext.Provider>;
}

export function useTrackStore() {
  const context = useContext(TrackStoreContext);
  if (!context) {
    throw new Error("useTrackStore must be used within TrackStoreProvider");
  }
  return context;
}
