#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const outDir = path.join(root, 'public', 'office', 'agents');
const sourceDir = path.join(root, 'generated_assets');

const sources = [
  {
    name: 'office-agent-sprite-v1',
    file: path.join(sourceDir, 'office-agent-sprite-v1-2880.png'),
    rows: 8,
    cols: 8,
    frameW: 360,
    frameH: 360,
    animations: [],
  },
];

function isGreenKey(r, g, b) {
  return g > 135 && g > r * 1.45 && g > b * 1.45;
}

function alphaForPixel(r, g, b) {
  if (!isGreenKey(r, g, b)) return 255;
  const dominance = Math.min(g - r, g - b);
  if (dominance > 90) return 0;
  return Math.max(0, Math.min(255, 255 - dominance * 3));
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
        data[index + 1] = Math.min(data[index + 1], Math.round((r + b) / 2));
      }
    }
  }
  await sharp(data, { raw: info }).png().toFile(output);
}

async function buildAnimationSheet(alphaFile, source) {
  const sourceImage = sharp(alphaFile);
  const metadata = await sourceImage.metadata();
  const frameW = Math.floor(metadata.width / source.cols);
  const frameH = Math.floor(metadata.height / source.rows);
  const manifest = {};

  for (const animation of source.animations) {
    const composites = [];
    for (const [index, col] of animation.frames.entries()) {
      const frame = await sourceImage
        .clone()
        .extract({
          left: Math.round(col * frameW),
          top: Math.round(animation.row * frameH),
          width: frameW,
          height: frameH,
        })
        .png()
        .toBuffer();
      composites.push({ input: frame, left: index * frameW, top: 0 });
    }
    const out = path.join(outDir, `${animation.id}.png`);
    await sharp({
      create: {
        width: frameW * animation.frames.length,
        height: frameH,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite(composites).png().toFile(out);
    manifest[animation.id] = {
      src: `/office/agents/${animation.id}.png`,
      frameWidth: frameW,
      frameHeight: frameH,
      frames: animation.frames.length,
    };
  }

  return manifest;
}

async function findComponents(alphaFile) {
  const { data, info } = await sharp(alphaFile).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const visited = new Uint8Array(width * height);
  const stack = [];
  const boxes = [];
  const offset = (x, y) => y * width + x;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const seed = offset(x, y);
      if (visited[seed]) continue;
      const alpha = data[seed * channels + 3];
      if (alpha < 32) {
        visited[seed] = 1;
        continue;
      }

      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let count = 0;
      visited[seed] = 1;
      stack.push([x, y]);

      while (stack.length) {
        const [cx, cy] = stack.pop();
        count += 1;
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);

        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = offset(nx, ny);
          if (visited[next]) continue;
          const nextAlpha = data[next * channels + 3];
          if (nextAlpha < 32) {
            visited[next] = 1;
            continue;
          }
          visited[next] = 1;
          stack.push([nx, ny]);
        }
      }

      if (count > 1000) {
        boxes.push({
          minX,
          maxX,
          minY,
          maxY,
          count,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
          cx: (minX + maxX) / 2,
          cy: (minY + maxY) / 2,
        });
      }
    }
  }

  return boxes;
}

function groupRows(boxes, threshold = 26) {
  const rows = [];
  for (const box of [...boxes].sort((a, b) => a.cy - b.cy)) {
    const row = rows.find((candidate) => Math.abs(candidate.cy - box.cy) < threshold);
    if (row) {
      row.boxes.push(box);
      row.cy = row.boxes.reduce((sum, item) => sum + item.cy, 0) / row.boxes.length;
    } else {
      rows.push({ cy: box.cy, boxes: [box] });
    }
  }
  return rows.map((row) => row.boxes.sort((a, b) => a.cx - b.cx));
}

async function buildSmartAgentSheets(alphaFile) {
  const rows = groupRows(await findComponents(alphaFile)).filter((row) => row.length >= 8);
  const frameIndexes = [0, 1, 2, 3, 4, 5, 6, 7];
  const animations = [
    { id: 'male-idle-left-smart', row: 0, frames: frameIndexes },
    { id: 'male-idle-right-smart', row: 1, frames: frameIndexes },
    { id: 'male-walk-left-smart', row: 2, frames: frameIndexes },
    { id: 'male-walk-right-smart', row: 3, frames: frameIndexes },
    { id: 'female-idle-left-smart', row: 4, frames: frameIndexes },
    { id: 'female-idle-right-smart', row: 5, frames: frameIndexes },
    { id: 'female-walk-left-smart', row: 6, frames: frameIndexes },
    { id: 'female-walk-right-smart', row: 7, frames: frameIndexes },
  ];
  const frameW = 128;
  const frameH = 180;
  const manifest = {};
  const sourceImage = sharp(alphaFile);

  for (const animation of animations) {
    const composites = [];
    for (const [index, frameIndex] of animation.frames.entries()) {
      const box = rows[animation.row]?.slice(0, 8)?.[frameIndex];
      if (!box) continue;
      const padX = 6;
      const padY = 0;
      const metadata = await sourceImage.metadata();
      const left = Math.max(0, box.minX - padX);
      const top = Math.max(0, box.minY - padY);
      const width = Math.min(box.maxX + padX, metadata.width - 1) - left + 1;
      const height = Math.min(box.maxY + padY, metadata.height - 1) - top + 1;
      const frame = await sourceImage.clone().extract({ left, top, width, height }).png().toBuffer();
      composites.push({
        input: frame,
        left: index * frameW + Math.round((frameW - width) / 2),
        top: Math.max(0, frameH - height - 4),
      });
    }
    const out = path.join(outDir, `${animation.id}.png`);
    await sharp({
      create: {
        width: frameW * animation.frames.length,
        height: frameH,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite(composites).png().toFile(out);
    manifest[animation.id] = {
      src: `/office/agents/${animation.id}.png`,
      frameWidth: frameW,
      frameHeight: frameH,
      frames: animation.frames.length,
    };
  }

  return manifest;
}

await fs.mkdir(outDir, { recursive: true });
const manifest = {};

for (const source of sources) {
  try {
    await fs.access(source.file);
  } catch {
    continue;
  }
  const alphaFile = path.join(outDir, `${source.name}-alpha.png`);
  await chromaToAlpha(source.file, alphaFile);
  if (source.name === 'office-agent-sprite-v1') {
    Object.assign(manifest, await buildSmartAgentSheets(alphaFile));
  }
  await fs.rm(alphaFile, { force: true });
}

await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(path.join(outDir, 'manifest.json'));
