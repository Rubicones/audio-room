import { useEffect, useRef, useState } from "react";
import { Group } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { Plane, Vector3 } from "three";
import type { AcousticColumn, Vec3 } from "./types";

const SHADOW_Y = 0.01;

const dragPlane = new Plane(new Vector3(0, 1, 0), 0);
const dragPoint = new Vector3();

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type ObstacleColumnProps = {
  column: AcousticColumn;
  roomScale: [number, number, number];
  onPositionChange: (position: Vec3) => void;
  onSelect?: (columnId: string | null) => void;
};

/**
 * Wireframe cylinder only — no opaque fill (blueprint sketch).
 */
export function ObstacleColumn({
  column,
  roomScale,
  onPositionChange,
  onSelect,
}: ObstacleColumnProps) {
  const groupRef = useRef<Group>(null);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const y = column.height / 2;

  const clampToRoom = (point: Vector3) => {
    const halfW = (10 * roomScale[0]) / 2 - column.radius;
    const halfD = (10 * roomScale[2]) / 2 - column.radius;
    point.x = clamp(point.x, -halfW, halfW);
    point.z = clamp(point.z, -halfD, halfD);
    point.y = 0;
  };

  const updateDragFromEvent = (event: ThreeEvent<PointerEvent>) => {
    if (!event.ray.intersectPlane(dragPlane, dragPoint)) return;
    clampToRoom(dragPoint);
    groupRef.current?.position.set(dragPoint.x, 0, dragPoint.z);
    onPositionChange([dragPoint.x, 0, dragPoint.z]);
  };

  useEffect(() => {
    groupRef.current?.position.set(column.position[0], 0, column.position[2]);
  }, [column.position]);

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, SHADOW_Y, 0]}
        visible={dragging}
        onPointerMove={(event) => {
          if (!draggingRef.current) return;
          event.stopPropagation();
          updateDragFromEvent(event);
        }}
        onPointerUp={(event) => {
          if (!draggingRef.current) return;
          event.stopPropagation();
          updateDragFromEvent(event);
          draggingRef.current = false;
          setDragging(false);
        }}
      >
        <planeGeometry args={[10 * roomScale[0], 10 * roomScale[2]]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>

      <group
        ref={groupRef}
        position={[column.position[0], 0, column.position[2]]}
      >
        <mesh position={[0, y, 0]}>
          <cylinderGeometry
            args={[column.radius, column.radius, column.height, 40, 1]}
          />
          <meshBasicMaterial
            color={column.color}
            wireframe
            toneMapped={false}
          />
        </mesh>

        <mesh
          position={[0, y, 0]}
          onPointerDown={(event) => {
            event.stopPropagation();
            onSelect?.(column.id);
            const target = event.target as Element & {
              setPointerCapture?: (id: number) => void;
            };
            target.setPointerCapture?.(event.pointerId);
            draggingRef.current = true;
            setDragging(true);
            updateDragFromEvent(event);
          }}
          onPointerMove={(event) => {
            if (!draggingRef.current) return;
            event.stopPropagation();
            onSelect?.(column.id);
            updateDragFromEvent(event);
          }}
          onPointerUp={(event) => {
            if (!draggingRef.current) return;
            event.stopPropagation();
            updateDragFromEvent(event);
            draggingRef.current = false;
            setDragging(false);
            const target = event.target as Element & {
              releasePointerCapture?: (id: number) => void;
            };
            target.releasePointerCapture?.(event.pointerId);
          }}
          onPointerOver={(event) => {
            event.stopPropagation();
            onSelect?.(column.id);
          }}
          onPointerOut={(event) => {
            event.stopPropagation();
            if (!draggingRef.current) onSelect?.(null);
          }}
        >
          <cylinderGeometry
            args={[column.radius * 1.35, column.radius * 1.35, column.height, 24, 1]}
          />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
    </>
  );
}
