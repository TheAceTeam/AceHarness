export type AvatarSpriteSheetId = 'group1' | (string & {});

export type AvatarCategoryId =
  | 'all'
  | 'animals'
  | 'plants-nature'
  | 'modern-careers'
  | 'academics-engineers'
  | 'user-default'
  | 'agent-default';

export type AvatarSpriteEntry = {
  sheetId: AvatarSpriteSheetId;
  index: number;
};

export type AvatarSpriteFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  row: number;
  col: number;
};

export type AvatarSpriteSheet = {
  id: AvatarSpriteSheetId;
  src: string;
  label: string;
  width: number;
  height: number;
  rows: number;
  cols: number;
  cell: number;
  gap: number;
  margin: number;
};

export type AvatarCategory = {
  id: AvatarCategoryId;
  label: string;
  description?: string;
  entries: AvatarSpriteEntry[];
  picker?: boolean;
};

export type ResolvedAvatarSource =
  | {
      kind: 'sprite';
      value: string;
      sheet: AvatarSpriteSheet;
      sheetId: AvatarSpriteSheetId;
      index: number;
      frame: AvatarSpriteFrame;
    }
  | {
      kind: 'image';
      src: string;
    }
  | {
      kind: 'none';
    };

export const AVATAR_SPRITE_SHEETS: Record<AvatarSpriteSheetId, AvatarSpriteSheet> = {
  group1: {
    id: 'group1',
    src: '/avatars/group1.png',
    label: '基础头像 1',
    width: 2880,
    height: 2880,
    rows: 10,
    cols: 10,
    cell: 256,
    gap: 16,
    margin: 88,
  },
};

const group1 = (start: number, end: number): AvatarSpriteEntry[] => {
  const entries: AvatarSpriteEntry[] = [];
  for (let index = start; index <= end; index += 1) {
    entries.push({ sheetId: 'group1', index });
  }
  return entries;
};

const MODERN_CAREER_AVATARS = group1(50, 79);
const ACADEMIC_ENGINEER_AVATARS = group1(80, 99);
const PERSON_AVATARS = [...MODERN_CAREER_AVATARS, ...ACADEMIC_ENGINEER_AVATARS];

export const AVATAR_CATEGORIES: AvatarCategory[] = [
  {
    id: 'animals',
    label: '动物',
    description: '狗、兔子、鹿、大象、猫、熊猫等',
    entries: group1(0, 29),
    picker: true,
  },
  {
    id: 'plants-nature',
    label: '植物自然',
    description: '植物精灵、云朵、水滴、星月雪火等',
    entries: group1(30, 49),
    picker: true,
  },
  {
    id: 'modern-careers',
    label: '现代职业',
    description: '程序员、设计师、医生、教师、管理者等',
    entries: MODERN_CAREER_AVATARS,
    picker: true,
  },
  {
    id: 'academics-engineers',
    label: '学者工程师',
    description: '学者、研究员、工程师与技术专家',
    entries: ACADEMIC_ENGINEER_AVATARS,
    picker: true,
  },
  {
    id: 'user-default',
    label: '用户默认',
    entries: PERSON_AVATARS,
  },
  {
    id: 'agent-default',
    label: 'Agent 默认',
    entries: PERSON_AVATARS,
  },
  {
    id: 'all',
    label: '全部',
    entries: group1(0, 99),
  },
];

export const AVATAR_PICKER_CATEGORIES = AVATAR_CATEGORIES.filter((category) => category.picker);

export const DEFAULT_USER_AVATAR_CATEGORY: AvatarCategoryId = 'user-default';
export const DEFAULT_AGENT_AVATAR_CATEGORY: AvatarCategoryId = 'agent-default';

const GROUP1_AVATAR_NAMES = [
  '狗', '兔子', '鹿', '大象', '狮子',
  '狐獴', '斑马', '老虎', '小鸟', '熊猫',
  '河马', '猫头鹰', '企鹅', '松鼠', '树懒',
  '猫', '美西螈', '猴子', '长颈鹿', '狐狸',
  '水獭', '考拉', '熊', '刺猬', '九色鹿',
  '小浣熊', '小羊驼', '小海豹', '小仓鼠', '小柴犬',
  '向日葵精灵', '玫瑰精灵', '荷花精灵', '竹子精灵', '松树精灵',
  '蘑菇精灵', '仙人掌精灵', '银杏叶精灵', '枫叶精灵', '藤蔓精灵',
  '小草精灵', '樱花精灵', '兰花精灵', '海藻精灵', '水滴精灵',
  '云朵精灵', '星星精灵', '月亮精灵', '雪花精灵', '火焰精灵',
  '程序员', '产品经理', '设计师', '测试工程师', '运维工程师',
  '数据分析师', '安全工程师', '医生', '护士', '教师',
  '律师', '记者', '摄影师', '厨师', '建筑师',
  '飞行员', '科研人员', '消防员', '警探', '心理咨询师',
  '音乐制作人', '插画师', '财务顾问', '项目经理', '创业者',
  '编辑', '翻译', '咨询顾问', '运营经理', '数据产品经理',
  '数学家', '物理学家', '化学家', '生物学家', '天文学家',
  '语言学家', '历史学家', '哲学家', '图书管理员', '档案研究员',
  '机械工程师', '电气工程师', '土木工程师', '航天工程师', 'AI 研究员',
  '密码学家', '编译器工程师', '数据库专家', '网络工程师', '硬件工程师',
] as const;

const LEGACY_AVATAR_INDEX: Record<string, number> = {
  dog: 0,
  rabbit: 1,
  deer: 2,
  elephant: 3,
  lion: 4,
  suricate_suricatta: 5,
  suricate: 5,
  meerkat: 5,
  zebra: 6,
  tiger: 7,
  bird: 8,
  panda: 9,
  hippo: 10,
  owl: 11,
  penguin: 12,
  squirrel: 13,
  sloth: 14,
  cat: 15,
  axolotl: 16,
  monkey: 17,
  giraffe: 18,
  fox: 19,
  otter: 20,
  koala: 21,
  bear: 22,
  hedgehog: 23,
};

const SPRITE_VALUE_PREFIX = 'sprite:';

export function buildSpriteAvatarValue(sheetId: AvatarSpriteSheetId, index: number): string {
  return `${SPRITE_VALUE_PREFIX}${sheetId}:${index}`;
}

export function getAvatarCategory(id: AvatarCategoryId | string | undefined): AvatarCategory {
  return AVATAR_CATEGORIES.find((category) => category.id === id)
    || AVATAR_CATEGORIES.find((category) => category.id === 'all')!;
}

export function getAvatarSpriteSheet(sheetId: AvatarSpriteSheetId | string | undefined): AvatarSpriteSheet {
  return AVATAR_SPRITE_SHEETS[sheetId || 'group1'] || AVATAR_SPRITE_SHEETS.group1;
}

export function getAvatarSpriteFrame(sheetId: AvatarSpriteSheetId, index: number): AvatarSpriteFrame {
  const sheet = getAvatarSpriteSheet(sheetId);
  const normalizedIndex = normalizeSpriteIndex(index, sheet);
  const row = Math.floor(normalizedIndex / sheet.cols);
  const col = normalizedIndex % sheet.cols;

  return {
    x: sheet.margin + col * (sheet.cell + sheet.gap),
    y: sheet.margin + row * (sheet.cell + sheet.gap),
    width: sheet.cell,
    height: sheet.cell,
    row,
    col,
  };
}

export function stableAvatarHash(seed: string): number {
  let hash = 2166136261;
  const input = seed || 'avatar';
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function pickSpriteAvatar(
  seed: string,
  options?: {
    category?: AvatarCategoryId | string;
    salt?: string;
  },
): AvatarSpriteEntry {
  const category = getAvatarCategory(options?.category || 'all');
  const entries = category.entries.length ? category.entries : getAvatarCategory('all').entries;
  const hash = stableAvatarHash(`${options?.salt || ''}:${seed || 'avatar'}`);
  return entries[hash % entries.length];
}

export function pickSpriteAvatarValue(
  seed: string,
  options?: {
    category?: AvatarCategoryId | string;
    salt?: string;
  },
): string {
  const entry = pickSpriteAvatar(seed, options);
  return buildSpriteAvatarValue(entry.sheetId, entry.index);
}

export function parseSpriteAvatarValue(value: string): AvatarSpriteEntry | null {
  const normalized = value.trim();
  if (!normalized.startsWith(SPRITE_VALUE_PREFIX)) return null;

  const payload = normalized.slice(SPRITE_VALUE_PREFIX.length);
  const parts = payload.split(':').filter(Boolean);
  const sheetId = parts.length === 1 ? 'group1' : parts[0];
  const rawIndex = parts.length === 1 ? parts[0] : parts[1];
  const index = Number.parseInt(rawIndex, 10);

  if (!Number.isFinite(index)) return null;
  return {
    sheetId,
    index: normalizeSpriteIndex(index, getAvatarSpriteSheet(sheetId)),
  };
}

export function resolveSpriteAvatarEntry(value?: string | null): AvatarSpriteEntry | null {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  return parseSpriteAvatarValue(normalized) || resolveLegacyAvatarEntry(normalized);
}

export function getAvatarCategoryForEntry(entry?: AvatarSpriteEntry | null): AvatarCategory | null {
  if (!entry) return null;
  return AVATAR_PICKER_CATEGORIES.find((category) => (
    category.entries.some((item) => item.sheetId === entry.sheetId && item.index === entry.index)
  )) || null;
}

export function getSpriteAvatarName(entry: AvatarSpriteEntry): string {
  if (entry.sheetId === 'group1') {
    return GROUP1_AVATAR_NAMES[entry.index] || `头像 ${entry.index + 1}`;
  }
  return `头像 ${entry.index + 1}`;
}

export function resolveLegacyAvatarEntry(value: string): AvatarSpriteEntry | null {
  const key = value
    .trim()
    .replace(/^\/?avatar\//, '')
    .replace(/^\/?avatars\//, '')
    .replace(/\.(png|jpg|jpeg|webp|gif|svg)$/i, '')
    .toLowerCase();
  const index = LEGACY_AVATAR_INDEX[key];
  if (index === undefined) return null;
  return { sheetId: 'group1', index };
}

export function resolveAvatarSource(
  value?: string | null,
  options?: {
    seed?: string;
    category?: AvatarCategoryId | string;
    fallbackToHash?: boolean;
  },
): ResolvedAvatarSource {
  const normalized = String(value || '').trim();

  if (normalized) {
    const spriteEntry = resolveSpriteAvatarEntry(normalized);
    if (spriteEntry) {
      return buildResolvedSpriteSource(spriteEntry);
    }

    const imageSrc = normalizeImageAvatarSrc(normalized);
    if (imageSrc) {
      return { kind: 'image', src: imageSrc };
    }
  }

  if (options?.seed && options.fallbackToHash !== false) {
    return buildResolvedSpriteSource(
      pickSpriteAvatar(options.seed, {
        category: options.category || 'all',
      }),
    );
  }

  return { kind: 'none' };
}

export function normalizeImageAvatarSrc(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (/^(https?:|data:|blob:)/i.test(normalized)) return normalized;
  if (normalized.startsWith('/')) return normalized;
  if (normalized.includes('/')) {
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  }
  return null;
}

export function isSpriteAvatarValue(value?: string | null): boolean {
  return Boolean(resolveSpriteAvatarEntry(value));
}

function buildResolvedSpriteSource(entry: AvatarSpriteEntry): Extract<ResolvedAvatarSource, { kind: 'sprite' }> {
  const sheet = getAvatarSpriteSheet(entry.sheetId);
  const index = normalizeSpriteIndex(entry.index, sheet);
  return {
    kind: 'sprite',
    value: buildSpriteAvatarValue(sheet.id, index),
    sheet,
    sheetId: sheet.id,
    index,
    frame: getAvatarSpriteFrame(sheet.id, index),
  };
}

function normalizeSpriteIndex(index: number, sheet: AvatarSpriteSheet): number {
  const total = sheet.rows * sheet.cols;
  return ((Math.trunc(index) % total) + total) % total;
}
