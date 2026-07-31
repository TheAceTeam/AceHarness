export const AI_WORKFLOW_CREATOR_ACTION = '__HOME_ACTION__:create_workflow';
export const AI_WORKFLOW_CREATOR_COMPAT_ACTION = '__HOME_ACTION__:ai-workflow-creator';
export const CODESPEC_WORKFLOW_CREATOR_ACTION = '__HOME_ACTION__:create_workflow_from_codespec';
export const AI_WORKFLOW_CREATOR_STARTER_ACTION = 'create_workflow';
export const AI_WORKFLOW_CREATOR_COMPAT_STARTER_ACTION = 'ai-workflow-creator';
export const DEFAULT_AI_WORKFLOW_REQUIREMENTS = '我想围绕【目标】创建一个轻量工作流，工作目录是【路径】，请先帮我梳理任务目标、执行 Agent 和验收条件。';
export const CODESPEC_WORKFLOW_CREATOR_REQUIREMENTS = '请结合当前工作目录中的 Codespec 文档，整理目标、执行 Agent、任务清单和验收条件，创建一个轻量任务清单工作流。';
export const DEFAULT_AI_WORKFLOW_DESCRIPTION = '通过任务清单动态拆分、调度与验收的协作执行。';

const WORKFLOW_TERM = /(?:工作流|workflow)/iu;
const CREATE_TERM = /(?:创建|新建|生成|搭建|设计|编排|制作|做|create|build|design|set\s*up)/iu;
const NEGATED_CREATE_REQUEST = /(?:不要|别|无需|不需要|不必|不想|禁止|don't|do\s+not)\s*(?:创建|新建|生成|搭建|设计|编排|制作|做|create|build|design|set\s*up)?[^\n。！？!?]{0,12}(?:工作流|workflow)/iu;

export type AiWorkflowCreatorConversationContext = {
  creationAssistantEnabled?: boolean;
  sessionCreationAssistantEnabled?: boolean;
  hasWorkflowBinding?: boolean;
  hasAgentBinding?: boolean;
  hasCollaboration?: boolean;
};

export function isAiWorkflowCreatorAction(input: unknown): boolean {
  return input === AI_WORKFLOW_CREATOR_ACTION || input === AI_WORKFLOW_CREATOR_COMPAT_ACTION;
}

export function isCodespecWorkflowCreatorAction(input: unknown): boolean {
  return input === CODESPEC_WORKFLOW_CREATOR_ACTION;
}

export function isAiWorkflowCreatorStarterAction(input: unknown): boolean {
  return input === AI_WORKFLOW_CREATOR_STARTER_ACTION || input === AI_WORKFLOW_CREATOR_COMPAT_STARTER_ACTION;
}

/** 判断首页普通对话是否明确要求进入工作流创建 UI。 */
export function looksLikeAiWorkflowCreationRequest(input: unknown): boolean {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text || !WORKFLOW_TERM.test(text) || !CREATE_TERM.test(text)) return false;
  return !NEGATED_CREATE_REQUEST.test(text);
}

/** 首页普通对话只在可创建的空闲会话中接管明确的创建请求。 */
export function shouldOpenAiWorkflowCreatorFromConversation(
  input: unknown,
  context: AiWorkflowCreatorConversationContext,
): boolean {
  if (context.creationAssistantEnabled === false) return false;
  if (context.sessionCreationAssistantEnabled === false) return false;
  if (context.hasWorkflowBinding || context.hasAgentBinding || context.hasCollaboration) return false;
  return looksLikeAiWorkflowCreationRequest(input);
}
