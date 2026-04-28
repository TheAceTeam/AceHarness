'use client';

import { useMemo } from 'react';
import { Badge } from './ui/badge';
import { ArrowRight, Clock, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import type { StateTransitionRecord } from '@/lib/schemas';

// 格式化状态名称，将内部状态名转换为友好显示
function formatStateName(name: string): string {
  if (name === '__origin__') return '开始';
  if (name === '__human_approval__') return '人工审查';
  return name;
}

interface StateTransitionTimelineProps {
  stateHistory: StateTransitionRecord[];
  currentState: string | null;
  status: 'idle' | 'running' | 'completed' | 'failed';
}

export default function StateTransitionTimeline({
  stateHistory,
  currentState,
  status,
}: StateTransitionTimelineProps) {
  // 构建时序数据
  const timelineData = useMemo(() => {
    const data: Array<{
      timestamp: string;
      from: string;
      to: string;
      reason: string;
      issues: any[];
      duration?: number;
      index: number;
    }> = [];

    for (let i = 0; i < stateHistory.length; i++) {
      const record = stateHistory[i];
      const nextRecord = stateHistory[i + 1];

      // 计算在该状态停留的时间
      let duration = 0;
      if (nextRecord) {
        const currentTime = new Date(record.timestamp).getTime();
        const nextTime = new Date(nextRecord.timestamp).getTime();
        duration = Math.floor((nextTime - currentTime) / 1000); // 秒
      }

      data.push({
        ...record,
        duration,
        index: i,
      });
    }

    return data;
  }, [stateHistory]);

  // 获取所有唯一的状态
  const allStates = useMemo(() => {
    const states = new Set<string>();
    stateHistory.forEach(record => {
      states.add(record.from);
      states.add(record.to);
    });
    if (currentState) states.add(currentState);
    return Array.from(states);
  }, [stateHistory, currentState]);

  if (stateHistory.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-8 border border-gray-200 dark:border-gray-700">
        <div className="text-center text-gray-500">
          <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>工作流尚未开始执行</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold">执行时序图</h3>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {stateHistory.length} 次转移
          </Badge>
          {status === 'running' && (
            <Badge className="bg-blue-500">
              <div className="w-2 h-2 rounded-full bg-white animate-pulse mr-2" />
              执行中
            </Badge>
          )}
          {status === 'completed' && (
            <Badge className="bg-green-500">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              已完成
            </Badge>
          )}
          {status === 'failed' && (
            <Badge className="bg-red-500">
              <XCircle className="w-3 h-3 mr-1" />
              失败
            </Badge>
          )}
        </div>
      </div>

      {/* 时序图主体 */}
      <div className="relative">
        {/* 时间轴线 */}
        <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-blue-500 via-purple-500 to-pink-500" />

        {/* 时序事件 */}
        <div className="space-y-6">
          {timelineData.map((item, index) => {
            const isLast = index === timelineData.length - 1;
            const hasIssues = item.issues.length > 0;
            const criticalIssues = item.issues.filter(i => i.severity === 'critical').length;

            return (
              <div key={index} className="relative pl-20">
                {/* 时间点标记 */}
                <div className="absolute left-0 top-0 flex items-center gap-3">
                  <div className={`
                    w-16 h-16 rounded-full flex items-center justify-center font-bold text-lg
                    ${item.to === '__human_approval__' || item.from === '__human_approval__'
                      ? 'bg-orange-500 text-white'
                      : hasIssues
                      ? criticalIssues > 0
                        ? 'bg-red-500 text-white'
                        : 'bg-orange-500 text-white'
                      : 'bg-blue-500 text-white'
                    }
                    shadow-lg z-10
                  `}>
                    {item.to === '__human_approval__' || item.from === '__human_approval__' ? (
                      <span className="material-symbols-outlined" style={{ fontSize: 28 }}>person</span>
                    ) : (
                      index + 1
                    )}
                  </div>
                </div>

                {/* 事件内容卡片 */}
                <div className={`
                  ml-4 p-4 rounded-lg border-2 transition-all
                  ${isLast && status === 'running'
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 shadow-lg'
                    : item.to === '__human_approval__' || item.from === '__human_approval__'
                    ? 'border-orange-400 dark:border-orange-600 bg-orange-50 dark:bg-orange-950'
                    : hasIssues
                    ? 'border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950'
                    : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900'
                  }
                `}>
                  {/* 时间戳 */}
                  <div className="flex items-center gap-2 mb-3">
                    <Clock className="w-4 h-4 text-gray-500" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {new Date(item.timestamp).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                    {(item.duration ?? 0) > 0 && (
                      <>
                        <span className="text-gray-400">•</span>
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          停留 {formatDuration(item.duration ?? 0)}
                        </span>
                      </>
                    )}
                  </div>

                  {/* 状态转移 */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                      <span className="font-semibold text-sm">
                        {formatStateName(item.from)}
                      </span>
                    </div>
                    <ArrowRight className="w-5 h-5 text-gray-400" />
                    <div className={`px-3 py-1.5 rounded-lg border ${
                      item.to === '__human_approval__'
                        ? 'bg-orange-100 dark:bg-orange-900 border-orange-300 dark:border-orange-700'
                        : 'bg-blue-100 dark:bg-blue-900 border-blue-300 dark:border-blue-700'
                    }`}>
                      <span className={`font-semibold text-sm ${
                        item.to === '__human_approval__'
                          ? 'text-orange-700 dark:text-orange-300'
                          : 'text-blue-700 dark:text-blue-300'
                      }`}>
                        {formatStateName(item.to)}
                      </span>
                    </div>
                  </div>

                  {/* 转移原因 */}
                  <div className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                    <span className="font-medium">原因：</span>
                    {item.reason}
                  </div>

                  {/* 问题列表 */}
                  {hasIssues && (
                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="w-4 h-4 text-orange-500" />
                        <span className="text-sm font-medium">
                          发现 {item.issues.length} 个问题
                        </span>
                      </div>
                      <div className="space-y-2">
                        {item.issues.slice(0, 3).map((issue, idx) => (
                          <div
                            key={idx}
                            className="flex items-start gap-2 text-sm p-2 rounded bg-white dark:bg-gray-800"
                          >
                            <Badge
                              variant={issue.severity === 'critical' ? 'destructive' : 'outline'}
                              className="text-xs flex-shrink-0"
                            >
                              {issue.severity}
                            </Badge>
                            <Badge variant="outline" className="text-xs flex-shrink-0">
                              {issue.type}
                            </Badge>
                            <span className="text-gray-700 dark:text-gray-300 flex-1">
                              {issue.description}
                            </span>
                          </div>
                        ))}
                        {item.issues.length > 3 && (
                          <div className="text-xs text-gray-500 pl-2">
                            还有 {item.issues.length - 3} 个问题...
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* 当前状态（如果正在运行） */}
          {status === 'running' && currentState && (
            <div className="relative pl-20">
              <div className="absolute left-0 top-0 flex items-center gap-3">
                <div className="w-16 h-16 rounded-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-500 text-white shadow-lg z-10 animate-pulse">
                  <div className="w-3 h-3 rounded-full bg-white" />
                </div>
              </div>

              <div className="ml-4 p-4 rounded-lg border-2 border-blue-500 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950 dark:to-purple-950 shadow-lg">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                    正在执行
                  </span>
                </div>
                <div className="px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 border border-blue-300 dark:border-blue-700 inline-block">
                  <span className="font-semibold">{formatStateName(currentState)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 统计信息 */}
      <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {allStates.length}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">访问的状态</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
              {stateHistory.length}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">状态转移次数</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
              {stateHistory.reduce((sum, item) => sum + item.issues.length, 0)}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">发现的问题</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes}分${remainingSeconds}秒`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}小时${remainingMinutes}分`;
}
