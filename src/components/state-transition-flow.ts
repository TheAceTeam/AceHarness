const PIXELS_PER_SECOND = 500;
const PULSE_INTERVAL_SECONDS = 3;
const PULSE_SPACING = PIXELS_PER_SECOND * PULSE_INTERVAL_SECONDS;
const HIGHLIGHT_LENGTH = 40;

type MeasuredPath = { path: SVGPathElement; start: number; length: number };

function measurePaths(diagram: HTMLElement): MeasuredPath[] {
  const paths = Array.from(diagram.querySelectorAll<SVGPathElement>('path.state-transition-flow[data-transition-index]'));
  paths.sort((a, b) => Number(a.dataset.transitionIndex) - Number(b.dataset.transitionIndex));
  const measured: MeasuredPath[] = [];
  let start = 0;
  for (const path of paths) {
    const length = path.getTotalLength?.() ?? 0;
    if (!Number.isFinite(length) || length <= 0) continue;
    measured.push({ path, start, length });
    start += length;
  }
  return measured;
}

export function getTransitionHighlightDashes(distance: number, start: number, length: number): string {
  const firstPulse = Math.max(0, Math.floor((distance - start - length - HIGHLIGHT_LENGTH) / PULSE_SPACING) + 1);
  const lastPulse = Math.floor((distance - start) / PULSE_SPACING);
  const dashes = [0];
  let lastEnd = 0;

  // Work in SVG path units so the same distance is covered per frame on every edge.
  for (let pulse = lastPulse; pulse >= firstPulse; pulse--) {
    const head = distance - pulse * PULSE_SPACING - start;
    const from = Math.max(0, head - HIGHLIGHT_LENGTH);
    const to = Math.min(length, head);
    if (from >= to) continue;
    dashes.push(from - lastEnd, to - from);
    lastEnd = to;
  }

  if (dashes.length === 1) return '';
  dashes.push(length - lastEnd + 1);
  return dashes.join(' ');
}

export function startTransitionFlow(diagram: HTMLElement) {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let paths: MeasuredPath[] = [];
  let needsMeasurement = true;
  let frame = 0;
  let startedAt: number | undefined;

  const observer = new MutationObserver(() => { needsMeasurement = true; });
  observer.observe(diagram, { subtree: true, childList: true, attributes: true, attributeFilter: ['d'] });

  function animate(now: number) {
    if (needsMeasurement) {
      for (const { path } of paths) path.style.visibility = 'hidden';
      paths = measurePaths(diagram);
      needsMeasurement = false;
    }
    if (paths.length > 0) {
      startedAt ??= now;
      const distance = (now - startedAt) / 1000 * PIXELS_PER_SECOND;
      for (const edge of paths) {
        const dashes = getTransitionHighlightDashes(distance, edge.start, edge.length);
        if (dashes) {
          edge.path.style.strokeDasharray = dashes;
          edge.path.style.visibility = 'visible';
        } else if (edge.path.style.visibility === 'visible') {
          edge.path.style.visibility = 'hidden';
        }
      }
    }
    frame = requestAnimationFrame(animate);
  }

  function updateMotionPreference() {
    cancelAnimationFrame(frame);
    startedAt = undefined;
    if (reducedMotion?.matches) {
      for (const { path } of paths) path.style.visibility = 'hidden';
    } else {
      frame = requestAnimationFrame(animate);
    }
  }

  updateMotionPreference();
  reducedMotion?.addEventListener('change', updateMotionPreference);
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    reducedMotion?.removeEventListener('change', updateMotionPreference);
    for (const { path } of paths) path.style.visibility = 'hidden';
  };
}
