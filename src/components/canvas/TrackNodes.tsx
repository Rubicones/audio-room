import { Billboard, Line, Text, useTexture } from "@react-three/drei";
import { useMemo, useRef, useState } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import {
  CircleGeometry,
  Group,
  Object3D,
  Plane,
  RingGeometry,
  Vector3,
} from "three";
import type { Track } from "./types";
import { useItimFontUrl } from "./sketch";
import {
  DIRECTIVITY_ARROW_FRONT_OFFSET,
  DIRECTIVITY_ARROW_TIP_OFFSET,
  getForwardDirectionFromRotationDeg,
} from "./directivity";

const INK = "#1a1a1a";
const FLOOR_Y = 0.5;
const NODE_RADIUS = 0.55;
const NODE_HIT_RADIUS = 0.95;

const NODE_DISC_GEOMETRY = new CircleGeometry(NODE_RADIUS - 0.04, 64);
const NODE_HIT_GEOMETRY = new CircleGeometry(NODE_HIT_RADIUS, 40);
const HALO_GEOMETRY = new RingGeometry(0.78, 0.92, 64);

const floorPlane = new Plane(new Vector3(0, 1, 0), -FLOOR_Y);
const tempPoint = new Vector3();

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampToRoom(point: Vector3, roomScale: [number, number, number]) {
  const halfW = (10 * roomScale[0]) / 2 - NODE_RADIUS;
  const halfD = (10 * roomScale[2]) / 2 - NODE_RADIUS;
  point.y = FLOOR_Y;
  point.x = clamp(point.x, -halfW, halfW);
  point.z = clamp(point.z, -halfD, halfD);
}

function ringPoints(
  radius: number,
  segments = 80
): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push([Math.cos(a) * radius, Math.sin(a) * radius, 0]);
  }
  return pts;
}

type TrackNodesProps = {
  tracks: Track[];
  onTrackDragCommit: (trackId: string, position: [number, number, number]) => void;
  onListenerRef: (object: Object3D | null) => void;
  onTrackRef: (trackId: string, object: Object3D | null) => void;
  roomScale: [number, number, number];
};

function ListenerHeadphones() {
  const iconTexture = useTexture("/headphones.svg");

  return (
    <Billboard>
      <mesh position={[0, 0.02, 0]}>
        <planeGeometry args={[0.92, 0.9]} />
        <meshBasicMaterial
          map={iconTexture}
          transparent
          toneMapped={false}
        />
      </mesh>
    </Billboard>
  );
}

type TrackNodeProps = {
  track: Track;
  index: number;
  listenerPos: Vector3;
  isDragging: boolean;
  groupRef: (group: Group | null) => void;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void;
  onPointerUp: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMissed: () => void;
};

function TrackNode({
  track,
  index,
  listenerPos,
  isDragging,
  groupRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerMissed,
}: TrackNodeProps) {
  const dx = track.position[0] - listenerPos.x;
  const dz = track.position[2] - listenerPos.z;
  const distance = Math.sqrt(dx * dx + dz * dz);

  const circlePoints = useMemo(() => ringPoints(NODE_RADIUS, 80), []);
  const fontUrl = useItimFontUrl();
  const [hovered, setHovered] = useState(false);
  const showLabel = hovered || isDragging;
  const direction = getForwardDirectionFromRotationDeg(track.rotationDeg);

  return (
    <group ref={groupRef} position={track.position}>
      {isDragging ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.49, 0]}>
          <primitive object={HALO_GEOMETRY} attach="geometry" />
          <meshBasicMaterial
            color={track.color}
            transparent
            opacity={0.4}
            toneMapped={false}
          />
        </mesh>
      ) : null}

      <Billboard position={[0, 0, 0]}>
        <mesh
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerMissed={onPointerMissed}
          onPointerOver={(event) => {
            event.stopPropagation();
            setHovered(true);
            document.body.style.cursor = "grab";
          }}
          onPointerOut={(event) => {
            event.stopPropagation();
            setHovered(false);
            document.body.style.cursor = "";
          }}
        >
          <primitive object={NODE_DISC_GEOMETRY} attach="geometry" />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
        {/* Larger invisible touch target so mobile drag is easier to grab. */}
        <mesh
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerMissed={onPointerMissed}
        >
          <primitive object={NODE_HIT_GEOMETRY} attach="geometry" />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <Line points={circlePoints} color={track.color} lineWidth={3} />
        <Text
          position={[0, 0, 0.001]}
          fontSize={0.42}
          color={INK}
          anchorX="center"
          anchorY="middle"
          font={fontUrl}
          outlineWidth={0}
        >
          {String(index + 1)}
        </Text>
      </Billboard>

      {track.isDirectivityEnabled ? (
        <group position={[0, 0.08, 0]}>
          <Line
            points={[
              [
                direction.x * DIRECTIVITY_ARROW_FRONT_OFFSET,
                0,
                direction.z * DIRECTIVITY_ARROW_FRONT_OFFSET,
              ],
              [
                direction.x * DIRECTIVITY_ARROW_TIP_OFFSET,
                0,
                direction.z * DIRECTIVITY_ARROW_TIP_OFFSET,
              ],
            ]}
            color={INK}
            lineWidth={3.2}
          />
          <Line
            points={[
              [
                direction.x * DIRECTIVITY_ARROW_TIP_OFFSET,
                0,
                direction.z * DIRECTIVITY_ARROW_TIP_OFFSET,
              ],
              [
                direction.x * (DIRECTIVITY_ARROW_TIP_OFFSET - 0.14) - direction.z * 0.08,
                0,
                direction.z * (DIRECTIVITY_ARROW_TIP_OFFSET - 0.14) + direction.x * 0.08,
              ],
              [
                direction.x * DIRECTIVITY_ARROW_TIP_OFFSET,
                0,
                direction.z * DIRECTIVITY_ARROW_TIP_OFFSET,
              ],
              [
                direction.x * (DIRECTIVITY_ARROW_TIP_OFFSET - 0.14) + direction.z * 0.08,
                0,
                direction.z * (DIRECTIVITY_ARROW_TIP_OFFSET - 0.14) - direction.x * 0.08,
              ],
            ]}
            color={INK}
            lineWidth={3.2}
          />
        </group>
      ) : null}

      {showLabel ? (
        <Billboard position={[0, 1.0, 0]}>
          <Text
            position={[0, 0.08, 0]}
            fontSize={0.22}
            color={INK}
            anchorX="center"
            anchorY="middle"
            font={fontUrl}
            outlineWidth={0}
            maxWidth={3}
          >
            {track.name}
          </Text>
          <Text
            position={[0, -0.16, 0]}
            fontSize={0.14}
            color={INK}
            fillOpacity={0.6}
            anchorX="center"
            anchorY="middle"
            font={fontUrl}
            outlineWidth={0}
          >
            {`${distance.toFixed(1)}m`}
          </Text>
        </Billboard>
      ) : null}
    </group>
  );
}

export function TrackNodes({
  tracks,
  onTrackDragCommit,
  onListenerRef,
  onTrackRef,
  roomScale,
}: TrackNodesProps) {
  const [draggingTrackId, setDraggingTrackId] = useState<string | null>(null);
  const trackGroups = useRef<Map<string, Group>>(new Map());
  const draggingTrackIdRef = useRef<string | null>(null);
  const listenerPos = useMemo(() => new Vector3(0, FLOOR_Y, 0), []);

  const updateDragFromEvent = (
    event: ThreeEvent<PointerEvent>,
    trackId: string
  ) => {
    if (!event.ray.intersectPlane(floorPlane, tempPoint)) return;
    clampToRoom(tempPoint, roomScale);
    const group = trackGroups.current.get(trackId);
    if (!group) return;
    group.position.set(tempPoint.x, tempPoint.y, tempPoint.z);
  };

  const commitDrag = (trackId: string) => {
    const group = trackGroups.current.get(trackId);
    if (!group) return;
    onTrackDragCommit(trackId, [
      group.position.x,
      group.position.y,
      group.position.z,
    ]);
  };

  const dragPlaneWidth = 10 * roomScale[0];
  const dragPlaneDepth = 10 * roomScale[2];

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, FLOOR_Y + 0.002, 0]}
        visible={draggingTrackId !== null}
        onPointerMove={(event) => {
          const trackId = draggingTrackIdRef.current;
          if (!trackId) return;
          event.stopPropagation();
          updateDragFromEvent(event, trackId);
        }}
        onPointerUp={(event) => {
          const trackId = draggingTrackIdRef.current;
          if (!trackId) return;
          event.stopPropagation();
          updateDragFromEvent(event, trackId);
          commitDrag(trackId);
          setDraggingTrackId(null);
          draggingTrackIdRef.current = null;
        }}
        onPointerOut={(event) => {
          const trackId = draggingTrackIdRef.current;
          if (!trackId) return;
          if (event.pointerType !== "touch") return;
          updateDragFromEvent(event, trackId);
        }}
      >
        <planeGeometry args={[dragPlaneWidth, dragPlaneDepth]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>

      <group
        ref={(group) => onListenerRef(group ?? null)}
        position={[0, FLOOR_Y, 0]}
      >
        <ListenerHeadphones />
      </group>

      {tracks.map((track, index) => (
        <TrackNode
          key={track.id}
          track={track}
          index={index}
          listenerPos={listenerPos}
          isDragging={draggingTrackId === track.id}
          groupRef={(group) => {
            onTrackRef(track.id, group ?? null);
            if (!group) {
              trackGroups.current.delete(track.id);
            } else {
              trackGroups.current.set(track.id, group);
            }
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
            const target = event.target as Element & {
              setPointerCapture?: (id: number) => void;
            };
            target.setPointerCapture?.(event.pointerId);
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
            commitDrag(track.id);
            setDraggingTrackId(null);
            draggingTrackIdRef.current = null;
            const target = event.target as Element & {
              releasePointerCapture?: (id: number) => void;
            };
            target.releasePointerCapture?.(event.pointerId);
          }}
          onPointerMissed={() => {
            if (draggingTrackIdRef.current === track.id) {
              setDraggingTrackId(null);
              draggingTrackIdRef.current = null;
            }
          }}
        />
      ))}
    </>
  );
}
