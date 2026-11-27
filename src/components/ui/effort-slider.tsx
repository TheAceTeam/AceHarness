"use client";

import * as React from "react";
import { useTranslations } from "@/hooks/useTranslations";

import {
  useCanvas,
  type CanvasSurface,
} from "@/components/ui/effort-slider-utils/canvas";
import {
  usePalette,
  type ColorToken,
  type Palette,
} from "@/components/ui/effort-slider-utils/color";
import {
  clamp,
  easeOutCubic,
  hash,
  mixRgb,
  rgba,
  smoothstep,
  TAU,
  type RGB,
} from "@/components/ui/effort-slider-utils/math";
import {
  prefersReducedMotion,
  springStep,
  useAnimationLoop,
  useLazyRef,
  useReducedMotion,
} from "@/components/ui/effort-slider-utils/motion";
import { ROLL_TIMING } from "@/components/ui/effort-slider-utils/roll-text";
import { useControllableState } from "@/components/ui/effort-slider-utils/use-controllable-state";
import { cn } from "@/lib/core/utils";

type EffortLevel = string;
interface EffortLevelInfo { id: string }
interface SliderStrings {
  effort: string;
  faster: string;
  smarter: string;
  recommended: string;
  help: string;
  note: string;
}

export interface EffortSliderProps {
  value: string;
  efforts: readonly string[];
  onValueChange: (value: string) => void;
  className?: string;
}

export function EffortSlider({ value, efforts, onValueChange, className }: EffortSliderProps) {
  const { t, locale } = useTranslations();
  const levelsKey = JSON.stringify([...new Set(efforts)]);
  const Slider = React.useMemo(() => createEffortSlider(JSON.parse(levelsKey), {
    effort: t('modelEfforts.label'), faster: t('modelEfforts.faster'), smarter: t('modelEfforts.smarter'),
    recommended: '', help: t('modelEfforts.help'), note: t('modelEfforts.note'),
  }), [levelsKey, t]);
  if (!efforts.length) return null;
  return <Slider value={value || efforts[0]} onValueChange={onValueChange} lang={locale} className={className} />;
}

function createEffortSlider(efforts: string[], strings: SliderStrings) {
const EFFORT_LEVELS: readonly EffortLevelInfo[] = efforts.map(id => ({ id }));
interface InternalEffortSliderProps extends Omit<
  React.ComponentProps<"div">,
  "defaultValue"
> {

  value?: EffortLevel;

  defaultValue?: EffortLevel;

  onValueChange?: (value: EffortLevel) => void;

  onValueInput?: (value: EffortLevel) => void;

  recommended?: EffortLevel;

  lang?: string;

  disabled?: boolean;
}


function AnimatedEffortSlider({
  value,
  defaultValue = EFFORT_LEVELS[0].id,
  onValueChange,
  onValueInput,
  recommended = EFFORT_LEVELS[Math.floor((EFFORT_LEVELS.length - 1) / 2)].id,
  lang,
  disabled = false,
  className,
  ...props
}: InternalEffortSliderProps) {
  const [committed, setCommitted] = useControllableState<EffortLevel>({
    value,
    defaultValue,
    onChange: onValueChange,
  });
  const committedIndex = levelIndex(committed, 0);
  const recommendedIndex = levelIndex(recommended, 0);
  const language = languageOf(lang);
  // Labels supplied by the application i18n.
  const reducedMotion = useReducedMotion();


  const [liveIndex, setLiveIndex] = React.useState<number | null>(null);

  const lit = true;
  const [noteOpen, setNoteOpen] = React.useState(false);
  const noteId = React.useId();
  const [captionHalfWidth, setCaptionHalfWidth] = React.useState(30);
  // The server markup places the thumb with `left`; the loop moves it from there with a transform.
  const [thumbOrigin] = React.useState(committedIndex / Math.max(1, LAST));
  const dragging = liveIndex !== null;
  const shownIndex = liveIndex ?? committedIndex;

  const panelRef = React.useRef<HTMLDivElement>(null);
  const dotsRef = React.useRef<HTMLCanvasElement>(null);
  const effectsRef = React.useRef<HTMLCanvasElement>(null);
  const thumbRef = React.useRef<HTMLDivElement>(null);
  const knobRef = React.useRef<HTMLDivElement>(null);
  const flashRef = React.useRef<HTMLDivElement>(null);
  const ringRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const levelRef = React.useRef<HTMLSpanElement>(null);
  const captionRef = React.useRef<HTMLSpanElement>(null);

  const motionRef = useLazyRef(() => createMotion(committedIndex));
  const track = React.useRef<TrackLayout>({ width: 0, height: 0, dots: [] });
  const arrival = React.useRef<Animation[]>([]);
  const glow = React.useRef<Animation | null>(null);

  function measureCaption() {
    const half = (captionRef.current?.offsetWidth ?? 0) / 2;
    if (half) setCaptionHalfWidth(half);
  }

  const loop = useAnimationLoop(panelRef, step);
  const colors = usePalette(panelRef, SLIDER_COLORS, () => loop.kick());
  const dots = useCanvas(dotsRef, (surface) => {
    track.current = {
      width: surface.width,
      height: surface.height,
      dots: buildLattice(surface.width, surface.height),
    };
    measureCaption();
    loop.kick();
  });
  const effects = useCanvas(effectsRef, () => loop.kick());

  const stopGlow = React.useCallback(() => {
    glow.current?.cancel();
    glow.current = null;
  }, []);
  const startGlow = React.useCallback((delay: number) => {
    glow.current?.cancel();
    const knob = knobRef.current;
    glow.current =
      knob && typeof knob.animate === "function"
        ? knob.animate(GLOW_KEYFRAMES, {
            duration: 2600,
            iterations: Infinity,
            delay,
          })
        : null;
  }, []);

  // A committed level that changes from outside (or is refused by a controlled parent) moves the thumb.
  React.useEffect(() => {
    const state = motionRef.current;
    if (state.dragging || state.index === committedIndex) return;
    state.index = committedIndex;
    state.target = committedIndex;
    if (prefersReducedMotion()) {
      state.position = committedIndex;
      state.velocity = 0;
    }
    loop.kick();
  }, [committedIndex, dragging, motionRef, loop]);


  React.useEffect(() => {
    if (!lit || reducedMotion) return;
    if (!glow.current) startGlow(0);
    return stopGlow;
  }, [lit, reducedMotion, startGlow, stopGlow]);

  // The ambient trail animation stops with reduced motion; restart the loop when that changes.
  React.useEffect(() => {
    loop.kick();
  }, [reducedMotion, loop]);

  React.useLayoutEffect(() => {
    measureCaption();
  }, [strings.recommended]);

  function step(time: number, delta: number) {
    const state = motionRef.current;
    const { width } = track.current;
    const now = time * 1000;
    const reduced = prefersReducedMotion();

    if (!state.dragging || state.grabGlide) {
      if (reduced) {
        state.position = state.target;
        state.velocity = 0;
      } else {
        // under-damped spring: a small, quick overshoot on snap
        springStep(state, state.target, delta);
        state.position = clamp(state.position, -0.15, LAST + 0.15);
      }
    }

    const activeIndex = state.dragging ? Math.round(clamp(state.position, 0, LAST)) : state.index;
    const strength = .16 + .84 * (activeIndex / Math.max(1, LAST));
    const thumbX = xFor(clamp(state.position, 0, LAST), width);
    if (state.lastEffectIndex !== activeIndex && Math.abs(state.position - activeIndex) < .12) {
      state.lastEffectIndex = activeIndex;
      fireArrival(now, thumbX, strength);
    }
    const goal = strength;
    if (reduced) state.ultra = goal;
    else state.ultra += clamp(goal - state.ultra, -delta / RETRACT_SECONDS, delta / GROW_SECONDS);
    state.growing = goal >= state.ultra;
    if (knobRef.current) knobRef.current.style.opacity = String(.65 + strength * .35);

    const thumb = thumbRef.current;
    if (thumb && width) {
      const offset =
        (clamp(state.position, 0, LAST) / Math.max(1, LAST) - thumbOrigin) *
        (width - THUMB_WIDTH);
      thumb.style.transform = `translate3d(${offset.toFixed(2)}px,0,0)`;
    }

    const palette = colors.current;
    const trail = palette ? trailColors(palette) : null;
    const dotsSurface = dots.current;
    if (trail && dotsSurface)
      drawTrail(
        dotsSurface.context,
        track.current,
        trail,
        state,
        thumbX,
        now,
        reduced,
      );
    const effectsSurface = effects.current;
    const sparksLive =
      trail && effectsSurface
        ? drawEffects(
            effectsSurface,
            track.current,
            trail,
            state,
            thumbX,
            now,
            delta,
          )
        : false;

    const bursting =
      sparksLive || (state.burstStart > 0 && now - state.burstStart < 1300);
    const settled =
      !state.dragging &&
      Math.abs(state.position - state.target) < 0.0005 &&
      Math.abs(state.velocity) < 0.001 &&
      state.ultra === goal;
    const ambient = !reduced && state.ultra > 0;
    return !settled || ambient || bursting;
  }


  function fireArrival(now: number, thumbX: number, strength: number) {
    const state = motionRef.current;
    state.ultraLive = true;
    if (prefersReducedMotion()) return;
    state.burstStart = now;

    for (const animation of arrival.current) animation.cancel();
    const played: Animation[] = [];
    const play = (
      element: Element | null | undefined,
      keyframes: Keyframe[],
      options: KeyframeAnimationOptions,
    ) => {
      if (element && typeof element.animate === "function")
        played.push(element.animate(keyframes, options));
    };
    play(flashRef.current, FLASH_KEYFRAMES, {
      duration: 550,
      easing: "cubic-bezier(.1,.8,.3,1)",
    });
    RING_TIMINGS.forEach((timing, i) =>
      play(ringRefs.current[i], RING_KEYFRAMES, {
        ...timing,
        easing: "cubic-bezier(.1,.75,.3,1)",
      }),
    );
    play(knobRef.current, POP_KEYFRAMES, { duration: 550 });
    play(panelRef.current, PANEL_KEYFRAMES, {
      duration: 1000,
      easing: "cubic-bezier(.2,.8,.2,1)",
    });
    const word = levelRef.current?.lastElementChild;
    if (word instanceof HTMLElement) {
      word.style.transformOrigin = "left center";
      play(word, LEVEL_POP_KEYFRAMES, {
        duration: 560,
        easing: "cubic-bezier(.2,.8,.2,1)",
      });
    }
    arrival.current = played;
    startGlow(550);

    const { height } = track.current;
    state.sparks.push(...arrivalSparks(thumbX + FX_X, height / 2 + FX_Y).slice(0, Math.round(110 * strength)));
  }

  function dragTo(trackElement: HTMLElement, clientX: number, first: boolean) {
    const state = motionRef.current;
    const position = positionOnTrack(trackElement, clientX);
    if (first && !prefersReducedMotion()) {
      // glide to the press point instead of jumping
      state.target = position;
      state.grabGlide = true;
    } else {
      state.grabGlide = false;
      state.position = position;
      state.velocity = 0;
    }
    const nearest = Math.round(position);
    if (nearest !== state.lastInput) {
      state.lastInput = nearest;
      state.index = nearest;
      setLiveIndex(nearest);
      onValueInput?.(EFFORT_LEVELS[nearest].id);
    }
    loop.kick();
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || disabled) return;
    event.preventDefault();
    const trackElement = event.currentTarget;
    trackElement.focus({ preventScroll: true });
    trackElement.setPointerCapture(event.pointerId);
    const state = motionRef.current;
    state.dragging = true;
    state.lastInput = state.index;
    setLiveIndex(state.index);
    dragTo(trackElement, event.clientX, true);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (motionRef.current.dragging)
      dragTo(event.currentTarget, event.clientX, false);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const state = motionRef.current;
    if (!state.dragging) return;
    const glide = state.grabGlide;
    state.dragging = false;
    state.grabGlide = false;
    const trackElement = event.currentTarget;
    if (trackElement.hasPointerCapture(event.pointerId))
      trackElement.releasePointerCapture(event.pointerId);
    // the burst already played during the drag when the thumb entered the last stop
    const index = clamp(
      Math.round(glide ? state.target : state.position),
      0,
      LAST,
    );
    state.index = index;
    state.target = index;
    setLiveIndex(null);
    setCommitted(EFFORT_LEVELS[index].id);
    loop.kick();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const { key } = event;
    if (disabled || keyTarget(key, 0) === null) return;
    event.preventDefault();
    // from the latest committed level, so presses that arrive before a re-render still add up
    setCommitted(
      (previous) =>
        EFFORT_LEVELS[
          clamp(keyTarget(key, levelIndex(previous, LAST)) ?? 0, 0, LAST)
        ].id,
    );
  }

  return (
    <div
      data-slot="effort-slider"
      data-disabled={disabled ? "" : undefined}
      lang={lang}
      className={cn(
        "inline-block w-[248px] max-w-full [-webkit-tap-highlight-color:transparent] data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <div
        ref={panelRef}
        className="grid gap-2.5 rounded-xl border border-border bg-card px-3 pt-3 pb-2.5 text-[13px] leading-[1.3] text-foreground shadow-[0_10px_30px_-10px_rgba(20,18,30,.25),0_2px_6px_-2px_rgba(20,18,30,.12)]"
      >
        <div className="flex min-h-[22px] items-center gap-1.5">
          <span className="text-muted-foreground">{strings.effort}</span>
          <LevelName
            ref={levelRef}
            index={shownIndex}
            text={levelLabel(shownIndex, language)}
            reducedMotion={reducedMotion}
          />
          <button
            type="button"
            aria-label={strings.help}
            aria-expanded={noteOpen}
            aria-controls={noteId}
            disabled={disabled}
            onClick={() => setNoteOpen((open) => !open)}
            className="ml-auto grid size-[22px] cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--lumesec)] focus-visible:outline-solid aria-expanded:bg-foreground/8 aria-expanded:text-foreground"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.3}
              strokeLinecap="round"
              aria-hidden="true"
              className="size-3.5"
            >
              <circle cx="8" cy="8" r="6.4" />
              <path d="M6.3 6.2a1.8 1.8 0 0 1 3.5.5c0 1.2-1.8 1.5-1.8 2.6" />
              <circle
                cx="8"
                cy="11.4"
                r=".5"
                fill="currentColor"
                stroke="none"
              />
            </svg>
          </button>
        </div>
        <p
          id={noteId}
          hidden={!noteOpen}
          className="-mt-1 mb-0 text-[12px] leading-[1.45] text-muted-foreground"
        >
          {strings.note}
        </p>
        <div
          aria-hidden="true"
          className="flex justify-between text-[12px] text-muted-foreground"
        >
          <span>{strings.faster}</span>
          <span>{strings.smarter}</span>
        </div>
        <div
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={strings.effort}
          aria-valuemin={0}
          aria-valuemax={LAST}
          aria-valuenow={shownIndex}
          aria-valuetext={levelLabel(shownIndex, language)}
          aria-disabled={disabled || undefined}
          data-dragging={dragging ? "" : undefined}
          data-ultra={lit ? "" : undefined}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
          className="group/track relative h-[22px] cursor-pointer touch-none overflow-hidden rounded-lg bg-muted outline-none focus-visible:ring-2 focus-visible:ring-primary/40 data-[dragging]:cursor-grabbing"
        >
          <canvas
            ref={dotsRef}
            aria-hidden="true"
            className="absolute inset-0 block size-full rounded-lg"
            style={{ width: '100%', height: '100%', border: 0, outline: 0 }}
          />
          <div className="pointer-events-none absolute inset-0 z-[2]">
            {EFFORT_LEVELS.map((level, i) => (
              <div
                key={level.id}
                className={cn(
                  "absolute top-1/2 -ml-px w-0.5 -translate-y-1/2 rounded-sm bg-foreground/30",
                )}
                data-slot="effort-slider-tick"
                style={{ left: stopOffset(i), height: i === shownIndex ? 10 : 7, backgroundColor: 'hsl(var(--foreground) / 0.3)' }}
              />
            ))}
          </div>
          <canvas
            ref={effectsRef}
            aria-hidden="true"
            className="pointer-events-none absolute z-[1] block"
            style={{ top: -40, left: -32, width: 'calc(100% + 64px)', height: 'calc(100% + 80px)', maxWidth: 'none', border: 0, outline: 0 }}
          />
          <div
            ref={thumbRef}
            className="pointer-events-none absolute top-0 z-[3] h-[22px] w-4 will-change-transform"
            style={{ left: `calc((100% - ${THUMB_WIDTH}px) * ${thumbOrigin})` }}
          >
            <div
              ref={flashRef}
              className="absolute top-1/2 left-1/2 -mt-8 -ml-8 size-16 rounded-full bg-[radial-gradient(circle,var(--lumesec-glint)_0%,color-mix(in_srgb,var(--lumesec)_70%,transparent)_30%,transparent_68%)] opacity-0"
            />
            {RING_TIMINGS.map((timing, i) => (
              <div
                key={timing.duration}
                ref={(node) => {
                  ringRefs.current[i] = node;
                }}
                className="absolute inset-0 rounded-[7px] border-2 border-[var(--lumesec)] opacity-0"
              />
            ))}
            <div
              ref={knobRef}
              className="absolute inset-0 rounded-md bg-white shadow-[0_1px_2px_rgba(0,0,0,.28),0_0_0_.5px_rgba(0,0,0,.18)] [transition:transform_.18s_cubic-bezier(.2,.8,.2,1),box-shadow_.4s_ease] group-data-[dragging]/track:[transform:scale(.9,.94)] group-data-[ultra]/track:shadow-[0_1px_2px_rgba(0,0,0,.28),0_0_0_1px_color-mix(in_srgb,var(--lumesec)_55%,transparent),0_0_14px_2px_color-mix(in_srgb,var(--lumesec)_50%,transparent)] motion-reduce:transition-none"
            />
          </div>
        </div>
        <div aria-hidden="true" className="relative h-[15px]">
          <span
            ref={captionRef}
            className="absolute top-0 -translate-x-1/2 text-[11.5px] whitespace-nowrap text-muted-foreground"
            style={{
              left: `clamp(${captionHalfWidth}px, ${stopOffset(recommendedIndex)}, calc(100% - ${captionHalfWidth}px))`,
            }}
          >
            {strings.recommended}
          </span>
        </div>
      </div>
    </div>
  );
}

/* Level name ---------------------------------------------------------------------------------------- */

interface WordMotion {

  direction: number;
  animate: boolean;
}

interface LevelWord {
  key: number;
  text: string;
  ultra: boolean;
  enter: WordMotion;

  exit: WordMotion | null;
}

const STILL: WordMotion = { direction: 1, animate: false };


const LEVEL_MASK =
  "linear-gradient(to bottom, transparent 0, #000 6px, #000 calc(100% - 6px), transparent 100%)";


function LevelName({
  index,
  text,
  reducedMotion,
  ref,
}: {
  index: number;
  text: string;
  reducedMotion: boolean;
  ref: React.Ref<HTMLSpanElement>;
}) {
  const [state, setState] = React.useState<{
    index: number;
    text: string;
    words: LevelWord[];
  }>(() => ({
    index,
    text,
    words: [{ key: 0, text, ultra: true, enter: STILL, exit: null }],
  }));

  // Derive the word list during render, so the new name is in the first paint after the change.
  if (state.text !== text) {
    const current = state.words[state.words.length - 1];
    // a language change swaps the name in place; reduced motion swaps it too
    const change: WordMotion = {
      direction: index > state.index ? 1 : -1,
      animate: index !== state.index && !reducedMotion,
    };
    const next: LevelWord = {
      key: current.key + 1,
      text,
      ultra: index === LAST,
      enter: change,
      exit: null,
    };
    // keep at most two outgoing names when the level changes faster than the animation
    const words = change.animate
      ? [...state.words.slice(-2, -1), { ...current, exit: change }, next]
      : [next];
    setState({ index, text, words });
  }

  const removeWord = React.useCallback((key: number) => {
    setState((value) => ({
      ...value,
      words: value.words.filter((word) => word.key !== key),
    }));
  }, []);

  return (
    <span
      ref={ref}
      aria-hidden="true"
      className="relative -my-1.5 inline-grid justify-items-start py-1.5 font-semibold tracking-[.005em] [perspective:180px]"
      style={{ maskImage: LEVEL_MASK, WebkitMaskImage: LEVEL_MASK }}
    >
      {state.words.map((word) => (
        <LevelNameWord
          key={word.key}
          word={word}
          reducedMotion={reducedMotion}
          onExited={removeWord}
        />
      ))}
    </span>
  );
}

function LevelNameWord({
  word,
  reducedMotion,
  onExited,
}: {
  word: LevelWord;
  reducedMotion: boolean;
  onExited: (key: number) => void;
}) {
  const node = React.useRef<HTMLSpanElement>(null);
  const { key, ultra, enter, exit } = word;

  React.useLayoutEffect(() => {
    const element = node.current;
    if (!element || !enter.animate || typeof element.animate !== "function")
      return;
    const animation = ultra
      ? element.animate(ULTRA_ENTER_KEYFRAMES, {
          duration: 220,
          easing: "cubic-bezier(.2,.8,.2,1)",
        })
      : element.animate(rollInKeyframes(enter.direction), ROLL_TIMING);
    return () => animation.cancel();
  }, [enter, ultra]);

  React.useLayoutEffect(() => {
    if (!exit) return;
    const element = node.current;
    if (!element || typeof element.animate !== "function") {
      onExited(key);
      return;
    }
    // same timing as the incoming name so both ride the drum together
    const animation = ultra
      ? element.animate(ULTRA_EXIT_KEYFRAMES, {
          duration: 200,
          easing: "ease-out",
          fill: "forwards",
        })
      : element.animate(rollOutKeyframes(exit.direction), {
          ...ROLL_TIMING,
          fill: "forwards",
        });
    animation.onfinish = () => onExited(key);
    return () => {
      animation.onfinish = null;
      animation.cancel();
    };
  }, [exit, ultra, key, onExited]);

  React.useEffect(() => {
    const element = node.current;
    if (
      !ultra ||
      reducedMotion ||
      !element ||
      typeof element.animate !== "function"
    )
      return;
    const animation = element.animate(SHIMMER_KEYFRAMES, {
      duration: 2600,
      iterations: Infinity,
    });
    return () => animation.cancel();
  }, [ultra, reducedMotion]);

  return (
    <span
      ref={node}
      className={cn(
        "col-start-1 row-start-1 inline-block [transform-origin:50%_50%_-11px] whitespace-nowrap will-change-[transform,opacity] [backface-visibility:hidden]",
        ultra &&
          "bg-[linear-gradient(100deg,var(--lumesec)_0%,var(--lumesec)_38%,var(--lumesec-glint)_50%,var(--lumesec)_62%,var(--lumesec)_100%)] [background-size:260%_100%] bg-clip-text [background-position:100%_0] text-transparent",
      )}
    >
      {word.text}
    </span>
  );
}

/* Constants ------------------------------------------------------------------------------------------ */

const LAST = EFFORT_LEVELS.length - 1;

// Geometry in CSS pixels
const THUMB_WIDTH = 16;
const TRACK_PAD = THUMB_WIDTH / 2;
const DOT_PITCH = 3.5;
const DOT_SIZE = 1.5;

const TRAIL_LENGTH = 0.75;

const GROW_SECONDS = 0.6;

const RETRACT_SECONDS = 0.35;

const FX_X = 32;
const FX_Y = 40;





const SLIDER_COLORS = {
  accent: ["--lumesec", "#6219f3"],
  glint: ["--lumesec-glint", "#c9bdff"],
  muted: ["--muted-foreground", "#71717b"],
  card: ["--card", "#ffffff"],
} as const satisfies Record<string, ColorToken>;

const PANEL_SHADOW =
  "0 10px 30px -10px rgba(20,18,30,.25), 0 2px 6px -2px rgba(20,18,30,.12)";
const KNOB_DROP = "0 1px 2px rgba(0,0,0,.28)";
const accentMix = (percent: number) =>
  `color-mix(in srgb, var(--lumesec) ${percent}%, transparent)`;

const GLOW_KEYFRAMES: Keyframe[] = [
  {
    boxShadow: `${KNOB_DROP}, 0 0 0 1px ${accentMix(55)}, 0 0 10px 1px ${accentMix(40)}`,
    easing: "ease-in-out",
  },
  {
    boxShadow: `${KNOB_DROP}, 0 0 0 1px ${accentMix(75)}, 0 0 18px 4px ${accentMix(60)}`,
    easing: "ease-in-out",
    offset: 0.5,
  },
  {
    boxShadow: `${KNOB_DROP}, 0 0 0 1px ${accentMix(55)}, 0 0 10px 1px ${accentMix(40)}`,
  },
];

const POP_EASING = "cubic-bezier(.2,1.5,.4,1)";
const POP_KEYFRAMES: Keyframe[] = [
  { transform: "scale(.82)", easing: POP_EASING },
  { transform: "scale(1.28, 1.16)", easing: POP_EASING, offset: 0.4 },
  { transform: "scale(1)" },
];


const RING_TIMINGS = [
  { duration: 900, delay: 80 },
  { duration: 1050, delay: 180 },
  { duration: 750, delay: 0 },
];
const RING_KEYFRAMES: Keyframe[] = [
  { opacity: 1, transform: "scale(1)" },
  { opacity: 0, transform: "scale(4.2, 2.8)" },
];
const FLASH_KEYFRAMES: Keyframe[] = [
  { opacity: 1, transform: "scale(.3)" },
  { opacity: 0, transform: "scale(1.9)" },
];
const PANEL_KEYFRAMES: Keyframe[] = [
  {
    borderColor: "var(--lumesec)",
    boxShadow: `${PANEL_SHADOW}, 0 0 0 1px ${accentMix(60)}, 0 0 48px 6px ${accentMix(38)}`,
  },
  {
    borderColor: "var(--border)",
    boxShadow: `${PANEL_SHADOW}, 0 0 0 0 transparent, 0 0 0 0 transparent`,
  },
];
const LEVEL_POP_KEYFRAMES: Keyframe[] = [
  { transform: "scale(.75)", opacity: 0, filter: "blur(3px)" },
  {
    transform: "scale(1.16)",
    opacity: 1,
    filter: "blur(0) brightness(1.7)",
    offset: 0.45,
  },
  { transform: "scale(1)", opacity: 1, filter: "blur(0) brightness(1)" },
];
const SHIMMER_KEYFRAMES: Keyframe[] = [
  { backgroundPosition: "100% 0", easing: "cubic-bezier(.45,0,.25,1)" },
  { backgroundPosition: "0% 0", offset: 0.7 },
  { backgroundPosition: "0% 0" },
];
const ULTRA_ENTER_KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: "scale(.8)", filter: "blur(3px)" },
  { opacity: 1, transform: "scale(1)", filter: "blur(0)" },
];
const ULTRA_EXIT_KEYFRAMES: Keyframe[] = [
  { opacity: 1, transform: "scale(1)", filter: "blur(0)" },
  { opacity: 0, transform: "scale(.85)", filter: "blur(3px)" },
];

const rollInKeyframes = (direction: number): Keyframe[] => [
  {
    opacity: 0,
    transform: `rotateX(${-direction * 88}deg)`,
    filter: "blur(1.2px)",
    offset: 0,
  },
  { opacity: 1, filter: "blur(0)", offset: 0.55 },
  { opacity: 1, transform: "rotateX(0deg)", filter: "blur(0)", offset: 1 },
];

const rollOutKeyframes = (direction: number): Keyframe[] => [
  { opacity: 1, transform: "rotateX(0deg)", filter: "blur(0)", offset: 0 },
  { opacity: 0.35, offset: 0.45 },
  {
    opacity: 0,
    transform: `rotateX(${direction * 88}deg)`,
    filter: "blur(1.2px)",
    offset: 1,
  },
];

/* Motion state and drawing --------------------------------------------------------------------------- */


interface Dot {
  x: number;
  y: number;

  density: number;

  jitter: number;

  phase: number;
  speed: number;
}

interface TrackLayout {
  width: number;
  height: number;
  dots: Dot[];
}

interface TrailSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;

  mix: number;
}

interface TrailColors {
  dot: RGB;
  accent: RGB;
  glint: RGB;
}


interface SliderMotion {

  lastEffectIndex: number;
  position: number;
  velocity: number;

  target: number;

  index: number;

  ultra: number;

  ultraLive: boolean;

  growing: boolean;

  burstStart: number;
  dragging: boolean;

  grabGlide: boolean;

  lastInput: number;

  lit: boolean;
  sparks: TrailSpark[];

  fxDirty: boolean;
}

function createMotion(index: number): SliderMotion {

  const atUltracode = index === LAST;
  return {
    lastEffectIndex: index,
    position: index,
    velocity: 0,
    target: index,
    index,
    ultra: .16 + .84 * (index / Math.max(1, LAST)),
    ultraLive: atUltracode,
    growing: atUltracode,
    burstStart: -1,
    dragging: false,
    grabGlide: false,
    lastInput: index,
    lit: true,
    sparks: [],
    fxDirty: false,
  };
}

function levelIndex(id: string, fallback: number) {
  const index = EFFORT_LEVELS.findIndex((level) => level.id === id);
  return index >= 0 ? index : fallback;
}


function keyTarget(key: string, index: number) {
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return index + 1;
    case "ArrowLeft":
    case "ArrowDown":
      return index - 1;
    case "Home":
    case "PageDown":
      return 0;
    case "End":
    case "PageUp":
      return LAST;
    default:
      return null;
  }
}


function languageOf(lang: string | undefined): "en" | "de" {
  return lang && /^de(-|$)/i.test(lang) ? "de" : "en";
}

const levelLabel = (index: number, _language: string) => EFFORT_LEVELS[index].id;


const stopOffset = (index: number) =>
  `calc(${TRACK_PAD}px + (100% - ${TRACK_PAD * 2}px) * ${index / Math.max(1, LAST)})`;

const xFor = (position: number, width: number) =>
  TRACK_PAD + (position / Math.max(1, LAST)) * (width - 2 * TRACK_PAD);

function positionOnTrack(trackElement: HTMLElement, clientX: number) {
  const rect = trackElement.getBoundingClientRect();
  return (
    clamp(
      (clientX - rect.left - TRACK_PAD) / (rect.width - 2 * TRACK_PAD),
      0,
      1,
    ) * LAST
  );
}


const trailColors = (
  palette: Palette<keyof typeof SLIDER_COLORS>,
): TrailColors => ({
  dot: mixRgb(palette.muted, palette.card, 1 / 3),
  accent: palette.accent,
  glint: palette.glint,
});

function buildLattice(width: number, height: number) {
  const columns = Math.floor((width - 4) / DOT_PITCH);
  const rows = Math.floor((height - 4) / DOT_PITCH);
  const left = (width - (columns - 1) * DOT_PITCH) / 2;
  const top = (height - (rows - 1) * DOT_PITCH) / 2;
  const dots: Dot[] = [];
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      const seed = column * 31 + row * 7 + 1;
      dots.push({
        x: left + column * DOT_PITCH,
        y: top + row * DOT_PITCH,
        density: hash(seed),
        jitter: hash(seed + 1.13),
        phase: hash(seed + 0.37) * TAU,
        speed: 2 + hash(seed + 0.71) * 5,
      });
    }
  }
  return dots;
}


function arrivalSparks(x: number, y: number): TrailSpark[] {
  return Array.from({ length: 110 }, (_, i) => {
    const alongTrail = i < 78;
    const angle = alongTrail
      ? Math.PI + (Math.random() - 0.5) * 1.3
      : Math.random() * TAU;
    const speed = alongTrail
      ? 160 + Math.random() * 520
      : 70 + Math.random() * 230;
    return {
      x: x + (Math.random() - 0.5) * 6,
      y: y + (Math.random() - 0.5) * 14,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * (alongTrail ? 0.75 : 1),
      age: 0,
      life: 0.45 + Math.random() * 0.75,
      size: Math.random() < 0.25 ? 2.5 : 1.5,
      mix: Math.random(),
    };
  });
}


function drawTrail(
  context: CanvasRenderingContext2D,
  track: TrackLayout,
  colors: TrailColors,
  state: SliderMotion,
  thumbX: number,
  now: number,
  reduced: boolean,
) {
  const { width, height } = track;
  if (!width) return;
  context.clearRect(0, 0, width, height);
  if (state.ultra <= 0) return;
  const growth = state.growing ? easeOutCubic(state.ultra) : state.ultra; // shoots out, then settles
  const { dot, accent, glint } = colors;
  const t = now / 1000;
  const start = thumbX - THUMB_WIDTH / 2; // the trail starts at the thumb's left edge
  const length = width * TRAIL_LENGTH * (.25 + state.ultra * .75); // and reaches three quarters of the track

  // soft violet bloom behind the trail, strongest at the thumb
  const bloom = context.createLinearGradient(start, 0, start - length, 0);
  bloom.addColorStop(0, rgba(accent, 0.26 * smoothstep(0, 0.35, growth)));
  bloom.addColorStop(1, rgba(accent, 0));
  context.fillStyle = bloom;
  context.fillRect(
    Math.max(0, start - length),
    0,
    Math.min(length, start),
    height,
  );

  // light pulses, travelling right to left (0 = thumb, 1 = end of trail)
  const pulses = reduced ? [] : [(t * 0.48) % 1.3, (t * 0.48 + 0.62) % 1.3];
  const pulseStrength = reduced ? 0 : growth;
  const flashWindow =
    state.growing && !reduced ? 1 - smoothstep(0.9, 1, growth) : 0;
  const since = now - state.burstStart;
  const burstGlow =
    state.burstStart > 0 && since < 1500 && !reduced
      ? Math.exp(-since / 280)
      : 0;

  for (const d of track.dots) {
    const n = (start - d.x) / length;
    if (n < 0 || n > 1) continue;

    // procedural reveal: near dots first, with jitter so the front looks organic
    const threshold = n * 0.82 + d.jitter * 0.18;
    const appear = clamp((growth - threshold) / 0.07, 0, 1);
    if (appear <= 0) continue;

    let pulse = 0;
    for (const p of pulses) {
      const distance = n - p;
      pulse += Math.exp(-(distance * distance) / (2 * 0.045 * 0.045));
    }
    pulse = Math.min(1, pulse) * pulseStrength * (1 - n * 0.35);

    const density =
      0.9 - 0.8 * Math.pow(n, 0.85) + pulse * 0.25 + burstGlow * 0.75;
    if (d.density > density) continue;

    let alpha = (0.95 - 0.68 * n) * (.18 + .82 * state.ultra);
    let tint = 1 - smoothstep(0.2, 1, n) * 0.85;
    let white = 0;

    if (flashWindow > 0) {
      const flash = Math.exp(-(growth - threshold) / 0.05) * flashWindow;
      alpha += flash * 0.5;
      white += flash * 0.7;
    }
    if (!reduced) alpha *= 0.66 + 0.34 * Math.sin(t * d.speed + d.phase);
    alpha += pulse * 0.6 + burstGlow * 0.7;
    white += pulse * 0.55 + burstGlow * 0.55;
    alpha *= appear * (1 - smoothstep(0.82, 1, n) * 0.6);

    alpha = clamp(alpha, 0, 1);
    if (alpha < 0.02) continue;
    tint = clamp(tint, 0, 1);
    white = clamp(white, 0, 1);
    // lattice grey toward the accent along the trail, then toward the glint where it flashes (inlined: hot loop)
    const red =
      (dot[0] + (accent[0] - dot[0]) * tint) * (1 - white) + glint[0] * white;
    const green =
      (dot[1] + (accent[1] - dot[1]) * tint) * (1 - white) + glint[1] * white;
    const blue =
      (dot[2] + (accent[2] - dot[2]) * tint) * (1 - white) + glint[2] * white;
    context.globalAlpha = alpha;
    context.fillStyle = `rgb(${red | 0},${green | 0},${blue | 0})`;
    context.fillRect(
      d.x - DOT_SIZE / 2,
      d.y - DOT_SIZE / 2,
      DOT_SIZE,
      DOT_SIZE,
    );
  }
  context.globalAlpha = 1;
}


function drawEffects(
  surface: CanvasSurface,
  track: TrackLayout,
  colors: TrailColors,
  state: SliderMotion,
  thumbX: number,
  now: number,
  delta: number,
) {
  const { context, width, height } = surface;
  const since = now - state.burstStart;
  const shock = state.burstStart > 0 && since < 420;
  if (!state.sparks.length && !shock) {
    if (state.fxDirty) {
      context.clearRect(0, 0, width, height);
      state.fxDirty = false;
    }
    return false;
  }
  state.fxDirty = true;
  const { accent, glint } = colors;
  context.clearRect(0, 0, width, height);
  const cx = thumbX + FX_X;
  const cy = track.height / 2 + FX_Y;

  // shock streak: a light beam fired left along the track
  if (shock) {
    const k = since / 420;
    const reach = easeOutCubic(k * 1.6) * track.width * 0.9;
    const alpha = 0.55 * (1 - k) * state.ultra;
    const beam = context.createLinearGradient(cx, 0, cx - reach, 0);
    beam.addColorStop(0, rgba(glint, alpha));
    beam.addColorStop(0.25, rgba(accent, alpha * 0.8));
    beam.addColorStop(1, rgba(accent, 0));
    context.fillStyle = beam;
    const thickness = 3 + 8 * (1 - k);
    context.fillRect(cx - reach, cy - thickness / 2, reach, thickness);
  }

  const drag = Math.exp(-delta * 3.4);
  const alive: TrailSpark[] = [];
  for (const spark of state.sparks) {
    spark.age += delta;
    if (spark.age >= spark.life) continue;
    spark.vx *= drag;
    spark.vy *= drag;
    spark.x += spark.vx * delta;
    spark.y += spark.vy * delta;
    const life = 1 - spark.age / spark.life;
    const hot = Math.max(0, 1 - spark.age / 0.12);
    const color = mixRgb(accent, glint, Math.min(1, spark.mix * 0.6 + hot));
    context.globalAlpha = Math.pow(life, 1.3);
    context.fillStyle = `rgb(${color[0] | 0},${color[1] | 0},${color[2] | 0})`;
    // snap to the pixel lattice feel: square sparks
    context.fillRect(
      Math.round(spark.x * 2) / 2,
      Math.round(spark.y * 2) / 2,
      spark.size,
      spark.size,
    );
    alive.push(spark);
  }
  context.globalAlpha = 1;
  state.sparks = alive;
  return alive.length > 0 || shock;
}

return AnimatedEffortSlider;
}
export default EffortSlider;
