import { OrthographicCamera } from "@react-three/drei";
import { useEffect, useRef, useState } from "react";
import { OrthographicCamera as ThreeOrthographicCamera, Vector3 } from "three";

type CameraView = "isometric" | "top-down";

type CameraRigProps = {
  view: CameraView;
  zoomSteps: number;
};

const ISO_DISTANCE = 22;
const ISO_TARGET = new Vector3(
  ISO_DISTANCE * Math.cos(Math.PI / 4),
  ISO_DISTANCE * Math.tan(Math.PI / 6),
  ISO_DISTANCE * Math.sin(Math.PI / 4)
);
const TOP_TARGET = new Vector3(0, 28, 0.001);
const LOOK_AT = new Vector3(0, 0.5, 0);

function isMobileViewport() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 900px)").matches;
}

export function CameraRig({ view, zoomSteps }: CameraRigProps) {
  const cameraRef = useRef<ThreeOrthographicCamera>(null);
  const [mobile, setMobile] = useState(isMobileViewport);

  useEffect(() => {
    const onResize = () => setMobile(isMobileViewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;

    const target = view === "top-down" ? TOP_TARGET : ISO_TARGET;
    const baseZoom = view === "top-down" ? (mobile ? 34 : 52) : mobile ? 28 : 44;
    const nextZoom = Math.max(16, Math.min(90, baseZoom + zoomSteps * 3));

    camera.position.set(target.x, target.y, target.z);
    camera.zoom = nextZoom;
    camera.lookAt(LOOK_AT);
    camera.updateProjectionMatrix();
  }, [view, zoomSteps, mobile]);

  return (
    <OrthographicCamera
      ref={cameraRef}
      makeDefault
      position={ISO_TARGET.toArray()}
      zoom={mobile ? 28 : 44}
      near={0.1}
      far={1000}
    />
  );
}

export type { CameraView };
