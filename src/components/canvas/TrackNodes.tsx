import { useMemo, useRef, useState } from "react";
import { ThreeEvent } from "@react-three/fiber";
import {
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  Plane,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from "three";
import type { Track } from "./types";

const FLOOR_Y = 0.5;
const LISTENER_GEOMETRY = new BoxGeometry(0.85, 0.85, 0.85);
const SPHERE_GEOMETRY = new SphereGeometry(0.45, 24, 24);
const FACE_GEOMETRY = new SphereGeometry(0.07, 16, 16);
const DRAG_RING_GEOMETRY = new RingGeometry(0.55, 0.65, 48);
const DRAG_RING_MATERIAL = new MeshBasicMaterial({
  color: "#8A5CFF",
  transparent: true,
  opacity: 0.38,
  depthWrite: false,
});
const floorPlane = new Plane(new Vector3(0, 1, 0), -FLOOR_Y);
const tempPoint = new Vector3();

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampToRoom(point: Vector3, roomScale: [number, number, number]) {
  const roomHalfWidth = (10 * roomScale[0]) / 2 - 0.5;
  const roomHalfDepth = (10 * roomScale[2]) / 2 - 0.5;
  point.y = FLOOR_Y;
  point.x = clamp(point.x, -roomHalfWidth, roomHalfWidth);
  point.z = clamp(point.z, -roomHalfDepth, roomHalfDepth);
}

type TrackNodesProps = {
  tracks: Track[];
  onTrackDragCommit: (trackId: string, position: [number, number, number]) => void;
  onListenerRef: (object: Mesh | null) => void;
  onTrackRef: (trackId: string, object: Mesh | null) => void;
  roomScale: [number, number, number];
};

export function TrackNodes({
  tracks,
  onTrackDragCommit,
  onListenerRef,
  onTrackRef,
  roomScale,
}: TrackNodesProps) {
  const [draggingTrackId, setDraggingTrackId] = useState<string | null>(null);
  const trackRefs = useRef<Map<string, Mesh>>(new Map());
  const dragRingRef = useRef<Mesh | null>(null);
  const draggingTrackIdRef = useRef<string | null>(null);

  const dragColor = useMemo(
    () => new Color(tracks.find((track) => track.id === draggingTrackId)?.color ?? "#8A5CFF"),
    [draggingTrackId, tracks]
  );

  const updateDragFromEvent = (event: ThreeEvent<PointerEvent>, trackId: string) => {
    if (!event.ray.intersectPlane(floorPlane, tempPoint)) return;

    const halfW = (10 * roomScale[0]) / 2 - 0.5;
    const halfD = (10 * roomScale[2]) / 2 - 0.5;
    const newX = Math.max(-halfW, Math.min(halfW, tempPoint.x));
    const newZ = Math.max(-halfD, Math.min(halfD, tempPoint.z));
    tempPoint.set(newX, FLOOR_Y, newZ);

    clampToRoom(tempPoint, roomScale);
    const mesh = trackRefs.current.get(trackId);
    if (!mesh) return;

    mesh.position.set(tempPoint.x, tempPoint.y, tempPoint.z);
    if (dragRingRef.current) {
      dragRingRef.current.position.set(tempPoint.x, 0.01, tempPoint.z);
      dragRingRef.current.visible = true;
    }
  };

  return (
    <>
      <mesh ref={onListenerRef} position={[0, 0.5, 0]} castShadow receiveShadow>
        <primitive object={LISTENER_GEOMETRY} attach="geometry" />
        <meshStandardMaterial color="#B991FF" roughness={0.95} metalness={0} />
        <mesh position={[0.18, 0.08, -0.34]}>
          <primitive object={FACE_GEOMETRY} attach="geometry" />
          <meshStandardMaterial color="#6A3FE8" roughness={0.6} metalness={0} />
        </mesh>
      </mesh>

      {tracks.map((track) => (
        <mesh
          key={track.id}
          ref={(mesh) => {
            onTrackRef(track.id, mesh);
            if (!mesh) {
              trackRefs.current.delete(track.id);
            } else {
              trackRefs.current.set(track.id, mesh);
            }
          }}
          position={track.position}
          castShadow
          receiveShadow
          onPointerDown={(event) => {
            event.stopPropagation();
            event.target.setPointerCapture(event.pointerId);
            setDraggingTrackId(track.id);
            draggingTrackIdRef.current = track.id;
            updateDragFromEvent(event, track.id);
          }}
          onPointerMove={(event) => {
            if (draggingTrackIdRef.current !== track.id) return;
            event.stopPropagation();
            updateDragFromEvent(event, track.id);
          }}
          onPointerUp={(event) => {
            if (draggingTrackIdRef.current !== track.id) return;
            event.stopPropagation();
            updateDragFromEvent(event, track.id);
            const mesh = trackRefs.current.get(track.id);
            if (mesh) {
              onTrackDragCommit(track.id, [mesh.position.x, mesh.position.y, mesh.position.z]);
            }
            setDraggingTrackId(null);
            draggingTrackIdRef.current = null;
            if (dragRingRef.current) dragRingRef.current.visible = false;
            event.target.releasePointerCapture(event.pointerId);
          }}
          onPointerMissed={() => {
            if (draggingTrackIdRef.current === track.id) {
              setDraggingTrackId(null);
              draggingTrackIdRef.current = null;
              if (dragRingRef.current) dragRingRef.current.visible = false;
            }
          }}
        >
          <primitive object={SPHERE_GEOMETRY} attach="geometry" />
          <meshStandardMaterial color={track.color} roughness={0.9} metalness={0} />
        </mesh>
      ))}

      {draggingTrackId ? (
        <mesh ref={dragRingRef} position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <primitive object={DRAG_RING_GEOMETRY} attach="geometry" />
          <primitive object={DRAG_RING_MATERIAL.clone()} attach="material" color={dragColor} />
        </mesh>
      ) : null}
    </>
  );
}
