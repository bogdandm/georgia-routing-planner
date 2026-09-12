export function formatWeatherMillimetresValue(value: number): string {
  if (value === 0) return '0';
  return value < 10 ? value.toFixed(1) : Math.round(value).toString();
}

export function formatWeatherMillimetres(value: number): string {
  return `${formatWeatherMillimetresValue(value)} mm`;
}
