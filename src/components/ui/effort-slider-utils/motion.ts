import * as React from 'react';
export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export function useReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => { const media = window.matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setReduced(media.matches); update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  return reduced;
}
export function useLazyRef<T>(factory: () => T) {
  const ref = React.useRef<T | null>(null);
  if (ref.current === null) ref.current = factory();
  return ref as React.RefObject<T>;
}
export function springStep(state: { position: number; velocity: number }, target: number, delta: number) {
  const steps = Math.max(1, Math.ceil(delta / (1 / 120)));
  const dt = Math.min(delta, .064) / steps;
  for (let i = 0; i < steps; i++) { state.velocity += ((target - state.position) * 420 - state.velocity * 30) * dt; state.position += state.velocity * dt; }
}
export function useAnimationLoop(ref: React.RefObject<HTMLElement | null>, step: (time: number, delta: number) => boolean) {
  const callback = React.useRef(step); callback.current = step;
  const frame = React.useRef<number | null>(null);
  const previous = React.useRef(0);
  const alive = React.useRef(false);
  const loop = React.useMemo(() => {
    const tick = (time: number) => {
      frame.current = null;
      if (!alive.current || !ref.current || document.hidden) return;
      const delta = previous.current ? Math.min((time - previous.current) / 1000, .064) : 1 / 60;
      previous.current = time;
      if (callback.current(time / 1000, delta)) frame.current = requestAnimationFrame(tick);
    };
    return { kick: () => { if (alive.current && frame.current === null) { previous.current = 0; frame.current = requestAnimationFrame(tick); } } };
  }, [ref]);
  React.useLayoutEffect(() => { alive.current = true; loop.kick(); const resume = () => { if (!document.hidden) loop.kick(); }; document.addEventListener('visibilitychange', resume); return () => { alive.current = false; if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; document.removeEventListener('visibilitychange', resume); }; }, [loop]);
  return loop;
}
