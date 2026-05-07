"use client";

import { Grid, Line } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Mesh, PCFShadowMap, Quaternion, Vector3 } from "three";
import {
  ensureTrackAudio,
  isAudioPlaying,
  isTrackAudible,
  pruneTracks,
  setAirAbsorptionEnabled,
  setListenerTransform,
  setTrackMixState,
  setTrackPosition,
  updateRoomAcoustics,
} from "./audioEngine";
import { CameraRig, CameraView } from "./CameraRig";
import { Room } from "./Room";
import { useTrackStore } from "./TrackStore";
import { TrackNodes } from "./TrackNodes";

type SceneContentsProps = {
  view: CameraView;
};

type SceneCanvasProps = {
  view: CameraView;
};

function SceneContents({ view }: SceneContentsProps) {
  const { tracks, roomScale, acousticSettings, setRt60Ms, updateTrackPosition } = useTrackStore();
  const worldPosition = useRef(new Vector3());
  const worldQuaternion = useRef(new Quaternion());
  const worldForward = useRef(new Vector3(0, 0, -1));
  const worldUp = useRef(new Vector3(0, 1, 0));

  const listenerRef = useRef<Mesh | null>(null);
  const trackRefs = useRef<Map<string, Mesh>>(new Map());
  const lastSyncRef = useRef(0);
  const [frameTick, setFrameTick] = useState(0);

  useEffect(() => {
    pruneTracks(tracks.map((track) => track.id));
    setTrackMixState(tracks);
    setAirAbsorptionEnabled(acousticSettings.enableAirAbsorption);
    for (const track of tracks) {
      if (!track.audioUrl) continue;
      void ensureTrackAudio(track);
    }
  }, [tracks, acousticSettings.enableAirAbsorption]);

  useEffect(() => {
    const rt60Ms = updateRoomAcoustics(
      roomScale,
      acousticSettings.roomMaterial,
      acousticSettings.enableRoomReverb
    );
    setRt60Ms(rt60Ms);
  }, [roomScale, acousticSettings.roomMaterial, acousticSettings.enableRoomReverb]);

  useFrame(() => {
    const now = performance.now();
    if (now - lastSyncRef.current < 16) return;
    lastSyncRef.current = now;

    if (listenerRef.current) {
      const listener = listenerRef.current;
      listener.getWorldPosition(worldPosition.current);
      listener.getWorldQuaternion(worldQuaternion.current);
      worldForward.current.set(0, 0, -1).applyQuaternion(worldQuaternion.current).normalize();
      worldUp.current.set(0, 1, 0).applyQuaternion(worldQuaternion.current).normalize();
      setListenerTransform(
        [worldPosition.current.x, worldPosition.current.y, worldPosition.current.z],
        [worldForward.current.x, worldForward.current.y, worldForward.current.z],
        [worldUp.current.x, worldUp.current.y, worldUp.current.z]
      );
    }

    trackRefs.current.forEach((mesh, trackId) => {
      setTrackPosition(trackId, [mesh.position.x, mesh.position.y, mesh.position.z]);
    });

    if (acousticSettings.showSoundRays) {
      setFrameTick((value) => (value + 1) % 100000);
    }
  });

  const onTrackDragCommit = (trackId: string, position: [number, number, number]) => {
    updateTrackPosition(trackId, position);
  };

  const handleTrackRef = (trackId: string, mesh: Mesh | null) => {
    if (!mesh) {
      trackRefs.current.delete(trackId);
      return;
    }
    trackRefs.current.set(trackId, mesh);
  };

  const rays = useMemo(() => {
    if (
      !acousticSettings.showSoundRays ||
      !acousticSettings.enableRoomReverb ||
      !listenerRef.current ||
      !isAudioPlaying()
    )
      return [];

    const listener = listenerRef.current.position;
    const roomHalfW = (10 * roomScale[0]) / 2;
    const roomHalfD = (10 * roomScale[2]) / 2;
    return tracks.flatMap((track) => {
      if (!isTrackAudible(track.id)) return [];
      const mesh = trackRefs.current.get(track.id);
      if (!mesh) return [];
      const source = mesh.position.clone();
      const listenerPos = listener.clone();
      const candidates = [
        { point: new Vector3(-roomHalfW, source.y, source.z), normal: new Vector3(1, 0, 0) },
        { point: new Vector3(roomHalfW, source.y, source.z), normal: new Vector3(-1, 0, 0) },
        { point: new Vector3(source.x, source.y, -roomHalfD), normal: new Vector3(0, 0, 1) },
        { point: new Vector3(source.x, source.y, roomHalfD), normal: new Vector3(0, 0, -1) },
      ];
      let bestWallPoint: Vector3 | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const candidate of candidates) {
        const mirroredListener = listenerPos
          .clone()
          .sub(candidate.point)
          .reflect(candidate.normal)
          .add(candidate.point);
        const pathDirection = mirroredListener.clone().sub(source).normalize();
        const denom = pathDirection.dot(candidate.normal);
        if (Math.abs(denom) < 1e-4) continue;
        const t = candidate.point.clone().sub(source).dot(candidate.normal) / denom;
        if (t <= 0) continue;
        const wallPoint = source.clone().add(pathDirection.multiplyScalar(t));
        if (Math.abs(wallPoint.x) > roomHalfW + 0.01 || Math.abs(wallPoint.z) > roomHalfD + 0.01) {
          continue;
        }
        const totalDistance =
          source.distanceTo(wallPoint) + wallPoint.distanceTo(listenerPos);
        if (totalDistance < bestDistance) {
          bestDistance = totalDistance;
          bestWallPoint = wallPoint;
        }
      }
      if (!bestWallPoint) return [];
      return [
        { key: `${track.id}-source-wall`, points: [source.toArray(), bestWallPoint.toArray()], color: track.color },
        { key: `${track.id}-wall-listener`, points: [bestWallPoint.toArray(), listenerPos.toArray()], color: track.color },
      ];
    });
  }, [tracks, roomScale, acousticSettings.showSoundRays, acousticSettings.enableRoomReverb, frameTick]);

  return (
    <>
      <CameraRig view={view} />

      <ambientLight intensity={0.5} />
      <directionalLight
        intensity={1}
        position={[5, 10, 5]}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-radius={4}
        shadow-bias={-0.0001}
      />

      <Room scale={roomScale} materialPreset={acousticSettings.roomMaterial} />

      <Grid
        position={[0, 0.01, 0]}
        args={[10, 10]}
        cellSize={1}
        cellThickness={0.15}
        sectionSize={5}
        sectionThickness={0.25}
        cellColor="#E6E8EE"
        sectionColor="#DBDFE8"
        fadeDistance={18}
        fadeStrength={2}
        infiniteGrid={false}
      />

      {acousticSettings.showSoundRays
        ? rays.map((ray) => (
            <Line
              key={ray.key}
              points={ray.points}
              color={ray.color}
              transparent
              opacity={0.16}
              lineWidth={1}
            />
          ))
        : null}

      <TrackNodes
        tracks={tracks}
        roomScale={roomScale}
        onTrackDragCommit={onTrackDragCommit}
        onListenerRef={(mesh) => {
          listenerRef.current = mesh;
        }}
        onTrackRef={handleTrackRef}
      />
    </>
  );
}

export function SceneCanvas({ view }: SceneCanvasProps) {
  return (
    <Canvas
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      shadows
      onCreated={({ gl }) => {
        gl.shadowMap.enabled = true;
        gl.shadowMap.type = PCFShadowMap;
      }}
    >
      <color attach="background" args={["#f7f7f9"]} />
      <SceneContents view={view} />
    </Canvas>
  );
}
