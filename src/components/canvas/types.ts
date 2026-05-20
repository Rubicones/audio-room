export type Vec3 = [number, number, number];

export const MATERIAL_REGISTRY = {
  concrete: {
    idReal: "polished-concrete-or-tile",
    name: "Smooth Concrete",
    alpha: "α ≈ 0.02",
    absorption: 0.02,
    desc: "Max reflections, severe flutter echo profile",
  },
  brick: {
    idReal: "brick-bare",
    name: "Bare Brickwork",
    alpha: "α ≈ 0.03",
    absorption: 0.03,
    desc: "Rigid mid-frequency bounce, distinct loft acoustics",
  },
  stone: {
    idReal: "concrete-block-painted",
    name: "Painted Block",
    alpha: "α ≈ 0.05",
    absorption: 0.05,
    desc: "Reflective mid-to-high frequency treatment",
  },
  glass: {
    idReal: "glass-thin",
    name: "Thin Glass",
    alpha: "α ≈ 0.10",
    absorption: 0.1,
    desc: "Reflects upper spectrum, passes lower frequencies",
  },
  wood: {
    idReal: "wood-panel",
    name: "Wood Paneling",
    alpha: "α ≈ 0.15",
    absorption: 0.15,
    desc: "Warm acoustic response, musical low-mid absorption",
  },
  plywood: {
    idReal: "plywood-panel",
    name: "Plywood Panel",
    alpha: "α ≈ 0.20",
    absorption: 0.2,
    desc: "Low-frequency structural membrane damping",
  },
  curtain: {
    idReal: "curtain-heavy",
    name: "Stage Drapery",
    alpha: "α ≈ 0.50",
    absorption: 0.5,
    desc: "Heavy broadband mid-to-high dampening",
  },
  tiles: {
    idReal: "acoustic-ceiling-tiles",
    name: "Acoustic Tiles",
    alpha: "α ≈ 0.65",
    absorption: 0.65,
    desc: "High performance educational/office damping",
  },
  foam: {
    idReal: "transparent",
    name: "Anechoic Foam",
    alpha: "α = 1.00",
    absorption: 1,
    desc: "100% total acoustic absorption, perfectly dead room",
  },
} as const;

export type RoomMaterialKey = keyof typeof MATERIAL_REGISTRY;
export type ResonanceMaterialId =
  (typeof MATERIAL_REGISTRY)[RoomMaterialKey]["idReal"];

export type TrackConfig = {
  name: string;
  color: string;
  audioUrl: string;
  /** dB offset for inverse-square zone visualization (0 = reference). */
  gainDb?: number;
  isDirectivityEnabled?: boolean;
  rotationDeg?: number;
  showShadows?: boolean;
};

export type Track = Omit<TrackConfig, "gainDb"> & {
  id: string;
  position: Vec3;
  muted: boolean;
  solo: boolean;
  gainDb: number;
  isDirectivityEnabled: boolean;
  rotationDeg: number;
  showShadows: boolean;
};

export type ObstacleType = "cylinder" | "box" | "wall-with-window";

export interface LineSegment2D {
  start: [number, number];
  end: [number, number];
}

export interface AcousticObstacle {
  id: string;
  type: ObstacleType;
  position: Vec3;
  rotationDeg: number;
  windowOffsetPct: number;
  radius: number;
  height: number;
  color: string;
  materialPreset: RoomMaterialKey;
  width?: number;
  depth?: number;
}
