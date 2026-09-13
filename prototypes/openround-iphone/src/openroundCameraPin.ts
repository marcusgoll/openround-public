export type CameraPinEstimate = {
  yards: number;
  confidence: "high" | "low";
};

export function estimateCameraPinDistance({
  flagHeightInches = 84,
  observedFlagPixels,
  frameHeightPixels,
}: {
  flagHeightInches?: number;
  observedFlagPixels: number;
  frameHeightPixels: number;
}): CameraPinEstimate | null {
  if (flagHeightInches <= 0 || observedFlagPixels < 12 || frameHeightPixels <= 0) return null;
  const yards = Math.round((flagHeightInches / 36) * (frameHeightPixels / observedFlagPixels) * 2.2);
  return { yards, confidence: yards <= 200 ? "high" : "low" };
}
