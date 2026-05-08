"use client";

import styles from "./Landing.module.css";

type LandingProps = {
  onStartClean: () => void;
  onStartDemo: () => void;
};

export function Landing({ onStartClean, onStartDemo }: LandingProps) {
  return (
    <div className={styles.overlay}>
      <section className={styles.panel}>
        <h1 className={styles.logo}>foam</h1>
        <p className={styles.description}>
          A professional-grade spatial audio simulator for sound engineers and educators.
          Calculate acoustic distribution, critical distance, and occlusion with engineering
          precision.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.startClean} onClick={onStartClean}>
            start clean
          </button>
          <button type="button" className={styles.startDemo} onClick={onStartDemo}>
            start demo
          </button>
        </div>
        <p className={styles.contactLine}>
          Questions or feedback?{" "}
          <a className={styles.contactLink} href="mailto:hello@foam.audio">
            Contact us
          </a>
        </p>
      </section>
    </div>
  );
}

