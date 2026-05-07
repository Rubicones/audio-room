export const DIRECTIVITY_ARROW_FRONT_OFFSET = 0.54;
export const DIRECTIVITY_ARROW_TIP_OFFSET = 0.87;

export function getForwardDirectionFromRotationDeg(rotationDeg: number) {
  const rad = (rotationDeg * Math.PI) / 180;
  return {
    x: Math.sin(rad),
    z: -Math.cos(rad),
  };
}

export function getDirectivityRayAnchors(
  sourceX: number,
  sourceZ: number,
  rotationDeg: number
) {
  const dir = getForwardDirectionFromRotationDeg(rotationDeg);
  const frontX = sourceX + dir.x * DIRECTIVITY_ARROW_FRONT_OFFSET;
  const frontZ = sourceZ + dir.z * DIRECTIVITY_ARROW_FRONT_OFFSET;
  const tipX = sourceX + dir.x * DIRECTIVITY_ARROW_TIP_OFFSET;
  const tipZ = sourceZ + dir.z * DIRECTIVITY_ARROW_TIP_OFFSET;
  return {
    dir,
    frontX,
    frontZ,
    tipX,
    tipZ,
  };
}

