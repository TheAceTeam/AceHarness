#!/usr/bin/env node

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const { values } = parseArgs({
  options: {
    input: { type: 'string', short: 'i' },
    output: { type: 'string', short: 'o' },
    rows: { type: 'string', default: '10' },
    cols: { type: 'string', default: '10' },
    canvas: { type: 'string', default: '2880' },
    cell: { type: 'string', default: '256' },
    gap: { type: 'string', default: '16' },
    margin: { type: 'string', default: '88' },
    safe: { type: 'string', default: '220' },
    alpha: { type: 'string', default: '8' },
    padding: { type: 'string', default: '2' },
  },
});

if (!values.input || !values.output) {
  console.error(
    'Usage: node scripts/normalize-avatar-sprite.mjs --input <source.png|webp> --output <target.png>',
  );
  process.exit(1);
}

const config = {
  rows: toInt(values.rows, 'rows'),
  cols: toInt(values.cols, 'cols'),
  canvas: toInt(values.canvas, 'canvas'),
  cell: toInt(values.cell, 'cell'),
  gap: toInt(values.gap, 'gap'),
  margin: toInt(values.margin, 'margin'),
  safe: toInt(values.safe, 'safe'),
  alpha: toInt(values.alpha, 'alpha'),
  padding: toInt(values.padding, 'padding'),
};

if (config.safe > config.cell) {
  throw new Error(`safe (${config.safe}) must be <= cell (${config.cell})`);
}

const input = values.input;
const output = values.output;
const inputImage = sharp(input, { animated: false }).ensureAlpha();
const { data, info } = await inputImage.raw().toBuffer({ resolveWithObject: true });

const columnProfile = new Uint32Array(info.width);
const rowProfile = new Uint32Array(info.height);

for (let y = 0; y < info.height; y += 1) {
  for (let x = 0; x < info.width; x += 1) {
    const alpha = data[(y * info.width + x) * 4 + 3];
    if (alpha > config.alpha) {
      columnProfile[x] += 1;
      rowProfile[y] += 1;
    }
  }
}

const columnBands = inferAxisBands(columnProfile, config.cols, info.width, 'columns');
const rowBands = inferAxisBands(rowProfile, config.rows, info.height, 'rows');
const columnBounds = bandsToBounds(columnBands, info.width);
const rowBounds = bandsToBounds(rowBands, info.height);

const composites = [];
const slots = [];

for (let row = 0; row < config.rows; row += 1) {
  for (let col = 0; col < config.cols; col += 1) {
    const index = row * config.cols + col;
    const sourceRegion = {
      left: columnBounds[col],
      top: rowBounds[row],
      width: columnBounds[col + 1] - columnBounds[col],
      height: rowBounds[row + 1] - rowBounds[row],
    };
    const alphaBounds = findAlphaBounds(data, info.width, sourceRegion, config.alpha);

    if (!alphaBounds) {
      slots.push({ index, row, col, empty: true, sourceRegion });
      continue;
    }

    const crop = expandBounds(alphaBounds, sourceRegion, config.padding);
    const resized = await sharp(input)
      .ensureAlpha()
      .extract({
        left: crop.left,
        top: crop.top,
        width: crop.width,
        height: crop.height,
      })
      .resize({
        width: config.safe,
        height: config.safe,
        fit: 'inside',
        kernel: sharp.kernel.lanczos3,
      })
      .png()
      .toBuffer({ resolveWithObject: true });

    const targetLeft =
      config.margin +
      col * (config.cell + config.gap) +
      Math.round((config.cell - resized.info.width) / 2);
    const targetTop =
      config.margin +
      row * (config.cell + config.gap) +
      Math.round((config.cell - resized.info.height) / 2);

    composites.push({
      input: resized.data,
      left: targetLeft,
      top: targetTop,
    });
    slots.push({
      index,
      row,
      col,
      sourceRegion,
      sourceContent: crop,
      target: {
        left: targetLeft,
        top: targetTop,
        width: resized.info.width,
        height: resized.info.height,
      },
    });
  }
}

await mkdir(path.dirname(output), { recursive: true });

await sharp({
  create: {
    width: config.canvas,
    height: config.canvas,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(composites)
  .png()
  .toFile(output);

const validation = await validateOutput(output, config);

console.log(
  JSON.stringify(
    {
      input,
      output,
      inputSize: { width: info.width, height: info.height },
      outputSize: { width: config.canvas, height: config.canvas },
      grid: {
        rows: config.rows,
        cols: config.cols,
        cell: config.cell,
        gap: config.gap,
        margin: config.margin,
        safe: config.safe,
      },
      inferred: {
        columns: columnBands.map(formatBand),
        rows: rowBands.map(formatBand),
      },
      slots: {
        total: config.rows * config.cols,
        empty: slots.filter((slot) => slot.empty).map((slot) => slot.index),
      },
      validation,
    },
    null,
    2,
  ),
);

if (validation.outsideGridAlphaPixels > 0 || validation.safeAreaOverflowAlphaPixels > 0) {
  process.exitCode = 2;
}

function toInt(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function inferAxisBands(profile, expectedCount, dimension, axisName) {
  const max = profile.reduce((largest, value) => Math.max(largest, value), 0);
  if (max === 0) {
    throw new Error(`No non-transparent pixels found while scanning ${axisName}`);
  }

  const thresholdRatios = [0.05, 0.04, 0.06, 0.08, 0.1, 0.12, 0.15, 0.2, 0.03, 0.02, 0.01];
  let best = null;

  for (const ratio of thresholdRatios) {
    const threshold = Math.max(1, Math.round(max * ratio));
    const bands = findRuns(profile, threshold, {
      minLength: Math.max(4, Math.round(dimension / 160)),
      mergeGap: Math.max(1, Math.round(dimension / 900)),
    });

    const score = scoreBands(bands, expectedCount);
    if (!best || score < best.score) {
      best = { bands, threshold, score };
    }
    if (bands.length === expectedCount) {
      return bands;
    }
  }

  return inferBandsByWeightedKMeans(profile, expectedCount, best?.threshold ?? Math.max(1, Math.round(max * 0.05)));
}

function findRuns(profile, threshold, { minLength, mergeGap }) {
  const runs = [];
  let start = -1;

  for (let i = 0; i < profile.length; i += 1) {
    if (profile[i] > threshold) {
      if (start === -1) {
        start = i;
      }
    } else if (start !== -1) {
      runs.push({ start, end: i - 1 });
      start = -1;
    }
  }

  if (start !== -1) {
    runs.push({ start, end: profile.length - 1 });
  }

  const merged = [];
  for (const run of runs) {
    const previous = merged.at(-1);
    if (previous && run.start - previous.end - 1 <= mergeGap) {
      previous.end = run.end;
    } else {
      merged.push({ ...run });
    }
  }

  return merged
    .filter((run) => run.end - run.start + 1 >= minLength)
    .map((run) => ({ ...run, center: (run.start + run.end) / 2 }));
}

function scoreBands(bands, expectedCount) {
  const countPenalty = Math.abs(bands.length - expectedCount) * 1000;
  if (bands.length <= 1) {
    return countPenalty + 1000;
  }

  const centers = bands.map((band) => band.center);
  const gaps = centers.slice(1).map((center, index) => center - centers[index]);
  const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  const variance = gaps.reduce((sum, gap) => sum + (gap - averageGap) ** 2, 0) / gaps.length;

  return countPenalty + Math.sqrt(variance);
}

function inferBandsByWeightedKMeans(profile, expectedCount, threshold) {
  const occupied = [];
  for (let i = 0; i < profile.length; i += 1) {
    if (profile[i] > 0) {
      occupied.push(i);
    }
  }

  const min = occupied[0];
  const max = occupied.at(-1);
  let centers = Array.from({ length: expectedCount }, (_, index) =>
    expectedCount === 1 ? (min + max) / 2 : min + (index * (max - min)) / (expectedCount - 1),
  );

  for (let iteration = 0; iteration < 40; iteration += 1) {
    const sums = Array(expectedCount).fill(0);
    const weights = Array(expectedCount).fill(0);

    for (let i = min; i <= max; i += 1) {
      const weight = profile[i];
      if (weight === 0) {
        continue;
      }
      const cluster = nearestCenterIndex(i, centers);
      sums[cluster] += i * weight;
      weights[cluster] += weight;
    }

    centers = centers.map((center, index) => (weights[index] > 0 ? sums[index] / weights[index] : center));
  }

  centers.sort((a, b) => a - b);
  const bounds = centersToBounds(centers, profile.length);

  return centers.map((center, index) => {
    let start = bounds[index];
    let end = bounds[index + 1] - 1;

    while (start < end && profile[start] <= threshold) {
      start += 1;
    }
    while (end > start && profile[end] <= threshold) {
      end -= 1;
    }

    return { start, end, center };
  });
}

function nearestCenterIndex(value, centers) {
  let nearest = 0;
  let nearestDistance = Math.abs(value - centers[0]);

  for (let index = 1; index < centers.length; index += 1) {
    const distance = Math.abs(value - centers[index]);
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function bandsToBounds(bands, dimension) {
  const centers = bands.map((band) => band.center);
  return centersToBounds(centers, dimension);
}

function centersToBounds(centers, dimension) {
  const bounds = [0];

  for (let index = 0; index < centers.length - 1; index += 1) {
    bounds.push(clamp(Math.round((centers[index] + centers[index + 1]) / 2), 0, dimension));
  }

  bounds.push(dimension);
  return bounds;
}

function findAlphaBounds(data, width, region, alphaThreshold) {
  let minX = region.left + region.width;
  let minY = region.top + region.height;
  let maxX = region.left - 1;
  let maxY = region.top - 1;

  for (let y = region.top; y < region.top + region.height; y += 1) {
    for (let x = region.left; x < region.left + region.width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > alphaThreshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function expandBounds(bounds, region, padding) {
  const left = clamp(bounds.left - padding, region.left, region.left + region.width);
  const top = clamp(bounds.top - padding, region.top, region.top + region.height);
  const right = clamp(bounds.left + bounds.width + padding, region.left, region.left + region.width);
  const bottom = clamp(bounds.top + bounds.height + padding, region.top, region.top + region.height);

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

async function validateOutput(file, target) {
  const { data: outputData, info: outputInfo } = await sharp(file).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  const safeOffset = Math.floor((target.cell - target.safe) / 2);
  const cellPitch = target.cell + target.gap;
  let outsideGridAlphaPixels = 0;
  let safeAreaOverflowAlphaPixels = 0;
  const slotAlphaCounts = Array(target.rows * target.cols).fill(0);

  for (let y = 0; y < outputInfo.height; y += 1) {
    for (let x = 0; x < outputInfo.width; x += 1) {
      const alpha = outputData[(y * outputInfo.width + x) * 4 + 3];
      if (alpha === 0) {
        continue;
      }

      const col = Math.floor((x - target.margin) / cellPitch);
      const row = Math.floor((y - target.margin) / cellPitch);
      const localX = x - target.margin - col * cellPitch;
      const localY = y - target.margin - row * cellPitch;
      const insideCell =
        row >= 0 &&
        row < target.rows &&
        col >= 0 &&
        col < target.cols &&
        localX >= 0 &&
        localX < target.cell &&
        localY >= 0 &&
        localY < target.cell;

      if (!insideCell) {
        outsideGridAlphaPixels += 1;
        continue;
      }

      const index = row * target.cols + col;
      slotAlphaCounts[index] += 1;

      const insideSafe =
        localX >= safeOffset &&
        localX < safeOffset + target.safe &&
        localY >= safeOffset &&
        localY < safeOffset + target.safe;

      if (!insideSafe) {
        safeAreaOverflowAlphaPixels += 1;
      }
    }
  }

  return {
    imageSize: { width: outputInfo.width, height: outputInfo.height },
    outsideGridAlphaPixels,
    safeAreaOverflowAlphaPixels,
    emptySlots: slotAlphaCounts
      .map((count, index) => ({ count, index }))
      .filter((slot) => slot.count === 0)
      .map((slot) => slot.index),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatBand(band) {
  return {
    start: Math.round(band.start),
    end: Math.round(band.end),
    center: Math.round(band.center),
  };
}
