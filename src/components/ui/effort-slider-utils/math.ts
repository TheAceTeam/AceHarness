export type RGB = readonly [number, number, number];
export const TAU = Math.PI * 2;
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const easeOutCubic = (value: number) => 1 - (1 - clamp(value, 0, 1)) ** 3;
export function smoothstep(min: number, max: number, value: number) {
  const x = clamp((value - min) / (max - min), 0, 1);
  return x * x * (3 - 2 * x);
}
export const hash = (seed: number) => { const x = Math.sin(seed * 127.1) * 43758.5453; return x - Math.floor(x); };
export const mixRgb = (a: RGB, b: RGB, amount: number): RGB => [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount];
export const rgba = (color: RGB, alpha: number) => `rgba(${color.join(',')},${alpha})`;
