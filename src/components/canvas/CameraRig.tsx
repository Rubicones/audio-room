import { OrthographicCamera } from "@react-three/drei";
import gsap from "gsap";
import { useEffect, useRef } from "react";
import { OrthographicCamera as ThreeOrthographicCamera, Vector3 } from "three";

type CameraView = "isometric" | "top-down";

type CameraRigProps = {
  view: CameraView;
};

const ISO_TARGET = new Vector3(12, 10, 12);
const TOP_TARGET = new Vector3(0, 20, 0.001);
const LOOK_AT = new Vector3(0, 0, 0);

export function CameraRig({ view }: CameraRigProps) {
  const cameraRef = useRef<ThreeOrthographicCamera>(null);

  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;

    const target = view === "top-down" ? TOP_TARGET : ISO_TARGET;
    const nextZoom = view === "top-down" ? 56 : 48;

    gsap.to(camera.position, {
      x: target.x,
      y: target.y,
      z: target.z,
      duration: 0.85,
      ease: "power2.inOut",
      onUpdate: () => camera.lookAt(LOOK_AT),
    });

    gsap.to(camera, {
      zoom: nextZoom,
      duration: 0.85,
      ease: "power2.inOut",
      onUpdate: () => {
        camera.lookAt(LOOK_AT);
        camera.updateProjectionMatrix();
      },
    });
  }, [view]);

  return (
    <OrthographicCamera
      ref={cameraRef}
      makeDefault
      position={ISO_TARGET.toArray()}
      zoom={48}
      near={0.1}
      far={1000}
    />
  );
}

export type { CameraView };
