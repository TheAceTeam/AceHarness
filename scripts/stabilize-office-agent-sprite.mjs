#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

// Stabilizes an already-good animation sheet by shifting frame contents inside
// fixed frame cells. It does not invent new poses; bad motion cycles still need
// regenerated artwork.
const { values } = parseArgs({
  options: {
    input: { type: 'string', short: 'i' },
    output: { type: 'string', short: 'o' },
    frames: { type: 'string', default: '6' },
    'frame-width': { type: 'string' },
    'frame-height': { type: 'string' },
    alpha: { type: 'string', default: '12' },
    padding: { type: 'string', default: '2' },
    'top-padding': { type: 'string', default: '2' },
    'bottom-padding': { type: 'string', default: '2' },
    'x-anchor': { type: 'string', default: 'auto' },
    'vertical-anchor': { type: 'string', default: 'auto' },
    facing: { type: 'string' },
    manifest: { type: 'string' },
    asset: { type: 'string' },
    'target-x': { type: 'string' },
    'target-top': { type: 'string' },
    'target-bottom': { type: 'string' },
    'target-y': { type: 'string' },
    report: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'in-place': { type: 'boolean', default: false },
  },
});

if (!values.input) {
  console.error([
    'Usage: node scripts/stabilize-office-agent-sprite.mjs --input <sprite.png> [--output <sprite.png>]',
    '',
    'Default behavior keeps frame size/order and shifts each frame content to a shared anchor.',
    'Use --in-place to overwrite the input, or --dry-run to print the report only.',
  ].join('\n'));
  process.exit(1);
}

const input = path.resolve(values.input);
const output = values.output ? path.resolve(values.output) : input;
const frames = toInt(values.frames, 'frames');
const alphaThreshold = toInt(values.alpha, 'alpha');
const padding = toInt(values.padding, 'padding');
const topPadding = toInt(values['top-padding'], 'top-padding');
const bottomPadding = toInt(values['bottom-padding'], 'bottom-padding');
const requestedXAnchorMode = validateChoice(values['x-anchor'], 'x-anchor', ['body-center', 'content-left', 'content-right', 'facing-edge', 'auto']);
const requestedVerticalAnchorMode = validateChoice(values['vertical-anchor'], 'vertical-anchor', ['top', 'bottom', 'center', 'auto']);
const inferredFacing = inferFacingFromPath(input);
const facing = validateOptionalChoice(values.facing || inferredFacing, 'facing', ['left', 'right']);
const manifestEntry = await loadManifestEntry(input, values.manifest, values.asset);
const xAnchorMode = resolveXAnchorMode(requestedXAnchorMode, manifestEntry, facing);
const verticalAnchorMode = resolveVerticalAnchorMode(requestedVerticalAnchorMode, manifestEntry, input);
const explicitTargetX = optionalNumber(values['target-x'], 'target-x');
const explicitTargetTop = optionalNumber(values['target-top'], 'target-top');
const explicitTargetBottom = optionalNumber(values['target-bottom'], 'target-bottom');
const explicitTargetY = optionalNumber(values['target-y'], 'target-y');

if (xAnchorMode === 'facing-edge' && !facing) {
  throw new Error('Unable to infer facing direction. Pass --facing left or --facing right when using --x-anchor facing-edge.');
}

if (!values['dry-run'] && !values['in-place'] && !values.output) {
  throw new Error('Refusing to overwrite input without --in-place. Provide --output, --in-place, or --dry-run.');
}

const source = sharp(input, { animated: false }).ensureAlpha();
const metadata = await source.metadata();
const imageWidth = metadata.width || 0;
const imageHeight = metadata.height || 0;
const frameWidth = values['frame-width'] ? toInt(values['frame-width'], 'frame-width') : imageWidth / frames;
const frameHeight = values['frame-height'] ? toInt(values['frame-height'], 'frame-height') : imageHeight;

if (!Number.isInteger(frameWidth) || frameWidth <= 0) {
  throw new Error(`Image width ${imageWidth} is not divisible by ${frames} frames. Pass --frame-width explicitly.`);
}
if (!Number.isInteger(frameHeight) || frameHeight <= 0) {
  throw new Error(`Invalid frame height: ${frameHeight}`);
}
if (imageWidth !== frameWidth * frames || imageHeight !== frameHeight) {
  throw new Error(`Expected ${frameWidth * frames}x${frameHeight}, got ${imageWidth}x${imageHeight}`);
}

const { data, info } = await source.raw().toBuffer({ resolveWithObject: true });
const frameAnalyses = Array.from({ length: frames }, (_item, frameIndex) => {
  const contentBounds = findAlphaBounds(data, info, {
    left: frameIndex * frameWidth,
    top: 0,
    width: frameWidth,
    height: frameHeight,
  }, alphaThreshold);

  if (!contentBounds) {
    return { frameIndex, empty: true };
  }

  const cropBounds = expandBounds(contentBounds, frameWidth, frameHeight, padding);
  const xAnchor = xAnchorForFrame({
    data,
    info,
    frameLeft: frameIndex * frameWidth,
    bounds: contentBounds,
    alphaThreshold,
    mode: xAnchorMode,
    facing,
  });
  return {
    frameIndex,
    empty: false,
    before: formatBounds(contentBounds),
    crop: formatBounds(cropBounds),
    anchor: {
      x: round2(xAnchor.value),
      xMode: xAnchor.mode,
      y: round2(yAnchorForFrame(contentBounds, verticalAnchorMode)),
      yMode: verticalAnchorMode,
    },
    contentBounds,
    cropBounds,
    anchorX: xAnchor.value,
    anchorXMode: xAnchor.mode,
    anchorY: yAnchorForFrame(contentBounds, verticalAnchorMode),
  };
});

const nonEmptyFrames = frameAnalyses.filter((frame) => !frame.empty);
if (!nonEmptyFrames.length) {
  throw new Error('No non-transparent sprite content found.');
}

const desiredTargetX = explicitTargetX ?? median(nonEmptyFrames.map((frame) => frame.anchorX));
const desiredTargetY = targetYFromMode({
  mode: verticalAnchorMode,
  frameHeight,
  topPadding,
  bottomPadding,
  explicitTargetTop,
  explicitTargetBottom,
  explicitTargetY,
  anchors: nonEmptyFrames.map((frame) => frame.anchorY),
});
const targetX = chooseCommonTarget(
  desiredTargetX,
  nonEmptyFrames.map((frame) => ({
    min: frame.anchorX - frame.cropBounds.left,
    max: frame.anchorX + (frameWidth - 1 - frame.cropBounds.right),
  })),
);
const targetY = chooseCommonTarget(
  desiredTargetY,
  nonEmptyFrames.map((frame) => ({
    min: frame.anchorY - frame.cropBounds.top,
    max: frame.anchorY + (frameHeight - 1 - frame.cropBounds.bottom),
  })),
);

const stabilizedFrames = [];
const reportFrames = [];

for (const frame of frameAnalyses) {
  if (frame.empty) {
    stabilizedFrames.push(await transparentPng(frameWidth, frameHeight));
    reportFrames.push({ frame: frame.frameIndex, empty: true });
    continue;
  }

  let dx = Math.round(targetX.value - frame.anchorX);
  let dy = Math.round(targetY.value - frame.anchorY);
  dx = clamp(dx, -frame.cropBounds.left, frameWidth - 1 - frame.cropBounds.right);
  dy = clamp(dy, -frame.cropBounds.top, frameHeight - 1 - frame.cropBounds.bottom);

  const sourceLeft = frame.frameIndex * frameWidth + frame.cropBounds.left;
  const crop = await sharp(input)
    .ensureAlpha()
    .extract({
      left: sourceLeft,
      top: frame.cropBounds.top,
      width: frame.cropBounds.width,
      height: frame.cropBounds.height,
    })
    .png()
    .toBuffer();

  const targetLeft = frame.cropBounds.left + dx;
  const targetTop = frame.cropBounds.top + dy;
  const stabilized = await sharp({
    create: {
      width: frameWidth,
      height: frameHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: crop, left: targetLeft, top: targetTop }])
    .png()
    .toBuffer();

  stabilizedFrames.push(stabilized);
  reportFrames.push({
    frame: frame.frameIndex,
    before: frame.before,
    after: shiftBounds(frame.contentBounds, dx, dy),
    anchorBefore: frame.anchor,
    anchorAfter: {
      x: round2(frame.anchorX + dx),
      y: round2(frame.anchorY + dy),
    },
    shift: { dx, dy },
  });
}

const report = {
  input,
  output: values['dry-run'] ? null : output,
  size: { width: imageWidth, height: imageHeight },
  frame: { width: frameWidth, height: frameHeight, frames },
  strategy: {
    x: describeXAnchorStrategy(xAnchorMode, facing),
    y: describeYAnchorStrategy(verticalAnchorMode),
    scaling: 'none',
    order: 'preserved',
  },
  manifest: manifestEntry ? {
    asset: manifestEntry.key,
    anchor: manifestEntry.anchor || null,
    verticalAnchor: manifestEntry.verticalAnchor || null,
  } : null,
  alphaThreshold,
  padding,
  targets: {
    xAnchor: requestedXAnchorMode,
    resolvedXAnchor: xAnchorMode,
    verticalAnchor: requestedVerticalAnchorMode,
    resolvedVerticalAnchor: verticalAnchorMode,
    facing: facing || null,
    desiredX: round2(desiredTargetX),
    appliedX: round2(targetX.value),
    commonXFeasible: targetX.feasible,
    desiredY: round2(desiredTargetY),
    appliedY: round2(targetY.value),
    commonYFeasible: targetY.feasible,
  },
  frames: reportFrames,
};

if (!values['dry-run']) {
  const composites = stabilizedFrames.map((frame, index) => ({
    input: frame,
    left: index * frameWidth,
    top: 0,
  }));
  const tempOutput = output === input
    ? path.join(path.dirname(output), `.${path.basename(output)}.${randomUUID()}.tmp.png`)
    : output;
  await fs.mkdir(path.dirname(tempOutput), { recursive: true });
  await sharp({
    create: {
      width: imageWidth,
      height: imageHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toFile(tempOutput);

  if (tempOutput !== output) {
    await fs.rename(tempOutput, output);
  }
}

if (values.report) {
  const reportPath = path.resolve(values.report);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(report, null, 2));

function toInt(value, name) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function optionalNumber(value, name) {
  if (typeof value === 'undefined') return undefined;
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function validateChoice(value, name, choices) {
  const normalized = String(value || '').trim();
  if (choices.includes(normalized)) return normalized;
  throw new Error(`Invalid ${name}: ${value}. Expected one of: ${choices.join(', ')}`);
}

function validateOptionalChoice(value, name, choices) {
  if (!value) return undefined;
  return validateChoice(value, name, choices);
}

async function loadManifestEntry(inputPath, manifestPathValue, assetKeyValue) {
  const manifestPath = manifestPathValue
    ? path.resolve(manifestPathValue)
    : path.join(path.dirname(inputPath), 'manifest.json');

  let manifestText;
  try {
    manifestText = await fs.readFile(manifestPath, 'utf8');
  } catch (error) {
    if (manifestPathValue) throw error;
    return null;
  }

  const manifest = JSON.parse(manifestText);
  const basename = path.basename(inputPath);
  const inferredKey = basename.replace(/\.png$/i, '');
  const explicitKey = assetKeyValue || inferredKey;
  const entry = manifest[explicitKey]
    || Object.entries(manifest).find(([key, value]) => (
      key === inferredKey
      || path.basename(String(value?.src || '')) === basename
    ))?.[1];
  const key = manifest[explicitKey] ? explicitKey : Object.entries(manifest).find(([entryKey, value]) => (
    entryKey === inferredKey
    || path.basename(String(value?.src || '')) === basename
  ))?.[0];

  return entry ? { key: key || explicitKey, ...entry } : null;
}

function resolveXAnchorMode(requestedMode, manifestEntry, facing) {
  if (requestedMode !== 'auto') return requestedMode;
  if (manifestEntry?.anchor === 'left') return 'content-left';
  if (manifestEntry?.anchor === 'right') return 'content-right';
  return facing ? 'facing-edge' : 'body-center';
}

function resolveVerticalAnchorMode(requestedMode, manifestEntry, inputPath) {
  if (requestedMode !== 'auto') return requestedMode;
  if (manifestEntry?.verticalAnchor) {
    return validateChoice(manifestEntry.verticalAnchor, 'manifest verticalAnchor', ['top', 'bottom', 'center']);
  }
  return /(?:^|-)walk(?:-|\.|_)/i.test(path.basename(inputPath)) ? 'top' : 'bottom';
}

function inferFacingFromPath(filePath) {
  const basename = path.basename(filePath).toLowerCase();
  if (/(?:^|-)left(?:-|\.|_)/.test(basename)) return 'left';
  if (/(?:^|-)right(?:-|\.|_)/.test(basename)) return 'right';
  return undefined;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function median(valuesToSort) {
  const sorted = [...valuesToSort].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function chooseCommonTarget(desired, intervals) {
  const min = Math.max(...intervals.map((interval) => interval.min));
  const max = Math.min(...intervals.map((interval) => interval.max));
  if (min <= max) {
    return { value: clamp(desired, min, max), feasible: true, interval: { min: round2(min), max: round2(max) } };
  }
  return { value: desired, feasible: false, interval: { min: round2(min), max: round2(max) } };
}

function targetYFromMode({
  mode,
  frameHeight,
  topPadding,
  bottomPadding,
  explicitTargetTop,
  explicitTargetBottom,
  explicitTargetY,
  anchors,
}) {
  if (typeof explicitTargetY !== 'undefined') return explicitTargetY;
  if (mode === 'top') return explicitTargetTop ?? topPadding;
  if (mode === 'bottom') return explicitTargetBottom ?? frameHeight - 1 - bottomPadding;
  return median(anchors);
}

function describeXAnchorStrategy(mode, facing) {
  if (mode === 'auto') {
    if (facing === 'left') return 'shared right content edge because the character faces left';
    if (facing === 'right') return 'shared left content edge because the character faces right';
    return 'median body center from opaque pixels in the torso/head band';
  }
  if (mode === 'body-center') return 'median body center from opaque pixels in the torso/head band';
  if (mode === 'content-left') return 'shared left content edge';
  if (mode === 'content-right') return 'shared right content edge';
  if (mode === 'facing-edge') {
    return facing === 'left'
      ? 'shared right content edge because the character faces left'
      : 'shared left content edge because the character faces right';
  }
  return mode;
}

function describeYAnchorStrategy(mode) {
  if (mode === 'top') return 'shared top/head line from alpha bounds';
  if (mode === 'bottom') return 'shared foot/bottom baseline from alpha bounds';
  return 'shared vertical center from alpha bounds';
}

function xAnchorForFrame({ data, info, frameLeft, bounds, alphaThreshold, mode, facing }) {
  const resolvedMode = mode === 'auto'
    ? (facing ? 'facing-edge' : 'body-center')
    : mode;
  if (resolvedMode === 'content-left' || (resolvedMode === 'facing-edge' && facing === 'right')) {
    return { value: bounds.left, mode: 'content-left' };
  }
  if (resolvedMode === 'content-right' || (resolvedMode === 'facing-edge' && facing === 'left')) {
    return { value: bounds.right, mode: 'content-right' };
  }
  return {
    value: bodyCenterX(data, info, frameLeft, bounds, alphaThreshold),
    mode: 'body-center',
  };
}

function yAnchorForFrame(bounds, mode) {
  if (mode === 'top') return bounds.top;
  if (mode === 'bottom') return bounds.bottom;
  return (bounds.top + bounds.bottom) / 2;
}

function alphaAt(data, info, x, y) {
  return data[(y * info.width + x) * info.channels + 3];
}

function findAlphaBounds(data, info, region, alphaThreshold) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  let count = 0;

  for (let y = region.top; y < region.top + region.height; y += 1) {
    for (let x = region.left; x < region.left + region.width; x += 1) {
      if (alphaAt(data, info, x, y) <= alphaThreshold) continue;
      const localX = x - region.left;
      const localY = y - region.top;
      left = Math.min(left, localX);
      top = Math.min(top, localY);
      right = Math.max(right, localX);
      bottom = Math.max(bottom, localY);
      count += 1;
    }
  }

  if (!count) return null;
  return {
    left,
    top,
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
    count,
  };
}

function expandBounds(bounds, frameWidth, frameHeight, padding) {
  const left = Math.max(0, bounds.left - padding);
  const top = Math.max(0, bounds.top - padding);
  const right = Math.min(frameWidth - 1, bounds.right + padding);
  const bottom = Math.min(frameHeight - 1, bounds.bottom + padding);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

function bodyCenterX(data, info, frameLeft, bounds, alphaThreshold) {
  const bandTop = bounds.top + Math.round(bounds.height * 0.12);
  const bandBottom = bounds.top + Math.round(bounds.height * 0.72);
  let sumX = 0;
  let count = 0;

  for (let y = bandTop; y <= bandBottom; y += 1) {
    for (let x = bounds.left; x <= bounds.right; x += 1) {
      if (alphaAt(data, info, frameLeft + x, y) <= alphaThreshold) continue;
      sumX += x;
      count += 1;
    }
  }

  if (count > Math.max(12, bounds.count * 0.08)) return sumX / count;
  return (bounds.left + bounds.right) / 2;
}

function formatBounds(bounds) {
  return {
    left: bounds.left,
    top: bounds.top,
    right: bounds.right,
    bottom: bounds.bottom,
    width: bounds.width,
    height: bounds.height,
    count: bounds.count,
  };
}

function shiftBounds(bounds, dx, dy) {
  return {
    left: bounds.left + dx,
    top: bounds.top + dy,
    right: bounds.right + dx,
    bottom: bounds.bottom + dy,
    width: bounds.width,
    height: bounds.height,
    count: bounds.count,
  };
}

async function transparentPng(width, height) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).png().toBuffer();
}
