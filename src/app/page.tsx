"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { DefaultLoadingManager } from "three";
import * as Tone from "tone";
import {
  disposeAudioEngine,
  toggleTransport,
  waitForToneLoaded,
} from "@/components/canvas/audioEngine";
import { CameraView } from "@/components/canvas/CameraRig";
import { SceneCanvas } from "@/components/canvas/SceneCanvas";
import { TrackStoreProvider, useTrackStore } from "@/components/canvas/TrackStore";
import type { TrackConfig } from "@/components/canvas/types";
import styles from "./page.module.css";

const SEEDED_TRACKS: TrackConfig[] = [
  { name: "Lead Guitar", color: "#FF5555", audioUrl: "/audio/lead-guitar.mp3" },
  { name: "Synth Pad", color: "#55A4FF", audioUrl: "/audio/synth-pad.mp3" },
];

const palette = ["#FF8AAE", "#A6D8FF", "#B5E7A0", "#FFD37A", "#D9B3FF"];

function MixerPage() {
  const {
    tracks,
    roomScale,
    acousticSettings,
    addTracks,
    updateTrackName,
    updateTrackColor,
    toggleTrackMute,
    toggleTrackSolo,
    setRoomScale,
    setRoomMaterial,
    setEnableRoomReverb,
    setShowSoundRays,
    setEnableAirAbsorption,
  } = useTrackStore();
  const [view, setView] = useState<CameraView>("isometric");
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isBootReady, setIsBootReady] = useState(false);

  const trackCount = useMemo(() => tracks.length, [tracks.length]);

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

    if ((DefaultLoadingManager as unknown as { isLoading?: boolean }).isLoading !== true) {
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

    const newTracks = files.map((file, index) =>
      ({
        name: file.name.replace(/\.[^/.]+$/, ""),
        color: palette[(tracks.length + index) % palette.length],
        audioUrl: URL.createObjectURL(file),
      })
    );

    addTracks(newTracks);
    event.currentTarget.value = "";
  };

  const handlePlayToggle = async () => {
    const playing = await toggleTransport();
    setIsPlaying(playing);
  };

  return (
    <main className={styles.page}>
      {!isBootReady ? (
        <div className={styles.loadingScreen}>
          <h1>Preparing Spatial Lab</h1>
          <p>Loading assets and audio buffers... {loadingProgress}%</p>
        </div>
      ) : null}
      <section className={styles.toolbar}>
        <button
          type="button"
          className={view === "isometric" ? styles.active : ""}
          onClick={() => setView("isometric")}
        >
          Isometric
        </button>
        <button
          type="button"
          className={view === "top-down" ? styles.active : ""}
          onClick={() => setView("top-down")}
        >
          Top-Down
        </button>
      </section>

      <aside className={styles.sidebar}>
        <h2>Tracks ({trackCount})</h2>
        <div className={styles.sidebarActions}>
          <button
            type="button"
            className={isPlaying ? styles.playActive : ""}
            onClick={handlePlayToggle}
            disabled={tracks.length === 0}
          >
            {isPlaying ? "Stop" : "Play"}
          </button>
          <button type="button" onClick={() => addTracks(SEEDED_TRACKS)}>
            Add Config Tracks
          </button>
          <label className={styles.fileLabel}>
            Add Files
            <input type="file" accept="audio/*" multiple onChange={handleFileAdd} />
          </label>
        </div>
        <ul className={styles.trackList}>
          {tracks.map((track) => (
            <li key={track.id}>
              <span style={{ backgroundColor: track.color }} />
              <input
                value={track.name}
                onChange={(event) => updateTrackName(track.id, event.target.value)}
              />
              <input
                type="color"
                value={track.color}
                onChange={(event) => updateTrackColor(track.id, event.target.value)}
              />
              <button
                type="button"
                className={`${styles.softSwitch} ${track.muted ? styles.softSwitchOn : ""}`}
                onClick={() => toggleTrackMute(track.id)}
              >
                M
              </button>
              <button
                type="button"
                className={`${styles.softSwitch} ${track.solo ? styles.softSwitchOn : ""}`}
                onClick={() => toggleTrackSolo(track.id)}
              >
                S
              </button>
            </li>
          ))}
        </ul>
        <div className={styles.roomScale}>
          <label>
            Room Width
            <input
              className={styles.softSlider}
              type="range"
              min="0.7"
              max="1.8"
              step="0.1"
              value={roomScale[0]}
              onChange={(event) =>
                setRoomScale([Number(event.target.value), roomScale[1], roomScale[2]])
              }
            />
          </label>
          <label>
            Room Height
            <input
              className={styles.softSlider}
              type="range"
              min="0.7"
              max="1.8"
              step="0.1"
              value={roomScale[1]}
              onChange={(event) =>
                setRoomScale([roomScale[0], Number(event.target.value), roomScale[2]])
              }
            />
          </label>
          <label>
            Room Depth
            <input
              className={styles.softSlider}
              type="range"
              min="0.7"
              max="1.8"
              step="0.1"
              value={roomScale[2]}
              onChange={(event) =>
                setRoomScale([roomScale[0], roomScale[1], Number(event.target.value)])
              }
            />
          </label>
        </div>

        <section className={styles.acousticSettings}>
          <h3>Acoustic Settings</h3>
          <div className={styles.rt60Value}>Reverb Time (RT60): {acousticSettings.rt60Ms} ms</div>
          <label>
            Room Material
            <select
              value={acousticSettings.roomMaterial}
              onChange={(event) =>
                setRoomMaterial(event.target.value as "brick" | "wood" | "acoustic-foam" | "marble")
              }
            >
              <option value="brick">Brick (Reflective)</option>
              <option value="wood">Wood (Warm)</option>
              <option value="acoustic-foam">Acoustic Foam (Dead)</option>
              <option value="marble">Marble (Bright)</option>
            </select>
          </label>

          <label className={styles.toggleRow}>
            <span>Enable Room Reverb</span>
            <button
              type="button"
              className={`${styles.softSwitch} ${acousticSettings.enableRoomReverb ? styles.softSwitchOn : ""}`}
              onClick={() => setEnableRoomReverb(!acousticSettings.enableRoomReverb)}
            >
              {acousticSettings.enableRoomReverb ? "On" : "Off"}
            </button>
          </label>

          <label className={styles.toggleRow}>
            <span>Show Sound Rays</span>
            <button
              type="button"
              className={`${styles.softSwitch} ${acousticSettings.showSoundRays ? styles.softSwitchOn : ""}`}
              onClick={() => setShowSoundRays(!acousticSettings.showSoundRays)}
            >
              {acousticSettings.showSoundRays ? "On" : "Off"}
            </button>
          </label>

          <label className={styles.toggleRow}>
            <span>Enable Air Absorption</span>
            <button
              type="button"
              className={`${styles.softSwitch} ${acousticSettings.enableAirAbsorption ? styles.softSwitchOn : ""}`}
              onClick={() => setEnableAirAbsorption(!acousticSettings.enableAirAbsorption)}
            >
              {acousticSettings.enableAirAbsorption ? "On" : "Off"}
            </button>
          </label>
        </section>
      </aside>

      <section className={styles.canvasWrap}>
        {isBootReady ? <SceneCanvas view={view} /> : null}
      </section>
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
