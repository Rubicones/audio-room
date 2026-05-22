"use client";

import { Billboard, Line, Text } from "@react-three/drei";
import type { QuizReviewPair } from "@/lib/quizScoring";
import { useItimFontUrl } from "./sketch";

const INK = "#1a1a1a";
const LINE_Y_OFFSET = 0.08;

type QuizReviewOverlayProps = {
  pairs: QuizReviewPair[];
};

export function QuizReviewOverlay({ pairs }: QuizReviewOverlayProps) {
  const fontUrl = useItimFontUrl();

  return (
    <>
      {pairs.map((pair) => {
        const guessY = pair.guessPosition[1] + LINE_Y_OFFSET;
        const actualY = pair.actualPosition[1] + LINE_Y_OFFSET;
        const linePoints: [number, number, number][] = [
          [pair.guessPosition[0], guessY, pair.guessPosition[2]],
          [pair.actualPosition[0], actualY, pair.actualPosition[2]],
        ];
        const mid: [number, number, number] = [
          (pair.guessPosition[0] + pair.actualPosition[0]) / 2,
          (guessY + actualY) / 2 + 0.35,
          (pair.guessPosition[2] + pair.actualPosition[2]) / 2,
        ];

        return (
          <group key={pair.id}>
            <Line
              points={linePoints}
              color={pair.color}
              lineWidth={2.4}
              dashed
              dashSize={0.18}
              gapSize={0.12}
            />
            <Billboard position={mid}>
              <Text
                fontSize={0.22}
                color={INK}
                anchorX="center"
                anchorY="middle"
                font={fontUrl}
                outlineWidth={0}
              >
                {`${pair.distanceM.toFixed(2)} m`}
              </Text>
            </Billboard>
          </group>
        );
      })}
    </>
  );
}
