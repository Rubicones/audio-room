export type Vec3 = [number, number, number];

export type TrackConfig = {
  name: string;
  color: string;
  audioUrl: string;
  /** dB offset for inverse-square zone visualization (0 = reference). */
  gainDb?: number;
  isDirectivityEnabled?: boolean;
  rotationDeg?: number;
};

export type Track = Omit<TrackConfig, "gainDb"> & {
  id: string;
  position: Vec3;
  muted: boolean;
  solo: boolean;
  gainDb: number;
  isDirectivityEnabled: boolean;
  rotationDeg: number;
};
