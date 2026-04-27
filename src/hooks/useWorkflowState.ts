'use client';

import { useReducer, useCallback } from 'react';

interface Agent {
  name: string;
  team: string;
  model: string;
  status: 'waiting' | 'running' | 'completed' | 'failed';
  currentTask: string | null;
  completedTasks: number;
  sessionId?: string | null;
  output?: string;
  tokenUsage?: { inputTokens: number; outputTokens: number };
  iterationCount?: number;
  summary?: string;
  changes?: { file: string; action: 'created' | 'modified' | 'deleted'; description: string }[];
}

interface Log {
  agent: string;
  level: string;
  message: string;
  time: string;
}

interface IterationStateInfo {
  phaseName: string;
  currentIteration: number;
  maxIterations: number;
  consecutiveClean: number;
  status: string;
}

export type ViewMode = 'run' | 'design' | 'history';

export interface WorkflowState {
  viewMode: ViewMode;
  workflowConfig: any;
  editingConfig: any;
  agentConfigs: any[];
  workflowStatus: string;
  runId: string | null;
  currentPhase: string;
  currentStep: string;
  agents: Agent[];
  logs: Log[];
  completedSteps: string[];
  failedSteps: string[];
  stepResults: Record<string, { output: string; error?: string; costUsd?: number; durationMs?: number; startTime?: string; endTime?: string }>;
  stepIdMap: Record<string, string>; // stepName → latest stepId (UUID)
  showCheckpoint: boolean;
  checkpointMessage: string;
  checkpointIsIterative: boolean;
  activeTab: string;
  selectedAgent: Agent | null;
  selectedStep: any | null;
  projectRoot: string;
  workingDirectory: string | null;
  workspaceMode: 'isolated-copy' | 'in-place';
  requirements: string;
  timeoutMinutes: number;
  engine: string;
  skills: string[];
  showProcessPanel: boolean;
  showEditNodeModal: boolean;
  editingNode: { type: 'phase' | 'step'; phaseIndex: number; stepIndex?: number } | null;
  iterationStates: Record<string, IterationStateInfo>;
  globalContext: string;
  phaseContexts: Record<string, string>;
}

type WorkflowAction =
  | { type: 'SET_VIEW_MODE'; payload: ViewMode }
  | { type: 'SET_WORKFLOW_CONFIG'; payload: any }
  | { type: 'SET_EDITING_CONFIG'; payload: any }
  | { type: 'SET_WORKFLOW_STATUS'; payload: string }
  | { type: 'SET_RUN_ID'; payload: string | null }
  | { type: 'SET_CURRENT_PHASE'; payload: string }
  | { type: 'SET_CURRENT_STEP'; payload: string }
  | { type: 'SET_AGENTS'; payload: Agent[] }
  | { type: 'ADD_LOG'; payload: Log }
  | { type: 'CLEAR_AGENT_LOGS'; payload: string }
  | { type: 'SET_COMPLETED_STEPS'; payload: string[] }
  | { type: 'ADD_COMPLETED_STEP'; payload: string }
  | { type: 'SET_FAILED_STEPS'; payload: string[] }
  | { type: 'ADD_FAILED_STEP'; payload: string }
  | { type: 'SET_STEP_RESULT'; payload: { step: string; result: { output: string; error?: string; costUsd?: number; durationMs?: number } } }
  | { type: 'SET_STEP_RESULTS'; payload: Record<string, { output: string; error?: string; costUsd?: number; durationMs?: number }> }
  | { type: 'MERGE_STEP_RESULTS'; payload: Record<string, { output: string; error?: string; costUsd?: number; durationMs?: number }> }
  | { type: 'SET_STEP_ID_MAP'; payload: Record<string, string> }
  | { type: 'MERGE_STEP_ID_MAP'; payload: Record<string, string> }
  | { type: 'MAP_STEP_ID'; payload: { stepName: string; stepId: string } }
  | { type: 'SET_SHOW_CHECKPOINT'; payload: boolean }
  | { type: 'SET_CHECKPOINT_MESSAGE'; payload: string }
  | { type: 'SET_CHECKPOINT_IS_ITERATIVE'; payload: boolean }
  | { type: 'SET_ACTIVE_TAB'; payload: string }
  | { type: 'SET_SELECTED_AGENT'; payload: Agent | null }
  | { type: 'SET_SELECTED_STEP'; payload: any | null }
  | { type: 'SET_PROJECT_ROOT'; payload: string }
  | { type: 'SET_WORKSPACE_MODE'; payload: 'isolated-copy' | 'in-place' }
  | { type: 'SET_REQUIREMENTS'; payload: string }
  | { type: 'SET_TIMEOUT_MINUTES'; payload: number }
  | { type: 'SET_ENGINE'; payload: string }
  | { type: 'SET_SKILLS'; payload: string[] }
  | { type: 'SET_SHOW_PROCESS_PANEL'; payload: boolean }
  | { type: 'SET_SHOW_EDIT_NODE_MODAL'; payload: boolean }
  | { type: 'SET_EDITING_NODE'; payload: WorkflowState['editingNode'] }
  | { type: 'SET_AGENTS_CONFIG'; payload: any[] }
  | { type: 'SET_ITERATION_STATE'; payload: { phase: string; state: IterationStateInfo } }
  | { type: 'UPDATE_AGENT_TOKEN_USAGE'; payload: { agent: string; usage: { inputTokens: number; outputTokens: number } } }
  | { type: 'SET_GLOBAL_CONTEXT'; payload: string }
  | { type: 'SET_PHASE_CONTEXT'; payload: { phase: string; context: string } }
  | { type: 'SET_PHASE_CONTEXTS'; payload: Record<string, string> }
  | { type: 'SET_WORKING_DIRECTORY'; payload: string | null }
  | { type: 'RESET_RUN' };

function createInitialState(initialViewMode: ViewMode = 'run'): WorkflowState {
  return {
    viewMode: initialViewMode,
    workflowConfig: null,
    editingConfig: null,
    agentConfigs: [],
    workflowStatus: 'idle',
    runId: null,
    currentPhase: '',
    currentStep: '',
    agents: [],
    logs: [],
    completedSteps: [],
    failedSteps: [],
    stepResults: {},
    stepIdMap: {},
    showCheckpoint: false,
    checkpointMessage: '',
    checkpointIsIterative: false,
    activeTab: 'workflow',
    selectedAgent: null,
    selectedStep: null,
    projectRoot: '',
    workingDirectory: null,
    workspaceMode: 'isolated-copy',
    requirements: '',
    timeoutMinutes: 30,
    engine: '',
    skills: [],
    showProcessPanel: false,
    showEditNodeModal: false,
    editingNode: null,
    iterationStates: {},
    globalContext: '',
    phaseContexts: {},
  };
}

function workflowReducer(state: WorkflowState, action: WorkflowAction): WorkflowState {
  switch (action.type) {
    case 'SET_VIEW_MODE': return { ...state, viewMode: action.payload };
    case 'SET_WORKFLOW_CONFIG': return { ...state, workflowConfig: action.payload };
    case 'SET_EDITING_CONFIG': return { ...state, editingConfig: action.payload };
    case 'SET_WORKFLOW_STATUS': return { ...state, workflowStatus: action.payload };
    case 'SET_RUN_ID': return { ...state, runId: action.payload };
    case 'SET_CURRENT_PHASE': return { ...state, currentPhase: action.payload };
    case 'SET_CURRENT_STEP': return { ...state, currentStep: action.payload };
    case 'SET_AGENTS': return { ...state, agents: action.payload };
    case 'ADD_LOG': return { ...state, logs: [...state.logs, action.payload] };
    case 'CLEAR_AGENT_LOGS': return { ...state, logs: state.logs.filter((l) => l.agent !== action.payload) };
    case 'SET_COMPLETED_STEPS': return { ...state, completedSteps: action.payload };
    case 'ADD_COMPLETED_STEP': return { ...state, completedSteps: [...state.completedSteps, action.payload] };
    case 'SET_FAILED_STEPS': return { ...state, failedSteps: action.payload };
    case 'ADD_FAILED_STEP': return { ...state, failedSteps: [...state.failedSteps, action.payload] };
    case 'SET_STEP_RESULT': return { ...state, stepResults: { ...state.stepResults, [action.payload.step]: action.payload.result } };
    case 'SET_STEP_RESULTS': return { ...state, stepResults: action.payload };
    case 'MERGE_STEP_RESULTS': return { ...state, stepResults: { ...state.stepResults, ...action.payload } };
    case 'SET_STEP_ID_MAP': return { ...state, stepIdMap: action.payload };
    case 'MERGE_STEP_ID_MAP': return { ...state, stepIdMap: { ...state.stepIdMap, ...action.payload } };
    case 'MAP_STEP_ID': return { ...state, stepIdMap: { ...state.stepIdMap, [action.payload.stepName]: action.payload.stepId } };
    case 'SET_SHOW_CHECKPOINT': return { ...state, showCheckpoint: action.payload };
    case 'SET_CHECKPOINT_MESSAGE': return { ...state, checkpointMessage: action.payload };
    case 'SET_CHECKPOINT_IS_ITERATIVE': return { ...state, checkpointIsIterative: action.payload };
    case 'SET_ACTIVE_TAB': return { ...state, activeTab: action.payload };
    case 'SET_SELECTED_AGENT': return { ...state, selectedAgent: action.payload };
    case 'SET_SELECTED_STEP': return { ...state, selectedStep: action.payload };
    case 'SET_PROJECT_ROOT': return { ...state, projectRoot: action.payload };
    case 'SET_WORKSPACE_MODE': return { ...state, workspaceMode: action.payload };
    case 'SET_REQUIREMENTS': return { ...state, requirements: action.payload };
    case 'SET_TIMEOUT_MINUTES': return { ...state, timeoutMinutes: action.payload };
    case 'SET_ENGINE': return { ...state, engine: action.payload };
    case 'SET_SKILLS': return { ...state, skills: action.payload };
    case 'SET_SHOW_PROCESS_PANEL': return { ...state, showProcessPanel: action.payload };
    case 'SET_SHOW_EDIT_NODE_MODAL': return { ...state, showEditNodeModal: action.payload };
    case 'SET_EDITING_NODE': return { ...state, editingNode: action.payload };
    case 'SET_AGENTS_CONFIG': return { ...state, agentConfigs: action.payload };
    case 'SET_ITERATION_STATE':
      return { ...state, iterationStates: { ...state.iterationStates, [action.payload.phase]: action.payload.state } };
    case 'UPDATE_AGENT_TOKEN_USAGE': {
      const agents = state.agents.map((a) => {
        if (a.name === action.payload.agent) {
          return {
            ...a,
            tokenUsage: {
              inputTokens: (a.tokenUsage?.inputTokens || 0) + action.payload.usage.inputTokens,
              outputTokens: (a.tokenUsage?.outputTokens || 0) + action.payload.usage.outputTokens,
            },
          };
        }
        return a;
      });
      return { ...state, agents };
    }
    case 'RESET_RUN':
      return { ...state, runId: null, logs: [], completedSteps: [], failedSteps: [], stepResults: {}, stepIdMap: {}, iterationStates: {}, workingDirectory: null };
    case 'SET_GLOBAL_CONTEXT':
      return { ...state, globalContext: action.payload };
    case 'SET_PHASE_CONTEXT':
      return { ...state, phaseContexts: { ...state.phaseContexts, [action.payload.phase]: action.payload.context } };
    case 'SET_PHASE_CONTEXTS':
      return { ...state, phaseContexts: action.payload };
    case 'SET_WORKING_DIRECTORY':
      return { ...state, workingDirectory: action.payload };
    default:
      return state;
  }
}

export function useWorkflowState(initialViewMode: ViewMode = 'run') {
  const [state, dispatch] = useReducer(workflowReducer, initialViewMode, createInitialState);

  const addLog = useCallback((agent: string, level: string, message: string) => {
    dispatch({
      type: 'ADD_LOG',
      payload: { agent, level, message, time: new Date().toLocaleTimeString() },
    });
  }, []);

  return { state, dispatch, addLog };
}

export type { Agent, Log, IterationStateInfo };
