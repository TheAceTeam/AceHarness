'use client';

import { useState, useEffect } from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import {
  Activity,
  Clock,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Zap,
  TrendingUp,
} from 'lucide-react';
import type { StateTransitionRecord, Issue } from '@/lib/schemas';

// 格式化状态名称，将内部状态名转换为友好显示
function formatStateName(name: string): string {
  if (name === '__origin__') return '开始';
  if (name === '__human_approval__') return '人工审查';
  return name;
}

interface StateMachineRuntimePanelProps {
  currentState: string | null;
  stateHistory: StateTransitionRecord[];
  issueTracker: Issue[];
  transitionCount: number;
  maxTransitions: number;
  status: 'idle' | 'running' | 'completed' | 'failed';
  startTime?: string | null;
  endTime?: string | null;
  onStateClick?: (stateName: string) => void;
}

export default function StateMachineRuntimePanel({
  currentState,
  stateHistory,
  issueTracker,
  transitionCount,
  maxTransitions,
  status,
  startTime,
  endTime,
  onStateClick,
}: StateMachineRuntimePanelProps) {
  const [selectedTransition, setSelectedTransition] = useState<StateTransitionRecord | null>(null);

  // 过滤掉空描述的问题
  const validIssues = issueTracker.filter(i => i.description?.trim());

  // 统计数据
  const criticalIssues = validIssues.filter(i => i.severity === 'critical').length;
  const majorIssues = validIssues.filter(i => i.severity === 'major').length;
  const minorIssues = validIssues.filter(i => i.severity === 'minor').length;

  // 状态访问次数统计
  const stateVisits = stateHistory.reduce((acc, record) => {
    acc[record.from] = (acc[record.from] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // 最近的转移记录
  const recentTransitions = stateHistory.slice(-5).reverse();

  return (
    <div className="space-y-4">
      {/* 顶部状态卡片 */}
      <div className="grid grid-cols-4 gap-4">
        {/* 当前状态 */}
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-4 text-white">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-5 h-5" />
            <span className="text-sm font-medium">当前状态</span>
          </div>
          <div className="text-2xl font-bold">
            {currentState ? (
              <button
                type="button"
                onClick={() => onStateClick?.(currentState)}
                className="text-left underline-offset-4 hover:underline"
              >
                {formatStateName(currentState)}
              </button>
            ) : '未开始'}
          </div>
          {status === 'running' && (
            <div className="flex items-center gap-1 mt-2 text-sm">
              <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <span>执行中...</span>
            </div>
          )}
        </div>

        {/* 转移次数 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-5 h-5 text-purple-500" />
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">转移次数</span>
          </div>
          <div className="text-2xl font-bold">
            {transitionCount} / {maxTransitions}
          </div>
          <div className="mt-2">
            <Progress
              value={(transitionCount / maxTransitions) * 100}
              className={`h-1.5 ${
                transitionCount / maxTransitions > 0.8
                  ? '[&>[data-slot=progress-indicator]]:bg-red-500'
                  : transitionCount / maxTransitions > 0.5
                  ? '[&>[data-slot=progress-indicator]]:bg-yellow-500'
                  : '[&>[data-slot=progress-indicator]]:bg-green-500'
              }`}
            />
          </div>
        </div>

        {/* 问题统计 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">发现问题</span>
          </div>
          <div className="text-2xl font-bold">
            {validIssues.length}
          </div>
          <div className="flex gap-2 mt-2 text-xs">
            {criticalIssues > 0 && (
              <Badge variant="destructive" className="text-xs">
                {criticalIssues} 严重
              </Badge>
            )}
            {majorIssues > 0 && (
              <Badge variant="outline" className="text-xs border-orange-500 text-orange-500">
                {majorIssues} 主要
              </Badge>
            )}
            {minorIssues > 0 && (
              <Badge variant="outline" className="text-xs">
                {minorIssues} 次要
              </Badge>
            )}
          </div>
        </div>

        {/* 执行时间 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-5 h-5 text-blue-500" />
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">执行时间</span>
          </div>
          <div className="text-2xl font-bold">
            <LiveTimer status={status} startTime={startTime} endTime={endTime} />
          </div>
          <div className="text-xs text-gray-500 mt-2">
            {status === 'completed' ? '已完成' : status === 'running' ? '进行中' : '待开始'}
          </div>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* 状态转移历史 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-500" />
              状态转移历史
            </h3>
            <Badge variant="outline">{stateHistory.length} 次转移</Badge>
          </div>

          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {recentTransitions.length === 0 ? (
              <div className="text-center text-sm text-gray-500 py-8">
                暂无转移记录
              </div>
            ) : (
              recentTransitions.map((record, idx) => (
                <div
                  key={idx}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedTransition(record)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedTransition(record);
                    }
                  }}
                  className={`
                    w-full p-3 rounded-lg border text-left transition-all
                    ${selectedTransition === record
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                    }
                  `}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="text-xs">
                      #{stateHistory.length - idx}
                    </Badge>
                    <span className="text-xs text-gray-500">
                      {new Date(record.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-sm font-medium mb-1">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onStateClick?.(record.from);
                      }}
                      className="underline-offset-4 hover:underline"
                    >
                      {formatStateName(record.from)}
                    </button>
                    <ArrowRight className="w-4 h-4 text-gray-400" />
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onStateClick?.(record.to);
                      }}
                      className="text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
                    >
                      {formatStateName(record.to)}
                    </button>
                  </div>

                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    {record.reason}
                  </div>

                  {record.issues.length > 0 && (
                    <div className="flex gap-1 mt-2">
                      {record.issues.slice(0, 2).map((issue, i) => (
                        <Badge
                          key={i}
                          variant={issue.severity === 'critical' ? 'destructive' : 'outline'}
                          className="text-xs"
                        >
                          {issue.type}
                        </Badge>
                      ))}
                      {record.issues.length > 2 && (
                        <Badge variant="outline" className="text-xs">
                          +{record.issues.length - 2}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* 问题追踪 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
              问题追踪
            </h3>
            <Badge variant="outline">{validIssues.length} 个问题</Badge>
          </div>

          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {validIssues.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-2" />
                <p className="text-sm text-gray-500">暂未发现问题</p>
              </div>
            ) : (
              validIssues.slice().reverse().map((issue, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg border border-gray-200 dark:border-gray-700"
                >
                  <div className="flex items-start gap-2 mb-2">
                    <Badge
                      variant={
                        issue.severity === 'critical'
                          ? 'destructive'
                          : issue.severity === 'major'
                          ? 'outline'
                          : 'secondary'
                      }
                      className="text-xs"
                    >
                      {issue.severity}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {issue.type}
                    </Badge>
                  </div>

                  <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                    {issue.description}
                  </p>

                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    {issue.foundInState && (
                      <span>发现于: {issue.foundInState}</span>
                    )}
                    {issue.foundByAgent && (
                      <>
                        <span>•</span>
                        <span>由 {issue.foundByAgent} 发现</span>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 状态访问统计 */}
      {Object.keys(stateVisits).length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold mb-4">状态访问统计</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(stateVisits)
              .sort(([, a], [, b]) => b - a)
              .map(([state, count]) => (
                <div
                  key={state}
                  className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700"
                >
                  <div className="text-sm font-medium mb-1">{formatStateName(state)}</div>
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {count}
                  </div>
                  <div className="text-xs text-gray-500">次访问</div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* 选中的转移详情 */}
      {selectedTransition && (
        <div className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950 dark:to-purple-950 rounded-xl p-4 border border-blue-200 dark:border-blue-800">
          <h3 className="font-semibold mb-3">转移详情</h3>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">转移路径</div>
              <div className="flex items-center gap-2 text-lg font-semibold">
                <span>{formatStateName(selectedTransition.from)}</span>
                <ArrowRight className="w-5 h-5 text-gray-400" />
                <span className="text-blue-600 dark:text-blue-400">{formatStateName(selectedTransition.to)}</span>
              </div>
            </div>

            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">转移原因</div>
              <div className="text-sm">{selectedTransition.reason}</div>
            </div>
          </div>

          {selectedTransition.issues.length > 0 && (
            <div className="mt-4">
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                相关问题 ({selectedTransition.issues.length})
              </div>
              <div className="space-y-2">
                {selectedTransition.issues.map((issue, idx) => (
                  <div
                    key={idx}
                    className="p-2 rounded bg-white dark:bg-gray-800 text-sm"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs">
                        {issue.severity}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {issue.type}
                      </Badge>
                    </div>
                    <div className="text-gray-700 dark:text-gray-300">
                      {issue.description}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 实时计时器组件
function LiveTimer({ status, startTime, endTime }: { status: string; startTime?: string | null; endTime?: string | null }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    // 计算初始已运行时间
    if (startTime) {
      const start = new Date(startTime).getTime();
      const end = endTime ? new Date(endTime).getTime() : Date.now();
      const initialElapsed = Math.floor((end - start) / 1000);
      setElapsed(initialElapsed);
    }

    // 如果正在运行，每秒更新
    if (status !== 'running' || !startTime) return;

    const interval = setInterval(() => {
      const start = new Date(startTime).getTime();
      const now = Date.now();
      const currentElapsed = Math.floor((now - start) / 1000);
      setElapsed(currentElapsed);
    }, 1000);

    return () => clearInterval(interval);
  }, [status, startTime, endTime]);

  const safeElapsed = Math.max(0, elapsed);
  const minutes = Math.floor(safeElapsed / 60);
  const seconds = safeElapsed % 60;

  return (
    <span>
      {minutes}:{seconds.toString().padStart(2, '0')}
    </span>
  );
}
