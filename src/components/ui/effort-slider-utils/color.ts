import * as React from 'react';
import type { RGB } from './math';
export type ColorToken = readonly [string, string];
export type Palette<K extends string> = Record<K, RGB>;
export function usePalette<K extends string>(ref: React.RefObject<HTMLElement | null>, tokens: Record<K, ColorToken>, onChange: () => void) {
  const palette = React.useRef<Palette<K> | null>(null);
  const callback = React.useRef(onChange); callback.current = onChange;
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const probe = document.createElement('span');
    probe.hidden = true; element.appendChild(probe);
    const update = () => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d'); if (!context) return;
      const result = {} as Palette<K>;
      for (const key of Object.keys(tokens) as K[]) {
        const [variable, fallback] = tokens[key];
        const raw = getComputedStyle(element).getPropertyValue(variable).trim();
        probe.style.color = raw && /^[\d.]+\s/.test(raw) ? `hsl(${raw})` : raw || fallback;
        context.clearRect(0, 0, 1, 1); context.fillStyle = getComputedStyle(probe).color;
        context.fillRect(0, 0, 1, 1);
        const rgb = context.getImageData(0, 0, 1, 1).data; result[key] = [rgb[0], rgb[1], rgb[2]];
      }
      palette.current = result; callback.current();
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    return () => { observer.disconnect(); probe.remove(); };
  }, [ref, tokens]);
  return palette;
}
