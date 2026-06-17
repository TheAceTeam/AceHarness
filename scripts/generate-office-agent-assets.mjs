import { mkdir, readFile, rename, rm } from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

const promptDir = path.resolve('tmp/imagegen/office-agents');
const outputDir = path.resolve('output/imagegen/office-agents');
const publicDir = path.resolve('public/office/agents');
const imageGen = path.join(process.env.CODEX_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex'), 'skills/.system/imagegen/scripts/image_gen.py');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set. Run scripts/office-agent-asset-prompts.mjs first, set OPENAI_API_KEY, then rerun this script.');
  }

  const promptsPath = path.join(promptDir, 'prompts.jsonl');
  const manifestPath = path.join(promptDir, 'manifest.json');
  await mkdir(outputDir, { recursive: true });
  await mkdir(publicDir, { recursive: true });

  await run('python', [
    imageGen,
    'generate-batch',
    '--input',
    promptsPath,
    '--out-dir',
    outputDir,
    '--concurrency',
    '3',
    '--model',
    'gpt-image-2',
  ]);

  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
  for (const [agentName, entry] of Object.entries(manifest.agents)) {
    const agentDir = path.join(publicDir, agentName);
    await mkdir(agentDir, { recursive: true });
    await rename(path.join(outputDir, `${agentName}-portrait.png`), path.join(agentDir, 'portrait.png')).catch(() => {});
    for (const action of Object.keys(entry.sprites)) {
      await rename(path.join(outputDir, `${agentName}-${action}.png`), path.join(agentDir, `${action}.png`)).catch(() => {});
    }
  }
  await rm(path.join(publicDir, 'manifest.json'), { force: true }).catch(() => {});
  await rename(manifestPath, path.join(publicDir, 'manifest.json'));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
