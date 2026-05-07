import type { EngineType } from '@/lib/engines/engine-factory'

export interface EngineMeta {
  id: EngineType
  name: string
  iconPath: string
}

export const ENGINE_META: Record<EngineType, EngineMeta> = {
  'claude-code': {
    id: 'claude-code',
    name: 'Claude Code',
    iconPath: '/engines/claude.svg',
  },
  'kiro-cli': {
    id: 'kiro-cli',
    name: 'Kiro CLI',
    iconPath: '/engines/kiro.svg',
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    iconPath: '/engines/opencode.svg',
  },
  nga: {
    id: 'nga',
    name: 'NGA',
    iconPath: '/engines/opencode.svg',
  },
  codegenie: {
    id: 'codegenie',
    name: 'CodeGenie',
    iconPath: '/engines/opencode.svg',
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    iconPath: '/engines/codex.svg',
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor CLI',
    iconPath: '/engines/cursor.svg',
  },
  'cangjie-magic': {
    id: 'cangjie-magic',
    name: 'CangjieMagic',
    iconPath: '/engines/cangjie_magic.png',
  },
  'trae-cli': {
    id: 'trae-cli',
    name: 'Trae CLI',
    iconPath: '/engines/trae.svg',
  },
}

export const CONCRETE_ENGINE_IDS = Object.keys(ENGINE_META) as EngineType[]

export function getConcreteEngines(): EngineMeta[] {
  return CONCRETE_ENGINE_IDS.map((id) => ENGINE_META[id])
}

export function getEngineMeta(id: string): EngineMeta | undefined {
  return ENGINE_META[id as EngineType]
}

export function getEngineDisplayName(id?: string): string {
  if (!id) return ''
  return getEngineMeta(id)?.name || id
}
