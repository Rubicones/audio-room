import { DragControls, RoundedBox } from "@react-three/drei";
import { useMemo } from "react";
import { Matrix4, Quaternion, Vector3 } from "three";

const FLOOR_Y = 0.6;
const LIMIT = 4.4;

const tempPosition = new Vector3();
const tempQuaternion = new Quaternion();
const tempScale = new Vector3();

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lockToFloor(matrix: Matrix4) {
  matrix.decompose(tempPosition, tempQuaternion, tempScale);
  tempPosition.y = FLOOR_Y;
  tempPosition.x = clamp(tempPosition.x, -LIMIT, LIMIT);
  tempPosition.z = clamp(tempPosition.z, -LIMIT, LIMIT);
  matrix.compose(tempPosition, tempQuaternion, tempScale);
}

function DraggableSphere({ position, color }: { position: [number, number, number]; color: string }) {
  return (
    <DragControls autoTransform onDrag={lockToFloor}>
      <mesh position={position} castShadow receiveShadow>
        <sphereGeometry args={[0.45, 32, 32]} />
        <meshStandardMaterial color={color} roughness={0.9} metalness={0} />
      </mesh>
    </DragControls>
  );
}

export function Placeholders() {
  const instruments = useMemo(
    () => [
      { position: [-2, FLOOR_Y, -1] as [number, number, number], color: "#FF8AAE" },
      { position: [2.2, FLOOR_Y, -2.1] as [number, number, number], color: "#A6D8FF" },
      { position: [0.8, FLOOR_Y, 1.8] as [number, number, number], color: "#B5E7A0" },
    ],
    []
  );

  return (
    <>
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
        <RoundedBox args={[0.85, 0.85, 0.85]} radius={0.2} smoothness={4}>
          <meshStandardMaterial color="#D7C9FF" roughness={0.85} metalness={0} />
        </RoundedBox>
      </mesh>

      {instruments.map((instrument, index) => (
        <DraggableSphere key={index} position={instrument.position} color={instrument.color} />
      ))}
    </>
  );
}
