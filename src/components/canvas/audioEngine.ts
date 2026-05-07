"use client";

import * as Tone from "tone";
import { Vector3 } from "three";
import type { Track } from "./types";
import type { RoomMaterialPreset } from "./TrackStore";

type ResonanceSceneLike = {
  output: AudioNode;
  createSource: () => {
    input: AudioNode;
    setPosition: (x: number, y: number, z: number) => void;
  };
  setListenerPosition: (x: number, y: number, z: number) => void;
  setListenerOrientation: (
    fx: number,
    fy: number,
    fz: number,
    ux: number,
    uy: number,
    uz: number
  ) => void;
  setRoomProperties?: (
    dimensions: { width: number; height: number; depth: number },
    materials: {
      left: string;
      right: string;
      front: string;
      back: string;
      down: string;
      up: string;
    }
  ) => void;
};

type ResonanceCtor = new (context: AudioContext) => ResonanceSceneLike;
type ResonanceSource = ReturnType<ResonanceSceneLike["createSource"]>;

type TrackNodeBundle = {
  player: Tone.Player;
  source: ResonanceSource;
  mixGain: GainNode;
  distanceGain: GainNode;
  airFilter: BiquadFilterNode;
  occlusionFilter: BiquadFilterNode;
};

type AudioEngineState = {
  nativeAudioContext: AudioContext;
  audioContext: AudioContext;
  resonanceScene: ResonanceSceneLike;
  roomGain: GainNode;
  listenerPosition: Vector3;
  listenerForward: Vector3;
  roomDimensions: { width: number; height: number; depth: number };
};

let engineState: AudioEngineState | null = null;
let resonanceCtor: ResonanceCtor | null = null;
let resonanceCtorPromise: Promise<ResonanceCtor> | null = null;

const trackIds = new Set<string>();
const sources = new Map<string, ResonanceSource>();
const players = new Map<string, Tone.Player>();
const trackNodes = new Map<string, TrackNodeBundle>();
const trackMixState = new Map<string, { muted: boolean; solo: boolean }>();
let isPlaying = false;
let airAbsorptionEnabled = false;
let globalPlaybackStartTime = 0;

const forwardVector = new Vector3();
const upVector = new Vector3();
const sourceDirection = new Vector3();

function getEngineState() {
  if (engineState) return engineState;
  if (!resonanceCtor) {
    throw new Error("ResonanceAudio is not initialized yet.");
  }
  if (typeof window === "undefined") {
    throw new Error("Audio engine can only initialize in the browser.");
  }
  const NativeAudioContext =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!NativeAudioContext) {
    throw new Error("Web Audio API is not supported in this browser.");
  }

  const nativeAudioContext = new NativeAudioContext();
  Tone.setContext(nativeAudioContext);
  const audioContext = Tone.getContext().rawContext as AudioContext;

  const resonanceScene = new resonanceCtor(nativeAudioContext);
  const roomGain = nativeAudioContext.createGain();
  roomGain.gain.value = 1;
  resonanceScene.output.connect(roomGain);
  roomGain.connect(nativeAudioContext.destination);

  engineState = {
    nativeAudioContext,
    audioContext,
    resonanceScene,
    roomGain,
    listenerPosition: new Vector3(0, 0.5, 0),
    listenerForward: new Vector3(0, 0, -1),
    roomDimensions: { width: 10, height: 4, depth: 10 },
  };

  return engineState;
}

async function ensureResonanceCtor() {
  if (resonanceCtor) return resonanceCtor;
  if (typeof window === "undefined") {
    throw new Error("Audio engine can only initialize in the browser.");
  }
  if (!resonanceCtorPromise) {
    resonanceCtorPromise = import("resonance-audio").then((module) => {
      const namespace = module as unknown as {
        ResonanceAudio?: ResonanceCtor;
        default?: ResonanceCtor | { ResonanceAudio?: ResonanceCtor };
      };
      const defaultExport = namespace.default;
      const ctor =
        namespace.ResonanceAudio ??
        (typeof defaultExport === "function" ? defaultExport : undefined) ??
        (typeof defaultExport === "object" && defaultExport
          ? defaultExport.ResonanceAudio
          : undefined);
      if (!ctor) {
        throw new Error("ResonanceAudio constructor not found in module exports.");
      }
      resonanceCtor = ctor;
      return ctor;
    });
  }
  return resonanceCtorPromise;
}

function mapThreeToResonance([x, y, z]: [number, number, number]) {
  // Resonance and Three axes can be perceived mirrored in this setup.
  // Flipping X aligns visual left with headphone left.
  return [-x, y, z] as const;
}

function getSyncedOffsetSeconds(player: Tone.Player) {
  const duration = player.buffer.duration;
  if (!isFinite(duration) || duration <= 0) return 0;
  const elapsed = Math.max(0, getEngineState().audioContext.currentTime - globalPlaybackStartTime);
  return elapsed % duration;
}

function setListenerTransform(
  position: [number, number, number],
  forward: [number, number, number],
  up: [number, number, number]
) {
  const { resonanceScene, listenerForward, listenerPosition } = getEngineState();
  const [x, y, z] = mapThreeToResonance(position);
  forwardVector.set(forward[0], forward[1], forward[2]);
  upVector.set(up[0], up[1], up[2]);
  listenerForward.copy(forwardVector).normalize();
  listenerPosition.set(position[0], position[1], position[2]);

  resonanceScene.setListenerPosition(x, y, z);
  resonanceScene.setListenerOrientation(
    forwardVector.x,
    forwardVector.y,
    -forwardVector.z,
    upVector.x,
    upVector.y,
    -upVector.z
  );

}

async function ensureTrackAudio(track: Track) {
  await ensureResonanceCtor();
  const { resonanceScene, audioContext } = getEngineState();
  if (typeof track.audioUrl !== "string" || track.audioUrl.trim().length === 0) {
    console.warn(`Skipping track "${track.name}" because audioUrl is missing.`);
    return;
  }
  trackIds.add(track.id);
  if (trackNodes.has(track.id) && sources.has(track.id) && players.has(track.id)) return;

  const source = resonanceScene.createSource();
  const player = new Tone.Player({ loop: true, autostart: false });
  player.mute = false;

  const mixGain = audioContext.createGain();
  const distanceGain = audioContext.createGain();
  const airFilter = audioContext.createBiquadFilter();
  airFilter.type = "lowpass";
  airFilter.frequency.value = 20000;
  airFilter.Q.value = 0.0001;
  const occlusionFilter = audioContext.createBiquadFilter();
  mixGain.gain.value = 1;
  distanceGain.gain.value = 1;
  occlusionFilter.type = "lowpass";
  occlusionFilter.frequency.value = 12000;
  occlusionFilter.Q.value = 0.7;

  // Tone node -> native graph -> Resonance source input.
  player.connect(mixGain);
  mixGain.connect(distanceGain);
  distanceGain.connect(airFilter);
  airFilter.connect(occlusionFilter);
  occlusionFilter.connect(source.input);

  try {
    await player.load(track.audioUrl);
  } catch (error) {
    console.warn(`Failed to load track "${track.name}" from "${track.audioUrl}"`, error);
    nodesCleanup(player, mixGain, distanceGain, occlusionFilter);
    return;
  }
  sources.set(track.id, source);
  players.set(track.id, player);
  trackNodes.set(track.id, {
    player,
    source,
    mixGain,
    distanceGain,
    airFilter,
    occlusionFilter,
  });
  refreshTrackMix();

  if (isPlaying) {
    const startAt = Tone.now() + 0.03;
    try {
      player.start(startAt, getSyncedOffsetSeconds(player));
    } catch {
      // Player may already be started.
    }
  }
}

function nodesCleanup(
  player: Tone.Player,
  mixGain: GainNode,
  distanceGain: GainNode,
  occlusionFilter: BiquadFilterNode
) {
  player.dispose();
  mixGain.disconnect();
  distanceGain.disconnect();
  occlusionFilter.disconnect();
}

function refreshTrackMix() {
  const hasSolo = Array.from(trackMixState.values()).some((state) => state.solo);
  trackNodes.forEach((nodes, trackId) => {
    const state = trackMixState.get(trackId) ?? { muted: false, solo: false };
    const audible = hasSolo ? state.solo && !state.muted : !state.muted;
    nodes.mixGain.gain.value = audible ? 1 : 0;
    nodes.player.mute = !audible;
  });
}

function setTrackMixState(tracks: Track[]) {
  trackMixState.clear();
  tracks.forEach((track) => {
    trackMixState.set(track.id, { muted: track.muted, solo: track.solo });
  });
  refreshTrackMix();
}

function pruneTracks(validIds: string[]) {
  const validSet = new Set(validIds);
  for (const id of trackIds) {
    if (validSet.has(id)) continue;
    trackIds.delete(id);
    const nodes = trackNodes.get(id);
    nodes?.player.dispose();
    nodes?.mixGain.disconnect();
    nodes?.distanceGain.disconnect();
  nodes?.airFilter.disconnect();
    nodes?.occlusionFilter.disconnect();
    players.delete(id);
    sources.delete(id);
    trackNodes.delete(id);
  }
}

function setTrackPosition(trackId: string, position: [number, number, number]) {
  const { listenerForward, listenerPosition } = getEngineState();
  const source = sources.get(trackId);
  const nodes = trackNodes.get(trackId);
  if (!source || !nodes) return;

  const [x, y, z] = mapThreeToResonance(position);
  source.setPosition(x, y, z);

  const dx = position[0] - listenerPosition.x;
  const dy = position[1] - listenerPosition.y;
  const dz = position[2] - listenerPosition.z;
  const distance = Math.max(0.25, Math.sqrt(dx * dx + dy * dy + dz * dz));

  const rolloffFactor = 1;
  // Inverse-distance style attenuation.
  nodes.distanceGain.gain.value = Math.min(1, rolloffFactor / distance);

  sourceDirection.set(dx, dy, dz).normalize();
  const behind = listenerForward.dot(sourceDirection) < 0;
  const airCutoff = airAbsorptionEnabled
    ? Math.max(2000, 20000 * Math.pow(0.5, distance / 5))
    : 20000;
  nodes.airFilter.frequency.setTargetAtTime(
    airCutoff,
    getEngineState().audioContext.currentTime,
    0.03
  );
  const baseCutoff = airAbsorptionEnabled ? airCutoff : 12000;
  nodes.occlusionFilter.frequency.value = behind ? Math.min(baseCutoff, 5000) : baseCutoff;
  nodes.occlusionFilter.Q.value = 0.7;

  const roomHalfWidth = getEngineState().roomDimensions.width / 2;
  const roomHalfDepth = getEngineState().roomDimensions.depth / 2;
  const nearWallDistance = Math.min(
    roomHalfWidth - Math.abs(position[0]),
    roomHalfDepth - Math.abs(position[2])
  );
  // Keep subtle near-wall boost in level to emulate early reflections cheaply.
  const wallBoost = nearWallDistance < 1 ? (1 - Math.max(0, nearWallDistance)) * 0.12 : 0;
  nodes.distanceGain.gain.value = Math.min(1, nodes.distanceGain.gain.value + wallBoost);
}

function updateRoomAcoustics(
  scale: [number, number, number],
  materialPreset: RoomMaterialPreset,
  enableRoomReverb: boolean
) {
  const { resonanceScene, roomGain } = getEngineState();
  const width = 10 * scale[0];
  const height = 4 * scale[1];
  const depth = 10 * scale[2];
  getEngineState().roomDimensions = { width, height, depth };

  const MATERIAL_MAP: Record<
    RoomMaterialPreset,
    {
      materials: { left: string; right: string; front: string; back: string; down: string; up: string };
      absorption: number;
      gainCompDb: number;
    }
  > = {
    brick: {
      materials: {
        left: "brick-bare",
        right: "brick-bare",
        front: "brick-bare",
        back: "brick-bare",
        down: "wood-panel",
        up: "acoustic-ceiling-tiles",
      },
      absorption: 0.22,
      gainCompDb: -1.2,
    },
    wood: {
      materials: {
        left: "wood-panel",
        right: "wood-panel",
        front: "wood-panel",
        back: "wood-panel",
        down: "wood-panel",
        up: "acoustic-ceiling-tiles",
      },
      absorption: 0.35,
      gainCompDb: -0.7,
    },
    "acoustic-foam": {
      materials: {
        left: "curtain-heavy",
        right: "curtain-heavy",
        front: "curtain-heavy",
        back: "curtain-heavy",
        down: "acoustic-ceiling-tiles",
        up: "acoustic-ceiling-tiles",
      },
      absorption: 0.85,
      gainCompDb: 0,
    },
    marble: {
      materials: {
        left: "marble",
        right: "marble",
        front: "marble",
        back: "marble",
        down: "marble",
        up: "marble",
      },
      absorption: 0.12,
      gainCompDb: -2.2,
    },
  };

  const deadRoom = {
    left: "curtain-heavy",
    right: "curtain-heavy",
    front: "curtain-heavy",
    back: "curtain-heavy",
    down: "acoustic-ceiling-tiles",
    up: "acoustic-ceiling-tiles",
  };

  const selected = MATERIAL_MAP[materialPreset];
  resonanceScene.setRoomProperties?.(
    { width, height, depth },
    enableRoomReverb ? selected.materials : deadRoom
  );
  roomGain.gain.value = Math.pow(10, (enableRoomReverb ? selected.gainCompDb : 0) / 20);

  const area = 2 * (width * depth + width * height + depth * height);
  const absorption = enableRoomReverb ? selected.absorption : 0.95;
  const rt60 = Math.max(0.12, (0.161 * width * height * depth) / Math.max(0.01, area * absorption));
  return Math.round(rt60 * 1000);
}

function setAirAbsorptionEnabled(enabled: boolean) {
  airAbsorptionEnabled = enabled;
}

function waitForToneLoaded() {
  return Promise.all([ensureResonanceCtor(), Tone.loaded()]).then(() => undefined);
}

async function preloadTracks(tracks: Track[]) {
  await ensureResonanceCtor();
  await Promise.all(
    tracks.map(async (track) => {
      if (!track.audioUrl) return;
      await ensureTrackAudio(track);
    })
  );
  await Tone.loaded();
}

async function toggleTransport() {
  await ensureResonanceCtor();
  const { nativeAudioContext } = getEngineState();
  if (nativeAudioContext.state === "suspended") await nativeAudioContext.resume();
  await Tone.start();
  Tone.Destination.volume.value = 0;
  console.log("Context state:", Tone.getContext().state);
  console.log("Transport before toggle:", Tone.Transport.state);

  if (isPlaying) {
    players.forEach((player) => {
      try {
        player.stop();
      } catch {
        // no-op
      }
    });
    Tone.Transport.stop();
    console.log("Transport after stop:", Tone.Transport.state);
    isPlaying = false;
    globalPlaybackStartTime = 0;
    return false;
  }

  const startAt = Tone.now() + 0.05;
  globalPlaybackStartTime = getEngineState().audioContext.currentTime + 0.05;
  players.forEach((player) => {
    try {
      player.start(startAt, 0);
    } catch {
      // no-op
    }
  });
  Tone.Transport.start();
  console.log("Transport after start:", Tone.Transport.state);
  isPlaying = true;
  return true;
}

function disposeAudioEngine() {
  if (!engineState) return;
  isPlaying = false;
  globalPlaybackStartTime = 0;
  for (const player of players.values()) player.dispose();
  for (const nodes of trackNodes.values()) {
    nodes.mixGain.disconnect();
    nodes.distanceGain.disconnect();
    nodes.airFilter.disconnect();
    nodes.occlusionFilter.disconnect();
  }
  players.clear();
  sources.clear();
  trackIds.clear();
  trackNodes.clear();
  trackMixState.clear();
  airAbsorptionEnabled = false;
  engineState = null;
}

function isAudioPlaying() {
  return isPlaying;
}

function isTrackAudible(trackId: string) {
  const hasSolo = Array.from(trackMixState.values()).some((state) => state.solo);
  const state = trackMixState.get(trackId) ?? { muted: false, solo: false };
  return isPlaying && (hasSolo ? state.solo && !state.muted : !state.muted);
}

export {
  disposeAudioEngine,
  ensureTrackAudio,
  pruneTracks,
  setListenerTransform,
  setTrackPosition,
  setTrackMixState,
  toggleTransport,
  setAirAbsorptionEnabled,
  isAudioPlaying,
  isTrackAudible,
  updateRoomAcoustics,
  waitForToneLoaded,
  preloadTracks,
};
