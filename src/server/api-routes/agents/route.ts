import { readdir, readFile } from 'fs/promises';
import { resolve } from 'path';
import { parse } from 'yaml';
import { getRuntimeAgentsDirPath } from '@/lib/run/runtime-configs';
import { errorMessage, jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';

export async function GET() {
  try {
    const agentsDir = await getRuntimeAgentsDirPath();
    const files = await readdir(agentsDir);
    const yamlFiles = files.filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'));

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

    return jsonOk({ agents, runtimeAgentsDir: agentsDir });
  } catch (error: any) {
    return jsonError('获取 Agent 列表失败', 500, errorMessage(error));
  }
}
