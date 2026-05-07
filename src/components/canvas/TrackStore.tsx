"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Track, TrackConfig, Vec3 } from "./types";

type RoomScale = [number, number, number];
export type RoomMaterialPreset = "brick" | "wood" | "acoustic-foam" | "marble";

type AcousticSettings = {
  roomMaterial: RoomMaterialPreset;
  enableRoomReverb: boolean;
  showSoundRays: boolean;
  enableAirAbsorption: boolean;
  rt60Ms: number;
};

type TrackStoreValue = {
  tracks: Track[];
  roomScale: RoomScale;
  acousticSettings: AcousticSettings;
  addTracks: (configs: TrackConfig[]) => void;
  updateTrackPosition: (trackId: string, position: Vec3) => void;
  updateTrackName: (trackId: string, name: string) => void;
  updateTrackColor: (trackId: string, color: string) => void;
  toggleTrackMute: (trackId: string) => void;
  toggleTrackSolo: (trackId: string) => void;
  setRoomScale: (scale: RoomScale) => void;
  setRoomMaterial: (preset: RoomMaterialPreset) => void;
  setEnableRoomReverb: (enabled: boolean) => void;
  setShowSoundRays: (enabled: boolean) => void;
  setEnableAirAbsorption: (enabled: boolean) => void;
  setRt60Ms: (value: number) => void;
};

const TrackStoreContext = createContext<TrackStoreValue | null>(null);

function randomSpawnPosition(): Vec3 {
  const range = 3.8;
  const x = (Math.random() * 2 - 1) * range;
  const z = (Math.random() * 2 - 1) * range;
  return [x, 0.5, z];
}

function createTrack(config: TrackConfig): Track {
  return {
    ...config,
    id: crypto.randomUUID(),
    position: randomSpawnPosition(),
    muted: false,
    solo: false,
  };
}

export function TrackStoreProvider({ children }: { children: ReactNode }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [roomScale, setRoomScale] = useState<RoomScale>([1, 1, 1]);
  const [acousticSettings, setAcousticSettings] = useState<AcousticSettings>({
    roomMaterial: "brick",
    enableRoomReverb: true,
    showSoundRays: false,
    enableAirAbsorption: false,
    rt60Ms: 850,
  });

  const value = useMemo<TrackStoreValue>(
    () => ({
      tracks,
      roomScale,
      acousticSettings,
      addTracks: (configs) => {
        setTracks((current) => [
          ...current,
          ...configs.map((config) => createTrack(config)),
        ]);
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
      setShowSoundRays: (enabled) => {
        setAcousticSettings((current) => ({ ...current, showSoundRays: enabled }));
      },
      setEnableAirAbsorption: (enabled) => {
        setAcousticSettings((current) => ({ ...current, enableAirAbsorption: enabled }));
      },
      setRt60Ms: (value) => {
        setAcousticSettings((current) => ({ ...current, rt60Ms: value }));
      },
    }),
    [tracks, roomScale, acousticSettings]
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
