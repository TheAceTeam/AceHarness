'use client';

import { useCallback, useMemo, useEffect } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  MarkerType,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import styles from './DesignFlowDiagram.module.css';

interface Step {
  name: string;
  agent: string;
  task: string;
  role?: 'attacker' | 'defender' | 'judge';
  constraints?: string[];
  parallelGroup?: string;
}

interface IterationConfig {
  enabled: boolean;
  maxIterations: number;
  exitCondition: string;
  consecutiveCleanRounds: number;
  escalateToHuman: boolean;
}

interface Phase {
  name: string;
  steps: Step[];
  checkpoint?: { name: string; message: string };
  iteration?: IterationConfig;
}

interface Workflow {
  name: string;
  description?: string;
  phases: Phase[];
}

interface Agent {
  name: string;
  team?: string | null;
}

interface DesignFlowDiagramProps {
  workflow: Workflow;
  agents?: Agent[];
  onUpdateWorkflow: (workflow: Workflow) => void;
  onSelectNode: (type: 'phase' | 'step', phaseIndex: number, stepIndex?: number) => void;
  onAddPhase: (afterIndex: number) => void;
  onAddStep: (phaseIndex: number) => void;
  onAddStepAt: (phaseIndex: number, afterStepIndex: number) => void;
  onDeletePhase: (phaseIndex: number) => void;
  onDeleteStep: (phaseIndex: number, stepIndex: number) => void;
  onMoveStep: (phaseIndex: number, fromIndex: number, toIndex: number) => void;
  onToggleParallel: (phaseIndex: number, stepIndices: number[]) => void;
  onUngroup: (phaseIndex: number, stepIndex: number) => void;
}

export default function DesignFlowDiagram({
  workflow, agents = [], onUpdateWorkflow, onSelectNode,
  onAddPhase, onAddStep, onAddStepAt, onDeletePhase, onDeleteStep,
  onMoveStep, onToggleParallel, onUngroup,
}: DesignFlowDiagramProps) {
  const getAgentTeam = useCallback((agentName: string) => {
    return agents.find((agent) => agent?.name === agentName)?.team || undefined;
  }, [agents]);

  const getTeamColor = useCallback((agentName: string) => {
    const team = getAgentTeam(agentName);
    if (team === 'blue') return 'hsl(var(--flow-attacker))';
    if (team === 'judge') return 'hsl(var(--flow-judge))';
    if (team === 'red') return 'hsl(var(--flow-defender))';
    return 'hsl(var(--flow-node-border))';
  }, [getAgentTeam]);

  const getTeamIcon = useCallback((agentName: string) => {
    const team = getAgentTeam(agentName);
    if (team === 'blue') return 'swords';
    if (team === 'judge') return 'balance';
    if (team === 'red') return 'shield';
    return '';
  }, [getAgentTeam]);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const colGap = 60;
    const checkpointGap = 40;
    const headerY = 0;
    const phaseHeaderH = 50;
    const stepNodeH = 90;
    const stepGap = 24;
    const stepNodeW = 220;
    const stepsStartY = phaseHeaderH + 50;

    // Pre-calculate group heights for checkpoint vertical centering
    const groupHeights: number[] = workflow.phases.map((phase) => {
      if (phase.steps.length === 0) {
        return stepsStartY + 50;
      }

      // Group consecutive steps with same parallelGroup
      let rowCount = 0;
      let i = 0;
      while (i < phase.steps.length) {
        const currentGroup = phase.steps[i].parallelGroup;
        if (currentGroup) {
          // Find all consecutive steps with same parallelGroup
          let j = i;
          while (j < phase.steps.length && phase.steps[j].parallelGroup === currentGroup) {
            j++;
          }
          rowCount++; // parallel group takes 1 row
          i = j;
        } else {
          rowCount++; // sequential step takes 1 row
          i++;
        }
      }

      const lastStepBottom = stepsStartY + (rowCount - 1) * (stepNodeH + stepGap) + stepNodeH;
      return lastStepBottom + 50; // extra space for add-step button
    });

    // Calculate X positions accounting for checkpoints between phases
    const phaseXPositions: number[] = [];
    let currentX = 0;
    workflow.phases.forEach((phase, pi) => {
      phaseXPositions.push(currentX);
      currentX += stepNodeW;
      if (phase.checkpoint) {
        currentX += checkpointGap + 50 + checkpointGap;
      } else {
        currentX += colGap;
      }
    });

    workflow.phases.forEach((phase, pi) => {
      const phaseId = `phase-${pi}`;
      const colX = phaseXPositions[pi];
      const isIterative = phase.iteration?.enabled;

      // Phase header
      nodes.push({
        id: phaseId,
        type: 'default',
        position: { x: colX, y: headerY },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          label: (
            <div className={styles.phaseNode}>
              <div className={styles.phaseNumber}>{pi + 1}</div>
              <div className={styles.phaseName}>{phase.name}</div>
              {isIterative && <div className={styles.iterLabel}><span className="material-symbols-outlined" style={{ fontSize: 14 }}>loop</span> max {phase.iteration!.maxIterations}</div>}
              <div className={styles.actionBtns}>
                <button className={styles.editBtn}
                  onClick={(e) => { e.stopPropagation(); onSelectNode('phase', pi); }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 12 }}>edit</span>
                </button>
                <button className={styles.deleteBtn}
                  onClick={(e) => { e.stopPropagation(); onDeletePhase(pi); }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 12 }}>delete</span>
                </button>
              </div>
            </div>
          ),
          phaseIndex: pi,
        },
        style: {
          background: 'hsl(var(--flow-node-bg))',
          border: isIterative ? '2px solid hsl(var(--primary))' : '2px solid hsl(var(--flow-node-border))',
          borderLeft: isIterative ? '4px solid hsl(var(--primary))' : '4px solid hsl(var(--primary))',
          borderRadius: '6px',
          padding: '10px 14px',
          width: stepNodeW,
          minHeight: 50,
          cursor: 'pointer',
        },
        zIndex: 2,
      });

      // Checkpoint between this phase and next (placed at vertical center of group boxes)
      if (phase.checkpoint && pi < workflow.phases.length - 1) {
        const cpId = `checkpoint-${pi}`;
        const cpX = colX + stepNodeW + checkpointGap;
        const maxGroupH = Math.max(groupHeights[pi], groupHeights[pi + 1] || 0);
        const anchorCenterY = (maxGroupH - 10) / 2; // vertical center of group area

        // Invisible anchor on right edge of current group
        const anchorLeftId = `anchor-left-${pi}`;
        nodes.push({
          id: anchorLeftId,
          type: 'default',
          position: { x: colX + stepNodeW + 10, y: anchorCenterY },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          data: { label: '' },
          style: { width: 1, height: 1, background: 'transparent', border: 'none', padding: 0, opacity: 0 },
          zIndex: 0,
          selectable: false,
          draggable: false,
        });

        // Checkpoint node — offset upward so its vertical center aligns with anchors
        const cpEstimatedH = 82; // approximate rendered height of checkpoint node
        nodes.push({
          id: cpId,
          type: 'default',
          position: { x: cpX, y: anchorCenterY - cpEstimatedH / 2 },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          data: { label: <div className={styles.checkpointNode}><span className="material-symbols-outlined" style={{ fontSize: 14 }}>pan_tool</span> {phase.checkpoint.name}</div> },
          style: {
            background: 'hsl(var(--flow-node-bg))',
            border: '2px solid hsl(var(--flow-warning))',
            borderRadius: '4px',
            padding: '6px 8px',
            width: 50,
            textAlign: 'center' as const,
            lineHeight: '1.4',
            fontSize: '12px',
          },
          zIndex: 2,
        });

        // Invisible anchor on left edge of next group
        const nextColX = phaseXPositions[pi + 1];
        const anchorRightId = `anchor-right-${pi}`;
        nodes.push({
          id: anchorRightId,
          type: 'default',
          position: { x: nextColX - 11, y: anchorCenterY },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          data: { label: '' },
          style: { width: 1, height: 1, background: 'transparent', border: 'none', padding: 0, opacity: 0 },
          zIndex: 0,
          selectable: false,
          draggable: false,
        });

        // Edge: left anchor → checkpoint
        edges.push({
          id: `${anchorLeftId}-${cpId}`,
          source: anchorLeftId, target: cpId,
          type: 'straight',
          style: { stroke: 'hsl(var(--flow-warning))', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--flow-warning))' },
        });
        // Edge: checkpoint → right anchor
        edges.push({
          id: `${cpId}-${anchorRightId}`,
          source: cpId, target: anchorRightId,
          type: 'straight',
          style: { stroke: 'hsl(var(--primary))', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--primary))' },
        });
      } else if (pi < workflow.phases.length - 1 && !phase.checkpoint) {
        edges.push({
          id: `inter-${pi}-${pi + 1}`,
          source: phaseId, target: `phase-${pi + 1}`,
          type: 'smoothstep',
          style: { stroke: 'hsl(var(--primary))', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--primary))' },
        });
      }

      // Steps vertically below header, with parallel group support
      let currentRowIndex = 0;
      let stepI = 0;
      let previousStepIds: string[] = []; // track previous row's step IDs for edges
      const insertBtnH = 22;
      const insertGap = 6;

      while (stepI < phase.steps.length) {
        const currentGroup = phase.steps[stepI].parallelGroup;

        // Insert "+" button between rows (not before the first row)
        if (currentRowIndex > 0) {
          const insertY = stepsStartY + currentRowIndex * (stepNodeH + stepGap) - stepGap / 2 - insertBtnH / 2;
          const insertId = `insert-${pi}-${stepI}`;
          nodes.push({
            id: insertId,
            type: 'default',
            position: { x: colX + stepNodeW / 2 - 11, y: insertY },
            data: {
              label: (
                <div className={styles.insertBtn} style={{ opacity: 0.4 }}
                  onClick={(e) => { e.stopPropagation(); onAddStepAt(pi, stepI - 1); }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>add</span>
                </div>
              ),
            },
            style: { background: 'transparent', border: 'none', padding: 0, width: 22, height: 22 },
            zIndex: 10,
            selectable: false,
            draggable: false,
          });
        }

        if (currentGroup) {
          // Find all consecutive steps with same parallelGroup
          const groupSteps: { step: Step; si: number }[] = [];
          let j = stepI;
          while (j < phase.steps.length && phase.steps[j].parallelGroup === currentGroup) {
            groupSteps.push({ step: phase.steps[j], si: j });
            j++;
          }

          // Render parallel group
          const groupY = stepsStartY + currentRowIndex * (stepNodeH + stepGap);
          const groupStepIds: string[] = [];
          const horizontalGap = 10;
          const totalWidth = groupSteps.length * stepNodeW + (groupSteps.length - 1) * horizontalGap;
          const startX = colX + (stepNodeW - totalWidth) / 2; // center within column

          // Parallel container background
          const containerId = `parallel-container-${pi}-${stepI}`;
          nodes.push({
            id: containerId,
            type: 'default',
            position: { x: startX - 12, y: groupY - 12 },
            data: {
              label: (
                <div style={{
                  position: 'absolute',
                  top: 4,
                  left: 8,
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'hsl(var(--primary))',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}>
                  并行
                  <button className={styles.mergeBtn} title="取消并行分组"
                    onClick={(e) => { e.stopPropagation(); onUngroup(pi, groupSteps[0].si); }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 12 }}>call_split</span>
                  </button>
                </div>
              )
            },
            style: {
              background: 'hsl(var(--primary) / 0.05)',
              border: '2px dashed hsl(var(--primary) / 0.3)',
              borderRadius: '8px',
              width: totalWidth + 24,
              height: stepNodeH + 24,
              pointerEvents: 'none' as const,
            },
            zIndex: 0,
            selectable: false,
            draggable: false,
            connectable: false,
          });

          // Render each step in the parallel group
          groupSteps.forEach(({ step, si }, idx) => {
            const stepId = `step-${pi}-${si}`;
            groupStepIds.push(stepId);
            const stepX = startX + idx * (stepNodeW + horizontalGap);
            const roleColor = getTeamColor(step.agent);
            const roleIcon = getTeamIcon(step.agent);

            nodes.push({
              id: stepId,
              type: 'default',
              position: { x: stepX, y: groupY },
              sourcePosition: Position.Bottom,
              targetPosition: Position.Top,
              data: {
                label: (
                  <div className={styles.stepNode}>
                    <div className={styles.stepHeader}>
                      {roleIcon ? (
                        <span className={styles.roleBadge}>
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{roleIcon}</span>
                        </span>
                      ) : (
                        <span className={styles.stepNumber}>{si + 1}</span>
                      )}
                      <span className={styles.stepName}>{step.name}</span>
                    </div>
                    <div className={styles.stepAgent}>
                      <span className={styles.agentIcon}><span className="material-symbols-outlined" style={{ fontSize: 14 }}>smart_toy</span></span>
                      <span>{step.agent}</span>
                    </div>
                    <div className={styles.actionBtns}>
                      <button className={styles.editBtn}
                        onClick={(e) => { e.stopPropagation(); onSelectNode('step', pi, si); }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 12 }}>edit</span>
                      </button>
                      <button className={styles.deleteBtn}
                        onClick={(e) => { e.stopPropagation(); onDeleteStep(pi, si); }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 12 }}>delete</span>
                      </button>
                    </div>
                  </div>
                ),
                phaseIndex: pi, stepIndex: si,
              },
              style: {
                background: 'hsl(var(--flow-step-bg))',
                border: `2px solid ${roleColor}`,
                borderRadius: '8px',
                padding: '10px',
                width: stepNodeW,
                cursor: 'pointer',
              },
              zIndex: 1,
            });
          });

          // Edges from previous row to all steps in this parallel group
          if (previousStepIds.length > 0) {
            previousStepIds.forEach((prevId) => {
              groupStepIds.forEach((currId) => {
                const step = phase.steps[parseInt(currId.split('-')[2])];
                const roleColor = getTeamColor(step.agent);
                edges.push({
                  id: `${prevId}-${currId}`,
                  source: prevId, target: currId,
                  type: 'smoothstep',
                  style: { stroke: roleColor, strokeWidth: 2 },
                  markerEnd: { type: MarkerType.ArrowClosed, color: roleColor },
                });
              });
            });
          }

          previousStepIds = groupStepIds;
          currentRowIndex++;
          stepI = j;
        } else {
          // Sequential step (no parallelGroup)
          const step = phase.steps[stepI];
          const si = stepI;
          const stepId = `step-${pi}-${si}`;
          const stepY = stepsStartY + currentRowIndex * (stepNodeH + stepGap);
          const roleColor = getTeamColor(step.agent);
          const roleIcon = getTeamIcon(step.agent);
          const canMoveUp = si > 0;
          const canMoveDown = si < phase.steps.length - 1;
          // Can merge with next step if next step exists and is also sequential (or same group)
          const nextStep = phase.steps[si + 1];
          const canMergeDown = !!nextStep;

          nodes.push({
            id: stepId,
            type: 'default',
            position: { x: colX, y: stepY },
            sourcePosition: Position.Bottom,
            targetPosition: Position.Top,
            data: {
              label: (
                <div className={styles.stepNode}>
                  <div className={styles.stepHeader}>
                    {roleIcon ? (
                      <span className={styles.roleBadge}>
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{roleIcon}</span>
                      </span>
                    ) : (
                      <span className={styles.stepNumber}>{si + 1}</span>
                    )}
                    <span className={styles.stepName}>{step.name}</span>
                  </div>
                  <div className={styles.stepAgent}>
                    <span className={styles.agentIcon}><span className="material-symbols-outlined" style={{ fontSize: 14 }}>smart_toy</span></span>
                    <span>{step.agent}</span>
                  </div>
                  <div className={styles.actionBtns}>
                    {canMoveUp && <button className={styles.moveBtn} title="上移"
                      onClick={(e) => { e.stopPropagation(); onMoveStep(pi, si, si - 1); }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 12 }}>arrow_upward</span>
                    </button>}
                    {canMoveDown && <button className={styles.moveBtn} title="下移"
                      onClick={(e) => { e.stopPropagation(); onMoveStep(pi, si, si + 1); }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 12 }}>arrow_downward</span>
                    </button>}
                    {canMergeDown && <button className={styles.mergeBtn} title="与下一步并行"
                      onClick={(e) => { e.stopPropagation(); onToggleParallel(pi, [si, si + 1]); }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 12 }}>call_merge</span>
                    </button>}
                    <button className={styles.editBtn}
                      onClick={(e) => { e.stopPropagation(); onSelectNode('step', pi, si); }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 12 }}>edit</span>
                    </button>
                    <button className={styles.deleteBtn}
                      onClick={(e) => { e.stopPropagation(); onDeleteStep(pi, si); }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 12 }}>delete</span>
                    </button>
                  </div>
                </div>
              ),
              phaseIndex: pi, stepIndex: si,
            },
            style: {
              background: 'hsl(var(--flow-step-bg))',
              border: `2px solid ${roleColor}`,
              borderRadius: '8px',
              padding: '10px',
              width: stepNodeW,
              cursor: 'pointer',
            },
            zIndex: 1,
          });

          // Edge from previous row
          if (previousStepIds.length > 0) {
            previousStepIds.forEach((prevId) => {
              edges.push({
                id: `${prevId}-${stepId}`,
                source: prevId, target: stepId,
                type: 'smoothstep',
                style: { stroke: roleColor, strokeWidth: 2 },
                markerEnd: { type: MarkerType.ArrowClosed, color: roleColor },
              });
            });
          }

          previousStepIds = [stepId];
          currentRowIndex++;
          stepI++;
        }
      }

      // Add-step button below the last step in this phase
      const addStepId = `add-step-${pi}`;
      const addStepY = stepsStartY + currentRowIndex * (stepNodeH + stepGap);
      nodes.push({
        id: addStepId,
        type: 'default',
        position: { x: colX + stepNodeW / 2 - 15, y: addStepY },
        data: {
          label: (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); onAddStep(pi); }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
            </div>
          ),
        },
        style: {
          background: 'hsl(var(--muted))',
          border: '1px dashed hsl(var(--border))',
          borderRadius: '50%',
          width: 30,
          height: 30,
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        },
        zIndex: 5,
        selectable: false,
        draggable: false,
      });

      // Add-phase button between this phase and the next (or after the last phase)
      if (pi < workflow.phases.length - 1) {
        const addPhaseId = `add-phase-${pi}`;
        nodes.push({
          id: addPhaseId,
          type: 'default',
          position: { x: colX + stepNodeW + (phase.checkpoint ? checkpointGap + 50 + checkpointGap : colGap) / 2 - 15, y: headerY + 10 },
          data: {
            label: (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); onAddPhase(pi); }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
              </div>
            ),
          },
          style: {
            background: 'hsl(var(--primary))',
            color: 'white',
            border: 'none',
            borderRadius: '50%',
            width: 30,
            height: 30,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            opacity: 0.7,
          },
          zIndex: 10,
          selectable: false,
          draggable: false,
        });
      }

      // Group background box for this phase column
      const groupHeight = groupHeights[pi];
      nodes.push({
        id: `group-${pi}`,
        type: 'default',
        position: { x: colX - 10, y: headerY - 10 },
        data: { label: '' },
        style: {
          background: 'hsl(var(--flow-group-bg))',
          border: '1px dashed hsl(var(--flow-group-border))',
          borderRadius: '10px',
          width: stepNodeW + 20,
          height: groupHeight,
          pointerEvents: 'none' as const,
        },
        zIndex: -1,
        selectable: false,
        draggable: false,
        connectable: false,
      });
    });

    // Add-phase button after the last phase
    if (workflow.phases.length > 0) {
      const lastPi = workflow.phases.length - 1;
      const lastPhase = workflow.phases[lastPi];
      const lastColX = phaseXPositions[lastPi];
      const afterLastX = lastColX + stepNodeW + (lastPhase.checkpoint ? checkpointGap + 50 + checkpointGap : colGap) / 2 - 15;
      const addPhaseLastId = `add-phase-${lastPi}`;
      nodes.push({
        id: addPhaseLastId,
        type: 'default',
        position: { x: afterLastX, y: headerY + 10 },
        data: {
          label: (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); onAddPhase(lastPi); }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
            </div>
          ),
        },
        style: {
          background: 'hsl(var(--primary))',
          color: 'white',
          border: 'none',
          borderRadius: '50%',
          width: 30,
          height: 30,
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          opacity: 0.7,
        },
        zIndex: 10,
        selectable: false,
        draggable: false,
      });
    }

    return { nodes, edges };
  }, [workflow, getTeamColor, getTeamIcon, onSelectNode, onAddPhase, onAddStep, onAddStepAt, onDeletePhase, onDeleteStep, onMoveStep, onToggleParallel, onUngroup]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (node.data.stepIndex !== undefined) {
        onSelectNode('step', node.data.phaseIndex, node.data.stepIndex);
      } else if (node.data.phaseIndex !== undefined) {
        onSelectNode('phase', node.data.phaseIndex);
      }
    },
    [onSelectNode]
  );

  return (
    <div className={styles.flowContainer}>
      <ReactFlow
        nodes={nodes} edges={edges}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onConnect={onConnect} onNodeClick={onNodeClick}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView={false}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        fitViewOptions={{ padding: 0.2 }}
        disableKeyboardA11y
        proOptions={{ hideAttribution: true }}
        attributionPosition="bottom-left"
      >
        <Background color="hsl(var(--flow-node-border))" gap={16} />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            if (node.id.startsWith('phase')) return 'hsl(var(--primary))';
            if (node.id.startsWith('group')) return 'hsl(var(--primary) / 0.2)';
            if (node.id.startsWith('checkpoint')) return 'hsl(var(--flow-warning))';
            return 'hsl(var(--flow-step-bg))';
          }}
          maskColor="hsl(var(--background) / 0.6)"
        />
      </ReactFlow>
    </div>
  );
}
