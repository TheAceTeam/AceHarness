import * as React from 'react';
export interface CanvasSurface { context: CanvasRenderingContext2D; width: number; height: number }
export function useCanvas(ref: React.RefObject<HTMLCanvasElement | null>, onResize: (surface: CanvasSurface) => void) {
  const surface = React.useRef<CanvasSurface | null>(null);
  const callback = React.useRef(onResize);
  callback.current = onResize;
  React.useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      surface.current = { context, width, height };
      callback.current(surface.current);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => { observer.disconnect(); surface.current = null; };
  }, [ref]);
  return surface;
}
