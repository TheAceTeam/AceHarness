import { readdir, readFile, writeFile, unlink } from 'fs/promises';
import { resolve } from 'path';
import { parse, stringify } from 'yaml';
import { getRuntimeAgentsDirPath } from '@/lib/run/runtime-configs';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
    const { action } = body;

    const agentsDir = await getRuntimeAgentsDirPath();
    const files = await readdir(agentsDir);
    const yamlFiles = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

    let updatedCount = 0;

    if (action === 'delete') {
      const names = Array.isArray(body.names) ? body.names.filter((item: unknown) => typeof item === 'string' && item.trim()) : [];
      if (names.length === 0) {
        return jsonError('缺少待删除 Agent 名称', 400);
      }

      const normalizedNames = new Set(
        names
          .map((name: string) => name.trim())
          .filter((name: string) => !name.includes('..') && !name.includes('/') && !name.includes('\\'))
      );
      if (normalizedNames.size !== names.length) {
        return jsonError('包含无效 Agent 名称', 400);
      }

      for (const file of yamlFiles) {
        const filepath = resolve(agentsDir, file);
        const baseName = file.replace(/\.(yaml|yml)$/i, '');
        if (!normalizedNames.has(baseName)) continue;
        try {
          await unlink(filepath);
          updatedCount++;
        } catch (error) {
          console.error(`Failed to delete ${file}:`, error);
        }
      }

      return jsonOk({
        success: true,
        message: `已删除 ${updatedCount} 个 Agent`,
        updatedCount,
      });
    }

    for (const file of yamlFiles) {
      try {
        const filepath = resolve(agentsDir, file);
        const content = await readFile(filepath, 'utf-8');
        const agent = parse(content);
        const engineModels = agent.engineModels && typeof agent.engineModels === 'object'
          ? agent.engineModels
          : {};
        let changed = false;

        if (action === 'replace-model') {
          const { engine, fromModel, toModel } = body;
          if (fromModel === undefined || !toModel) {
            return jsonError('缺少必要参数', 400);
          }

          // engine key: "" means follow-global, undefined means match all engines
          const targetEngine = engine ?? undefined;
          const engines = targetEngine !== undefined
            ? [targetEngine]
            : Object.keys(engineModels);

          for (const eng of engines) {
            if (engineModels[eng] === fromModel) {
              engineModels[eng] = toModel;
              changed = true;
            }
          }
        } else if (action === 'set-model-policy') {
          const {
            sourceType,
            sourceEngine,
            sourceModel,
            targetEngine,
            targetModel,
          } = body;

          if (!targetEngine || !targetModel) {
            return jsonError('缺少目标引擎或目标模型', 400);
          }

          const hasStrategy = Object.keys(engineModels).length > 0 && Object.values(engineModels).some(Boolean);
          const matchesSource = sourceType === 'unconfigured'
            ? !hasStrategy
            : typeof sourceModel === 'string' && engineModels[String(sourceEngine || '')] === sourceModel;

          if (matchesSource) {
            if (engineModels[targetEngine] !== targetModel || agent.activeEngine !== targetEngine) {
              agent.engineModels = {
                ...engineModels,
                [targetEngine]: targetModel,
              };
              agent.activeEngine = targetEngine;
              changed = true;
            }
          }
        } else {
          return jsonError('不支持的操作', 400);
        }

        if (changed) {
          if (!agent.engineModels) {
            agent.engineModels = engineModels;
          }
          await writeFile(filepath, stringify(agent), 'utf-8');
          updatedCount++;
        }
      } catch (error) {
        console.error(`Failed to update ${file}:`, error);
      }
    }

    return jsonOk({
      success: true,
      message: action === 'set-model-policy'
        ? `已更新 ${updatedCount} 个 Agent 的模型策略`
        : `已更新 ${updatedCount} 个 Agent 的模型配置`,
      updatedCount,
    });
  } catch (error: any) {
    return jsonError('批量操作失败', 500, errorMessage(error));
  }
}
