"use client";

import styles from "./QuizIntroModal.module.css";

type QuizIntroModalProps = {
  open: boolean;
  onStart: () => void;
};

export function QuizIntroModal({ open, onStart }: QuizIntroModalProps) {
  if (!open) return null;

  return (
    <div className={styles.backdrop}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quiz-intro-title"
      >
        <div className={styles.header}>
          <h2 id="quiz-intro-title" className={styles.title}>
            quiz challenge
          </h2>
          <button
            type="button"
            className={styles.close}
            aria-label="Close introduction"
            onClick={onStart}
          >
            ×
          </button>
        </div>

        <p className={styles.lead}>
          You are in quiz mode. This is a placement challenge, not the original editable project
          view.
        </p>

        <p className={styles.notice}>
          Track positions are hidden. You will hear the full mix, but you cannot see where the
          sources actually are until you finish.
        </p>

        <ol className={styles.steps}>
          <li>Press play and listen to how the mix sounds in the room.</li>
          <li>Use the sidebar to place each track where you think it belongs.</li>
          <li>Optionally turn direction on and set the bearing for each source.</li>
          <li>Click done when finished to reveal answers, see your score, and compare mixes.</li>
        </ol>

        <div className={styles.footer}>
          <button type="button" className={styles.startBtn} onClick={onStart}>
            start quiz
          </button>
        </div>
      </div>
    </div>
  );
}
