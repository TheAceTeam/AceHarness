'use client';

import { Fragment, useMemo } from 'react';
import { copyText } from '@/lib/clipboard';

type AnsiStyle = {
  color?: string;
  backgroundColor?: string;
  fontWeight?: number;
  fontStyle?: 'italic';
  textDecoration?: string;
  opacity?: number;
};

type Segment = {
  text: string;
  style: AnsiStyle;
};

const ANSI_RE = /\x1b\[([0-9;]*)m/g;

const FG_COLORS: Record<number, string> = {
  30: '#111827',
  31: '#ef4444',
  32: '#22c55e',
  33: '#fbbf24',
  34: '#60a5fa',
  35: '#c084fc',
  36: '#67e8f9',
  37: '#f3f4f6',
  90: '#6b7280',
  91: '#f87171',
  92: '#4ade80',
  93: '#fde047',
  94: '#93c5fd',
  95: '#d8b4fe',
  96: '#a5f3fc',
  97: '#ffffff',
};

const BG_COLORS: Record<number, string> = {
  40: '#111827',
  41: '#7f1d1d',
  42: '#14532d',
  43: '#713f12',
  44: '#1e3a8a',
  45: '#581c87',
  46: '#164e63',
  47: '#e5e7eb',
  100: '#374151',
  101: '#991b1b',
  102: '#166534',
  103: '#854d0e',
  104: '#1d4ed8',
  105: '#7e22ce',
  106: '#0e7490',
  107: '#f9fafb',
};

function cloneStyle(style: AnsiStyle): AnsiStyle {
  return { ...style };
}

function applyCode(style: AnsiStyle, code: number): AnsiStyle {
  const next = cloneStyle(style);

  if (code === 0) return {};
  if (code === 1) {
    next.fontWeight = 700;
    return next;
  }
  if (code === 2) {
    next.opacity = 0.75;
    return next;
  }
  if (code === 3) {
    next.fontStyle = 'italic';
    return next;
  }
  if (code === 4) {
    next.textDecoration = 'underline';
    return next;
  }
  if (code === 22) {
    delete next.fontWeight;
    delete next.opacity;
    return next;
  }
  if (code === 23) {
    delete next.fontStyle;
    return next;
  }
  if (code === 24) {
    delete next.textDecoration;
    return next;
  }
  if (code === 39) {
    delete next.color;
    return next;
  }
  if (code === 49) {
    delete next.backgroundColor;
    return next;
  }
  if (FG_COLORS[code]) {
    next.color = FG_COLORS[code];
    return next;
  }
  if (BG_COLORS[code]) {
    next.backgroundColor = BG_COLORS[code];
    return next;
  }

  return next;
}

function parseAnsiSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let currentStyle: AnsiStyle = {};

  for (const match of text.matchAll(ANSI_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, index),
        style: cloneStyle(currentStyle),
      });
    }

    const rawCodes = (match[1] || '0')
      .split(';')
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value));

    const codes = rawCodes.length > 0 ? rawCodes : [0];
    for (const code of codes) {
      currentStyle = applyCode(currentStyle, code);
    }

    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      style: cloneStyle(currentStyle),
    });
  }

  return segments;
}

function splitSegmentsByLine(segments: Segment[]): Segment[][] {
  const lines: Segment[][] = [[]];

  segments.forEach((segment) => {
    const parts = segment.text.split('\n');
    parts.forEach((part, index) => {
      if (part) {
        lines[lines.length - 1].push({ text: part, style: segment.style });
      }
      if (index < parts.length - 1) {
        lines.push([]);
      }
    });
  });

  return lines;
}

export function AnsiLogBlock({
  text,
  className = '',
}: {
  text: string;
  className?: string;
}) {
  const lines = useMemo(() => splitSegmentsByLine(parseAnsiSegments(text || '')), [text]);

  return (
    <div className={`relative overflow-hidden rounded-md border border-slate-700/80 bg-[#0b1220] ${className}`}>
      <button
        type="button"
        onClick={() => void copyText(text || '')}
        className="absolute right-2 top-2 z-10 rounded bg-white/10 px-1.5 py-1 text-[11px] text-slate-200 transition-colors hover:bg-white/20"
        title="复制日志"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>content_copy</span>
      </button>
      <pre className="overflow-x-auto px-3 py-3 pr-10 text-[12px] leading-5 text-slate-200">
        <code className="font-mono">
          {lines.map((line, lineIndex) => (
            <Fragment key={lineIndex}>
              {line.length > 0 ? line.map((segment, segmentIndex) => (
                <span key={`${lineIndex}-${segmentIndex}`} style={segment.style}>
                  {segment.text}
                </span>
              )) : <span>&nbsp;</span>}
              {lineIndex < lines.length - 1 ? '\n' : null}
            </Fragment>
          ))}
        </code>
      </pre>
    </div>
  );
}
