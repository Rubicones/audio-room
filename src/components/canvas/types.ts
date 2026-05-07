export type Vec3 = [number, number, number];

export type TrackConfig = {
  name: string;
  color: string;
  audioUrl: string;
};

export type Track = TrackConfig & {
  id: string;
  position: Vec3;
  muted: boolean;
  solo: boolean;
};
