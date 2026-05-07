import { Line, Text } from "@react-three/drei";
import { useMemo } from "react";
import { DoubleSide, Shape } from "three";
import { useItimFontUrl } from "./sketch";

const INK = "#1a1a1a";
const LABEL_FONT_SIZE = 0.34;
const LABEL_CHAR_HALF_WIDTH = 0.105;
const LABEL_PADDING = 0.18;

const ARROW_LEN = 0.42;
const ARROW_WING = 0.18;
const ARROW_CORNER_RADIUS = 0.06;

type DimensionLinesProps = {
  scale: [number, number, number];
};

/**
 * Triangle pointing in -X with rounded corners.
 *   tip at (-len, 0)
 *   wings at (0, ±wing)
 *
 * The arrow is positioned so that the TIP lands on the wall corner and the
 * wings sit inset by `ARROW_LEN` along the dim-line axis — the whole
 * arrowhead lives strictly inside the wall span.
 */
function makeRoundedArrowShape(len: number, wing: number, radius: number) {
  const tipLen = Math.sqrt(len * len + wing * wing);
  const ux = len / tipLen;
  const uy = wing / tipLen;
  const r = Math.min(radius, len * 0.25, wing * 0.5);

  const shape = new Shape();
  // Counter-clockwise winding so the front face has +Z normal.
  shape.moveTo(0, wing - r);
  shape.lineTo(0, -wing + r);
  // Round wing- corner
  shape.quadraticCurveTo(0, -wing, -r * ux, -wing + r * uy);
  // Slope toward the tip
  shape.lineTo(-len + r * ux, -r * uy);
  // Round tip
  shape.quadraticCurveTo(-len, 0, -len + r * ux, r * uy);
  // Slope back to wing+
  shape.lineTo(-r * ux, wing - r * uy);
  // Round wing+ corner
  shape.quadraticCurveTo(0, wing, 0, wing - r);
  return shape;
}

function ArrowHead({
  position,
  rotation,
}: {
  position: [number, number, number];
  rotation: [number, number, number];
}) {
  const shape = useMemo(
    () => makeRoundedArrowShape(ARROW_LEN, ARROW_WING, ARROW_CORNER_RADIUS),
    []
  );

  return (
    <mesh position={position} rotation={rotation}>
      <shapeGeometry args={[shape, 12]} />
      <meshBasicMaterial color={INK} side={DoubleSide} toneMapped={false} />
    </mesh>
  );
}

function labelHalfWidth(text: string) {
  return text.length * LABEL_CHAR_HALF_WIDTH + LABEL_PADDING;
}

type Axis = "x" | "y" | "z";

function SplitLineWithLabel({
  start,
  end,
  axis,
  text,
  labelRotation,
}: {
  start: [number, number, number];
  end: [number, number, number];
  axis: Axis;
  text: string;
  labelRotation: [number, number, number];
}) {
  const fontUrl = useItimFontUrl();
  const half = labelHalfWidth(text);
  const idx = axis === "x" ? 0 : axis === "y" ? 1 : 2;

  const direction = end[idx] - start[idx];
  const sign = direction >= 0 ? 1 : -1;

  // Inset the line endpoints by ARROW_LEN so the line meets the back of each
  // arrowhead (whose tip sits on the wall corner) without poking through it.
  const innerStart: [number, number, number] = [...start];
  innerStart[idx] = start[idx] + sign * ARROW_LEN;
  const innerEnd: [number, number, number] = [...end];
  innerEnd[idx] = end[idx] - sign * ARROW_LEN;

  const mid: [number, number, number] = [
    (start[0] + end[0]) / 2,
    (start[1] + end[1]) / 2,
    (start[2] + end[2]) / 2,
  ];

  const leftEnd: [number, number, number] = [...mid];
  const rightStart: [number, number, number] = [...mid];
  leftEnd[idx] = mid[idx] - sign * half;
  rightStart[idx] = mid[idx] + sign * half;

  return (
    <group>
      <Line points={[innerStart, leftEnd]} color={INK} lineWidth={1.5} />
      <Line points={[rightStart, innerEnd]} color={INK} lineWidth={1.5} />
      <Text
        position={mid}
        rotation={labelRotation}
        fontSize={LABEL_FONT_SIZE}
        color={INK}
        anchorX="center"
        anchorY="middle"
        font={fontUrl}
        outlineWidth={0}
      >
        {text}
      </Text>
    </group>
  );
}

export function DimensionLines({ scale }: DimensionLinesProps) {
  const width = 10 * scale[0];
  const height = 4 * scale[1];
  const depth = 10 * scale[2];
  const halfW = width / 2;
  const halfD = depth / 2;
  const offset = 0.45;

  const widthM = `${width.toFixed(1)}m`;
  const heightM = `${height.toFixed(1)}m`;
  const depthM = `${depth.toFixed(1)}m`;

  return (
    <group>
      {/* Width — front edge, runs along +X */}
      <SplitLineWithLabel
        start={[-halfW, 0.005, halfD + offset]}
        end={[halfW, 0.005, halfD + offset]}
        axis="x"
        text={widthM}
        labelRotation={[-Math.PI / 2, 0, 0]}
      />
      {/* Left arrow: tip at -halfW corner, wings inset toward center */}
      <ArrowHead
        position={[-halfW + ARROW_LEN, 0.005, halfD + offset]}
        rotation={[-Math.PI / 2, 0, 0]}
      />
      {/* Right arrow: tip at +halfW corner, wings inset toward center */}
      <ArrowHead
        position={[halfW - ARROW_LEN, 0.005, halfD + offset]}
        rotation={[-Math.PI / 2, 0, Math.PI]}
      />

      {/* Depth — right edge, runs along +Z */}
      <SplitLineWithLabel
        start={[halfW + offset, 0.005, -halfD]}
        end={[halfW + offset, 0.005, halfD]}
        axis="z"
        text={depthM}
        labelRotation={[-Math.PI / 2, 0, Math.PI / 2]}
      />
      {/* Back arrow: tip at -halfD corner, wings inset toward center */}
      <ArrowHead
        position={[halfW + offset, 0.005, -halfD + ARROW_LEN]}
        rotation={[-Math.PI / 2, 0, -Math.PI / 2]}
      />
      {/* Front arrow: tip at +halfD corner, wings inset toward center */}
      <ArrowHead
        position={[halfW + offset, 0.005, halfD - ARROW_LEN]}
        rotation={[-Math.PI / 2, 0, Math.PI / 2]}
      />

      {/* Height — left-front vertical edge, runs along +Y */}
      <SplitLineWithLabel
        start={[-halfW - offset, 0, halfD]}
        end={[-halfW - offset, height, halfD]}
        axis="y"
        text={heightM}
        labelRotation={[0, Math.PI / 2, Math.PI / 2]}
      />
      {/* Bottom arrow: tip at floor corner, wings inset upward */}
      <ArrowHead
        position={[-halfW - offset, ARROW_LEN, halfD]}
        rotation={[0, 0, Math.PI / 2]}
      />
      {/* Top arrow: tip at ceiling corner, wings inset downward */}
      <ArrowHead
        position={[-halfW - offset, height - ARROW_LEN, halfD]}
        rotation={[0, 0, -Math.PI / 2]}
      />
    </group>
  );
}
