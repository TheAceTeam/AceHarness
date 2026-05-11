export type WerewolfRoleAssetKey =
  | 'seer'
  | 'witch'
  | 'hunter'
  | 'idiot'
  | 'guard'
  | 'dreamer'
  | 'knight'
  | 'bear'
  | 'fox'
  | 'crow'
  | 'elder'
  | 'mute-elder'
  | 'magician'
  | 'psychic'
  | 'gravekeeper'
  | 'stalker'
  | 'werewolf'
  | 'white-wolf-king'
  | 'wolf-king'
  | 'wolf-beauty'
  | 'evil-knight'
  | 'nightmare'
  | 'hidden-wolf'
  | 'gargoyle'
  | 'big-wolf'
  | 'blood-moon-apostle'
  | 'villager'
  | 'cupid'
  | 'thief'
  | 'mixed-blood'
  | 'cursed-fox'
  | 'piper';

const WEREWOLF_SPRITE_WIDTH = 1448;
const WEREWOLF_SPRITE_HEIGHT = 1086;
const WEREWOLF_CARD_COLUMNS = [
  { x: 72, width: 160 },
  { x: 273, width: 156 },
  { x: 467, width: 154 },
  { x: 660, width: 149 },
  { x: 844, width: 147 },
  { x: 1028, width: 147 },
  { x: 1213, width: 150 },
] as const;
const WEREWOLF_CARD_ROWS = [
  { y: 7, height: 194 },
  { y: 203, height: 184 },
  { y: 390, height: 178 },
  { y: 569, height: 166 },
  { y: 740, height: 164 },
  { y: 909, height: 167 },
] as const;

export const WEREWOLF_ROLE_SPRITE_SRC = '/images/werewolf.png';

export const WEREWOLF_ROLE_ASSETS: Record<WerewolfRoleAssetKey, { col: number; row: number; label: string }> = {
  seer: { col: 0, row: 0, label: '预言家' },
  witch: { col: 1, row: 0, label: '女巫' },
  hunter: { col: 2, row: 0, label: '猎人' },
  idiot: { col: 3, row: 0, label: '白痴' },
  guard: { col: 4, row: 0, label: '守卫' },
  dreamer: { col: 5, row: 0, label: '摄梦人' },
  knight: { col: 6, row: 0, label: '骑士' },
  bear: { col: 0, row: 1, label: '熊' },
  fox: { col: 1, row: 1, label: '狐狸' },
  crow: { col: 2, row: 1, label: '乌鸦' },
  elder: { col: 5, row: 1, label: '长老' },
  'mute-elder': { col: 6, row: 1, label: '禁言长老' },
  magician: { col: 0, row: 2, label: '魔术师' },
  psychic: { col: 1, row: 2, label: '通灵师' },
  gravekeeper: { col: 2, row: 2, label: '守墓人' },
  stalker: { col: 3, row: 2, label: '潜行者' },
  werewolf: { col: 4, row: 2, label: '狼人' },
  'white-wolf-king': { col: 6, row: 2, label: '白狼王' },
  'wolf-king': { col: 0, row: 3, label: '狼王' },
  'wolf-beauty': { col: 1, row: 3, label: '狼美人' },
  'evil-knight': { col: 2, row: 3, label: '恶灵骑士' },
  nightmare: { col: 3, row: 3, label: '梦魇' },
  'hidden-wolf': { col: 4, row: 3, label: '隐狼' },
  gargoyle: { col: 6, row: 3, label: '石像鬼' },
  'big-wolf': { col: 0, row: 4, label: '大野狼' },
  'blood-moon-apostle': { col: 1, row: 4, label: '血月使徒' },
  villager: { col: 2, row: 4, label: '平民' },
  cupid: { col: 3, row: 4, label: '丘比特' },
  thief: { col: 4, row: 4, label: '盗贼' },
  'mixed-blood': { col: 6, row: 4, label: '混血儿' },
  'cursed-fox': { col: 0, row: 5, label: '咒狐' },
  piper: { col: 1, row: 5, label: '吹笛者' },
};

export type WerewolfRolebookEntry = {
  key: WerewolfRoleAssetKey;
  camp: '好人阵营' | '狼人阵营' | '第三方' | '特殊';
  timing: '白天' | '黑夜' | '被动' | '特殊';
  description: string;
};

export const WEREWOLF_ROLEBOOK_ENTRIES: WerewolfRolebookEntry[] = [
  { key: 'seer', camp: '好人阵营', timing: '黑夜', description: '每夜查验一名玩家的阵营信息，是好人阵营最核心的信息位。' },
  { key: 'witch', camp: '好人阵营', timing: '黑夜', description: '拥有解药和毒药各一次，首夜通常允许自救，能改写夜间死亡结果。' },
  { key: 'hunter', camp: '好人阵营', timing: '特殊', description: '出局时可选择开枪带走一名玩家，部分板子会限制被毒或特定死亡方式。' },
  { key: 'idiot', camp: '好人阵营', timing: '被动', description: '白天被投出后可翻牌免死，但通常失去投票权，只保留发言。' },
  { key: 'guard', camp: '好人阵营', timing: '黑夜', description: '每夜守护一名玩家免受狼刀伤害，一般不能连续两晚守护同一人。' },
  { key: 'dreamer', camp: '好人阵营', timing: '黑夜', description: '夜间使玩家进入梦境，连续被摄梦或梦境死亡会触发额外结算。' },
  { key: 'knight', camp: '好人阵营', timing: '白天', description: '白天可决斗一名玩家，若目标为狼人则目标出局，否则骑士出局。' },
  { key: 'bear', camp: '好人阵营', timing: '被动', description: '每天根据相邻存活玩家阵营给出咆哮线索，适合推理位置关系。' },
  { key: 'fox', camp: '好人阵营', timing: '黑夜', description: '每夜查验连续三名玩家，若其中有狼人会得到正向信息。' },
  { key: 'crow', camp: '好人阵营', timing: '黑夜', description: '夜间诅咒一名玩家，使其次日获得额外票压或投票权重变化。' },
  { key: 'elder', camp: '好人阵营', timing: '被动', description: '首次被狼人袭击通常不会死亡，但被好人技能击中可能带来惩罚。' },
  { key: 'mute-elder', camp: '好人阵营', timing: '特殊', description: '可限制玩家发言或触发沉默效果，用来测试白天信息压制机制。' },
  { key: 'magician', camp: '好人阵营', timing: '黑夜', description: '夜间交换两名玩家的技能或结算目标，能制造强干扰和保护。' },
  { key: 'psychic', camp: '好人阵营', timing: '黑夜', description: '通过灵媒信息获取死亡或阵营线索，常用于补足夜间信息链。' },
  { key: 'gravekeeper', camp: '好人阵营', timing: '黑夜', description: '夜间查看白天被放逐玩家的真实阵营，帮助校准票型判断。' },
  { key: 'stalker', camp: '好人阵营', timing: '黑夜', description: '跟踪一名玩家的夜间行动方向，适合验证行动声明和逻辑矛盾。' },
  { key: 'werewolf', camp: '狼人阵营', timing: '黑夜', description: '夜间参与狼队讨论并选择袭击目标，白天隐藏身份推动抗推。' },
  { key: 'white-wolf-king', camp: '狼人阵营', timing: '白天', description: '可在白天自爆并带走一名玩家，常用于破坏警徽流或关键神职。' },
  { key: 'wolf-king', camp: '狼人阵营', timing: '特殊', description: '出局时可发动带人技能，是狼人阵营的强进攻角色。' },
  { key: 'wolf-beauty', camp: '狼人阵营', timing: '黑夜', description: '夜间魅惑一名玩家，自身出局时可连带魅惑目标一同出局。' },
  { key: 'evil-knight', camp: '狼人阵营', timing: '被动', description: '免疫或反制部分查验类能力，用于对抗预言家信息体系。' },
  { key: 'nightmare', camp: '狼人阵营', timing: '黑夜', description: '夜间恐惧一名玩家，使其当夜技能失效或行动受限。' },
  { key: 'hidden-wolf', camp: '狼人阵营', timing: '被动', description: '通常不参与狼队夜聊或查验显示特殊结果，适合制造身份迷雾。' },
  { key: 'gargoyle', camp: '狼人阵营', timing: '黑夜', description: '前期独立查验或潜伏，满足条件后加入狼队，偏成长型狼职。' },
  { key: 'big-wolf', camp: '狼人阵营', timing: '黑夜', description: '拥有更强夜间攻击或抗性规则，适合扩展复杂狼队板子。' },
  { key: 'blood-moon-apostle', camp: '狼人阵营', timing: '特殊', description: '自爆或死亡后触发延迟效果，常改变次日放逐和死亡节奏。' },
  { key: 'villager', camp: '好人阵营', timing: '白天', description: '没有夜间技能，依靠发言、票型和逻辑为好人阵营找狼。' },
  { key: 'cupid', camp: '第三方', timing: '特殊', description: '开局指定情侣，情侣可能形成跨阵营胜利条件。' },
  { key: 'thief', camp: '特殊', timing: '特殊', description: '开局从备选身份中选择一个身份加入游戏，用于增加板子变化。' },
  { key: 'mixed-blood', camp: '第三方', timing: '特殊', description: '选择榜样并随其阵营或胜利条件变化，适合测试隐性目标。' },
  { key: 'cursed-fox', camp: '第三方', timing: '特殊', description: '通常拥有独立胜利条件，需要避免被双方阵营识破。' },
  { key: 'piper', camp: '第三方', timing: '黑夜', description: '夜间魅惑玩家，当足够多玩家被魅惑后达成独立胜利。' },
];

export function getWerewolfRoleSpriteStyle(role?: string | null): Record<string, string> | null {
  const asset = role ? WEREWOLF_ROLE_ASSETS[role as WerewolfRoleAssetKey] : null;
  if (!asset) return null;
  const sourceColumn = WEREWOLF_CARD_COLUMNS[asset.col];
  const sourceRow = WEREWOLF_CARD_ROWS[asset.row];
  if (!sourceColumn || !sourceRow) return null;
  const scaleX = WEREWOLF_SPRITE_WIDTH / sourceColumn.width;
  const scaleY = WEREWOLF_SPRITE_HEIGHT / sourceRow.height;
  return {
    backgroundImage: `url(${WEREWOLF_ROLE_SPRITE_SRC})`,
    backgroundSize: `${scaleX * 100}% ${scaleY * 100}%`,
    backgroundPosition: `${(sourceColumn.x / (WEREWOLF_SPRITE_WIDTH - sourceColumn.width)) * 100}% ${(sourceRow.y / (WEREWOLF_SPRITE_HEIGHT - sourceRow.height)) * 100}%`,
    backgroundRepeat: 'no-repeat',
  };
}
