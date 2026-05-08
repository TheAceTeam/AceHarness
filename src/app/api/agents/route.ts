import { NextResponse } from 'next/server';
import { readdir, readFile } from 'fs/promises';
import { resolve } from 'path';
import { parse } from 'yaml';
import { getRuntimeAgentsDirPath } from '@/lib/runtime-configs';

export async function GET() {
  try {
    const agentsDir = await getRuntimeAgentsDirPath();
    const files = await readdir(agentsDir);
    const yamlFiles = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

    const agents = [];
    for (const file of yamlFiles) {
      try {
        const content = await readFile(resolve(agentsDir, file), 'utf-8');
        const agent = parse(content);
        agents.push({ ...agent, _file: file });
      } catch {
        // skip malformed files
      }
    }

    return NextResponse.json({ agents, runtimeAgentsDir: agentsDir });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取 Agent 列表失败', message: error.message },
      { status: 500 }
    );
  }
}
