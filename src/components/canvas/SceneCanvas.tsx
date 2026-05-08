"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef } from "react";
import { NoToneMapping, Object3D, Quaternion, Vector3 } from "three";
import { AcousticEducationViz } from "./AcousticEducationViz";
import {
  ensureTrackAudio,
  pruneTracks,
  setAirAbsorptionEnabled,
  setEducationalShadowEnabled,
  setListenerTransform,
  setTrackDirectivityState,
  setTrackMixState,
  setTrackUiGainDb,
  setTrackPosition,
  updateRoomAcoustics,
} from "./audioEngine";
import { CameraRig, CameraView } from "./CameraRig";
import { DimensionLines } from "./DimensionLines";
import { ObstacleColumn } from "./ObstacleColumn";
import { Room } from "./Room";
import { useTrackStore } from "./TrackStore";
import { TrackNodes } from "./TrackNodes";

type SceneContentsProps = {
  view: CameraView;
  zoomSteps: number;
};

type SceneCanvasProps = {
  view: CameraView;
  zoomSteps: number;
};

type TrackLite = {
  id: string;
  gainDb: number;
  isDirectivityEnabled: boolean;
  rotationDeg: number;
};

type EduFlags = {
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

function SceneContents({ view, zoomSteps }: SceneContentsProps) {
  const { tracks, roomScale, acousticSettings, setRt60Ms, updateTrackPosition } =
    useTrackStore();
  const worldPosition = useRef(new Vector3());
  const worldQuaternion = useRef(new Quaternion());
  const worldForward = useRef(new Vector3(0, 0, -1));
  const worldUp = useRef(new Vector3(0, 1, 0));
  const listenerPositionTuple = useRef<[number, number, number]>([0, 0, 0]);
  const listenerForwardTuple = useRef<[number, number, number]>([0, 0, -1]);
  const listenerUpTuple = useRef<[number, number, number]>([0, 1, 0]);
  const trackPositionTuple = useRef<[number, number, number]>([0, 0, 0]);
  const directivityTuple = useRef<[number, number, number]>([0, 0, -1]);

  const listenerRef = useRef<Object3D | null>(null);
  const trackRefs = useRef<Map<string, Object3D>>(new Map());
  const tracksRef = useRef<TrackLite[]>([]);
  const gainDbMapRef = useRef<Map<string, number>>(new Map());
  const directivityMapRef = useRef<
    Map<string, { enabled: boolean; rotationDeg: number }>
  >(new Map());
  const flagsRef = useRef<EduFlags>({
    attenuation: false,
    shadows: false,
    critical: false,
  });
  const roomRef = useRef<RoomDims>({
    rt60Sec: 0.85,
    width: 10,
    height: 4,
    depth: 10,
    materialAlpha: 0.3,
  });
  const lastSyncRef = useRef(0);

  useLayoutEffect(() => {
    tracksRef.current = tracks.map((t) => ({
      id: t.id,
      gainDb: t.gainDb,
      isDirectivityEnabled: t.isDirectivityEnabled,
      rotationDeg: t.rotationDeg,
    }));
    gainDbMapRef.current = new Map(
      tracks.map((track) => [track.id, Number.isFinite(track.gainDb) ? track.gainDb : -Infinity])
    );
    directivityMapRef.current = new Map(
      tracks.map((track) => [
        track.id,
        {
          enabled: track.isDirectivityEnabled,
          rotationDeg: track.rotationDeg,
        },
      ])
    );
  }, [tracks]);

  useLayoutEffect(() => {
    flagsRef.current = {
      attenuation: acousticSettings.showAttenuationZones,
      shadows: acousticSettings.showAcousticShadows,
      critical: acousticSettings.showCriticalDistance,
    };
  }, [
    acousticSettings.showAttenuationZones,
    acousticSettings.showAcousticShadows,
    acousticSettings.showCriticalDistance,
  ]);

  useEffect(() => {
    setEducationalShadowEnabled(acousticSettings.showAcousticShadows);
  }, [acousticSettings.showAcousticShadows]);

  useEffect(() => {
    pruneTracks(tracks.map((track) => track.id));
    setTrackMixState(tracks);
    setAirAbsorptionEnabled(acousticSettings.enableAirAbsorption);
    for (const track of tracks) {
      if (!track.audioUrl) continue;
      void ensureTrackAudio(track);
      setTrackUiGainDb(track.id, track.gainDb);
    }
  }, [tracks, acousticSettings.enableAirAbsorption]);

  useEffect(() => {
    const result = updateRoomAcoustics(
      roomScale,
      acousticSettings.roomMaterial,
      acousticSettings.enableRoomReverb
    );
    setRt60Ms(result.rt60Ms);
    roomRef.current = {
      rt60Sec: result.rt60Sec,
      width: result.width,
      height: result.height,
      depth: result.depth,
      materialAlpha: result.materialAlpha,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync only on room / material inputs
  }, [roomScale, acousticSettings.roomMaterial, acousticSettings.enableRoomReverb]);

  useFrame(() => {
    const now = performance.now();
    if (now - lastSyncRef.current < 16) return;
    lastSyncRef.current = now;

    if (listenerRef.current) {
      const listener = listenerRef.current;
      listener.getWorldPosition(worldPosition.current);
      listener.getWorldQuaternion(worldQuaternion.current);
      worldForward.current
        .set(0, 0, -1)
        .applyQuaternion(worldQuaternion.current)
        .normalize();
      worldUp.current.set(0, 1, 0).applyQuaternion(worldQuaternion.current).normalize();
      listenerPositionTuple.current[0] = worldPosition.current.x;
      listenerPositionTuple.current[1] = worldPosition.current.y;
      listenerPositionTuple.current[2] = worldPosition.current.z;
      listenerForwardTuple.current[0] = worldForward.current.x;
      listenerForwardTuple.current[1] = worldForward.current.y;
      listenerForwardTuple.current[2] = worldForward.current.z;
      listenerUpTuple.current[0] = worldUp.current.x;
      listenerUpTuple.current[1] = worldUp.current.y;
      listenerUpTuple.current[2] = worldUp.current.z;
      setListenerTransform(
        listenerPositionTuple.current,
        listenerForwardTuple.current,
        listenerUpTuple.current
      );
    }

    trackRefs.current.forEach((object, trackId) => {
      object.getWorldPosition(worldPosition.current);
      trackPositionTuple.current[0] = worldPosition.current.x;
      trackPositionTuple.current[1] = worldPosition.current.y;
      trackPositionTuple.current[2] = worldPosition.current.z;
      setTrackPosition(trackId, trackPositionTuple.current);
      const directivity = directivityMapRef.current.get(trackId);
      const rad = ((directivity?.rotationDeg ?? 0) * Math.PI) / 180;
      const x = Math.sin(rad);
      const z = -Math.cos(rad);
      directivityTuple.current[0] = x;
      directivityTuple.current[1] = 0;
      directivityTuple.current[2] = z;
      setTrackDirectivityState(
        trackId,
        directivityTuple.current,
        directivity?.enabled ?? false
      );
    });
  });

  const onTrackDragCommit = (
    trackId: string,
    position: [number, number, number]
  ) => {
    updateTrackPosition(trackId, position);
  };

  const handleTrackRef = (trackId: string, object: Object3D | null) => {
    if (!object) {
      trackRefs.current.delete(trackId);
      return;
    }
    trackRefs.current.set(trackId, object);
  };

  return (
    <>
      <CameraRig view={view} zoomSteps={zoomSteps} />

      <Room scale={roomScale} materialPreset={acousticSettings.roomMaterial} />

      <DimensionLines scale={roomScale} />

      {acousticSettings.showAcousticShadows ? <ObstacleColumn /> : null}

      <TrackNodes
        tracks={tracks}
        roomScale={roomScale}
        onTrackDragCommit={onTrackDragCommit}
        onListenerRef={(object) => {
          listenerRef.current = object;
        }}
        onTrackRef={handleTrackRef}
      />

      <AcousticEducationViz
        tracks={tracks.map((t) => ({
          id: t.id,
          gainDb: t.gainDb,
          isDirectivityEnabled: t.isDirectivityEnabled,
          rotationDeg: t.rotationDeg,
        }))}
        listenerRef={listenerRef}
        trackRefs={trackRefs}
        tracksRef={tracksRef}
        gainDbMapRef={gainDbMapRef}
        flagsRef={flagsRef}
        roomRef={roomRef}
        showAttenuation={acousticSettings.showAttenuationZones}
        showShadows={acousticSettings.showAcousticShadows}
        showCritical={acousticSettings.showCriticalDistance}
      />
    </>
  );
}

export function SceneCanvas({ view, zoomSteps }: SceneCanvasProps) {
  return (
    <Canvas
      flat
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
        toneMapping: NoToneMapping,
      }}
      onCreated={({ gl }) => {
        gl.toneMapping = NoToneMapping;
        gl.setClearColor(0x000000, 0);
      }}
    >
      <SceneContents view={view} zoomSteps={zoomSteps} />
    </Canvas>
  );
}
