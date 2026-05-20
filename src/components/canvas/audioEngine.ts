"use client";

import * as Tone from "tone";
import { Vector3 } from "three";
import type { Track } from "./types";
import {
  ACOUSTIC_MATERIALS,
  type RoomMaterialPreset,
  type ResonanceMaterialId,
} from "./acousticMaterials";

type ResonanceSceneLike = {
  output: AudioNode;
  createSource: () => {
    input: AudioNode;
    setPosition: (x: number, y: number, z: number) => void;
    setOrientation?: (
      fx: number,
      fy: number,
      fz: number,
      ux: number,
      uy: number,
      uz: number
    ) => void;
    setDirectivityPattern?: (alpha: number, sharpness: number) => void;
    setDirectivity?: (alpha: number, sharpness: number) => void;
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
  uiGain: GainNode;
  mixGain: GainNode;
  distanceGain: GainNode;
  shadowOcclusionGain: GainNode;
  dynamicOcclusionGain: GainNode;
  airFilter: BiquadFilterNode;
  occlusionFilter: BiquadFilterNode;
  shadowFilter: BiquadFilterNode;
  dynamicOcclusionFilter: BiquadFilterNode;
};

type AudioEngineState = {
  nativeAudioContext: AudioContext;
  audioContext: AudioContext;
  resonanceScene: ResonanceSceneLike;
  safetyLimiter: DynamicsCompressorNode;
  roomGain: GainNode;
  masterAnalyser: AnalyserNode;
  listenerPosition: Vector3;
  listenerForward: Vector3;
  roomDimensions: { width: number; height: number; depth: number };
};

const analyserBuffer = new Uint8Array(256);

let engineState: AudioEngineState | null = null;
let resonanceCtor: ResonanceCtor | null = null;
let resonanceCtorPromise: Promise<ResonanceCtor> | null = null;

const trackIds = new Set<string>();
const sources = new Map<string, ResonanceSource>();
const players = new Map<string, Tone.Player>();
const trackNodes = new Map<string, TrackNodeBundle>();
const trackPositions = new Map<string, [number, number, number]>();
const pendingTrackPositions = new Map<string, { x: number; y: number; z: number }>();
const trackMixState = new Map<string, { muted: boolean; solo: boolean }>();
const trackDirectivityState = new Map<
  string,
  {
    enabled: boolean;
    fx: number;
    fy: number;
    fz: number;
    tx: number;
    ty: number;
    tz: number;
  }
>();
let isPlaying = false;
let airAbsorptionEnabled = false;
let globalPlaybackStartTime = 0;
let trackPositionRafId: number | null = null;

const forwardVector = new Vector3();
const upVector = new Vector3();
const sourceDirection = new Vector3();
const listenerForwardXZ = new Vector3();
const sourceDirectionXZ = new Vector3();

/** Educational acoustic-shadow low-pass (bypassed when false). */
let educationalShadowsEnabled = false;
const shadowOcclusionState = new Map<string, number>();
const shadowLineBlockedState = new Map<string, boolean>();
const shadowOcclusionLossDbState = new Map<string, number>();
const shadowOccluderCountState = new Map<string, number>();
const shadowCutoffHzState = new Map<string, number>();
const dynamicAcousticsState = new Map<string, { cutoffHz: number; gain: number }>();
const diagnosticsLastLogMs = new Map<string, number>();
let diagnosticsReferenceLogged = false;
const DIAGNOSTICS_LOG_THROTTLE_MS = 500;
const BASE_TRACK_GAIN_LINEAR = 2; // +6 dB baseline for all tracks
const DYNAMIC_ACOUSTICS_RAMP_SEC = 0.08;

let currentRoomMaterial: RoomMaterialPreset = "brick";
let currentResonanceMaterialId: ResonanceMaterialId = "brick-bare";
let isReverbNodeConnected = false;
let lastMaterialDiagnostic = "";

export type RoomAcousticsResult = {
  rt60Ms: number;
  rt60Sec: number;
  width: number;
  height: number;
  depth: number;
  materialAlpha: number;
};

export type TrackAcousticData = {
  gainDb: number;
  panningText: string;
  filterHz: number;
  reverbSendPct: number;
  dryPct: number;
  occluded: boolean;
  distanceM: number;
  attenuationDb: number;
  directivityAngleDeg: number;
  directivityCoefficient: number;
  directivityGainDb: number;
  lowPassCutoffHz: number;
  airAbsorptionFilterHz: number;
};

export type TrackLoadingState = {
  loaded: number;
  total: number;
};

function gainDbToLinear(gainDb: number) {
  if (!Number.isFinite(gainDb)) return 0;
  return Math.pow(10, gainDb / 20);
}

function linearToGainDb(value: number) {
  if (!Number.isFinite(value) || value <= 0.0001) return -Infinity;
  return 20 * Math.log10(value);
}

function attenuationDbFromDistance(distance: number) {
  const d = Math.max(0.001, distance);
  return 20 * Math.log10(1 / d);
}

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

  const nativeAudioContext = new NativeAudioContext({
    latencyHint: "playback",
  } as AudioContextOptions);
  Tone.setContext(nativeAudioContext);
  (Tone.getContext() as unknown as { lookAhead?: number }).lookAhead = 0.15;
  const audioContext = Tone.getContext().rawContext as AudioContext;

  const resonanceScene = new resonanceCtor(nativeAudioContext);
  const safetyLimiter = nativeAudioContext.createDynamicsCompressor();
  // Limiter-like safety stage to prevent clipping on summed tracks.
  safetyLimiter.threshold.value = -1;
  safetyLimiter.knee.value = 0;
  safetyLimiter.ratio.value = 20;
  safetyLimiter.attack.value = 0.003;
  safetyLimiter.release.value = 0.08;
  const roomGain = nativeAudioContext.createGain();
  roomGain.gain.value = 1;
  const masterAnalyser = nativeAudioContext.createAnalyser();
  masterAnalyser.fftSize = 256;
  masterAnalyser.smoothingTimeConstant = 0.7;
  resonanceScene.output.connect(safetyLimiter);
  safetyLimiter.connect(roomGain);
  roomGain.connect(masterAnalyser);
  roomGain.connect(nativeAudioContext.destination);

  engineState = {
    nativeAudioContext,
    audioContext,
    resonanceScene,
    safetyLimiter,
    roomGain,
    masterAnalyser,
    listenerPosition: new Vector3(0, 0.5, 0),
    listenerForward: new Vector3(0, 0, -1),
    roomDimensions: { width: 10, height: 4, depth: 10 },
  };

  if (process.env.NODE_ENV === "development" && !diagnosticsReferenceLogged) {
    diagnosticsReferenceLogged = true;
    const at2m = attenuationDbFromDistance(2);
    const at4m = attenuationDbFromDistance(4);
    console.log(
      [
        "--- [foam DIAGNOSTICS REFERENCE] ---",
        `2m expected attenuation: ${at2m.toFixed(1)} dB (approx -6.0 dB)`,
        `4m expected attenuation: ${at4m.toFixed(1)} dB (approx -12.0 dB)`,
        "------------------------------------",
      ].join("\n")
    );
  }

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
  const x = -position[0];
  const y = position[1];
  const z = position[2];
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

  const uiGain = audioContext.createGain();
  const mixGain = audioContext.createGain();
  const distanceGain = audioContext.createGain();
  const shadowOcclusionGain = audioContext.createGain();
  const dynamicOcclusionGain = audioContext.createGain();
  const airFilter = audioContext.createBiquadFilter();
  airFilter.type = "lowpass";
  airFilter.frequency.value = 20000;
  airFilter.Q.value = 0.0001;
  const occlusionFilter = audioContext.createBiquadFilter();
  const shadowFilter = audioContext.createBiquadFilter();
  const dynamicOcclusionFilter = audioContext.createBiquadFilter();
  uiGain.gain.value = Math.max(0.0001, BASE_TRACK_GAIN_LINEAR * gainDbToLinear(track.gainDb));
  mixGain.gain.value = 1;
  distanceGain.gain.value = 1;
  shadowOcclusionGain.gain.value = 1;
  dynamicOcclusionGain.gain.value = 1;
  occlusionFilter.type = "lowpass";
  occlusionFilter.frequency.value = 12000;
  occlusionFilter.Q.value = 0.7;
  shadowFilter.type = "lowpass";
  shadowFilter.frequency.value = 20000;
  shadowFilter.Q.value = 0.7;
  dynamicOcclusionFilter.type = "lowpass";
  dynamicOcclusionFilter.frequency.value = 20000;
  dynamicOcclusionFilter.Q.value = 0.7;

  // Tone node -> native graph -> Resonance source input.
  player.connect(uiGain);
  uiGain.connect(mixGain);
  mixGain.connect(distanceGain);
  distanceGain.connect(airFilter);
  airFilter.connect(occlusionFilter);
  occlusionFilter.connect(shadowOcclusionGain);
  shadowOcclusionGain.connect(shadowFilter);
  shadowFilter.connect(dynamicOcclusionFilter);
  dynamicOcclusionFilter.connect(dynamicOcclusionGain);
  dynamicOcclusionGain.connect(source.input);

  try {
    await player.load(track.audioUrl);
  } catch (error) {
    console.warn(`Failed to load track "${track.name}" from "${track.audioUrl}"`, error);
    nodesCleanup(
      player,
      uiGain,
      mixGain,
      distanceGain,
      shadowOcclusionGain,
      dynamicOcclusionGain,
      airFilter,
      occlusionFilter,
      shadowFilter,
      dynamicOcclusionFilter
    );
    return;
  }
  sources.set(track.id, source);
  players.set(track.id, player);
  trackNodes.set(track.id, {
    player,
    source,
    uiGain,
    mixGain,
    distanceGain,
    shadowOcclusionGain,
    dynamicOcclusionGain,
    airFilter,
    occlusionFilter,
    shadowFilter,
    dynamicOcclusionFilter,
  });
  dynamicAcousticsState.set(track.id, { cutoffHz: 20000, gain: 1 });
  // Apply spatial/audio state immediately on decode so sources never start as
  // temporary full-volume "center" playback before the next frame sync.
  applyTrackPosition(track.id, {
    x: track.position[0],
    y: track.position[1],
    z: track.position[2],
  });
  const rad = (track.rotationDeg * Math.PI) / 180;
  setTrackDirectivityState(
    track.id,
    [Math.sin(rad), 0, -Math.cos(rad)],
    track.isDirectivityEnabled
  );
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
  uiGain: GainNode,
  mixGain: GainNode,
  distanceGain: GainNode,
  shadowOcclusionGain: GainNode,
  dynamicOcclusionGain: GainNode,
  airFilter: BiquadFilterNode,
  occlusionFilter: BiquadFilterNode,
  shadowFilter: BiquadFilterNode,
  dynamicOcclusionFilter: BiquadFilterNode
) {
  player.dispose();
  uiGain.disconnect();
  mixGain.disconnect();
  distanceGain.disconnect();
  shadowOcclusionGain.disconnect();
  dynamicOcclusionGain.disconnect();
  airFilter.disconnect();
  occlusionFilter.disconnect();
  shadowFilter.disconnect();
  dynamicOcclusionFilter.disconnect();
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

function setTrackUiGainDb(trackId: string, gainDb: number) {
  if (!engineState) return;
  const nodes = trackNodes.get(trackId);
  if (!nodes) return;
  const t = engineState.audioContext.currentTime;
  const linear = gainDbToLinear(gainDb);
  // Use epsilon to keep exponential response stable even near silence.
  const target = Math.max(0.0001, BASE_TRACK_GAIN_LINEAR * linear);
  nodes.uiGain.gain.cancelScheduledValues(t);
  nodes.uiGain.gain.setTargetAtTime(target, t, 0.06);
  logDiagnosticsThrottled(trackId);
}

function pruneTracks(validIds: string[]) {
  const validSet = new Set(validIds);
  for (const id of trackIds) {
    if (validSet.has(id)) continue;
    trackIds.delete(id);
    const nodes = trackNodes.get(id);
    nodes?.player.dispose();
    nodes?.uiGain.disconnect();
    nodes?.mixGain.disconnect();
    nodes?.distanceGain.disconnect();
    nodes?.shadowOcclusionGain.disconnect();
    nodes?.dynamicOcclusionGain.disconnect();
    nodes?.airFilter.disconnect();
    nodes?.occlusionFilter.disconnect();
    nodes?.shadowFilter.disconnect();
    nodes?.dynamicOcclusionFilter.disconnect();
    shadowOcclusionState.delete(id);
    shadowLineBlockedState.delete(id);
    shadowOcclusionLossDbState.delete(id);
    shadowOccluderCountState.delete(id);
    shadowCutoffHzState.delete(id);
    dynamicAcousticsState.delete(id);
    diagnosticsLastLogMs.delete(id);
    trackDirectivityState.delete(id);
    trackPositions.delete(id);
    pendingTrackPositions.delete(id);
    players.delete(id);
    sources.delete(id);
    trackNodes.delete(id);
  }
}

function applyTrackPosition(
  trackId: string,
  position: { x: number; y: number; z: number }
) {
  if (!engineState) return;
  const { listenerForward, listenerPosition, audioContext } = getEngineState();
  const source = sources.get(trackId);
  const nodes = trackNodes.get(trackId);
  if (!source || !nodes) return;

  const x = -position.x;
  const y = position.y;
  const z = position.z;
  source.setPosition(x, y, z);
  const stored = trackPositions.get(trackId);
  if (stored) {
    stored[0] = position.x;
    stored[1] = position.y;
    stored[2] = position.z;
  } else {
    trackPositions.set(trackId, [position.x, position.y, position.z]);
  }

  const dx = position.x - listenerPosition.x;
  const dy = position.y - listenerPosition.y;
  const dz = position.z - listenerPosition.z;
  const distance = Math.max(0.25, Math.sqrt(dx * dx + dy * dy + dz * dz));

  const rolloffFactor = 1;
  // Inverse-distance style attenuation.
  nodes.distanceGain.gain.value = Math.min(1, rolloffFactor / distance);

  sourceDirection.set(dx, dy, dz).normalize();
  const airCutoff = airAbsorptionEnabled
    ? Math.max(2000, 20000 * Math.pow(0.5, distance / 5))
    : 20000;
  nodes.airFilter.frequency.setTargetAtTime(
    airCutoff,
    audioContext.currentTime,
    0.03
  );
  const baseCutoff = airAbsorptionEnabled ? airCutoff : 12000;
  // Use horizontal-plane angle for smooth front/side/back filtering.
  listenerForwardXZ.set(listenerForward.x, 0, listenerForward.z);
  sourceDirectionXZ.set(sourceDirection.x, 0, sourceDirection.z);
  if (listenerForwardXZ.lengthSq() < 1e-6 || sourceDirectionXZ.lengthSq() < 1e-6) {
    listenerForwardXZ.set(listenerForward.x, 0, listenerForward.z).normalize();
    sourceDirectionXZ.set(sourceDirection.x, 0, sourceDirection.z).normalize();
  } else {
    listenerForwardXZ.normalize();
    sourceDirectionXZ.normalize();
  }
  const dotXZ = Math.max(-1, Math.min(1, listenerForwardXZ.dot(sourceDirectionXZ)));
  const frontBackFactor = (dotXZ + 1) / 2; // 1 = in front, 0 = behind
  const minBehindCutoff = Math.min(baseCutoff, 1600);
  const targetOcclusionCutoff =
    minBehindCutoff + frontBackFactor * (baseCutoff - minBehindCutoff);
  nodes.occlusionFilter.frequency.setTargetAtTime(
    targetOcclusionCutoff,
    audioContext.currentTime,
    0.05
  );
  nodes.occlusionFilter.Q.value = 0.7;

  const roomHalfWidth = getEngineState().roomDimensions.width / 2;
  const roomHalfDepth = getEngineState().roomDimensions.depth / 2;
  const nearWallDistance = Math.min(
    roomHalfWidth - Math.abs(position.x),
    roomHalfDepth - Math.abs(position.z)
  );
  // Keep subtle near-wall boost in level to emulate early reflections cheaply.
  const wallBoost = nearWallDistance < 1 ? (1 - Math.max(0, nearWallDistance)) * 0.12 : 0;
  nodes.distanceGain.gain.value = Math.min(1, nodes.distanceGain.gain.value + wallBoost);
  logDiagnosticsThrottled(trackId);
}

function flushTrackPositions() {
  trackPositionRafId = null;
  if (pendingTrackPositions.size === 0) return;
  pendingTrackPositions.forEach((position, trackId) => {
    applyTrackPosition(trackId, position);
  });
  pendingTrackPositions.clear();
}

function setTrackPosition(trackId: string, position: [number, number, number]) {
  const pending = pendingTrackPositions.get(trackId);
  if (pending) {
    pending.x = position[0];
    pending.y = position[1];
    pending.z = position[2];
  } else {
    pendingTrackPositions.set(trackId, {
      x: position[0],
      y: position[1],
      z: position[2],
    });
  }
  if (trackPositionRafId === null && typeof window !== "undefined") {
    trackPositionRafId = window.requestAnimationFrame(flushTrackPositions);
  }
}

function getTrackAcousticData(trackId: string): TrackAcousticData | null {
  if (!engineState) return null;
  const nodes = trackNodes.get(trackId);
  const position = trackPositions.get(trackId);
  if (!nodes || !position) return null;

  const diagnostics = getTrackDiagnostics(trackId);
  if (!diagnostics) return null;

  const [x, _y, z] = position;
  const roomHalfWidth = engineState.roomDimensions.width / 2;
  const roomHalfDepth = engineState.roomDimensions.depth / 2;
  const roomDiag = Math.sqrt(
    engineState.roomDimensions.width * engineState.roomDimensions.width +
      engineState.roomDimensions.depth * engineState.roomDimensions.depth
  );

  const panNorm = Math.max(-1, Math.min(1, x / Math.max(0.1, roomHalfWidth)));
  const panAbs = Math.round(Math.abs(panNorm) * 100);
  const panningText =
    panAbs < 2 ? "C 0%" : panNorm < 0 ? `L ${panAbs}%` : `R ${panAbs}%`;

  const nearWallDistance = Math.min(
    roomHalfWidth - Math.abs(x),
    roomHalfDepth - Math.abs(z)
  );
  const nearWallNorm = Math.max(0, Math.min(1, 1 - nearWallDistance / 2));
  const distanceNorm = Math.max(
    0,
    Math.min(1, diagnostics.distanceM / Math.max(1, roomDiag * 0.7))
  );
  const wet = Math.max(0, Math.min(1, 0.15 + distanceNorm * 0.55 + nearWallNorm * 0.3));
  const dry = 1 - wet;

  return {
    // Keep UI fader values relative to the boosted baseline.
    gainDb: linearToGainDb(nodes.uiGain.gain.value / BASE_TRACK_GAIN_LINEAR),
    panningText,
    filterHz: Math.round(diagnostics.lowPassCutoffHz),
    reverbSendPct: Math.round(wet * 100),
    dryPct: Math.round(dry * 100),
    occluded: diagnostics.occluded,
    distanceM: diagnostics.distanceM,
    attenuationDb: diagnostics.attenuationDb,
    directivityAngleDeg: diagnostics.directivityAngleDeg,
    directivityCoefficient: diagnostics.directivityCoefficient,
    directivityGainDb: diagnostics.directivityGainDb,
    lowPassCutoffHz: diagnostics.lowPassCutoffHz,
    airAbsorptionFilterHz: diagnostics.airAbsorptionFilterHz,
  };
}

function setTrackDirectivityState(
  trackId: string,
  forward: [number, number, number],
  enabled: boolean
) {
  if (!engineState) return;
  const source = sources.get(trackId);
  if (!source) return;

  const fx = forward[0];
  const fy = forward[1];
  const fz = -forward[2];
  const norm = Math.hypot(fx, fy, fz);
  const safeFx = norm > 1e-5 ? fx / norm : 0;
  const safeFy = norm > 1e-5 ? fy / norm : 0;
  const safeFz = norm > 1e-5 ? fz / norm : -1;
  const tNorm = Math.hypot(forward[0], forward[1], forward[2]);
  const safeTx = tNorm > 1e-5 ? forward[0] / tNorm : 0;
  const safeTy = tNorm > 1e-5 ? forward[1] / tNorm : 0;
  const safeTz = tNorm > 1e-5 ? forward[2] / tNorm : -1;

  const prev = trackDirectivityState.get(trackId);
  const changed =
    !prev ||
    prev.enabled !== enabled ||
    Math.abs(prev.fx - safeFx) > 0.005 ||
    Math.abs(prev.fy - safeFy) > 0.005 ||
    Math.abs(prev.fz - safeFz) > 0.005;
  if (!changed) return;

  source.setOrientation?.(safeFx, safeFy, safeFz, 0, 1, 0);
  const alpha = enabled ? 0.5 : 0;
  const sharpness = 1.0;
  source.setDirectivityPattern?.(alpha, sharpness);
  source.setDirectivity?.(alpha, sharpness);

  trackDirectivityState.set(trackId, {
    enabled,
    fx: safeFx,
    fy: safeFy,
    fz: safeFz,
    tx: safeTx,
    ty: safeTy,
    tz: safeTz,
  });
  logDiagnosticsThrottled(trackId);
}

function updateRoomAcoustics(
  scale: [number, number, number],
  materialPreset: RoomMaterialPreset,
  enableRoomReverb: boolean
) {
  const { resonanceScene, roomGain, nativeAudioContext } = getEngineState();
  if (!resonanceScene || typeof resonanceScene.setRoomProperties !== "function") {
    return {
      rt60Ms: 850,
      rt60Sec: 0.85,
      width: 10,
      height: 4,
      depth: 10,
      materialAlpha: 0.3,
    };
  }

  const width = Math.max(1, Number(10 * scale[0]));
  const height = Math.max(1, Number(4 * scale[1]));
  const depth = Math.max(1, Number(10 * scale[2]));
  const safeWidth = Number.isFinite(width) ? width : 10;
  const safeHeight = Number.isFinite(height) ? height : 4;
  const safeDepth = Number.isFinite(depth) ? depth : 10;
  getEngineState().roomDimensions = {
    width: safeWidth,
    height: safeHeight,
    depth: safeDepth,
  };
  currentRoomMaterial = materialPreset;

  const selected = ACOUSTIC_MATERIALS[materialPreset];
  const materialAlpha = selected.absorption;
  const targetId = (selected?.idReal ?? "concrete-block-painted") as ResonanceMaterialId;
  const dimensions = {
    width: safeWidth,
    height: safeHeight,
    depth: safeDepth,
  };
  const materials = {
    left: String(targetId),
    right: String(targetId),
    front: String(targetId),
    back: String(targetId),
    down: String(targetId),
    up: String(targetId),
  };
  let applyOk = false;
  try {
    resonanceScene.setRoomProperties(dimensions, materials);
    currentResonanceMaterialId = targetId;
    applyOk = true;
  } catch (error) {
    console.error("🚨 [foam] Critical failure updating material space:", error);
  }

  if (nativeAudioContext.state === "suspended") {
    void nativeAudioContext.resume().then(() => {
      try {
        resonanceScene.setRoomProperties(dimensions, materials);
        currentResonanceMaterialId = targetId;
      } catch {
        // no-op
      }
    });
  }

  isReverbNodeConnected =
    Boolean(resonanceScene.setRoomProperties) && applyOk && enableRoomReverb;

  const diagnosticLine = `🔊 [foam DIAGNOSTIC] Material Changed -> Key: "${materialPreset}" | Resolved Library ID: "${targetId}" | Context: ${Tone.getContext().state}`;
  if (diagnosticLine !== lastMaterialDiagnostic) {
    lastMaterialDiagnostic = diagnosticLine;
    console.log(diagnosticLine);
  }

  roomGain.gain.value = enableRoomReverb ? 1 : 0.82;

  const area =
    2 *
    (safeWidth * safeDepth + safeWidth * safeHeight + safeDepth * safeHeight);
  const absorption = enableRoomReverb ? selected.absorption : Math.max(0.9, selected.absorption);
  const rt60 = Math.max(
    0.12,
    (0.161 * safeWidth * safeHeight * safeDepth) / Math.max(0.01, area * absorption)
  );
  if (process.env.NODE_ENV === "development") {
    for (const id of trackIds) {
      logDiagnosticsThrottled(id);
    }
  }
  return {
    rt60Ms: Math.round(rt60 * 1000),
    rt60Sec: rt60,
    width,
    height,
    depth,
    materialAlpha,
  };
}

function setEducationalShadowEnabled(enabled: boolean) {
  educationalShadowsEnabled = enabled;
  if (!engineState) return;
  const t = engineState.audioContext.currentTime;
  for (const nodes of trackNodes.values()) {
    nodes.shadowOcclusionGain.gain.cancelScheduledValues(t);
    nodes.shadowOcclusionGain.gain.setValueAtTime(1, t);
    nodes.shadowFilter.frequency.cancelScheduledValues(t);
    nodes.shadowFilter.frequency.setValueAtTime(20000, t);
    nodes.dynamicOcclusionFilter.frequency.cancelScheduledValues(t);
    nodes.dynamicOcclusionFilter.frequency.setValueAtTime(20000, t);
    nodes.dynamicOcclusionGain.gain.cancelScheduledValues(t);
    nodes.dynamicOcclusionGain.gain.setValueAtTime(1, t);
  }
  dynamicAcousticsState.clear();
  shadowOcclusionState.clear();
  shadowLineBlockedState.clear();
  shadowOcclusionLossDbState.clear();
  shadowOccluderCountState.clear();
  shadowCutoffHzState.clear();
}

function setTrackDynamicAcoustics(trackId: string, cutoffHz: number, gain: number) {
  if (!engineState) return;
  const nodes = trackNodes.get(trackId);
  if (!nodes) return;
  const nextCutoff = Math.max(250, Math.min(20000, cutoffHz));
  const nextGain = Math.max(0.03, Math.min(1.2, gain));
  const prev = dynamicAcousticsState.get(trackId);
  if (
    prev &&
    Math.abs(prev.cutoffHz - nextCutoff) < 4 &&
    Math.abs(prev.gain - nextGain) < 0.002
  ) {
    return;
  }
  dynamicAcousticsState.set(trackId, { cutoffHz: nextCutoff, gain: nextGain });
  const t = engineState.audioContext.currentTime;
  nodes.dynamicOcclusionFilter.frequency.cancelScheduledValues(t);
  nodes.dynamicOcclusionFilter.frequency.linearRampToValueAtTime(
    nextCutoff,
    t + DYNAMIC_ACOUSTICS_RAMP_SEC
  );
  nodes.dynamicOcclusionGain.gain.cancelScheduledValues(t);
  nodes.dynamicOcclusionGain.gain.linearRampToValueAtTime(nextGain, t + DYNAMIC_ACOUSTICS_RAMP_SEC);
}

function updateTrackShadowOcclusion(
  trackId: string,
  clarityFactor: number,
  materialAlpha: number,
  lineBlocked = false,
  combinedCutoffHz?: number,
  combinedLossDb?: number,
  occluderCount?: number
) {
  if (!educationalShadowsEnabled || !engineState) return;
  const nodes = trackNodes.get(trackId);
  if (!nodes) return;
  const clampedClarity = Math.min(1, Math.max(0, clarityFactor));
  const prev = shadowOcclusionState.get(trackId);
  const prevCutoff = shadowCutoffHzState.get(trackId);
  const expectedCutoff =
    Number.isFinite(combinedCutoffHz) && combinedCutoffHz
      ? Math.max(120, Math.min(20000, combinedCutoffHz))
      : undefined;
  if (
    prev !== undefined &&
    Math.abs(prev - clampedClarity) < 0.005 &&
    (expectedCutoff === undefined ||
      (prevCutoff !== undefined && Math.abs(prevCutoff - expectedCutoff) < 8))
  ) {
    return;
  }
  shadowOcclusionState.set(trackId, clampedClarity);
  shadowLineBlockedState.set(trackId, lineBlocked);
  shadowOcclusionLossDbState.set(trackId, Number.isFinite(combinedLossDb) ? (combinedLossDb as number) : 0);
  shadowOccluderCountState.set(trackId, Math.max(0, occluderCount ?? 0));

  const alpha = Math.min(1, Math.max(0, materialAlpha));
  const minFreq = 400 + (1 - alpha) * 1600;
  const targetFromClarity = minFreq + clampedClarity * (20000 - minFreq);
  const target =
    Number.isFinite(combinedCutoffHz) && combinedCutoffHz
      ? Math.max(120, Math.min(20000, combinedCutoffHz))
      : targetFromClarity;
  shadowCutoffHzState.set(trackId, target);
  const t = engineState.audioContext.currentTime;
  nodes.shadowFilter.frequency.cancelScheduledValues(t);
  nodes.shadowFilter.frequency.linearRampToValueAtTime(target, t + 0.1);
  const combinedLoss = Math.max(0, combinedLossDb ?? 0);
  const attenuationLinear = Math.max(0.08, Math.pow(10, -combinedLoss / 20));
  nodes.shadowOcclusionGain.gain.cancelScheduledValues(t);
  nodes.shadowOcclusionGain.gain.linearRampToValueAtTime(attenuationLinear, t + 0.1);
  logDiagnosticsThrottled(trackId);
}

type TrackDiagnostics = {
  distanceM: number;
  deltaVector: [number, number, number];
  attenuationDb: number;
  directivityAngleDeg: number;
  directivityCoefficient: number;
  directivityGainDb: number;
  lowPassCutoffHz: number;
  airAbsorptionFilterHz: number;
  occluded: boolean;
  occlusionLossDb: number;
  occluderCount: number;
  room: RoomDiagnostics;
};

type RoomDiagnostics = {
  materialKey: RoomMaterialPreset;
  materialResonanceId: ResonanceMaterialId;
  materialName: string;
  materialAlphaLabel: string;
  materialDesc: string;
  reverbNodeConnected: boolean;
  width: number;
  height: number;
  depth: number;
  volumeM3: number;
  surfaceAreaM2: number;
  volumeSurfaceRatio: number;
};

function getRoomDiagnostics(): RoomDiagnostics | null {
  if (!engineState) return null;
  const { width, height, depth } = engineState.roomDimensions;
  const material = ACOUSTIC_MATERIALS[currentRoomMaterial];
  const volumeM3 = width * height * depth;
  const surfaceAreaM2 = 2 * (width * height + width * depth + height * depth);
  const volumeSurfaceRatio = volumeM3 / Math.max(0.001, surfaceAreaM2);
  return {
    materialKey: currentRoomMaterial,
    materialResonanceId: currentResonanceMaterialId,
    materialName: material.name,
    materialAlphaLabel: material.alpha,
    materialDesc: material.desc,
    reverbNodeConnected: isReverbNodeConnected,
    width,
    height,
    depth,
    volumeM3,
    surfaceAreaM2,
    volumeSurfaceRatio,
  };
}

function getTrackDiagnostics(trackId: string): TrackDiagnostics | null {
  if (!engineState) return null;
  const nodes = trackNodes.get(trackId);
  const position = trackPositions.get(trackId);
  if (!nodes || !position) return null;

  const listener = engineState.listenerPosition;
  const dx = listener.x - position[0];
  const dy = listener.y - position[1];
  const dz = listener.z - position[2];
  const distance = Math.max(0.001, Math.sqrt(dx * dx + dy * dy + dz * dz));
  const attenuationDb = attenuationDbFromDistance(distance);

  const dirState = trackDirectivityState.get(trackId);
  const toListenerLen = Math.max(0.001, Math.sqrt(dx * dx + dy * dy + dz * dz));
  const lx = dx / toListenerLen;
  const ly = dy / toListenerLen;
  const lz = dz / toListenerLen;
  const fx = dirState?.tx ?? 0;
  const fy = dirState?.ty ?? 0;
  const fz = dirState?.tz ?? -1;
  const dot = Math.max(-1, Math.min(1, fx * lx + fy * ly + fz * lz));
  const angleDeg = (Math.acos(dot) * 180) / Math.PI;
  const directivityCoefficient = dirState?.enabled ? Math.max(0, (1 + dot) / 2) : 1;
  const directivityGainDb = linearToGainDb(directivityCoefficient);

  const lowPassCutoffHz = Math.max(
    120,
    Math.min(
      nodes.airFilter.frequency.value,
      nodes.occlusionFilter.frequency.value,
      nodes.shadowFilter.frequency.value,
      nodes.dynamicOcclusionFilter.frequency.value
    )
  );
  const airAbsorptionFilterHz = Math.max(120, nodes.airFilter.frequency.value);
  const occluded = shadowLineBlockedState.get(trackId) ?? false;
  const occlusionLossDb = shadowOcclusionLossDbState.get(trackId) ?? 0;
  const occluderCount = shadowOccluderCountState.get(trackId) ?? 0;
  const room = getRoomDiagnostics();
  if (!room) return null;

  return {
    distanceM: distance,
    deltaVector: [listener.x - position[0], listener.y - position[1], listener.z - position[2]],
    attenuationDb,
    directivityAngleDeg: angleDeg,
    directivityCoefficient,
    directivityGainDb,
    lowPassCutoffHz,
    airAbsorptionFilterHz,
    occluded,
    occlusionLossDb,
    occluderCount,
    room,
  };
}

function logDiagnosticsThrottled(trackId: string) {
  if (process.env.NODE_ENV !== "development") return;
  const now = performance.now();
  const last = diagnosticsLastLogMs.get(trackId) ?? 0;
  if (now - last < DIAGNOSTICS_LOG_THROTTLE_MS) return;
  diagnosticsLastLogMs.set(trackId, now);
  const d = getTrackDiagnostics(trackId);
  if (!d) return;
  console.log(
    [
      `--- [foam DIAGNOSTICS: Track #${trackId}] ---`,
      `📍 Distance: ${d.distanceM.toFixed(2)} meters | Delta Vector: [${d.deltaVector[0].toFixed(
        2
      )}, ${d.deltaVector[1].toFixed(2)}, ${d.deltaVector[2].toFixed(2)}]`,
      `🔊 Attenuation: ${d.attenuationDb.toFixed(1)} dB (Inverse Square Law)`,
      `🔄 Angle to Listener: ${d.directivityAngleDeg.toFixed(
        1
      )}° | Directivity Gain: ${d.directivityGainDb.toFixed(1)} dB`,
      `🧱 Occlusion: ${d.occluded ? "[ACTIVE]" : "[INACTIVE]"} | LPF Cutoff: ${Math.round(
        d.lowPassCutoffHz
      )} Hz | Loss: ${d.occlusionLossDb.toFixed(1)} dB | Columns: ${d.occluderCount}`,
      `💨 Air Absorption Filter: ${Math.round(d.airAbsorptionFilterHz)} Hz`,
      "-----------------------------------------",
      "🔊 --- [foam AUDIO RESONANCE DEEPLOG] ---",
      `📐 Box Size: ${d.room.width.toFixed(1)}m x ${d.room.height.toFixed(1)}m x ${d.room.depth.toFixed(
        1
      )}m`,
      `🧱 Sent Material Key: "${d.room.materialKey}" -> ID passed to Engine: "${d.room.materialResonanceId}"`,
      `📊 Specs: Name: ${d.room.materialName} | Coefficients: ${d.room.materialAlphaLabel}`,
      `🎛️ AudioContext State: ${Tone.getContext().state} | Is Node Active: ${
        d.room.reverbNodeConnected ? "YES" : "NO"
      }`,
      "--------------------------------",
    ].join("\n")
  );
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

  if (isPlaying) {
    players.forEach((player) => {
      try {
        player.stop();
      } catch {
        // no-op
      }
    });
    Tone.Transport.stop();
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
  isPlaying = true;
  return true;
}

function disposeAudioEngine() {
  if (!engineState) return;
  engineState.safetyLimiter.disconnect();
  isPlaying = false;
  globalPlaybackStartTime = 0;
  for (const player of players.values()) player.dispose();
  for (const nodes of trackNodes.values()) {
    nodes.uiGain.disconnect();
    nodes.mixGain.disconnect();
    nodes.distanceGain.disconnect();
    nodes.airFilter.disconnect();
    nodes.occlusionFilter.disconnect();
    nodes.shadowFilter.disconnect();
    nodes.shadowOcclusionGain.disconnect();
    nodes.dynamicOcclusionFilter.disconnect();
    nodes.dynamicOcclusionGain.disconnect();
  }
  players.clear();
  sources.clear();
  trackIds.clear();
  trackNodes.clear();
  trackPositions.clear();
  pendingTrackPositions.clear();
  if (trackPositionRafId !== null && typeof window !== "undefined") {
    window.cancelAnimationFrame(trackPositionRafId);
  }
  trackPositionRafId = null;
  trackMixState.clear();
  shadowOcclusionState.clear();
  shadowLineBlockedState.clear();
  shadowOcclusionLossDbState.clear();
  shadowOccluderCountState.clear();
  shadowCutoffHzState.clear();
  dynamicAcousticsState.clear();
  diagnosticsLastLogMs.clear();
  trackDirectivityState.clear();
  airAbsorptionEnabled = false;
  educationalShadowsEnabled = false;
  engineState = null;
}

function isAudioPlaying() {
  return isPlaying;
}

function readMasterLevel() {
  if (!engineState || !isPlaying) return 0;
  engineState.masterAnalyser.getByteTimeDomainData(analyserBuffer);
  let sum = 0;
  for (let i = 0; i < analyserBuffer.length; i++) {
    const v = (analyserBuffer[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / analyserBuffer.length);
  return Math.min(1, rms * 2.4);
}

function getTransportSeconds() {
  if (!engineState) return 0;
  return Math.max(0, Tone.Transport.seconds);
}

function getMaxTrackDurationSeconds() {
  let max = 0;
  for (const nodes of trackNodes.values()) {
    const duration = nodes.player.buffer?.duration ?? 0;
    if (Number.isFinite(duration) && duration > max) max = duration;
  }
  return max;
}

function seekTransport(seconds: number) {
  if (!engineState) return;
  const safe = Math.max(0, seconds);
  const wasPlaying = isPlaying;

  players.forEach((player) => {
    try {
      player.stop();
    } catch {
      // no-op
    }
  });
  try {
    Tone.Transport.stop();
  } catch {
    // no-op
  }

  Tone.Transport.seconds = safe;

  if (wasPlaying) {
    const startAt = Tone.now() + 0.03;
    globalPlaybackStartTime = engineState.audioContext.currentTime + 0.03 - safe;
    players.forEach((player) => {
      try {
        const duration = player.buffer?.duration ?? 0;
        const offset = duration > 0 ? safe % duration : 0;
        player.start(startAt, offset);
      } catch {
        // no-op
      }
    });
    Tone.Transport.start();
    isPlaying = true;
  } else {
    isPlaying = false;
    globalPlaybackStartTime = 0;
  }
}

function isTrackAudible(trackId: string) {
  const hasSolo = Array.from(trackMixState.values()).some((state) => state.solo);
  const state = trackMixState.get(trackId) ?? { muted: false, solo: false };
  return isPlaying && (hasSolo ? state.solo && !state.muted : !state.muted);
}

function getTrackLoadingState(trackIdList: string[]): TrackLoadingState {
  const total = trackIdList.length;
  if (total === 0) return { loaded: 0, total: 0 };
  let loaded = 0;
  for (const id of trackIdList) {
    if (trackNodes.has(id)) loaded += 1;
  }
  return { loaded, total };
}

function isTrackLoaded(trackId: string) {
  return trackNodes.has(trackId);
}

export {
  disposeAudioEngine,
  ensureTrackAudio,
  pruneTracks,
  setListenerTransform,
  setTrackPosition,
  setTrackDirectivityState,
  setTrackMixState,
  setTrackUiGainDb,
  toggleTransport,
  setAirAbsorptionEnabled,
  setEducationalShadowEnabled,
  updateTrackShadowOcclusion,
  isAudioPlaying,
  isTrackAudible,
  getTrackLoadingState,
  isTrackLoaded,
  readMasterLevel,
  getTransportSeconds,
  getMaxTrackDurationSeconds,
  seekTransport,
  updateRoomAcoustics,
  setTrackDynamicAcoustics,
  getTrackAcousticData,
  getTrackDiagnostics,
  getRoomDiagnostics,
  waitForToneLoaded,
  preloadTracks,
};
