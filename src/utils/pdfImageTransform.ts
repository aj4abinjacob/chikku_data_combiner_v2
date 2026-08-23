export function normalizeRotationDegrees(rotation: number): number {
  return ((rotation % 360) + 360) % 360;
}

export function getRotatedBoundingSize(
  width: number,
  height: number,
  rotation: number
): { width: number; height: number } {
  const normalizedRotation = normalizeRotationDegrees(rotation);
  if (normalizedRotation === 0 || normalizedRotation === 180) return { width, height };
  if (normalizedRotation === 90 || normalizedRotation === 270) return { width: height, height: width };

  const radians = normalizedRotation * Math.PI / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  return {
    width: width * cosine + height * sine,
    height: width * sine + height * cosine,
  };
}
