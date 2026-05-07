"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { DefaultLoadingManager } from "three";
import * as Tone from "tone";
import {
  disposeAudioEngine,
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
  } = useTrackStore();
  const [view, setView] = useState<CameraView>("isometric");
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isBootReady, setIsBootReady] = useState(false);
  const [isMobilePanelOpen, setIsMobilePanelOpen] = useState(false);
  const [zoomSteps, setZoomSteps] = useState(0);

  useEffect(() => {
    const resumeAudioOnClick = () => {
      if (Tone.getContext().state !== "running") {
        void Tone.getContext().resume();
      }
    };
    window.addEventListener("click", resumeAudioOnClick);

    return () => {
      window.removeEventListener("click", resumeAudioOnClick);
      disposeAudioEngine();
    };
  }, []);

  useEffect(() => {
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
  }, []);

  const handleFileAdd = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    const newTracks = files.map((file, index) => ({
      name: file.name.replace(/\.[^/.]+$/, ""),
      color: PALETTE[(tracks.length + index) % PALETTE.length],
      audioUrl: URL.createObjectURL(file),
    }));

    addTracks(newTracks);
    event.currentTarget.value = "";
  };

  const handlePlayToggle = async () => {
    const playing = await toggleTransport();
    setIsPlaying(playing);
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
          <span className={styles.rowLabel}>Air absorption</span>
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
          <span className={styles.rowLabel}>Show attenuation zones</span>
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
          <span className={styles.rowLabel}>Show critical distance</span>
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
          disabled={tracks.length === 0}
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
                  className={styles.removeBtn}
                  onClick={() => removeTrack(track.id)}
                  aria-label={`Remove ${track.name}`}
                  title="Remove track"
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

  return (
    <main className={styles.page}>
      {!isBootReady ? (
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
