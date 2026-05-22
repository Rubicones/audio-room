import type { Track } from "@/components/canvas/types";

export function getQuizGuessTrackId(sourceTrackId: string): string {
  return `quiz-guess-${sourceTrackId}`;
}

export function toQuizSourceTracks(tracks: Track[]): Track[] {
  return tracks.map((track) => ({ ...track, quizHidden: true }));
}

export function isQuizAudioTrack(track: Track): boolean {
  return Boolean(track.quizHidden);
}

export function isQuizGuessTrack(track: Track): boolean {
  return Boolean(track.isQuizGuess);
}

export function getQuizAudioTrackIds(tracks: Track[]): string[] {
  return tracks.filter((track) => track.quizHidden && track.audioUrl).map((track) => track.id);
}

export type QuizCompareMode = "actual" | "guess";

export function getQuizGuessForSource(tracks: Track[], sourceTrackId: string): Track | null {
  return (
    tracks.find(
      (track) => track.isQuizGuess && track.quizSourceTrackId === sourceTrackId
    ) ?? null
  );
}
