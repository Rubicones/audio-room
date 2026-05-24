"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getMaxTrackDurationSeconds,
  getTransportSeconds,
  seekTransport,
} from "@/components/canvas/audioEngine";
import styles from "./PlayerBar.module.css";

const SCRUB_THROTTLE_MS = 45;

type PlayerBarProps = {
  isPlaying: boolean;
  disabled: boolean;
  loading?: boolean;
  onTogglePlay: () => void;
};

function formatTime(seconds: number) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PlayerBar({
  isPlaying,
  disabled,
  loading = false,
  onTogglePlay,
}: PlayerBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const lastScrubRef = useRef(0);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const dur = getMaxTrackDurationSeconds();
      setDuration(dur);
      if (!dragging) {
        const t = getTransportSeconds();
        const wrapped = dur > 0 ? t % dur : t;
        setPosition(wrapped);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dragging]);

  const ratio = useMemo(() => {
    if (duration <= 0) return 0;
    const value = dragging ? dragValue : position;
    return Math.min(1, Math.max(0, value / duration));
  }, [dragging, dragValue, position, duration]);

  const setFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || duration <= 0) return 0;
      const rect = track.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const seconds = t * duration;
      return seconds;
    },
    [duration]
  );

  const maybeSeek = useCallback(
    (seconds: number, force: boolean) => {
      const now = performance.now();
      if (force || now - lastScrubRef.current >= SCRUB_THROTTLE_MS) {
        lastScrubRef.current = now;
        seekTransport(seconds);
      }
    },
    []
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== " ") return;
      if (event.repeat) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, textarea, select, [contenteditable='true']"))
      ) {
        return;
      }
      if (disabled || loading) return;
      event.preventDefault();
      onTogglePlay();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [disabled, loading, onTogglePlay]);

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const next = setFromClientX(event.clientX);
      setDragValue(next);
      maybeSeek(next, false);
    };
    const up = (event: PointerEvent) => {
      const el = trackRef.current;
      if (el?.hasPointerCapture?.(event.pointerId)) {
        el.releasePointerCapture(event.pointerId);
      }
      const finalValue = setFromClientX(event.clientX);
      maybeSeek(finalValue, true);
      setPosition(finalValue);
      setDragValue(finalValue);
      setDragging(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, setFromClientX, maybeSeek]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const value = setFromClientX(event.clientX);
    setDragValue(value);
    setDragging(true);
    maybeSeek(value, true);
  };

  const displayPosition = dragging ? dragValue : position;

  return (
    <div className={styles.row}>
      <button
        type="button"
        className={`${styles.playBtn} ${isPlaying ? styles.playBtnActive : ""}`}
        onClick={onTogglePlay}
        disabled={disabled || loading}
        aria-label={loading ? "Loading" : isPlaying ? "Pause" : "Play"}
      >
        {loading ? (
          <span className={styles.spinner} aria-hidden />
        ) : isPlaying ? (
          <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
            <path d="M7 5 L19 12 L7 19 Z" />
          </svg>
        )}
      </button>
      <div
        ref={trackRef}
        className={styles.track}
        onPointerDown={handlePointerDown}
        aria-disabled={disabled || duration <= 0}
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
      <span className={styles.time}>
        {formatTime(displayPosition)} / {formatTime(duration)}
      </span>
    </div>
  );
}
