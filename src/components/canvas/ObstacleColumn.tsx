import { useRef, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { Plane, Vector3 } from "three";
import type { AcousticObstacle, Vec3 } from "./types";
import { getWallWithWindowGeometry2D } from "./obstacleConstants";

const SHADOW_Y = 0.01;

const dragPlane = new Plane(new Vector3(0, 1, 0), 0);
const dragPoint = new Vector3();

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type ObstacleColumnProps = {
  obstacle: AcousticObstacle;
  roomScale: [number, number, number];
  onPositionChange: (position: Vec3) => void;
  onSelect?: (obstacleId: string | null) => void;
  isReadOnly?: boolean;
};

/**
 * Wireframe cylinder only — no opaque fill (blueprint sketch).
 */
export function ObstacleColumn({
  obstacle,
  roomScale,
  onPositionChange,
  onSelect,
  isReadOnly = false,
}: ObstacleColumnProps) {
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const y = obstacle.height / 2;
  const roomWidth = roomScale[0] * 10;
  const roomDepth = roomScale[2] * 10;
  const wallDepth = obstacle.depth ?? Math.max(0.3, obstacle.radius * 1.6);
  const boxWidth = obstacle.width ?? 1;
  const boxDepth = obstacle.depth ?? 1;
  const wallGeometry =
    obstacle.type === "wall-with-window"
      ? getWallWithWindowGeometry2D(obstacle, roomWidth, roomDepth)
      : null;

  const clampToRoom = (point: Vector3) => {
    const extentX =
      obstacle.type === "box"
        ? boxWidth / 2
        : obstacle.type === "wall-with-window"
          ? 0.1
          : obstacle.radius;
    const extentZ =
      obstacle.type === "box"
        ? boxDepth / 2
        : obstacle.type === "wall-with-window"
          ? 0.1
          : obstacle.radius;
    const halfW = roomWidth / 2 - extentX;
    const halfD = roomDepth / 2 - extentZ;
    point.x = clamp(point.x, -halfW, halfW);
    point.z = clamp(point.z, -halfD, halfD);
    point.y = 0;
  };

  const updateDragFromEvent = (event: ThreeEvent<PointerEvent>) => {
    if (!event.ray.intersectPlane(dragPlane, dragPoint)) return;
    clampToRoom(dragPoint);
    if (obstacle.type === "wall-with-window") {
      const limitX = roomWidth / 2 - 0.05;
      const limitZ = roomDepth / 2 - 0.05;
      dragPoint.x = Math.min(limitX, Math.max(-limitX, dragPoint.x));
      dragPoint.z = Math.min(limitZ, Math.max(-limitZ, dragPoint.z));
    }
    onPositionChange([dragPoint.x, 0, dragPoint.z]);
  };

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (isReadOnly) return;
    event.stopPropagation();
    onSelect?.(obstacle.id);
    const target = event.target as Element & {
      setPointerCapture?: (id: number) => void;
    };
    target.setPointerCapture?.(event.pointerId);
    draggingRef.current = true;
    setDragging(true);
    updateDragFromEvent(event);
  };

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (isReadOnly) return;
    if (!draggingRef.current) return;
    event.stopPropagation();
    onSelect?.(obstacle.id);
    updateDragFromEvent(event);
  };

  const handlePointerUp = (event: ThreeEvent<PointerEvent>) => {
    if (isReadOnly) return;
    if (!draggingRef.current) return;
    event.stopPropagation();
    updateDragFromEvent(event);
    draggingRef.current = false;
    setDragging(false);
    const target = event.target as Element & {
      releasePointerCapture?: (id: number) => void;
    };
    target.releasePointerCapture?.(event.pointerId);
  };

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
        position={[obstacle.position[0], 0, obstacle.position[2]]}
        rotation-y={obstacle.type === "wall-with-window" ? -(obstacle.rotationDeg * Math.PI) / 180 : 0}
      >
        {obstacle.type === "wall-with-window" && wallGeometry ? (
          <>
            {(() => {
              const leftEndT = Math.max(
                wallGeometry.tMin,
                Math.min(wallGeometry.tGapStart, wallGeometry.tMax)
              );
              const rightStartT = Math.min(
                wallGeometry.tMax,
                Math.max(wallGeometry.tGapEnd, wallGeometry.tMin)
              );
              const leftLen = Math.max(0, leftEndT - wallGeometry.tMin);
              const rightLen = Math.max(0, wallGeometry.tMax - rightStartT);
              const leftCenter = (wallGeometry.tMin + leftEndT) / 2;
              const rightCenter = (rightStartT + wallGeometry.tMax) / 2;
              const windowSpan = Math.max(0, rightStartT - leftEndT);
              const windowCenter = (leftEndT + rightStartT) / 2;

              return (
                <>
                  {leftLen > 1e-4 ? (
                    <>
                      <mesh position={[leftCenter, y, 0]}>
                        <boxGeometry args={[leftLen, obstacle.height, wallDepth]} />
                        <meshBasicMaterial color={obstacle.color} wireframe toneMapped={false} />
                      </mesh>
                      <mesh
                        position={[leftCenter, y, 0]}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                      >
                        <boxGeometry args={[leftLen, obstacle.height, wallDepth]} />
                        <meshBasicMaterial
                          color="#ffffff"
                          transparent
                          opacity={0}
                          depthWrite={false}
                          toneMapped={false}
                        />
                      </mesh>
                    </>
                  ) : null}
                  {rightLen > 1e-4 ? (
                    <>
                      <mesh position={[rightCenter, y, 0]}>
                        <boxGeometry args={[rightLen, obstacle.height, wallDepth]} />
                        <meshBasicMaterial color={obstacle.color} wireframe toneMapped={false} />
                      </mesh>
                      <mesh
                        position={[rightCenter, y, 0]}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                      >
                        <boxGeometry args={[rightLen, obstacle.height, wallDepth]} />
                        <meshBasicMaterial
                          color="#ffffff"
                          transparent
                          opacity={0}
                          depthWrite={false}
                          toneMapped={false}
                        />
                      </mesh>
                    </>
                  ) : null}
                  {windowSpan > 1e-4 ? (
                    <mesh
                      position={[windowCenter, y, 0]}
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                    >
                      <boxGeometry args={[windowSpan, obstacle.height, wallDepth]} />
                      <meshBasicMaterial
                        color="#ffffff"
                        transparent
                        opacity={0}
                        depthWrite={false}
                        toneMapped={false}
                      />
                    </mesh>
                  ) : null}
                </>
              );
            })()}
          </>
        ) : (
          <>
          {obstacle.type === "cylinder" ? (
            <mesh position={[0, y, 0]}>
              <cylinderGeometry
                args={[obstacle.radius, obstacle.radius, obstacle.height, 40, 1]}
              />
              <meshBasicMaterial
                color={obstacle.color}
                wireframe
                toneMapped={false}
              />
            </mesh>
          ) : obstacle.type === "box" ? (
            <mesh position={[0, y, 0]}>
              <boxGeometry args={[boxWidth, obstacle.height, boxDepth]} />
              <meshBasicMaterial
                color={obstacle.color}
                wireframe
                toneMapped={false}
              />
            </mesh>
          ) : null}
          <mesh
            position={[0, y, 0]}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {obstacle.type === "box" ? (
              <boxGeometry args={[boxWidth * 1.15, obstacle.height, boxDepth * 1.15]} />
            ) : (
              <cylinderGeometry
                args={[obstacle.radius * 1.35, obstacle.radius * 1.35, obstacle.height, 24, 1]}
              />
            )}
            <meshBasicMaterial
              color="#ffffff"
              transparent
              opacity={0}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          </>
        )}
      </group>
    </>
  );
}
