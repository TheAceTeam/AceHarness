import { createHash } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { lstat, readdir } from 'fs/promises';
import { resolve } from 'path';
import type { LegacyArchiveMetadata } from '@/lib/memory-v2';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { authorizeLegacyArchiveChecksum } from './access-guard';

type LegacyArchiveSource = {
  path: string;
  sourceType: LegacyArchiveMetadata['sourceType'];
  retentionPolicy: string;
  recursiveYaml?: boolean;
};

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function hashFile(path: string): Promise<string> {
  authorizeLegacyArchiveChecksum(path);
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk: Buffer) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(`sha256:${hash.digest('hex')}`));
  });
}

async function listYamlFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) files.push(path);
    }
  };
  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function missingArchiveMetadata(source: LegacyArchiveSource): LegacyArchiveMetadata {
  return {
    sourcePath: source.path,
    sourceType: source.sourceType,
    contentHash: sha256(`missing-legacy-archive\n${source.path}`),
    retentionPolicy: source.retentionPolicy,
    verificationStatus: 'verified-no-access',
  };
}

async function archiveFileMetadata(
  path: string,
  source: LegacyArchiveSource,
): Promise<LegacyArchiveMetadata> {
  return {
    sourcePath: path,
    sourceType: source.sourceType,
    contentHash: await hashFile(path),
    retentionPolicy: source.retentionPolicy,
    verificationStatus: 'verified-no-access',
  };
}

function legacySources(): LegacyArchiveSource[] {
  return [
    {
      path: getWorkspaceDataFile('memory', 'memory.sqlite'),
      sourceType: 'sqlite',
      retentionPolicy: 'preserve-untouched-legacy-memory',
    },
    {
      path: getWorkspaceDataFile('experience-library'),
      sourceType: 'yaml',
      retentionPolicy: 'preserve-untouched-legacy-experiences',
      recursiveYaml: true,
    },
    {
      path: getWorkspaceDataFile('agent-relationships'),
      sourceType: 'yaml',
      retentionPolicy: 'preserve-untouched-agent-relationships',
      recursiveYaml: true,
    },
  ];
}

/**
 * Creates metadata only. It never parses, imports, indexes, or returns legacy
 * file bodies, and it intentionally excludes workflow-start-contexts.json.
 */
export async function collectLegacyArchiveMetadata(): Promise<LegacyArchiveMetadata[]> {
  const metadata: LegacyArchiveMetadata[] = [];
  for (const source of legacySources()) {
    if (source.recursiveYaml) {
      const files = await listYamlFiles(source.path);
      if (!files.length) {
        metadata.push(missingArchiveMetadata(source));
        continue;
      }
      for (const path of files) {
        metadata.push(await archiveFileMetadata(path, source));
      }
      continue;
    }

    if (!existsSync(source.path)) {
      metadata.push(missingArchiveMetadata(source));
      continue;
    }
    const stat = await lstat(source.path);
    if (!stat.isFile()) {
      metadata.push(missingArchiveMetadata(source));
      continue;
    }
    metadata.push(await archiveFileMetadata(source.path, source));
  }
  return metadata;
}
