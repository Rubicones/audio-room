"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { DefaultLoadingManager } from "three";
import * as Tone from "tone";
import {
  disposeAudioEngine,
  getTrackAcousticData,
  isTrackLoaded,
  getTrackLoadingState,
  type TrackAcousticData,
  toggleTransport,
  waitForToneLoaded,
} from "@/components/canvas/audioEngine";
import { CameraView } from "@/components/canvas/CameraRig";
import { SceneCanvas } from "@/components/canvas/SceneCanvas";
import {
  TrackStoreProvider,
  useTrackStore,
} from "@/components/canvas/TrackStore";
import type { TrackConfig } from "@/components/canvas/types";
import { PlayerBar } from "@/components/ui/PlayerBar";
import { SketchSlider } from "@/components/ui/SketchSlider";
import { Landing } from "./Landing";
import styles from "./page.module.css";

const PALETTE = ["#E16A6A", "#E5B94A", "#5BC489", "#7B5BE6", "#4A90E2", "#E07A5F"];

// All stems in `public/demo_track/` — loaded when the user clicks
// "Set up the demo track".
const DEMO_TRACK_FILES = [
  "vocal.webm",
  "vocal 2.webm",
  "guitar.webm",
  "guitar 2.webm",
  "guitarpiano.webm",
  "guitarpiano 2.webm",
  "bass.webm",
  "kick.webm",
  "snare.webm",
  "snare 2.webm",
  "overheads.webm",
  "overheads 2.webm",
] as const;

function buildDemoTracks(startIndex: number): TrackConfig[] {
  return DEMO_TRACK_FILES.map((file, idx) => ({
    name: file.replace(/\.[^/.]+$/, ""),
    color: PALETTE[(startIndex + idx) % PALETTE.length],
    audioUrl: `/demo_track/${encodeURIComponent(file)}`,
  }));
}

function RotationDial({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const dialRef = useRef<HTMLDivElement | null>(null);

  const setFromClientPoint = (clientX: number, clientY: number) => {
    const dial = dialRef.current;
    if (!dial) return;
    const rect = dial.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const next = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    onChange(next);
  };

  const rad = (value * Math.PI) / 180;
  const orbit = 12;
  const dotX = Math.sin(rad) * orbit;
  const dotY = -Math.cos(rad) * orbit;

  return (
    <div className={styles.rotationDialWrap}>
      <div
        ref={dialRef}
        className={styles.rotationDial}
        onPointerDown={(event) => {
          const target = event.currentTarget;
          target.setPointerCapture(event.pointerId);
          setFromClientPoint(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          const target = event.currentTarget;
          if (!target.hasPointerCapture(event.pointerId)) return;
          setFromClientPoint(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          const target = event.currentTarget;
          if (target.hasPointerCapture(event.pointerId)) {
            target.releasePointerCapture(event.pointerId);
          }
        }}
      >
        <span
          className={styles.rotationDialDot}
          style={{
            transform: `translate(calc(-50% + ${dotX}px), calc(-50% + ${dotY}px))`,
          }}
        />
      </div>
      <span className={styles.rotationDialValue}>{Math.round(value)}deg</span>
    </div>
  );
}

const TOOLTIP_DELAY_MS = 300;

function HelpTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const timerRef = useRef<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const popW = 240;
    const popH = 120;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const canRight = rect.right + 10 + popW < vw - 8;
    const left = canRight ? rect.right + 10 : Math.max(8, rect.left - popW - 10);
    const top = rect.top + popH + 8 < vh ? rect.top : Math.max(8, rect.bottom - popH);
    setPopoverStyle({ left, top, width: Math.min(popW, vw - 16), position: "fixed" });
  };

  const showDelayed = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      updatePosition();
      setOpen(true);
    }, TOOLTIP_DELAY_MS);
  };

  const hide = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setOpen(false);
  };

  useEffect(() => {
    const onResize = () => {
      if (open) updatePosition();
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [open]);

  return (
    <span className={styles.helpWrap}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.helpTrigger}
        aria-label="Show explanation"
        onMouseEnter={showDelayed}
        onMouseLeave={hide}
        onFocus={showDelayed}
        onBlur={hide}
        onClick={() => {
          if (!open) updatePosition();
          setOpen((v) => !v);
        }}
      >
        ?
      </button>
      {open ? (
        <span className={styles.helpBubble} style={popoverStyle}>
          {text}
        </span>
      ) : null}
    </span>
  );
}

type SummaryItemProps = {
  label: string;
  value: string;
  onCopy: (label: string, value: string) => void;
};

function SummaryItem({ label, value, onCopy }: SummaryItemProps) {
  return (
    <div className={styles.summaryRow}>
      <span className={styles.summaryKey}>{label}</span>
      <span className={styles.summaryValue}>{value}</span>
      <button
        type="button"
        className={styles.copyBtn}
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
        onClick={() => onCopy(label, value)}
      >
        copy
      </button>
    </div>
  );
}

function renderSummaryRows(
  data: TrackAcousticData,
  onCopy: (label: string, value: string) => void
) {
  return (
    <>
      <SummaryItem
        label="Gain"
        value={Number.isFinite(data.gainDb) ? `${data.gainDb.toFixed(1)} dB` : "-inf dB"}
        onCopy={onCopy}
      />
      <SummaryItem label="Panning" value={data.panningText} onCopy={onCopy} />
      <SummaryItem label="EQ/Filter" value={`${data.filterHz} Hz`} onCopy={onCopy} />
      <SummaryItem
        label="Reverb Send"
        value={`${data.reverbSendPct}% wet / ${data.dryPct}% dry`}
        onCopy={onCopy}
      />
      <SummaryItem label="Occluded" value={data.occluded ? "Yes" : "No"} onCopy={onCopy} />
    </>
  );
}

function MixerPage() {
  const {
    tracks,
    roomScale,
    acousticSettings,
    addTracks,
    removeTrack,
    updateTrackName,
    toggleTrackMute,
    toggleTrackSolo,
    setRoomScale,
    setRoomMaterial,
    setEnableRoomReverb,
    setEnableAirAbsorption,
    setShowAttenuationZones,
    setShowAcousticShadows,
    setShowCriticalDistance,
    setTrackGainDb,
    toggleTrackDirectivity,
    setTrackRotationDeg,
  } = useTrackStore();
  const [view, setView] = useState<CameraView>("isometric");
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [startMode, setStartMode] = useState<"clean" | "demo" | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isBootReady, setIsBootReady] = useState(false);
  const [transportLoading, setTransportLoading] = useState(false);
  const [trackBuffersLoading, setTrackBuffersLoading] = useState(false);
  const [demoQueued, setDemoQueued] = useState(false);
  const [isMobilePanelOpen, setIsMobilePanelOpen] = useState(false);
  const [zoomSteps, setZoomSteps] = useState(0);
  const [isNarrowScreen, setIsNarrowScreen] = useState(false);
  const [summaryTrackId, setSummaryTrackId] = useState<string | null>(null);
  const [expandedTrackIds, setExpandedTrackIds] = useState<Record<string, boolean>>({});
  const [liveTrackData, setLiveTrackData] = useState<Record<string, TrackAcousticData>>({});
  const [trackLoadedMap, setTrackLoadedMap] = useState<Record<string, boolean>>({});
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const demoAutoStartedRef = useRef(false);

  useEffect(() => () => disposeAudioEngine(), []);

  useEffect(() => {
    const updateScreen = () => setIsNarrowScreen(window.innerWidth <= 900);
    updateScreen();
    window.addEventListener("resize", updateScreen);
    return () => window.removeEventListener("resize", updateScreen);
  }, []);

  useEffect(() => {
    if (!hasStarted) return;
    let resolvedAssets = false;
    let resolvedTone = false;

    const markReady = () => {
      if (resolvedAssets && resolvedTone) setIsBootReady(true);
    };

    const previousOnProgress = DefaultLoadingManager.onProgress;
    const previousOnLoad = DefaultLoadingManager.onLoad;
    const previousOnError = DefaultLoadingManager.onError;

    DefaultLoadingManager.onProgress = (_url, loaded, total) => {
      const ratio = total > 0 ? loaded / total : 1;
      setLoadingProgress(Math.round(ratio * 100));
    };
    DefaultLoadingManager.onLoad = () => {
      resolvedAssets = true;
      setLoadingProgress(100);
      markReady();
    };
    DefaultLoadingManager.onError = () => {
      resolvedAssets = true;
      markReady();
    };

    if (
      (DefaultLoadingManager as unknown as { isLoading?: boolean }).isLoading !==
      true
    ) {
      resolvedAssets = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- boot phase mirrors loader completion
      setLoadingProgress(100);
    }

    waitForToneLoaded().finally(() => {
      resolvedTone = true;
      markReady();
    });

    markReady();

    return () => {
      DefaultLoadingManager.onProgress = previousOnProgress;
      DefaultLoadingManager.onLoad = previousOnLoad;
      DefaultLoadingManager.onError = previousOnError;
    };
  }, [hasStarted]);

  const startApp = async (mode: "clean" | "demo") => {
    await Tone.start();
    setHasStarted(true);
    setStartMode(mode);
    if (mode === "demo") {
      setTrackBuffersLoading(true);
      addTracks(buildDemoTracks(tracks.length));
      setDemoQueued(true);
    }
  };

  const handleFileAdd = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    const newTracks = files.map((file, index) => ({
      name: file.name.replace(/\.[^/.]+$/, ""),
      color: PALETTE[(tracks.length + index) % PALETTE.length],
      audioUrl: URL.createObjectURL(file),
    }));

    setTrackBuffersLoading(true);
    addTracks(newTracks);
    event.currentTarget.value = "";
  };

  const handlePlayToggle = useCallback(async () => {
    const loadingNow = getTrackLoadingState(tracks.map((track) => track.id));
    if (loadingNow.total > 0 && loadingNow.loaded < loadingNow.total) return;
    setTransportLoading(true);
    try {
      const playing = await toggleTransport();
      setIsPlaying(playing);
    } finally {
      setTransportLoading(false);
    }
  }, [tracks]);

  useEffect(() => {
    const ids = tracks.map((track) => track.id);
    if (ids.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset loading when no tracks exist
      setTrackBuffersLoading(false);
      setTrackLoadedMap({});
      return;
    }
    const tick = () => {
      const state = getTrackLoadingState(ids);
      setTrackBuffersLoading(state.total > 0 && state.loaded < state.total);
      const nextLoaded: Record<string, boolean> = {};
      for (const id of ids) {
        nextLoaded[id] = isTrackLoaded(id);
      }
      setTrackLoadedMap(nextLoaded);
    };
    tick();
    const interval = window.setInterval(tick, 150);
    return () => window.clearInterval(interval);
  }, [tracks]);

  useEffect(() => {
    if (startMode !== "demo" || !demoQueued || !isBootReady || trackBuffersLoading) return;
    if (demoAutoStartedRef.current || tracks.length === 0) return;
    demoAutoStartedRef.current = true;
    void handlePlayToggle();
  }, [demoQueued, isBootReady, startMode, trackBuffersLoading, tracks.length, handlePlayToggle]);

  useEffect(() => {
    const refresh = () => {
      const next: Record<string, TrackAcousticData> = {};
      for (const track of tracks) {
        const data = getTrackAcousticData(track.id);
        if (data) next[track.id] = data;
      }
      setLiveTrackData(next);
    };
    refresh();
    const timer = window.setInterval(refresh, 150);
    return () => window.clearInterval(timer);
  }, [tracks]);

  const summaryData = summaryTrackId ? (liveTrackData[summaryTrackId] ?? null) : null;
  const summaryTrack = summaryTrackId
    ? tracks.find((track) => track.id === summaryTrackId) ?? null
    : null;
  const summaryTrackNumber =
    summaryTrackId != null ? tracks.findIndex((track) => track.id === summaryTrackId) + 1 : 0;
  const playbackDisabled =
    tracks.length === 0 || !isBootReady || trackBuffersLoading || transportLoading;

  const handleSummaryCopy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(`${label}: ${value}`);
      setCopyToast(`${label} copied`);
    } catch {
      setCopyToast("copy failed");
    }
    window.setTimeout(() => setCopyToast(null), 1300);
  };

  const sidebarContent = (
    <>
      <section className={styles.section}>
        <h2 className={styles.heading}>Room</h2>
        <SketchSlider
          label="width"
          value={roomScale[0]}
          min={0.7}
          max={1.8}
          step={0.05}
          onChange={(v) => setRoomScale([v, roomScale[1], roomScale[2]])}
          formatValue={(v) => `${(10 * v).toFixed(1)}m`}
        />
        <SketchSlider
          label="height"
          value={roomScale[1]}
          min={0.4}
          max={1.5}
          step={0.05}
          onChange={(v) => setRoomScale([roomScale[0], v, roomScale[2]])}
          formatValue={(v) => `${(4 * v).toFixed(1)}m`}
        />
        <SketchSlider
          label="depth"
          value={roomScale[2]}
          min={0.7}
          max={1.8}
          step={0.05}
          onChange={(v) => setRoomScale([roomScale[0], roomScale[1], v])}
          formatValue={(v) => `${(10 * v).toFixed(1)}m`}
        />
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Acoustic</h2>
        <p className={styles.rt60}>
          Reverb Time (RT60): {acousticSettings.rt60Ms} ms
        </p>

        <div className={styles.row}>
          <span className={styles.rowLabel}>Room reverb</span>
          <button
            type="button"
            className={`${styles.toggle} ${acousticSettings.enableRoomReverb ? styles.toggleOn : ""}`}
            onClick={() => setEnableRoomReverb(!acousticSettings.enableRoomReverb)}
          >
            {acousticSettings.enableRoomReverb ? "on" : "off"}
          </button>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabelWithHelp}>
            <span className={styles.rowLabel}>Air absorption</span>
            <HelpTooltip text="Simulates how high frequencies fade faster than lows in large rooms. Turning this on makes distant sources sound darker and more realistic." />
          </span>
          <button
            type="button"
            className={`${styles.toggle} ${acousticSettings.enableAirAbsorption ? styles.toggleOn : ""}`}
            onClick={() =>
              setEnableAirAbsorption(!acousticSettings.enableAirAbsorption)
            }
          >
            {acousticSettings.enableAirAbsorption ? "on" : "off"}
          </button>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabel}>Room material</span>
          <div className={styles.selectWrap}>
            <select
              className={styles.select}
              value={acousticSettings.roomMaterial}
              onChange={(e) =>
                setRoomMaterial(
                  e.target.value as
                    | "brick"
                    | "wood"
                    | "acoustic-foam"
                    | "marble"
                )
              }
            >
              <option value="brick">brick</option>
              <option value="wood">wood</option>
              <option value="acoustic-foam">foam</option>
              <option value="marble">marble</option>
            </select>
            <span className={styles.selectChevron} aria-hidden>
              ▾
            </span>
          </div>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabelWithHelp}>
            <span className={styles.rowLabel}>Show attenuation zones</span>
            <HelpTooltip text="Visualizes how sound volume drops over distance. Use this to ensure the back of the club is not too quiet compared to the front." />
          </span>
          <button
            type="button"
            className={`${styles.toggle} ${acousticSettings.showAttenuationZones ? styles.toggleOn : ""}`}
            onClick={() =>
              setShowAttenuationZones(!acousticSettings.showAttenuationZones)
            }
          >
            {acousticSettings.showAttenuationZones ? "on" : "off"}
          </button>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabel}>Show acoustic shadows</span>
          <button
            type="button"
            className={`${styles.toggle} ${acousticSettings.showAcousticShadows ? styles.toggleOn : ""}`}
            onClick={() =>
              setShowAcousticShadows(!acousticSettings.showAcousticShadows)
            }
          >
            {acousticSettings.showAcousticShadows ? "on" : "off"}
          </button>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabelWithHelp}>
            <span className={styles.rowLabel}>Show critical distance</span>
            <HelpTooltip text="The point where room echoes become as loud as the direct sound. Beyond this circle, the music loses clarity and becomes muddy." />
          </span>
          <button
            type="button"
            className={`${styles.toggle} ${acousticSettings.showCriticalDistance ? styles.toggleOn : ""}`}
            onClick={() =>
              setShowCriticalDistance(!acousticSettings.showCriticalDistance)
            }
          >
            {acousticSettings.showCriticalDistance ? "on" : "off"}
          </button>
        </div>

      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Tracks</h2>

        <PlayerBar
          isPlaying={isPlaying}
          disabled={playbackDisabled}
          loading={transportLoading || trackBuffersLoading || !isBootReady}
          onTogglePlay={handlePlayToggle}
        />

        <ul className={styles.trackList}>
          {tracks.map((track, idx) => (
            <li key={track.id} className={styles.trackCard}>
              <div className={styles.trackItem}>
                <span
                  className={styles.colorDot}
                  style={{ backgroundColor: track.color }}
                />
                <span className={styles.trackIndex}>{idx + 1}</span>
                <input
                  className={styles.trackName}
                  value={track.name}
                  onChange={(e) => updateTrackName(track.id, e.target.value)}
                />
                <button
                  type="button"
                  className={styles.summaryBtn}
                  onClick={() => {
                    if (isNarrowScreen) {
                      setExpandedTrackIds((current) => ({
                        ...current,
                        [track.id]: !current[track.id],
                      }));
                      return;
                    }
                    setSummaryTrackId(track.id);
                  }}
                  aria-label={`Open settings summary for ${track.name}`}
                  title={isNarrowScreen ? "Details" : "Settings Summary"}
                >
                  i
                </button>
                <button
                  type="button"
                  className={`${styles.circleBtn} ${track.muted ? styles.circleBtnOn : ""}`}
                  onClick={() => toggleTrackMute(track.id)}
                  title="Mute"
                >
                  m
                </button>
                <button
                  type="button"
                  className={`${styles.circleBtn} ${track.solo ? styles.circleBtnOn : ""}`}
                  onClick={() => toggleTrackSolo(track.id)}
                  title="Solo"
                >
                  s
                </button>
                <button
                  type="button"
                  className={`${styles.removeBtn} ${
                    !trackLoadedMap[track.id] ? styles.removeBtnDisabled : ""
                  }`}
                  onClick={() => removeTrack(track.id)}
                  disabled={!trackLoadedMap[track.id]}
                  aria-label={`Remove ${track.name}`}
                  title={!trackLoadedMap[track.id] ? "Wait until track loads" : "Remove track"}
                >
                  ×
                </button>
              </div>
              <div className={styles.trackGainRow}>
                <SketchSlider
                  label="gain"
                  value={Number.isFinite(track.gainDb) ? track.gainDb : -60}
                  min={-60}
                  max={12}
                  step={1}
                  onChange={(v) => setTrackGainDb(track.id, v)}
                  formatValue={(v) => (v <= -60 ? "-inf dB" : `${v >= 0 ? "+" : ""}${v} dB`)}
                />
              </div>
              <div className={styles.trackDirectivityRow}>
                <span className={styles.trackDirectivityLabel}>direction</span>
                <button
                  type="button"
                  className={`${styles.toggle} ${track.isDirectivityEnabled ? styles.toggleOn : ""}`}
                  onClick={() => toggleTrackDirectivity(track.id)}
                  aria-label={`Toggle directivity for ${track.name}`}
                  title="Direction on/off"
                >
                  {track.isDirectivityEnabled ? "on" : "off"}
                </button>
              </div>
              {track.isDirectivityEnabled ? (
                <div className={styles.trackRotationRow}>
                  <RotationDial
                    value={track.rotationDeg}
                    onChange={(v) => setTrackRotationDeg(track.id, v)}
                  />
                </div>
              ) : null}
              {isNarrowScreen && expandedTrackIds[track.id] ? (
                <div className={styles.mobileDetails}>
                  {liveTrackData[track.id] ? (
                    <>
                      <div className={styles.mobileDetailCell}>
                        <span className={styles.mobileDetailKey}>Gain</span>
                        <span className={styles.mobileDetailValue}>
                          {Number.isFinite(liveTrackData[track.id].gainDb)
                            ? `${liveTrackData[track.id].gainDb.toFixed(1)} dB`
                            : "-inf dB"}
                        </span>
                      </div>
                      <div className={styles.mobileDetailCell}>
                        <span className={styles.mobileDetailKey}>Pan</span>
                        <span className={styles.mobileDetailValue}>
                          {liveTrackData[track.id].panningText}
                        </span>
                      </div>
                      <div className={styles.mobileDetailCell}>
                        <span className={styles.mobileDetailKey}>Filter</span>
                        <span className={styles.mobileDetailValue}>
                          {liveTrackData[track.id].filterHz} Hz
                        </span>
                      </div>
                      <div className={styles.mobileDetailCell}>
                        <span className={styles.mobileDetailKey}>Reverb</span>
                        <span className={styles.mobileDetailValue}>
                          {liveTrackData[track.id].reverbSendPct}% wet
                        </span>
                      </div>
                      <div className={styles.mobileDetailCell}>
                        <span className={styles.mobileDetailKey}>Occluded</span>
                        <span className={styles.mobileDetailValue}>
                          {liveTrackData[track.id].occluded ? "Yes" : "No"}
                        </span>
                      </div>
                    </>
                  ) : (
                    <span className={styles.mobileDetailKey}>No live data yet.</span>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        <div className={styles.addColumn}>
          <label className={styles.addBtn}>
            Add track
            <input
              type="file"
              accept="audio/*"
              multiple
              onChange={handleFileAdd}
            />
          </label>
          <button
            type="button"
            className={styles.demoBtn}
            onClick={() => addTracks(buildDemoTracks(tracks.length))}
          >
            Set up the demo track
          </button>
        </div>
      </section>
    </>
  );

  if (!hasStarted) {
    return (
      <main className={styles.page}>
        <Landing onStartClean={() => void startApp("clean")} onStartDemo={() => void startApp("demo")} />
      </main>
    );
  }

  return (
    <main className={styles.page}>
      {hasStarted && !isBootReady ? (
        <div className={styles.loadingScreen}>
          <h1>Sketching Spatial Lab</h1>
          <p>Loading assets and audio buffers... {loadingProgress}%</p>
        </div>
      ) : null}

      <section className={styles.cameraToolbar}>
        <button
          type="button"
          className={`${styles.viewBtn} ${view === "isometric" ? styles.viewBtnActive : ""}`}
          onClick={() => setView("isometric")}
          aria-label="Isometric view"
          title="Isometric"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3 L21 8 L21 16 L12 21 L3 16 L3 8 Z" />
            <path d="M12 3 L12 21" />
            <path d="M3 8 L21 8" />
          </svg>
        </button>
        <button
          type="button"
          className={`${styles.viewBtn} ${view === "top-down" ? styles.viewBtnActive : ""}`}
          onClick={() => setView("top-down")}
          aria-label="Top-down view"
          title="Top-down"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="1" />
          </svg>
        </button>
      </section>

      <aside className={styles.sidebar}>{sidebarContent}</aside>

      <button
        type="button"
        className={styles.settingsGear}
        aria-label="Open settings"
        onClick={() => setIsMobilePanelOpen(true)}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.6 1.6 0 0 0 .32 1.76l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.6 1.6 0 0 0 15 19.4a1.6 1.6 0 0 0-1 .6 1.6 1.6 0 0 0-.4 1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-.4-1 1.6 1.6 0 0 0-1-.4 1.6 1.6 0 0 0-1 .32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-.6-1 1.6 1.6 0 0 0-1-.4H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1-.4 1.6 1.6 0 0 0 .4-1 1.6 1.6 0 0 0-.32-1l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 9 4.6c.4 0 .78-.16 1-.4.24-.24.4-.62.4-1V3a2 2 0 1 1 4 0v.1c0 .38.16.76.4 1 .24.24.62.4 1 .4.38 0 .74-.12 1-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.32 1c0 .38.16.76.4 1 .24.24.62.4 1 .4H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1 .4 1.6 1.6 0 0 0-.5 1z" />
        </svg>
      </button>

      {isMobilePanelOpen ? (
        <div className={styles.mobileOverlay}>
          <aside className={`${styles.sidebar} ${styles.mobileSidebar}`}>
            <button
              type="button"
              className={styles.mobileClose}
              aria-label="Close settings"
              onClick={() => setIsMobilePanelOpen(false)}
            >
              ×
            </button>
            {sidebarContent}
          </aside>
        </div>
      ) : null}

      <section className={styles.canvasWrap}>
        {isBootReady ? <SceneCanvas view={view} zoomSteps={zoomSteps} /> : null}
      </section>

      {!isNarrowScreen ? (
        <aside
          className={`${styles.summaryDrawer} ${summaryTrackId ? styles.summaryDrawerOpen : ""}`}
        >
          <div className={styles.summaryHeader}>
            <h3 className={styles.summaryTitle}>
              {summaryTrack ? (
                <span className={styles.summaryTrackTitle}>
                  <span
                    className={styles.summaryTrackDot}
                    style={{ backgroundColor: summaryTrack.color }}
                  />
                  <span className={styles.summaryTrackPrefix}>{`Track #${summaryTrackNumber}:`}</span>
                  <span
                    className={styles.summaryTrackName}
                    title={`Track #${summaryTrackNumber}: ${summaryTrack.name}`}
                  >
                    {summaryTrack.name}
                  </span>
                </span>
              ) : (
                "Settings Summary"
              )}
            </h3>
            <button
              type="button"
              className={styles.summaryClose}
              onClick={() => setSummaryTrackId(null)}
              aria-label="Close settings summary"
            >
              ×
            </button>
          </div>
          {summaryTrackId && summaryData ? (
            <div className={styles.summaryBody}>
              {renderSummaryRows(summaryData, handleSummaryCopy)}
            </div>
          ) : (
            <p className={styles.summaryEmpty}>Pick a track via the info button.</p>
          )}
        </aside>
      ) : null}

      {copyToast ? <div className={styles.copyToast}>{copyToast}</div> : null}

      <div className={styles.zoomControls}>
        <button
          type="button"
          className={styles.zoomBtn}
          aria-label="Zoom out"
          onClick={() => setZoomSteps((z) => Math.max(-6, z - 1))}
        >
          −
        </button>
        <button
          type="button"
          className={styles.zoomBtn}
          aria-label="Zoom in"
          onClick={() => setZoomSteps((z) => Math.min(8, z + 1))}
        >
          +
        </button>
      </div>
    </main>
  );
}

export default function HomePage() {
  return (
    <TrackStoreProvider>
      <MixerPage />
    </TrackStoreProvider>
  );
}
