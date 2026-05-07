import { OBSTACLE_CENTER, OBSTACLE_HEIGHT, OBSTACLE_RADIUS } from "./obstacleConstants";

const INK = "#1a1a1a";

/**
 * Wireframe cylinder only — no opaque fill (blueprint sketch).
 */
export function ObstacleColumn() {
  const y = OBSTACLE_HEIGHT / 2;
  return (
    <mesh position={[OBSTACLE_CENTER.x, y, OBSTACLE_CENTER.z]}>
      <cylinderGeometry
        args={[OBSTACLE_RADIUS, OBSTACLE_RADIUS, OBSTACLE_HEIGHT, 40, 1]}
      />
      <meshBasicMaterial
        color={INK}
        wireframe
        toneMapped={false}
      />
    </mesh>
  );
}
