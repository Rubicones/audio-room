"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AcousticColumn, Track, TrackConfig, Vec3 } from "./types";
import type { RoomMaterialPreset } from "./acousticMaterials";
import { createDefaultColumn } from "./obstacleConstants";
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
  columns: AcousticColumn[];
  acousticSettings: AcousticSettings;
  addTracks: (configs: TrackConfig[]) => void;
  removeTrack: (trackId: string) => void;
  updateTrackPosition: (trackId: string, position: Vec3) => void;
  updateTrackName: (trackId: string, name: string) => void;
  updateTrackColor: (trackId: string, color: string) => void;
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
  setTrackRotationDeg: (trackId: string, value: number) => void;
  addColumn: (position?: Vec3) => string;
  removeColumn: (columnId: string) => void;
  updateColumn: (columnId: string, updates: Partial<AcousticColumn>) => void;
};

const TrackStoreContext = createContext<TrackStoreValue | null>(null);

function randomSpawnPosition(): Vec3 {
  const range = 3.8;
  const x = (Math.random() * 2 - 1) * range;
  const z = (Math.random() * 2 - 1) * range;
  return [x, 0.5, z];
}

function createTrack(config: TrackConfig): Track {
  const { gainDb: _g, isDirectivityEnabled, rotationDeg, ...rest } = config;
  const normalizedRotation = Number.isFinite(rotationDeg)
    ? ((((Math.round(rotationDeg as number) % 360) + 360) % 360) as number)
    : 0;
  return {
    ...rest,
    id: crypto.randomUUID(),
    position: randomSpawnPosition(),
    muted: false,
    solo: false,
    gainDb: Number.isFinite(config.gainDb) ? (config.gainDb as number) : 0,
    isDirectivityEnabled: Boolean(isDirectivityEnabled),
    rotationDeg: normalizedRotation,
  };
}

export function TrackStoreProvider({ children }: { children: ReactNode }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [roomScale, setRoomScale] = useState<RoomScale>([1, 1, 1]);
  const [columns, setColumns] = useState<AcousticColumn[]>([createDefaultColumn(0)]);
  const [acousticSettings, setAcousticSettings] = useState<AcousticSettings>({
    roomMaterial: "brick",
    enableRoomReverb: true,
    enableAirAbsorption: false,
    rt60Ms: 850,
    showAttenuationZones: false,
    showAcousticShadows: false,
    showCriticalDistance: false,
  });

  const value = useMemo<TrackStoreValue>(
    () => ({
      tracks,
      roomScale,
      columns,
      acousticSettings,
      addTracks: (configs) => {
        setTracks((current) => [
          ...current,
          ...configs.map((config) => createTrack(config)),
        ]);
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
              ? { ...track, isDirectivityEnabled: !track.isDirectivityEnabled }
              : track
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
      addColumn: (position) => {
        const next = createDefaultColumn(columns.length, position);
        setColumns((current) => [...current, next]);
        return next.id;
      },
      removeColumn: (columnId) => {
        setColumns((current) => current.filter((column) => column.id !== columnId));
      },
      updateColumn: (columnId, updates) => {
        setColumns((current) =>
          current.map((column) => {
            if (column.id !== columnId) return column;
            return {
              ...column,
              ...updates,
              position: updates.position ?? column.position,
            };
          })
        );
      },
    }),
    [tracks, roomScale, columns, acousticSettings]
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
