"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./SketchSlider.module.css";

type SketchSliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatValue: (value: number) => string;
};

export function SketchSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
}: SketchSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const ratio = useMemo(
    () => Math.min(1, Math.max(0, (value - min) / (max - min))),
    [value, min, max]
  );

  const setFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const raw = min + t * (max - min);
      const stepped = Math.round(raw / step) * step;
      const clamped = Math.min(max, Math.max(min, stepped));
      onChange(Number(clamped.toFixed(4)));
    },
    [min, max, step, onChange]
  );

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => setFromClientX(event.clientX);
    const up = (event: PointerEvent) => {
      const el = trackRef.current;
      if (el?.hasPointerCapture?.(event.pointerId)) {
        el.releasePointerCapture(event.pointerId);
      }
      setDragging(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, setFromClientX]);

  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <div
        ref={trackRef}
        className={styles.track}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          setFromClientX(event.clientX);
        }}
      >
        <div className={styles.lineMuted} aria-hidden />
        <div
          className={styles.linePlayed}
          style={{ width: `${ratio * 100}%` }}
          aria-hidden
        />
        <div
          className={styles.handle}
          style={{ left: `${ratio * 100}%` }}
          aria-hidden
        />
      </div>
      <span className={styles.value}>{formatValue(value)}</span>
    </div>
  );
}
