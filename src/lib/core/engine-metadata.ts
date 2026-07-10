import { AGENT_ICON_PATHS } from '@/lib/runtime-agent/agent-icons'

export type EngineMetadataId =
  | 'claude'
  | 'claude-code'
  | 'claude-code-acp'
  | 'kiro'
  | 'kiro-cli'
  | 'codex'
  | 'cursor'
  | 'opencode'
  | 'opencode-sdk'
  | 'nga'
  | 'nga-sdk'
  | 'codegenie'
  | 'codegenie-sdk'
  | 'trae'
  | 'trae-cli'
  | 'cangjie-magic'
  | 'magic-cli'
  | 'pi'
  | 'openclaw'
  | 'gemini'
  | 'copilot'
  | 'kilocode'
  | 'kimi'
  | 'mux'
  | 'qoder'
  | 'qwen'

export interface EngineMeta {
  id: EngineMetadataId
  name: string
  iconPath: string
}

export const ENGINE_META: Record<EngineMetadataId, EngineMeta> = {
  claude: {
    id: 'claude',
    name: 'Claude',
    iconPath: AGENT_ICON_PATHS.claude,
  },
  'claude-code': {
    id: 'claude-code',
    name: 'Claude Code',
    iconPath: AGENT_ICON_PATHS.claude,
  },
  'claude-code-acp': {
    id: 'claude-code-acp',
    name: 'Claude Code (ACP)',
    iconPath: AGENT_ICON_PATHS.claude,
  },
  kiro: {
    id: 'kiro',
    name: 'Kiro',
    iconPath: AGENT_ICON_PATHS.kiro,
  },
  'kiro-cli': {
    id: 'kiro-cli',
    name: 'Kiro CLI',
    iconPath: AGENT_ICON_PATHS.kiro,
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    iconPath: AGENT_ICON_PATHS.opencode,
  },
  'opencode-sdk': {
    id: 'opencode-sdk',
    name: 'OpenCode (SDK)',
    iconPath: AGENT_ICON_PATHS.opencode,
  },
  nga: {
    id: 'nga',
    name: 'NGA',
    iconPath: AGENT_ICON_PATHS.nga,
  },
  'nga-sdk': {
    id: 'nga-sdk',
    name: 'NGA (SDK)',
    iconPath: AGENT_ICON_PATHS.nga,
  },
  codegenie: {
    id: 'codegenie',
    name: 'CodeGenie',
    iconPath: AGENT_ICON_PATHS.codegenie,
  },
  'codegenie-sdk': {
    id: 'codegenie-sdk',
    name: 'CodeGenie (SDK)',
    iconPath: AGENT_ICON_PATHS.codegenie,
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    iconPath: AGENT_ICON_PATHS.codex,
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor CLI',
    iconPath: AGENT_ICON_PATHS.cursor,
  },
  trae: {
    id: 'trae',
    name: 'Trae',
    iconPath: AGENT_ICON_PATHS.trae,
  },
  'trae-cli': {
    id: 'trae-cli',
    name: 'Trae CLI',
    iconPath: AGENT_ICON_PATHS.trae,
  },
  'cangjie-magic': {
    id: 'cangjie-magic',
    name: 'Cangjie Magic',
    iconPath: AGENT_ICON_PATHS.cangjieMagic,
  },
  'magic-cli': {
    id: 'magic-cli',
    name: 'Magic CLI',
    iconPath: AGENT_ICON_PATHS.cangjieMagic,
  },
  pi: {
    id: 'pi',
    name: 'Pi',
    iconPath: AGENT_ICON_PATHS.pi,
  },
  openclaw: {
    id: 'openclaw',
    name: 'OpenClaw',
    iconPath: AGENT_ICON_PATHS.openclaw,
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    iconPath: AGENT_ICON_PATHS.gemini,
  },
  copilot: {
    id: 'copilot',
    name: 'Copilot',
    iconPath: AGENT_ICON_PATHS.copilot,
  },
  kilocode: {
    id: 'kilocode',
    name: 'Kilo Code',
    iconPath: AGENT_ICON_PATHS.kilocode,
  },
  kimi: {
    id: 'kimi',
    name: 'Kimi',
    iconPath: AGENT_ICON_PATHS.kimi,
  },
  mux: {
    id: 'mux',
    name: 'Mux',
    iconPath: AGENT_ICON_PATHS.mux,
  },
  qoder: {
    id: 'qoder',
    name: 'Qoder',
    iconPath: AGENT_ICON_PATHS.qoder,
  },
  qwen: {
    id: 'qwen',
    name: 'Qwen',
    iconPath: AGENT_ICON_PATHS.qwen,
  },
}

export const CONCRETE_ENGINE_IDS = Object.keys(ENGINE_META) as EngineMetadataId[]

export function getConcreteEngines(): EngineMeta[] {
  return CONCRETE_ENGINE_IDS.map((id) => ENGINE_META[id])
}

export function getEngineMeta(id: string): EngineMeta | undefined {
  return ENGINE_META[id as EngineMetadataId]
}

export function getEngineDisplayName(id?: string): string {
  if (!id) return ''
  return getEngineMeta(id)?.name || id
}
