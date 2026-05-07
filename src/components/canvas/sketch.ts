import { useEffect, useState } from "react";
import { CanvasTexture, RepeatWrapping, Texture } from "three";

let cachedPaperTexture: Texture | null = null;
let cachedShadowTexture: Texture | null = null;

const FONT_PATH = "/fonts/Itim-Regular.ttf";
type FontStatus = "pending" | "ok" | "missing";
let cachedFontStatus: FontStatus = "pending";
const fontStatusListeners = new Set<(status: FontStatus) => void>();

function setFontStatus(status: FontStatus) {
  cachedFontStatus = status;
  fontStatusListeners.forEach((listener) => listener(status));
}

if (typeof window !== "undefined") {
  fetch(FONT_PATH, { method: "HEAD" })
    .then((res) => setFontStatus(res.ok ? "ok" : "missing"))
    .catch(() => setFontStatus("missing"));
}

export function useItimFontUrl(): string | undefined {
  const [status, setStatus] = useState<FontStatus>(cachedFontStatus);
  useEffect(() => {
    fontStatusListeners.add(setStatus);
    return () => {
      fontStatusListeners.delete(setStatus);
    };
  }, []);
  return status === "ok" ? FONT_PATH : undefined;
}

export function getPaperTexture(): Texture | null {
  if (typeof document === "undefined") return null;
  if (cachedPaperTexture) return cachedPaperTexture;

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);

  const grain = ctx.getImageData(0, 0, size, size);
  const { data } = grain;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 14;
    data[i] = Math.min(255, Math.max(240, 252 + noise));
    data[i + 1] = Math.min(255, Math.max(240, 252 + noise));
    data[i + 2] = Math.min(255, Math.max(240, 252 + noise));
    data[i + 3] = 255;
  }
  ctx.putImageData(grain, 0, 0);

  ctx.strokeStyle = "rgba(0,0,0,0.045)";
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 40; i++) {
    const y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y + (Math.random() - 0.5) * 8);
    ctx.stroke();
  }
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.04})`;
    ctx.beginPath();
    ctx.arc(x, y, Math.random() * 1.4 + 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  cachedPaperTexture = texture;
  return texture;
}

export function getShadowTexture(): Texture | null {
  if (typeof document === "undefined") return null;
  if (cachedShadowTexture) return cachedShadowTexture;

  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  gradient.addColorStop(0, "rgba(0,0,0,0.55)");
  gradient.addColorStop(0.45, "rgba(0,0,0,0.18)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new CanvasTexture(canvas);
  texture.anisotropy = 4;
  cachedShadowTexture = texture;
  return texture;
}

export function jitteredPolyline(
  points: [number, number, number][],
  amplitude = 0.012,
  segmentsPerEdge = 6
): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    for (let s = 0; s <= segmentsPerEdge; s++) {
      const t = s / segmentsPerEdge;
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      const z = a[2] + (b[2] - a[2]) * t;
      const skip = s === 0 || s === segmentsPerEdge;
      const jx = skip ? 0 : (Math.random() - 0.5) * amplitude;
      const jy = skip ? 0 : (Math.random() - 0.5) * amplitude;
      const jz = skip ? 0 : (Math.random() - 0.5) * amplitude;
      out.push([x + jx, y + jy, z + jz]);
    }
  }
  return out;
}
