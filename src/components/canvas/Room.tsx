import { Edges, Line, Text } from "@react-three/drei";
import type { RoomMaterialPreset } from "./TrackStore";
import { useItimFontUrl } from "./sketch";

const INK = "#1a1a1a";
const WALL_LINE_WIDTH = 3;
const CORNER_INSET = 0.012;

const MATERIAL_LABELS: Record<RoomMaterialPreset, string> = {
  brick: "BRICK",
  wood: "WOOD",
  "acoustic-foam": "FOAM",
  marble: "MARBLE",
};

type RoomProps = {
  scale: [number, number, number];
  materialPreset: RoomMaterialPreset;
};

export function Room({ scale, materialPreset }: RoomProps) {
  const width = 10 * scale[0];
  const height = 4 * scale[1];
  const depth = 10 * scale[2];

  const halfW = width / 2;
  const halfD = depth / 2;
  const label = MATERIAL_LABELS[materialPreset];
  const fontUrl = useItimFontUrl();

  const labelFontSize = Math.min(height * 0.42, Math.min(halfW, halfD) * 0.3);
  const sizeKey = `${width.toFixed(2)}x${height.toFixed(2)}x${depth.toFixed(2)}`;

  // Inset slightly toward room interior so the lines render in front of the
  // wall planes (avoids z-fighting with EdgesGeometry).
  const innerLeft = -halfW + CORNER_INSET;
  const innerBack = -halfD + CORNER_INSET;
  const innerFront = halfD - CORNER_INSET;
  const innerRight = halfW - CORNER_INSET;
  const innerFloor = CORNER_INSET;
  const innerCeil = height - CORNER_INSET;

  return (
    <group>
      <mesh
        key={`floor-${sizeKey}`}
        position={[0, 0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
        <Edges color={INK} lineWidth={WALL_LINE_WIDTH} />
      </mesh>

      <mesh
        key={`back-${sizeKey}`}
        position={[0, height / 2, -halfD]}
      >
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
        <Edges color={INK} lineWidth={WALL_LINE_WIDTH} />
      </mesh>

      <mesh
        key={`left-${sizeKey}`}
        position={[-halfW, height / 2, 0]}
        rotation={[0, Math.PI / 2, 0]}
      >
        <planeGeometry args={[depth, height]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
        <Edges color={INK} lineWidth={WALL_LINE_WIDTH} />
      </mesh>

      {/* Vertical inner corner: left wall <-> back wall */}
      <Line
        points={[
          [innerLeft, innerFloor, innerBack],
          [innerLeft, innerCeil, innerBack],
        ]}
        color={INK}
        lineWidth={WALL_LINE_WIDTH}
      />
      {/* Floor edge along the back wall */}
      <Line
        points={[
          [innerLeft, innerFloor, innerBack],
          [innerRight, innerFloor, innerBack],
        ]}
        color={INK}
        lineWidth={WALL_LINE_WIDTH}
      />
      {/* Floor edge along the left wall */}
      <Line
        points={[
          [innerLeft, innerFloor, innerBack],
          [innerLeft, innerFloor, innerFront],
        ]}
        color={INK}
        lineWidth={WALL_LINE_WIDTH}
      />

      <Text
        position={[0, height * 0.55, -halfD + 0.015]}
        fontSize={labelFontSize}
        color={INK}
        anchorX="center"
        anchorY="middle"
        font={fontUrl}
        letterSpacing={0.06}
        outlineWidth={0}
      >
        {label}
      </Text>

      <Text
        position={[-halfW + 0.015, height * 0.55, 0]}
        rotation={[0, Math.PI / 2, 0]}
        fontSize={labelFontSize}
        color={INK}
        anchorX="center"
        anchorY="middle"
        font={fontUrl}
        letterSpacing={0.06}
        outlineWidth={0}
      >
        {label}
      </Text>
    </group>
  );
}
