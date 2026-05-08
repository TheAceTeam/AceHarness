'use client';

import { useMemo } from 'react';
import { Badge } from './ui/badge';
import { ArrowRight, TrendingUp, RotateCcw } from 'lucide-react';
import type { StateTransitionRecord } from '@/lib/schemas';

const HUMAN_APPROVAL_STATE = '__human_approval__';
const ORIGIN_STATE = '__origin__';

// 格式化状态名称，将内部状态名转换为友好显示
function formatStateName(name: string): string {
  if (name === ORIGIN_STATE) return '开始';
  if (name === HUMAN_APPROVAL_STATE) return '人工审查';
  return name;
}

function isWorkflowState(name: string): boolean {
  return name !== ORIGIN_STATE && name !== HUMAN_APPROVAL_STATE;
}

interface StateFlowVisualizerProps {
  stateHistory: StateTransitionRecord[];
  currentState: string | null;
  onStateClick?: (stateName: string) => void;
}

export default function StateFlowVisualizer({
  stateHistory,
  currentState,
  onStateClick,
}: StateFlowVisualizerProps) {
  // 分析状态流转模式
  const flowAnalysis = useMemo(() => {
    const transitions: Record<string, Record<string, number>> = {};
    const stateVisits: Record<string, number> = {};
    const backwardTransitions: Array<{ from: string; to: string; count: number }> = [];

    // 统计转移次数
    stateHistory.forEach(record => {
      // 记录转移
      if (!transitions[record.from]) {
        transitions[record.from] = {};
      }
      transitions[record.from][record.to] = (transitions[record.from][record.to] || 0) + 1;

      // 记录访问次数
      stateVisits[record.from] = (stateVisits[record.from] || 0) + 1;
      stateVisits[record.to] = (stateVisits[record.to] || 0) + 1;
    });

    // 识别回退（假设状态名称包含顺序信息，或者通过访问顺序判断）
    const stateOrder: Record<string, number> = {};
    let orderIndex = 0;
    stateHistory.forEach(record => {
      if (!(record.from in stateOrder)) {
        stateOrder[record.from] = orderIndex++;
      }
      if (!(record.to in stateOrder)) {
        stateOrder[record.to] = orderIndex++;
      }

      // 只把真实 workflow 状态之间的后退计为回退；人工审查是旁路检查点，不代表流程倒退。
      if (
        isWorkflowState(record.from) &&
        isWorkflowState(record.to) &&
        stateOrder[record.to] < stateOrder[record.from]
      ) {
        const existing = backwardTransitions.find(
          t => t.from === record.from && t.to === record.to
        );
        if (existing) {
          existing.count++;
        } else {
          backwardTransitions.push({ from: record.from, to: record.to, count: 1 });
        }
      }
    });

    return {
      transitions,
      stateVisits,
      backwardTransitions,
      allStates: Object.keys(stateVisits).sort((a, b) => {
        return (stateOrder[a] || 0) - (stateOrder[b] || 0);
      }),
    };
  }, [stateHistory]);

  if (stateHistory.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-8 border border-gray-200 dark:border-gray-700">
        <div className="text-center text-gray-500">
          <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>暂无流转数据</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 主流程图 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold mb-6">状态流转图</h3>

        <div className="space-y-4">
          {flowAnalysis.allStates.map((state, index) => {
            const isCurrentState = state === currentState;
            const isHumanApproval = state === HUMAN_APPROVAL_STATE;
            const displayName = formatStateName(state);
            const visitCount = flowAnalysis.stateVisits[state] || 0;
            const outgoingTransitions = flowAnalysis.transitions[state] || {};
            const hasOutgoing = Object.keys(outgoingTransitions).length > 0;

            return (
              <div key={state}>
                {/* 状态节点 */}
                <div className="flex items-center gap-4">
                  {/* 访问次数指示器 */}
                  <div className="flex flex-col items-center gap-1">
                    <div className={`
                      w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm
                      ${isCurrentState
                        ? 'bg-gradient-to-br from-blue-500 to-purple-500 text-white shadow-lg animate-pulse'
                        : isHumanApproval
                        ? 'bg-orange-500 text-white'
                        : visitCount > 3
                        ? 'bg-orange-500 text-white'
                        : visitCount > 1
                        ? 'bg-yellow-500 text-white'
                        : 'bg-blue-500 text-white'
                      }
                    `}>
                      {isHumanApproval ? (
                        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>person</span>
                      ) : (
                        visitCount
                      )}
                    </div>
                    <span className="text-xs text-gray-500">{isHumanApproval ? '' : '次'}</span>
                  </div>

                  {/* 状态名称卡片 */}
                  <div className={`
                    flex-1 p-4 rounded-lg border-2 transition-all
                    ${isCurrentState
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 shadow-lg'
                      : isHumanApproval
                      ? 'border-orange-400 bg-orange-50 dark:bg-orange-950'
                      : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900'
                    }
                  `}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-lg mb-1 flex items-center gap-2">
                          {isHumanApproval && (
                            <span className="material-symbols-outlined text-orange-500" style={{ fontSize: 20 }}>person</span>
                          )}
                          <button
                            type="button"
                            onClick={() => onStateClick?.(state)}
                            className="text-left underline-offset-4 hover:underline"
                          >
                            {displayName}
                          </button>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                          <span>访问 {visitCount} 次</span>
                          {hasOutgoing && (
                            <>
                              <span>•</span>
                              <span>{Object.keys(outgoingTransitions).length} 个出口</span>
                            </>
                          )}
                        </div>
                      </div>
                      {isCurrentState && (
                        <Badge className="bg-blue-500">
                          <div className="w-2 h-2 rounded-full bg-white animate-pulse mr-2" />
                          当前
                        </Badge>
                      )}
                      {isHumanApproval && !isCurrentState && (
                        <Badge className="bg-orange-500">人工审查</Badge>
                      )}
                    </div>
                  </div>
                </div>

                {/* 转移箭头 */}
                {hasOutgoing && (
                  <div className="ml-16 mt-2 space-y-2">
                    {Object.entries(outgoingTransitions).map(([targetState, count]) => {
                      const isBackward = flowAnalysis.backwardTransitions.some(
                        t => t.from === state && t.to === targetState
                      );
                      const targetDisplayName = formatStateName(targetState);

                      return (
                        <div
                          key={targetState}
                          className={`
                            flex items-center gap-3 p-3 rounded-lg border
                            ${isBackward
                              ? 'border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950'
                              : targetState === HUMAN_APPROVAL_STATE
                              ? 'border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950'
                              : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900'
                            }
                          `}
                        >
                          {isBackward ? (
                            <RotateCcw className="w-5 h-5 text-orange-500 flex-shrink-0" />
                          ) : targetState === HUMAN_APPROVAL_STATE ? (
                            <span className="material-symbols-outlined text-orange-500 flex-shrink-0" style={{ fontSize: 20 }}>person</span>
                          ) : (
                            <ArrowRight className="w-5 h-5 text-blue-500 flex-shrink-0" />
                          )}
                          <div className="flex-1 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => onStateClick?.(targetState)}
                              className="text-sm font-medium underline-offset-4 hover:underline"
                            >
                              → {targetDisplayName}
                            </button>
                          <Badge variant="outline" className="text-xs">
                            {count} 次
                          </Badge>
                          </div>
                          {isBackward && (
                            <Badge variant="outline" className="text-xs text-orange-600 border-orange-600">
                              回退
                            </Badge>
                          )}
                          {targetState === HUMAN_APPROVAL_STATE && !isBackward && (
                            <Badge variant="outline" className="text-xs text-orange-600 border-orange-600">
                              人工审查
                            </Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 连接线 */}
                {index < flowAnalysis.allStates.length - 1 && (
                  <div className="ml-6 h-4 w-0.5 bg-gray-300 dark:bg-gray-700" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 回退分析 */}
      {flowAnalysis.backwardTransitions.length > 0 && (
        <div className="bg-gradient-to-br from-orange-50 to-red-50 dark:from-orange-950 dark:to-red-950 rounded-xl p-6 border border-orange-200 dark:border-orange-800">
          <div className="flex items-center gap-2 mb-4">
            <RotateCcw className="w-5 h-5 text-orange-600" />
            <h3 className="font-semibold text-orange-900 dark:text-orange-100">
              回退分析
            </h3>
            <Badge variant="outline" className="text-orange-600 border-orange-600">
              {flowAnalysis.backwardTransitions.length} 个回退路径
            </Badge>
          </div>

          <div className="space-y-2">
            {flowAnalysis.backwardTransitions.map((transition, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-gray-800"
              >
                <div className="flex items-center gap-3">
                  <RotateCcw className="w-4 h-4 text-orange-500" />
                  <span className="text-sm">
                    <button
                      type="button"
                      onClick={() => onStateClick?.(transition.from)}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {formatStateName(transition.from)}
                    </button>
                    <ArrowRight className="w-4 h-4 inline mx-2 text-gray-400" />
                    <button
                      type="button"
                      onClick={() => onStateClick?.(transition.to)}
                      className="font-medium text-orange-600 underline-offset-4 hover:underline"
                    >
                      {formatStateName(transition.to)}
                    </button>
                  </span>
                </div>
                <Badge variant="outline" className="text-xs">
                  回退 {transition.count} 次
                </Badge>
              </div>
            ))}
          </div>

          <div className="mt-4 p-3 rounded-lg bg-orange-100 dark:bg-orange-900 text-sm text-orange-900 dark:text-orange-100">
            <strong>提示：</strong>
            回退表示工作流从后面的状态返回到前面的状态，通常是因为发现了需要在早期阶段解决的问题；人工审查节点不计入回退。
          </div>
        </div>
      )}

      {/* 热点状态 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <h3 className="font-semibold mb-4">热点状态</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Object.entries(flowAnalysis.stateVisits)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 6)
            .map(([state, count]) => (
              <div
                key={state}
                className="p-3 rounded-lg bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950 dark:to-purple-950 border border-blue-200 dark:border-blue-800"
              >
                <div className="text-sm font-medium mb-1">{formatStateName(state)}</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full"
                      style={{
                        width: `${(count / Math.max(...Object.values(flowAnalysis.stateVisits))) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                    {count}
                  </span>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
