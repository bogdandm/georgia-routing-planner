export function formatTrackDistance(meters: number): string {
  return `${(meters / 1_000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

export function formatTrackElevation(meters: number): string {
  return `${Math.round(meters).toLocaleString('en')} m`;
}

export function formatTrackGrade(gradePct: number): string {
  const rounded = Math.round(gradePct);
  if (Object.is(rounded, -0) || rounded === 0) return '0%';
  return `${rounded > 0 ? '+' : ''}${String(rounded)}%`;
}
