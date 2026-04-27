'use client';

import { useCallback, useMemo, useEffect, useState, useRef } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  MarkerType,
  NodeTypes,
  Handle,
  Position,
  useReactFlow,
  ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { StateMachineState, StateTransition, StateTransitionRecord } from '@/lib/schemas';
import { Badge } from './ui/badge';

// 格式化状态名称，将内部状态名转换为友好显示
function formatStateName(name: string): string {
  if (name === '__origin__') return '开始';
  if (name === '__human_approval__') return '人工审查';
  return name;
}

interface SupervisorFlowRecord {
  type: 'question' | 'decision';
  from: string;
  to: string;
  question?: string;
  method?: string;
  round: number;
  timestamp: string;
}

interface StateMachineDiagramProps {
  states: StateMachineState[];
  onStateClick?: (stateName: string) => void;
  onStepClick?: (step: any) => void;
  onTransitionClick?: (from: string, to: string) => void;
  onForceTransition?: (targetState: string) => void;
  currentState?: string | null;
  currentStep?: string | null;
  completedSteps?: string[];
  stateHistory?: StateTransitionRecord[];
  isRunning?: boolean;
  focusedState?: string | null;
  supervisorFlow?: SupervisorFlowRecord[];
}

// 自动布局算法：基于层次结构排列节点，优化空间利用
function calculateNodeLayout(states: StateMachineState[], useAutoLayout: boolean = true): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // 如果不使用自动布局且所有节点都有预定义位置，直接使用
  if (!useAutoLayout) {
    const allHavePositions = states.every(s => s.position);
    if (allHavePositions) {
      states.forEach(state => {
        if (state.position) {
          positions.set(state.name, state.position);
        }
      });
      return positions;
    }
  }

  // 构建依赖图
  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, string[]>();

  states.forEach(state => {
    inDegree.set(state.name, 0);
    outEdges.set(state.name, []);
  });

  states.forEach(state => {
    if (state.transitions) {
      state.transitions.forEach(trans => {
        const current = inDegree.get(trans.to) || 0;
        inDegree.set(trans.to, current + 1);
        const edges = outEdges.get(state.name) || [];
        edges.push(trans.to);
        outEdges.set(state.name, edges);
      });
    }
  });

  // 拓扑排序分层
  const layers: string[][] = [];
  const processed = new Set<string>();

  while (processed.size < states.length) {
    const currentLayer: string[] = [];

    states.forEach(state => {
      if (processed.has(state.name)) return;

      const degree = inDegree.get(state.name) || 0;
      if (degree === 0 || state.isInitial) {
        currentLayer.push(state.name);
      }
    });

    if (currentLayer.length === 0) {
      // 处理循环依赖：选择入度最小的节点
      let minDegree = Infinity;
      let minNode = '';
      states.forEach(state => {
        if (!processed.has(state.name)) {
          const degree = inDegree.get(state.name) || 0;
          if (degree < minDegree) {
            minDegree = degree;
            minNode = state.name;
          }
        }
      });
      if (minNode) {
        currentLayer.push(minNode);
      }
    }

    layers.push(currentLayer);

    currentLayer.forEach(node => {
      processed.add(node);
      const edges = outEdges.get(node) || [];
      edges.forEach(target => {
        const current = inDegree.get(target) || 0;
        inDegree.set(target, Math.max(0, current - 1));
      });
    });
  }

  // 优化布局：使用更紧凑的网格布局，充分利用屏幕空间
  const nodeWidth = 220;
  const nodeHeight = 180;
  const horizontalSpacing = 350;  // 水平间距
  const verticalSpacing = 250;    // 垂直间距
  const maxNodesPerRow = 3;       // 每行最多节点数

  // 如果层数较多且每层节点较少，尝试使用网格布局
  const totalNodes = states.length;
  const avgNodesPerLayer = totalNodes / layers.length;

  if (layers.length > 4 && avgNodesPerLayer < 2) {
    // 使用网格布局
    let nodeIndex = 0;
    states.forEach(state => {
      const row = Math.floor(nodeIndex / maxNodesPerRow);
      const col = nodeIndex % maxNodesPerRow;
      const x = col * (nodeWidth + horizontalSpacing) - ((maxNodesPerRow - 1) * (nodeWidth + horizontalSpacing)) / 2;
      const y = row * (nodeHeight + verticalSpacing) + 100;
      positions.set(state.name, { x, y });
      nodeIndex++;
    });
  } else {
    // 使用层次布局
    layers.forEach((layer, layerIndex) => {
      const layerWidth = layer.length * nodeWidth + (layer.length - 1) * horizontalSpacing;
      const startX = -layerWidth / 2;

      layer.forEach((nodeName, nodeIndex) => {
        const x = startX + nodeIndex * (nodeWidth + horizontalSpacing) + nodeWidth / 2;
        const y = layerIndex * (nodeHeight + verticalSpacing) + 100;
        positions.set(nodeName, { x, y });
      });
    });
  }

  return positions;
}

// 自定义状态节点组件
function StateNode({ data }: any) {
  const { state, isInitial, isFinal, isCurrent, currentStep, completedSteps = [], onStepClick, onForceTransition, isRunning } = data;
  const isHumanCheckpoint = state.type === 'human-checkpoint';

  return (
    <div
      className={`
        px-3 py-2 rounded-lg border-2 min-w-[200px] transition-all
        ${isCurrent ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 shadow-lg' : isHumanCheckpoint ? 'border-orange-400 bg-orange-50 dark:bg-orange-950' : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800'}
        ${isInitial ? 'ring-2 ring-green-400' : ''}
        ${isFinal ? 'ring-2 ring-red-400' : ''}
      `}
    >
      {/* 添加四个方向的连接点 */}
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />

      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          {isHumanCheckpoint && (
            <span className="material-symbols-outlined text-orange-500" style={{ fontSize: 13 }}>person</span>
          )}
          <div className="font-semibold text-xs">{state.name}</div>
        </div>
        <div className="flex gap-1">
          {isInitial && <Badge variant="outline" className="text-[10px] px-1 py-0 bg-green-100 dark:bg-green-900">初始</Badge>}
          {isFinal && <Badge variant="outline" className="text-[10px] px-1 py-0 bg-red-100 dark:bg-red-900">终止</Badge>}
          {isHumanCheckpoint && <Badge variant="outline" className="text-[10px] px-1 py-0 bg-orange-100 dark:bg-orange-900">人工</Badge>}
          {isCurrent && <Badge className="text-[10px] px-1 py-0 bg-blue-500 text-white">执行中</Badge>}
        </div>
      </div>

      {state.description && (
        <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-1.5 line-clamp-1">
          {state.description}
        </div>
      )}

      {/* 步骤列表 */}
      <div className="space-y-0.5 mt-1.5">
        {(state.steps || []).map((step: any, idx: number) => {
          const isDone = completedSteps.includes(step.name) || completedSteps.includes(`${state.name}-${step.name}`);
          const isRunningStep = currentStep === step.name || currentStep === `${state.name}-${step.name}`;
          return (
            <div
              key={idx}
              onClick={(e) => { e.stopPropagation(); onStepClick?.(step); }}
              className={`
                flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-colors
                ${isRunningStep ? 'bg-blue-500 text-white' : isDone ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'}
              `}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 11 }}>
                {isRunningStep ? 'play_arrow' : isDone ? 'check_circle' : step.role === 'attacker' ? 'swords' : step.role === 'judge' ? 'gavel' : 'shield'}
              </span>
              <span className="truncate flex-1">{step.name}</span>
            </div>
          );
        })}
      </div>

      {/* 人工审查节点：当前状态时显示可选跳转目标 */}
      {isHumanCheckpoint && isCurrent && isRunning && onForceTransition && (
        <div className="mt-1.5 space-y-0.5">
          <div className="text-[10px] text-orange-600 dark:text-orange-400 font-medium mb-0.5">选择下一步：</div>
          {state.transitions && state.transitions.length > 0 ? (
            state.transitions.map((transition: any, idx: number) => (
              <button
                key={idx}
                onClick={(e) => { e.stopPropagation(); onForceTransition(transition.to); }}
                className="w-full text-[10px] px-1.5 py-0.5 rounded border border-orange-300 text-orange-600 hover:bg-orange-100 dark:hover:bg-orange-900/50 transition-colors text-left"
              >
                → {transition.to}
                {transition.label && <span className="text-gray-500 ml-1">({transition.label})</span>}
              </button>
            ))
          ) : (
            <div className="text-[10px] text-gray-500">配置的转移规则为空</div>
          )}
        </div>
      )}

      {/* 强制跳转按钮（仅在运行中且非当前状态时显示，非人工审查节点） */}
      {isRunning && !isCurrent && !isHumanCheckpoint && onForceTransition && (
        <button
          onClick={(e) => { e.stopPropagation(); onForceTransition(state.name); }}
          className="mt-1.5 w-full text-[10px] px-1.5 py-0.5 rounded border border-orange-300 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/30 transition-colors"
        >
          强制跳转到此
        </button>
      )}
    </div>
  );
}

// Supervisor 节点组件
function SupervisorNode({ data }: any) {
  const { currentRound, flowCount } = data;

  return (
    <div className="px-3 py-2 rounded-lg border-2 border-purple-400 bg-purple-50 dark:bg-purple-950 min-w-[180px] shadow-lg">
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />

      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-purple-500" style={{ fontSize: 18 }}>hub</span>
        <div className="font-semibold text-sm text-purple-700 dark:text-purple-300">Supervisor</div>
      </div>
      {currentRound !== undefined && (
        <div className="mt-1 text-xs text-purple-600 dark:text-purple-400">
          第 {currentRound + 1} 轮 · {flowCount} 条记录
        </div>
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  stateNode: StateNode,
  supervisorNode: SupervisorNode,
};

// 根据两个节点的相对位置计算最佳连接点
function calculateHandlePositions(
  sourcePos: { x: number; y: number },
  targetPos: { x: number; y: number }
): { sourceHandle: string; targetHandle: string } {
  const dx = targetPos.x - sourcePos.x;
  const dy = targetPos.y - sourcePos.y;

  // 计算角度，判断主要方向
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  // 根据角度确定连接点
  // -45° 到 45°: 右侧
  // 45° 到 135°: 下方
  // 135° 到 180° 或 -180° 到 -135°: 左侧
  // -135° 到 -45°: 上方

  let sourceHandle = 'right';
  let targetHandle = 'left';

  if (angle >= -45 && angle < 45) {
    // 目标在右侧
    sourceHandle = 'right';
    targetHandle = 'left';
  } else if (angle >= 45 && angle < 135) {
    // 目标在下方
    sourceHandle = 'bottom';
    targetHandle = 'top';
  } else if (angle >= 135 || angle < -135) {
    // 目标在左侧
    sourceHandle = 'left';
    targetHandle = 'right';
  } else {
    // 目标在上方
    sourceHandle = 'top';
    targetHandle = 'bottom';
  }

  return { sourceHandle, targetHandle };
}

// 内部组件，使用 useReactFlow
function StateMachineDiagramInner({
  states,
  onStateClick,
  onStepClick,
  onTransitionClick,
  onForceTransition,
  currentState,
  currentStep,
  completedSteps = [],
  stateHistory = [],
  isRunning = false,
  focusedState,
  supervisorFlow = [],
}: StateMachineDiagramProps) {
  const [showAllEdges, setShowAllEdges] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const { setCenter, fitView: rfFitView } = useReactFlow();
  const initialFitDone = useRef(false);

  // 转换为 ReactFlow 节点
  const initialNodes: Node[] = useMemo(() => {
    // 计算布局 - 强制使用自动布局
    const layoutPositions = calculateNodeLayout(states, true);

    const nodes = states.map((state, index) => {
      const position = layoutPositions.get(state.name) || {
        x: (index % 3) * 400 + 150,
        y: Math.floor(index / 3) * 350 + 150,
      };

      return {
        id: state.name,
        type: 'stateNode',
        position,
        data: {
          state,
          isInitial: state.isInitial,
          isFinal: state.isFinal,
          isCurrent: currentState === state.name,
          currentStep,
          completedSteps,
          onStepClick,
          onForceTransition,
          isRunning,
        },
      };
    });

    // 始终添加内置的人工审查节点
    // 将人工审查节点放在视图最下方，居中显示
    const avgX = nodes.length > 0 ? nodes.reduce((sum, n) => sum + n.position.x, 0) / nodes.length : 500;
    const maxY = nodes.length > 0 ? Math.max(...nodes.map(n => n.position.y)) : 200;

    nodes.push({
      id: '__human_approval__',
      type: 'stateNode',
      position: { x: avgX, y: maxY + 300 }, // 放在最下方，距离其他节点300px
      data: {
        state: {
          name: '人工审查',
          description: '等待人工决策下一步',
          steps: [],
          transitions: states.map(s => ({ to: s.name, condition: {}, priority: 100, label: s.name })),
          type: 'human-checkpoint',
          isInitial: false,
          isFinal: false,
        },
        isInitial: false,
        isFinal: false,
        isCurrent: currentState === '__human_approval__',
        currentStep,
        completedSteps,
        onStepClick,
        onForceTransition,
        isRunning,
      },
    });

    return nodes;
  }, [states, currentState, currentStep, completedSteps, onStepClick, onForceTransition, isRunning, stateHistory, supervisorFlow]);

  // 转换为 ReactFlow 边
  const initialEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = [];
    const edgeSet = new Set<string>(); // 用于去重

    // 获取节点位置映射
    const nodePositions = calculateNodeLayout(states, true);

    // 始终添加人工审查节点的位置（在最下方）
    const avgX = states.length > 0
      ? Array.from(nodePositions.values()).reduce((sum, pos) => sum + pos.x, 0) / nodePositions.size
      : 500;
    const maxY = states.length > 0
      ? Math.max(...Array.from(nodePositions.values()).map(pos => pos.y))
      : 200;
    nodePositions.set('__human_approval__', { x: avgX, y: maxY + 300 });

    // 配置的状态转移边
    for (const state of states) {
      if (!state.transitions || !Array.isArray(state.transitions)) {
        continue;
      }

      for (const transition of state.transitions) {
        const edgeId = `${state.name}-${transition.to}`;

        // 检查是否已经添加过这条边
        if (edgeSet.has(edgeId)) {
          continue;
        }
        edgeSet.add(edgeId);

        // 检查这条边是否在历史记录中
        const historyIndex = stateHistory.findIndex(
          h => h.from === state.name && h.to === transition.to
        );
        const isInHistory = historyIndex !== -1;

        // 检查是否是当前状态的可用转移
        const isCurrentStateTransition = currentState === state.name;

        // 根据边的类型设置不同的样式
        let edgeStyle: any = {};
        let edgeAnimated = false;
        let edgeHidden = false;

        if (isInHistory) {
          // 已执行的边：粗实线，高亮颜色，动画
          edgeStyle = {
            stroke: '#3b82f6',
            strokeWidth: 3,
          };
          edgeAnimated = true;
        } else if (isCurrentStateTransition) {
          // 当前状态可用的转移：中等粗细，正常颜色
          edgeStyle = {
            stroke: '#64748b',
            strokeWidth: 2,
          };
        } else {
          // 其他未使用的转移：细虚线，半透明
          edgeStyle = {
            stroke: '#94a3b8',
            strokeWidth: 1.5,
            strokeDasharray: '4,4',
            opacity: 0.4,
          };
          // 如果不显示所有边，隐藏这些边
          edgeHidden = !showAllEdges;
        }

        // 计算连接点
        const sourcePos = nodePositions.get(state.name);
        const targetPos = nodePositions.get(transition.to);
        let sourceHandle = 'right';
        let targetHandle = 'left';

        if (sourcePos && targetPos) {
          const handles = calculateHandlePositions(sourcePos, targetPos);
          sourceHandle = handles.sourceHandle;
          targetHandle = handles.targetHandle;
        }

        edges.push({
          id: edgeId,
          source: state.name,
          target: transition.to,
          sourceHandle,
          targetHandle,
          label: isInHistory
            ? `${historyIndex + 1}. ${transition.label || getConditionLabel(transition)}`
            : transition.label || getConditionLabel(transition),
          type: 'default',
          animated: edgeAnimated,
          hidden: edgeHidden,
          style: edgeStyle,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: isInHistory ? 20 : 16,
            height: isInHistory ? 20 : 16,
            color: edgeStyle.stroke,
          },
          labelStyle: {
            fontSize: isInHistory ? 11 : 9,
            fontWeight: isInHistory ? 'bold' : 'normal',
            fill: isInHistory ? '#3b82f6' : '#64748b',
            opacity: isInHistory ? 1 : 0.7,
          },
          labelBgStyle: {
            fill: '#ffffff',
            fillOpacity: 0.9,
          },
        });
      }
    }

    // 添加历史中实际发生但不在配置中的转移（如 __origin__ 或其他动态转移）
    for (let i = 0; i < stateHistory.length; i++) {
      const record = stateHistory[i];

      // 跳过 __origin__ 和 __human_approval__ 相关的转移（后面单独处理）
      if (record.from === '__origin__' || record.to === '__human_approval__' || record.from === '__human_approval__') {
        continue;
      }

      const edgeId = `${record.from}-${record.to}`;

      // 如果这条边不在配置的边中，添加它
      if (!edges.find(e => e.id === edgeId)) {
        // 计算连接点
        const sourcePos = nodePositions.get(record.from);
        const targetPos = nodePositions.get(record.to);
        let sourceHandle = 'right';
        let targetHandle = 'left';

        if (sourcePos && targetPos) {
          const handles = calculateHandlePositions(sourcePos, targetPos);
          sourceHandle = handles.sourceHandle;
          targetHandle = handles.targetHandle;
        }

        edges.push({
          id: edgeId,
          source: record.from,
          target: record.to,
          sourceHandle,
          targetHandle,
          label: `${i + 1}. ${record.reason}`,
          type: 'default',
          animated: true,
          hidden: false,
          style: {
            stroke: '#3b82f6',
            strokeWidth: 3,
            strokeDasharray: '5,5',
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 20,
            height: 20,
            color: '#3b82f6',
          },
          labelStyle: {
            fontSize: 11,
            fontWeight: 'bold',
            fill: '#3b82f6',
          },
          labelBgStyle: {
            fill: '#ffffff',
            fillOpacity: 0.9,
          },
        });
      }
    }

    // 添加从需要人工审查的状态到人工审查节点的连线
    for (const state of states) {
      // 检查状态是否需要人工审查（通过 requireHumanApproval 或 humanApproval 字段）
      if ((state as any).requireHumanApproval || (state as any).humanApproval) {
        const edgeId = `${state.name}-__human_approval__`;

        // 避免重复添加
        if (!edgeSet.has(edgeId)) {
          edgeSet.add(edgeId);

          // 计算连接点
          const sourcePos = nodePositions.get(state.name);
          const targetPos = nodePositions.get('__human_approval__');
          let sourceHandle = 'bottom'; // 默认从下方连接到人工审查节点
          let targetHandle = 'top';

          if (sourcePos && targetPos) {
            const handles = calculateHandlePositions(sourcePos, targetPos);
            sourceHandle = handles.sourceHandle;
            targetHandle = handles.targetHandle;
          }

          edges.push({
            id: edgeId,
            source: state.name,
            target: '__human_approval__',
            sourceHandle,
            targetHandle,
            label: '需要人工审查',
            type: 'default',
            animated: false,
            hidden: !showAllEdges,
            style: {
              stroke: '#f97316', // 橙色
              strokeWidth: 2,
              strokeDasharray: '5,5',
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 16,
              height: 16,
              color: '#f97316',
            },
            labelStyle: {
              fontSize: 9,
              fontWeight: 'normal',
              fill: '#f97316',
              opacity: 0.8,
            },
            labelBgStyle: {
              fill: '#ffffff',
              fillOpacity: 0.9,
            },
          });
        }
      }
    }

    return edges;
  }, [states, stateHistory, currentState, showAllEdges, supervisorFlow]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync node data when runtime state changes, without replacing node positions
  useEffect(() => {
    setNodes(prev => {
      if (prev.length !== initialNodes.length) return initialNodes;
      return prev.map((node, i) => {
        const newNode = initialNodes[i];
        if (!newNode || node.id !== newNode.id) return newNode || node;
        // Only update data, keep existing position (user may have dragged)
        return { ...node, data: newNode.data };
      });
    });
    // Only fitView on first render, not on subsequent node updates
    if (!initialFitDone.current) {
      initialFitDone.current = true;
      setTimeout(() => rfFitView({ padding: 0.3, maxZoom: 1.2 }), 50);
    }
  }, [initialNodes, setNodes, rfFitView]);

  // Sync edges when initialEdges changes
  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  // 处理鼠标悬停时显示相关边
  useEffect(() => {
    if (!hoveredNode) return;

    setEdges((eds) =>
      eds.map((edge) => {
        const isRelated = edge.source === hoveredNode || edge.target === hoveredNode;
        const isInHistory = stateHistory.some(
          h => h.from === edge.source && h.to === edge.target
        );

        // 如果是悬停节点相关的边，且原本是隐藏的，临时显示
        if (isRelated && !isInHistory && !showAllEdges) {
          return {
            ...edge,
            hidden: false,
            style: {
              ...edge.style,
              opacity: 0.6,
            },
          };
        }

        return edge;
      })
    );
  }, [hoveredNode, setEdges, stateHistory, showAllEdges]);

  // 当 focusedState 改变时，自动聚焦到对应节点（用于视图跳转，不影响执行状态）
  const prevFocusedState = useRef<string | null>(null);
  useEffect(() => {
    if (focusedState && focusedState !== prevFocusedState.current) {
      prevFocusedState.current = focusedState;
      const targetNode = initialNodes.find(n => n.id === focusedState);
      if (targetNode) {
        setTimeout(() => {
          setCenter(targetNode.position.x, targetNode.position.y, {
            zoom: 1.0,
            duration: 800,
          });
        }, 100);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedState, setCenter]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (onStateClick) {
        onStateClick(node.id);
      }
    },
    [onStateClick]
  );

  const onNodeMouseEnter = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setHoveredNode(node.id);
    },
    []
  );

  const onNodeMouseLeave = useCallback(
    () => {
      setHoveredNode(null);
      // 恢复原始边的状态
      setEdges(initialEdges);
    },
    [setEdges, initialEdges]
  );

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      if (onTransitionClick) {
        onTransitionClick(edge.source, edge.target);
      }
    },
    [onTransitionClick]
  );

  return (
    <div className="w-full h-full bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onEdgeClick={onEdgeClick}
        nodeTypes={nodeTypes}
        defaultViewport={{ x: 0, y: 0, zoom: 0.6 }}
        minZoom={0.2}
        maxZoom={1.5}
        attributionPosition="bottom-left"
      >
        <Controls />
        <Background />

        {/* 切换按钮 */}
        <Panel position="top-right">
          <button
            onClick={() => setShowAllEdges(!showAllEdges)}
            className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 shadow-lg text-xs hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              {showAllEdges ? 'visibility' : 'visibility_off'}
            </span>
            <span>{showAllEdges ? '隐藏未执行路径' : '显示所有路径'}</span>
          </button>
        </Panel>

        {/* 图例 */}
        <Panel position="bottom-right">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 shadow-lg text-xs">
            <div className="font-semibold mb-2">图例</div>
            <div className="space-y-1">
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-blue-500" /><span>当前状态</span></div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full border-2 border-green-400" /><span>初始状态</span></div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full border-2 border-red-400" /><span>终止状态</span></div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full border-2 border-orange-400" /><span>人工检查点</span></div>
              <div className="flex items-center gap-2"><div className="w-8 h-0.5 bg-blue-500" /><span>已执行路径</span></div>
              <div className="flex items-center gap-2"><div className="w-8 h-0.5 bg-gray-500" /><span>当前可用</span></div>
              <div className="flex items-center gap-2"><div className="w-8 h-0.5 bg-gray-400 opacity-40" style={{ borderTop: '1px dashed' }} /><span>未使用路径</span></div>
            </div>
            <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 text-[10px] text-gray-500">
              提示：悬停节点可查看相关路径
            </div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

function getConditionLabel(transition: StateTransition): string {
  const condition = transition.condition;
  const parts: string[] = [];

  if (condition.verdict) {
    parts.push(condition.verdict);
  }

  if (condition.issueTypes && condition.issueTypes.length > 0) {
    parts.push(condition.issueTypes.join(','));
  }

  if (condition.severities && condition.severities.length > 0) {
    parts.push(condition.severities.join(','));
  }

  return parts.length > 0 ? parts.join(' | ') : '默认';
}

// 主组件，用 ReactFlowProvider 包装
export default function StateMachineDiagram(props: StateMachineDiagramProps) {
  return (
    <ReactFlowProvider>
      <StateMachineDiagramInner {...props} />
    </ReactFlowProvider>
  );
}
