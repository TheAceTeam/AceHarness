#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const outDir = path.join(root, 'public', 'office', 'agents');
const sourceDir = path.join(root, 'generated_assets');

const generatedGridSources = [
  {
    file: path.join(sourceDir, 'office-agent-work-backview-male-v3.png'),
    cols: 6,
    rows: 4,
    frameWidth: 256,
    frameHeight: 256,
    targetWidth: 128,
    targetHeight: 180,
    scaleWidth: 124,
    scaleHeight: 174,
    bottomPadding: 3,
    animations: [
      { id: 'male-work-back-right-smart', row: 0, frames: [0, 1, 2, 3, 4, 5] },
      { id: 'male-work-back-left-smart', row: 0, frames: [0, 1, 2, 3, 4, 5], flipH: true },
      { id: 'male-think-back-right-smart', row: 1, frames: [0, 1, 2, 3, 4, 5] },
      { id: 'male-think-back-left-smart', row: 1, frames: [0, 1, 2, 3, 4, 5], flipH: true },
    ],
  },
  {
    file: path.join(sourceDir, 'office-agent-work-backview-female-v3.png'),
    cols: 6,
    rows: 4,
    frameWidth: 256,
    frameHeight: 256,
    targetWidth: 128,
    targetHeight: 180,
    scaleWidth: 124,
    scaleHeight: 174,
    bottomPadding: 3,
    animations: [
      { id: 'female-work-back-right-smart', row: 0, frames: [0, 1, 2, 3, 4, 5] },
      { id: 'female-work-back-left-smart', row: 0, frames: [0, 1, 2, 3, 4, 5], flipH: true },
      { id: 'female-think-back-right-smart', row: 1, frames: [0, 1, 2, 3, 4, 5] },
      { id: 'female-think-back-left-smart', row: 1, frames: [0, 1, 2, 3, 4, 5], flipH: true },
    ],
  },
  {
    file: path.join(sourceDir, 'office-agent-talk-single-directions-v1.png'),
    cols: 6,
    rows: 4,
    frameWidth: 256,
    frameHeight: 256,
    targetWidth: 128,
    targetHeight: 180,
    scaleWidth: 124,
    scaleHeight: 174,
    bottomPadding: 3,
    animations: [
      { id: 'female-talk-left-smart', row: 2, frames: [0, 1, 2, 3, 4, 5] },
      { id: 'female-talk-right-smart', row: 3, frames: [0, 1, 2, 3, 4, 5] },
      { id: 'male-talk-left-smart', row: 0, frames: [0, 1, 2, 3, 4, 5] },
      { id: 'male-talk-right-smart', row: 1, frames: [0, 1, 2, 3, 4, 5] },
    ],
  },
];

function isGreenKey(r, g, b) {
  const strongestNonGreen = Math.max(r, b);
  return g > 96 && g > r * 1.12 && g > b * 1.12 && g - strongestNonGreen > 18;
}

function alphaForPixel(r, g, b) {
  if (!isGreenKey(r, g, b)) return 255;
  const dominance = g - Math.max(r, b);
  if (dominance > 58) return 0;
  return Math.max(0, Math.min(255, Math.round(255 - ((dominance - 18) / 40) * 255)));
}

async function chromaToAlpha(input, output) {
  const image = sharp(input).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  for (let index = 0; index < data.length; index += info.channels) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const alpha = alphaForPixel(r, g, b);
    if (alpha < 255) {
      data[index + 3] = alpha;
      if (alpha === 0) {
        data[index] = 0;
        data[index + 1] = 0;
        data[index + 2] = 0;
      } else {
        data[index + 1] = Math.min(data[index + 1], Math.round(Math.max(r, b) * 0.82 + Math.min(r, b) * 0.18));
      }
    }
  }
  await sharp(data, { raw: info }).png().toFile(output);
}

async function findAlphaBounds(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const visited = new Uint8Array(info.width * info.height);
  const stack = [];
  const offset = (x, y) => y * info.width + x;
  let best = null;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const seed = offset(x, y);
      if (visited[seed]) continue;
      const alpha = data[seed * info.channels + 3];
      if (alpha <= 32) {
        visited[seed] = 1;
        continue;
      }

      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let count = 0;
      visited[seed] = 1;
      stack.push([x, y]);

      while (stack.length) {
        const [cx, cy] = stack.pop();
        count += 1;
        minX = Math.min(minX, cx);
        minY = Math.min(minY, cy);
        maxX = Math.max(maxX, cx);
        maxY = Math.max(maxY, cy);

        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
          if (nx < 0 || ny < 0 || nx >= info.width || ny >= info.height) continue;
          const next = offset(nx, ny);
          if (visited[next]) continue;
          const nextAlpha = data[next * info.channels + 3];
          if (nextAlpha <= 32) {
            visited[next] = 1;
            continue;
          }
          visited[next] = 1;
          stack.push([nx, ny]);
        }
      }

      const area = (maxX - minX + 1) * (maxY - minY + 1);
      const centerPenalty = Math.abs(((minX + maxX) / 2) - info.width / 2) * 12;
      const score = count + area * 0.08 - centerPenalty;
      if (!best || score > best.score) {
        best = { minX, minY, maxX, maxY, count, score };
      }
    }
  }

  return best;
}

async function buildNormalizedFrame(sourceImage, extraction, options) {
  const cell = await sourceImage.clone().extract(extraction).png().toBuffer();
  const bounds = await findAlphaBounds(cell);
  if (!bounds) {
    return {
      input: await sharp({
        create: {
          width: options.targetWidth,
          height: options.targetHeight,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      }).png().toBuffer(),
      left: 0,
      top: 0,
      width: options.targetWidth,
      height: options.targetHeight,
    };
  }

  const padX = options.padX ?? 6;
  const padY = options.padY ?? 3;
  const left = Math.max(0, bounds.minX - padX);
  const top = Math.max(0, bounds.minY - padY);
  const right = Math.min(extraction.width - 1, bounds.maxX + padX);
  const bottom = Math.min(extraction.height - 1, bounds.maxY + padY);
  let frame = sharp(cell).extract({
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  });

  if (options.flipH) frame = frame.flop();

  const resized = await frame
    .resize({
      width: options.scaleWidth,
      height: options.scaleHeight,
      fit: 'contain',
      withoutEnlargement: false,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();
  const metadata = await sharp(resized).metadata();
  const width = metadata.width || options.scaleWidth;
  const height = metadata.height || options.scaleHeight;

  return {
    input: resized,
    left: Math.round((options.targetWidth - width) / 2) + (options.offsetX || 0),
    top: Math.max(0, options.targetHeight - height - (options.bottomPadding || 0) + (options.offsetY || 0)),
    width,
    height,
  };
}

async function buildGridAnimationSheets(alphaFile, source) {
  const sourceImage = sharp(alphaFile);
  const manifest = {};

  for (const animation of source.animations) {
    const composites = [];
    for (const [index, frameIndex] of animation.frames.entries()) {
      const frame = await buildNormalizedFrame(sourceImage, {
        left: frameIndex * source.frameWidth,
        top: animation.row * source.frameHeight,
        width: source.frameWidth,
        height: source.frameHeight,
      }, {
        targetWidth: source.targetWidth,
        targetHeight: source.targetHeight,
        scaleWidth: animation.scaleWidth || source.scaleWidth,
        scaleHeight: animation.scaleHeight || source.scaleHeight,
        bottomPadding: animation.bottomPadding ?? source.bottomPadding,
        padX: animation.padX ?? source.padX,
        padY: animation.padY ?? source.padY,
        offsetX: animation.offsetX || 0,
        offsetY: animation.offsetY || 0,
        flipH: Boolean(animation.flipH),
      });
      composites.push({
        input: frame.input,
        left: index * source.targetWidth + frame.left,
        top: frame.top,
      });
    }

    const out = path.join(outDir, `${animation.id}.png`);
    await sharp({
      create: {
        width: source.targetWidth * animation.frames.length,
        height: source.targetHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite(composites).png().toFile(out);
    manifest[animation.id] = {
      src: `/office/agents/${animation.id}.png`,
      frameWidth: source.targetWidth,
      frameHeight: source.targetHeight,
      frames: animation.frames.length,
    };
  }

  return manifest;
}

async function cleanupUnusedAgentSprites(manifest) {
  const keep = new Set(
    Object.values(manifest)
      .map((entry) => path.basename(entry.src || ''))
      .filter(Boolean)
  );

  let files = [];
  try {
    files = await fs.readdir(outDir);
  } catch {
    return;
  }

  for (const file of files) {
    if (file === 'manifest.json' || !file.endsWith('.png')) continue;
    if (keep.has(file)) continue;
    await fs.rm(path.join(outDir, file), { force: true });
  }
}

await fs.mkdir(outDir, { recursive: true });
const manifest = {};

for (const source of generatedGridSources) {
  try {
    await fs.access(source.file);
  } catch {
    continue;
  }
  const alphaFile = path.join(outDir, `${path.basename(source.file, '.png')}-alpha.png`);
  await chromaToAlpha(source.file, alphaFile);
  Object.assign(manifest, await buildGridAnimationSheets(alphaFile, source));
  await fs.rm(alphaFile, { force: true });
}

await cleanupUnusedAgentSprites(manifest);
await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(path.join(outDir, 'manifest.json'));
