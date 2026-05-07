import { BoxGeometry } from "three";
import type { RoomMaterialPreset } from "./TrackStore";

const FLOOR_GEOMETRY = new BoxGeometry(1, 0.2, 1);
const WALL_X_GEOMETRY = new BoxGeometry(0.2, 1, 1);
const WALL_Z_GEOMETRY = new BoxGeometry(1, 1, 0.2);
type RoomProps = {
  scale: [number, number, number];
  materialPreset: RoomMaterialPreset;
};

const MATERIAL_COLORS: Record<RoomMaterialPreset, { floor: string; wall: string }> = {
  brick: { floor: "#E4DFDA", wall: "#C8B1A0" },
  wood: { floor: "#CBAA86", wall: "#B9885A" },
  "acoustic-foam": { floor: "#CDD1D6", wall: "#8E949F" },
  marble: { floor: "#F1F2F6", wall: "#E7EAF0" },
};

export function Room({ scale, materialPreset }: RoomProps) {
  const width = 10 * scale[0];
  const height = 4 * scale[1];
  const depth = 10 * scale[2];
  const wallThickness = 0.2;
  const palette = MATERIAL_COLORS[materialPreset];

  return (
    <group>
      <mesh
        geometry={FLOOR_GEOMETRY}
        position={[0, -0.1, 0]}
        scale={[width, 1, depth]}
        receiveShadow
      >
        <meshStandardMaterial color={palette.floor} roughness={1} metalness={0} />
      </mesh>

      <mesh
        geometry={WALL_Z_GEOMETRY}
        position={[0, height / 2, -depth / 2 + wallThickness / 2]}
        scale={[width, height, 1]}
      >
        <meshStandardMaterial color={palette.wall} roughness={1} metalness={0} />
      </mesh>

      <mesh
        geometry={WALL_X_GEOMETRY}
        position={[-width / 2 + wallThickness / 2, height / 2, 0]}
        scale={[1, height, depth]}
      >
        <meshStandardMaterial color={palette.wall} roughness={1} metalness={0} />
      </mesh>
    </group>
  );
}
