"use client";

import type { QuizTrackResult } from "@/lib/quizScoring";
import styles from "./QuizResultsModal.module.css";

type QuizResultsModalProps = {
  open: boolean;
  results: QuizTrackResult[];
  onClose: () => void;
};

function scoreClass(pct: number): string {
  if (pct >= 75) return styles.quizResultScoreGood;
  if (pct >= 45) return styles.quizResultScoreMid;
  return styles.quizResultScoreLow;
}

function formatAttenuation(db: number): string {
  return Number.isFinite(db) ? `${db.toFixed(1)} dB` : "-inf dB";
}

export function QuizResultsModal({ open, results, onClose }: QuizResultsModalProps) {
  if (!open) return null;

  const placed = results.filter((result) => result.placed);
  const overallPct =
    placed.length > 0
      ? Math.round(
          placed.reduce((sum, result) => sum + result.combinedAccuracyPct, 0) / placed.length
        )
      : 0;

  return (
    <div className={styles.quizModalBackdrop} onClick={onClose}>
      <div
        className={styles.quizModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quiz-results-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.quizModalHeader}>
          <h2 id="quiz-results-title" className={styles.quizModalTitle}>
            quiz results
          </h2>
          <button
            type="button"
            className={styles.quizModalClose}
            aria-label="Close results"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <p className={styles.quizModalSummary}>
          {placed.length > 0
            ? `Overall accuracy: ${overallPct}% across ${placed.length} placed track${placed.length === 1 ? "" : "s"}. Answers are shown on the scene.`
            : "No tracks were placed. Place tracks on the scene before finishing the quiz."}
        </p>

        <div className={styles.quizModalList}>
          {results.map((result) => (
            <article key={result.sourceTrackId} className={styles.quizResultCard}>
              <div className={styles.quizResultCardHeader}>
                <span className={styles.quizResultTrackName} title={result.trackName}>
                  {result.displayIndex}. {result.trackName}
                </span>
                {result.placed ? (
                  <span className={`${styles.quizResultScore} ${scoreClass(result.combinedAccuracyPct)}`}>
                    {result.combinedAccuracyPct}%
                  </span>
                ) : null}
              </div>

              {!result.placed ? (
                <p className={styles.quizResultUnplaced}>Not placed</p>
              ) : (
                <>
                  <div className={styles.quizResultBreakdown}>
                    <span>position: {result.positionAccuracyPct}%</span>
                    <span>error: {result.distanceErrorM.toFixed(2)} m</span>
                    {result.directionAccuracyPct != null ? (
                      <span>direction: {result.directionAccuracyPct}%</span>
                    ) : null}
                    {result.directionErrorDeg != null ? (
                      <span>angle error: {result.directionErrorDeg.toFixed(0)}°</span>
                    ) : null}
                  </div>
                  <p className={styles.quizResultDetails}>
                    Listener distance {result.details.listenerDistanceM.toFixed(2)} m · pan{" "}
                    {result.details.panLabel} · attenuation{" "}
                    {formatAttenuation(result.details.attenuationDb)}
                    {result.details.guessDirectionEnabled
                      ? ` · actual bearing ${result.details.actualRotationDeg.toFixed(0)}° · your bearing ${result.details.guessRotationDeg?.toFixed(0) ?? "0"}°`
                      : " · direction off"}
                  </p>
                </>
              )}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
