import { NextRequest, NextResponse } from 'next/server';
import { readdir, readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { parse, stringify } from 'yaml';
import { getRuntimeAgentsDirPath } from '@/lib/runtime-configs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    const agentsDir = await getRuntimeAgentsDirPath();
    const files = await readdir(agentsDir);
    const yamlFiles = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

    let updatedCount = 0;

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
            return NextResponse.json(
              { error: '缺少必要参数' },
              { status: 400 }
            );
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
            return NextResponse.json(
              { error: '缺少目标引擎或目标模型' },
              { status: 400 }
            );
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
          return NextResponse.json(
            { error: '不支持的操作' },
            { status: 400 }
          );
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

    return NextResponse.json({
      success: true,
      message: action === 'set-model-policy'
        ? `已更新 ${updatedCount} 个 Agent 的模型策略`
        : `已更新 ${updatedCount} 个 Agent 的模型配置`,
      updatedCount,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '批量操作失败', message: error.message },
      { status: 500 }
    );
  }
}
