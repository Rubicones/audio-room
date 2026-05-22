import type { Track, Vec3 } from "@/components/canvas/types";

export type QuizTrackResult = {
  sourceTrackId: string;
  guessTrackId: string | null;
  trackName: string;
  displayIndex: number;
  placed: boolean;
  positionAccuracyPct: number;
  directionAccuracyPct: number | null;
  combinedAccuracyPct: number;
  distanceErrorM: number;
  directionErrorDeg: number | null;
  actualPosition: Vec3;
  guessPosition: Vec3 | null;
  details: {
    listenerDistanceM: number;
    panLabel: string;
    actualRotationDeg: number;
    guessRotationDeg: number | null;
    attenuationDb: number;
    guessDirectionEnabled: boolean;
  };
};

function distance3d(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function normalizeDeg(value: number): number {
  return ((value % 360) + 360) % 360;
}

function shortestAngleDiff(a: number, b: number): number {
  const delta = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  return delta > 180 ? 360 - delta : delta;
}

function listenerDistanceM(listener: Vec3, position: Vec3): number {
  const dx = position[0] - listener[0];
  const dy = position[1] - listener[1];
  const dz = position[2] - listener[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function panLabelFromListener(listener: Vec3, position: Vec3): string {
  const dx = position[0] - listener[0];
  const dz = position[2] - listener[2];
  if (Math.abs(dx) < 0.05 && Math.abs(dz) < 0.05) return "center";
  const angle = (Math.atan2(dx, -dz) * 180) / Math.PI;
  if (angle < -45) return "left";
  if (angle > 45) return "right";
  return "center";
}

function attenuationDbFromDistance(distance: number): number {
  const d = Math.max(0.001, distance);
  return 20 * Math.log10(1 / d);
}

function maxPlacementErrorM(roomScale: [number, number, number]): number {
  const halfW = 5 * roomScale[0];
  const halfD = 5 * roomScale[2];
  return Math.sqrt(halfW * halfW + halfD * halfD);
}

export function scoreQuizTracks(input: {
  sourceTracks: Track[];
  guessTracks: Track[];
  listenerPosition: Vec3;
  roomScale: [number, number, number];
}): QuizTrackResult[] {
  const { sourceTracks, guessTracks, listenerPosition, roomScale } = input;
  const maxErrorM = maxPlacementErrorM(roomScale);

  return sourceTracks.map((source, index) => {
    const guess = guessTracks.find((track) => track.quizSourceTrackId === source.id) ?? null;
    const placed = Boolean(guess);
    const distanceErrorM = placed ? distance3d(source.position, guess!.position) : maxErrorM;
    const positionAccuracyPct = Math.round(
      100 * Math.max(0, 1 - distanceErrorM / maxErrorM)
    );

    let directionErrorDeg: number | null = null;
    let directionAccuracyPct: number | null = null;
    if (placed && guess!.isDirectivityEnabled) {
      directionErrorDeg = shortestAngleDiff(source.rotationDeg, guess!.rotationDeg);
      directionAccuracyPct = Math.round(100 * Math.max(0, 1 - directionErrorDeg / 180));
    }

    const combinedAccuracyPct =
      directionAccuracyPct != null
        ? Math.round((positionAccuracyPct + directionAccuracyPct) / 2)
        : positionAccuracyPct;

    const listenerDist = listenerDistanceM(listenerPosition, source.position);

    return {
      sourceTrackId: source.id,
      guessTrackId: guess?.id ?? null,
      trackName: source.name,
      displayIndex: guess?.quizDisplayIndex ?? index + 1,
      placed,
      positionAccuracyPct,
      directionAccuracyPct,
      combinedAccuracyPct,
      distanceErrorM: placed ? distanceErrorM : maxErrorM,
      directionErrorDeg,
      actualPosition: source.position,
      guessPosition: guess?.position ?? null,
      details: {
        listenerDistanceM: listenerDist,
        panLabel: panLabelFromListener(listenerPosition, source.position),
        actualRotationDeg: source.rotationDeg,
        guessRotationDeg: guess?.rotationDeg ?? null,
        attenuationDb: attenuationDbFromDistance(listenerDist),
        guessDirectionEnabled: Boolean(guess?.isDirectivityEnabled),
      },
    };
  });
}

export type QuizReviewPair = {
  id: string;
  color: string;
  guessPosition: Vec3;
  actualPosition: Vec3;
  distanceM: number;
};

export function toQuizReviewPairs(results: QuizTrackResult[], tracks: Track[]): QuizReviewPair[] {
  return results
    .filter((result) => result.placed && result.guessPosition)
    .map((result) => {
      const source = tracks.find((track) => track.id === result.sourceTrackId);
      return {
        id: result.sourceTrackId,
        color: source?.color ?? "#4A90E2",
        guessPosition: result.guessPosition!,
        actualPosition: result.actualPosition,
        distanceM: result.distanceErrorM,
      };
    });
}
