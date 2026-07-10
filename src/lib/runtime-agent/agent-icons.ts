export const ENGINE_ICON_BASE_PATH = '/engines';

export const AGENT_ICON_PATHS = {
  claude: `${ENGINE_ICON_BASE_PATH}/claude.svg`,
  codex: `${ENGINE_ICON_BASE_PATH}/codex.svg`,
  opencode: `${ENGINE_ICON_BASE_PATH}/opencode.svg`,
  cursor: `${ENGINE_ICON_BASE_PATH}/cursor.svg`,
  kiro: `${ENGINE_ICON_BASE_PATH}/kiro.svg`,
  trae: `${ENGINE_ICON_BASE_PATH}/trae.svg`,
  nga: `${ENGINE_ICON_BASE_PATH}/code-agent.svg`,
  codegenie: `${ENGINE_ICON_BASE_PATH}/code-genie.svg`,
  cangjieMagic: `${ENGINE_ICON_BASE_PATH}/magic-cli.svg`,
  pi: `${ENGINE_ICON_BASE_PATH}/pi.svg`,
  openclaw: `${ENGINE_ICON_BASE_PATH}/openclaw.svg`,
  gemini: `${ENGINE_ICON_BASE_PATH}/gemini.svg`,
  copilot: `${ENGINE_ICON_BASE_PATH}/copilot.svg`,
  kilocode: `${ENGINE_ICON_BASE_PATH}/kilocode.svg`,
  kimi: `${ENGINE_ICON_BASE_PATH}/kimi.svg`,
  mux: `${ENGINE_ICON_BASE_PATH}/mux.svg`,
  qoder: `${ENGINE_ICON_BASE_PATH}/qoder.svg`,
  qwen: `${ENGINE_ICON_BASE_PATH}/qwen.svg`,
  genericProvider: `${ENGINE_ICON_BASE_PATH}/code-agent.svg`,
} as const;

export type AgentIconKey = keyof typeof AGENT_ICON_PATHS;

export function isLocalAgentIconPath(iconPath: string): boolean {
  return /^\/engines\/[^/]+\.(svg|png)$/i.test(iconPath);
}
