'use client';

import { useMemo } from 'react';
import { Badge } from './ui/badge';
import { ArrowRight, GitBranch, User, Bot, HelpCircle, Clock } from 'lucide-react';

interface SupervisorFlowRecord {
  type: 'question' | 'decision';
  from: string;
  to: string;
  question?: string;
  method?: string;
  round: number;
  timestamp: string;
  stateName?: string;
}

interface SupervisorFlowVisualizerProps {
  flow: SupervisorFlowRecord[];
  currentRound?: number;
}

export default function SupervisorFlowVisualizer({
  flow,
  currentRound,
}: SupervisorFlowVisualizerProps) {
  const sortedFlow = useMemo(() => {
    const deduped = flow.filter((record, index, list) => {
      const key = `${record.type}::${record.from}::${record.to}::${record.stateName || ''}::${record.timestamp}::${record.question || ''}`;
      return list.findIndex((item) => (
        `${item.type}::${item.from}::${item.to}::${item.stateName || ''}::${item.timestamp}::${item.question || ''}` === key
      )) === index;
    });
    return deduped.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [flow]);

  if (flow.length === 0) {
    return (
      <div className="h-full bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 flex flex-col">
        <div className="flex items-center gap-2 mb-4">
          <GitBranch className="w-5 h-5 text-purple-500" />
          <h3 className="font-semibold">Supervisor 流转</h3>
        </div>
        <div className="flex-1 min-h-0 flex items-center justify-center text-center text-gray-500 py-8">
          <div>
          <HelpCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">暂无 Supervisor 流转记录</p>
          <p className="text-xs mt-1">当 Agent 请求信息时，将显示路由路径</p>
          </div>
        </div>
        {currentRound !== undefined && (
          <Badge className="bg-purple-100 text-purple-700 border-purple-200">
            当前第 {currentRound + 1} 轮
          </Badge>
        )}
      </div>
    );
  }

  const getMethodBadge = (method?: string) => {
    if (method === 'keyword') {
      return <Badge variant="outline" className="text-[10px] py-0 h-5 border-green-500 text-green-600">关键词</Badge>;
    }
    if (method === 'llm') {
      return <Badge variant="outline" className="text-[10px] py-0 h-5 border-blue-500 text-blue-600">LLM</Badge>;
    }
    return null;
  };

  return (
    <div className="h-full bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-purple-500" />
          <h3 className="font-semibold">Supervisor 流转</h3>
          <Badge variant="secondary">{flow.length} 条记录</Badge>
        </div>
        {currentRound !== undefined && (
          <Badge className="bg-purple-100 text-purple-700 border-purple-200">
            当前第 {currentRound + 1} 轮
          </Badge>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="space-y-3">
        {sortedFlow.map((record, idx) => (
          <div key={idx} className="relative pl-8">
            {/* 时间轴线 */}
            <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-purple-200" />
            <div className="absolute left-2 top-3 w-2 h-2 rounded-full bg-purple-500 border-2 border-white dark:border-gray-800" />
            
            <div className="bg-purple-50 dark:bg-purple-950/20 rounded-lg p-3 border border-purple-100 dark:border-purple-900">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-3 h-3 text-purple-400" />
                <span className="text-xs text-purple-500">
                  {new Date(record.timestamp).toLocaleTimeString()}
                </span>
                {record.stateName && (
                  <Badge variant="outline" className="text-[10px] py-0 h-5">
                    {record.stateName}
                  </Badge>
                )}
                <Badge variant="outline" className="text-[10px] py-0 h-5">
                  第 {record.round + 1} 轮
                </Badge>
              </div>

              <div className="flex items-center gap-2 text-sm flex-wrap">
                <div className={`
                  flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium
                  ${record.from === 'user' 
                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' 
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  }
                `}>
                  {record.from === 'user' ? (
                    <User className="w-3 h-3" />
                  ) : (
                    <Bot className="w-3 h-3" />
                  )}
                  {record.from}
                </div>

                <ArrowRight className="w-4 h-4 text-gray-400" />

                <div className={`
                  flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium
                  ${record.to === 'user' 
                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' 
                    : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  }
                `}>
                  {record.to === 'user' ? (
                    <User className="w-3 h-3" />
                  ) : (
                    <Bot className="w-3 h-3" />
                  )}
                  {record.to}
                </div>

                {getMethodBadge(record.method)}
              </div>

              {record.question && (
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-900/50 rounded p-2 whitespace-pre-wrap break-words leading-relaxed">
                  {record.question}
                </div>
              )}
            </div>
          </div>
        ))}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
        <div className="flex flex-wrap gap-3 text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <Bot className="w-3 h-3 text-blue-500" />
            <span>Agent</span>
          </div>
          <div className="flex items-center gap-1">
            <User className="w-3 h-3 text-orange-500" />
            <span>用户</span>
          </div>
          <div className="flex items-center gap-1">
            <Badge variant="outline" className="text-[10px] py-0 h-4">关键词</Badge>
            <span>关键词匹配</span>
          </div>
          <div className="flex items-center gap-1">
            <Badge variant="outline" className="text-[10px] py-0 h-4">LLM</Badge>
            <span>LLM 语义路由</span>
          </div>
        </div>
      </div>
    </div>
  );
}
