export type AgentTeam = 'blue' | 'red' | 'judge' | 'yellow' | 'black-gold';
export type AgentRoleType = 'normal' | 'supervisor';
export type AgentAvatarMode = 'deterministic' | 'generated' | 'uploaded' | 'preset';
export type AgentAvatarStyle = 'personas' | 'adventurer' | 'pixel-art';

export interface AgentAvatarConfig {
  mode: AgentAvatarMode;
  seed?: string;
  style?: AgentAvatarStyle;
  prompt?: string;
  imageUrl?: string;
  thumbUrl?: string;
  presetName?: string;
  generatedAt?: string;
}

export const AGENT_AVATAR_STYLES: AgentAvatarStyle[] = ['personas', 'adventurer', 'pixel-art'];

export function getDefaultAvatarStyle(team: AgentTeam, roleType: AgentRoleType = 'normal'): AgentAvatarStyle {
  if (roleType === 'supervisor' || team === 'black-gold') return 'personas';
  if (team === 'judge') return 'pixel-art';
  return 'adventurer';
}

export function createDeterministicAvatarConfig(
  seed: string,
  options?: { team?: AgentTeam; roleType?: AgentRoleType }
): AgentAvatarConfig {
  return {
    mode: 'deterministic',
    seed,
    style: getDefaultAvatarStyle(options?.team || 'blue', options?.roleType || 'normal'),
  };
}

export function normalizeAgentAvatar(
  avatar: AgentAvatarConfig | string | null | undefined,
  seed: string,
  options?: { team?: AgentTeam; roleType?: AgentRoleType }
): AgentAvatarConfig {
  if (!avatar) {
    return createDeterministicAvatarConfig(seed, options);
  }

  if (typeof avatar === 'string') {
    return createDeterministicAvatarConfig(`${seed}:${avatar}`, options);
  }

  return {
    mode: avatar.mode || 'deterministic',
    seed: avatar.seed || seed,
    style: avatar.style || getDefaultAvatarStyle(options?.team || 'blue', options?.roleType || 'normal'),
    prompt: avatar.prompt,
    imageUrl: avatar.imageUrl,
    thumbUrl: avatar.thumbUrl,
    presetName: avatar.presetName,
    generatedAt: avatar.generatedAt,
  };
}

export function resolveAgentAvatarSrc(
  avatar: AgentAvatarConfig | string | null | undefined,
  fallbackSeed: string,
  options?: { team?: AgentTeam; roleType?: AgentRoleType }
): string {
  const normalized = normalizeAgentAvatar(avatar, fallbackSeed, options);

  if (normalized.mode === 'uploaded' || normalized.mode === 'generated') {
    if (normalized.thumbUrl) return normalized.thumbUrl;
    if (normalized.imageUrl) return normalized.imageUrl;
  }

  if (normalized.mode === 'preset' && normalized.presetName) {
    return `/agent-avatars/presets/${normalized.presetName}`;
  }

  const seed = normalized.seed || fallbackSeed;
  return buildDeterministicAvatarDataUri(seed, options);
}

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function pickVariant<T>(hash: number, offset: number, variants: T[]): T {
  return variants[(Math.abs(hash + offset * 131) >>> 0) % variants.length];
}

type AvatarPalette = {
  background: string;
  backgroundSecondary: string;
  aura: string;
  coat: string;
  coatSecondary: string;
  metal: string;
  accent: string;
  skin: string[];
  hair: string[];
  eyes: string[];
};

function getAvatarPalette(team: AgentTeam, roleType: AgentRoleType = 'normal'): AvatarPalette {
  const visualTeam = roleType === 'supervisor' ? 'black-gold' : team;

  if (visualTeam === 'blue') {
    return {
      background: '#071120',
      backgroundSecondary: '#123b78',
      aura: '#7dd3fc',
      coat: '#143966',
      coatSecondary: '#63a5ff',
      metal: '#c7ecff',
      accent: '#99f6e4',
      skin: ['#f6d1b8', '#eeb99e', '#d99674'],
      hair: ['#d7e9ff', '#8dc2ff', '#203c74', '#0f172a'],
      eyes: ['#d8f3ff', '#b0e7ff', '#ffffff'],
    };
  }

  if (visualTeam === 'red') {
    return {
      background: '#1b090d',
      backgroundSecondary: '#7a1328',
      aura: '#fb7185',
      coat: '#6f1726',
      coatSecondary: '#fb7185',
      metal: '#ffd7e0',
      accent: '#fdba74',
      skin: ['#f5d2bd', '#e7b193', '#cd8c6c'],
      hair: ['#2a0d0d', '#6b1527', '#d94b68', '#ffcabd'],
      eyes: ['#ffe5ea', '#ffd0da', '#fff6f6'],
    };
  }

  if (visualTeam === 'yellow') {
    return {
      background: '#211403',
      backgroundSecondary: '#8a5a10',
      aura: '#fde68a',
      coat: '#7c4d0a',
      coatSecondary: '#facc15',
      metal: '#fff2b3',
      accent: '#fef08a',
      skin: ['#f5d1ad', '#eab98d', '#cb9566'],
      hair: ['#3b2a08', '#7c5a10', '#f3d36f', '#fff3bf'],
      eyes: ['#fff5d4', '#fde68a', '#ffffff'],
    };
  }

  if (visualTeam === 'black-gold') {
    return {
      background: '#09090b',
      backgroundSecondary: '#5b4308',
      aura: '#fbbf24',
      coat: '#171717',
      coatSecondary: '#d4a017',
      metal: '#fde68a',
      accent: '#fef3c7',
      skin: ['#f6d1b8', '#e7b48f', '#cd8b5c'],
      hair: ['#0f0f10', '#564114', '#d9b451', '#f7e6af'],
      eyes: ['#fff3c2', '#fde68a', '#ffffff'],
    };
  }

  return {
    background: '#0f172a',
    backgroundSecondary: '#334155',
    aura: '#f8d46b',
    coat: '#374151',
    coatSecondary: '#d6d3d1',
    metal: '#f5f5f4',
    accent: '#facc15',
    skin: ['#f3d5c1', '#e9bb9c', '#c98f6f'],
    hair: ['#111827', '#475569', '#cbd5e1', '#ede9d5'],
    eyes: ['#f8fafc', '#fff7d1', '#e2e8f0'],
  };
}

export function renderDeterministicAvatarSvg(
  seed: string,
  options?: { team?: AgentTeam; roleType?: AgentRoleType }
): string {
  const hash = hashSeed(seed);
  const team = options?.roleType === 'supervisor' ? 'black-gold' : (options?.team || 'blue');
  const palette = getAvatarPalette(team, options?.roleType || 'normal');
  const initials = seed
    .trim()
    .split(/[\s_-]+/)
    .map((part) => part[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'AG';

  const skin = pickVariant(hash, 1, palette.skin);
  const hair = pickVariant(hash, 2, palette.hair);
  const eye = pickVariant(hash, 3, palette.eyes);
  const faceShape = pickVariant(hash, 4, ['30 32 34 32', '32 30 32 34', '31 31 31 33']);
  const jawWidth = pickVariant(hash, 5, [22, 24, 26, 28]);
  const hairStyle = (hash >>> 3) % 6;
  const accessory = (hash >>> 5) % 6;
  const emblem = (hash >>> 7) % 4;
  const shoulderWidth = pickVariant(hash, 9, [84, 90, 96]);
  const glowX = 28 + (hash % 72);
  const glowY = 20 + ((hash >>> 2) % 38);
  const eyeTilt = pickVariant(hash, 11, [-2, -1, 0, 1, 2]);
  const mouthY = pickVariant(hash, 12, [84, 86, 88]);
  const mouthWidth = pickVariant(hash, 13, [16, 22, 28, 34]);
  const brow = pickVariant(hash, 14, [34, 36, 38]);
  const headPiece = pickVariant(hash, 15, ['none', 'halo', 'crest', 'visor']);
  const judgeMark = team === 'judge';

  const hairPath = [
    `M27 49c2-20 18-34 37-34 20 0 36 14 38 33-5-5-11-8-18-10-6 6-15 12-29 14-9 2-17 1-28-3z`,
    `M24 51c4-21 19-36 40-36 20 0 35 13 40 33-8-2-14-6-20-13-6 7-15 13-28 16-10 2-20 2-32 0z`,
    `M28 45c7-17 20-29 37-29 19 0 34 11 39 29-6 0-12 2-18 6-8-4-16-6-23-6-14 0-24 1-35 0z`,
    `M26 50c5-23 18-35 39-35 23 0 37 12 40 35-8-7-17-10-28-10-11 0-22 4-31 10-6 4-12 5-20 0z`,
    `M30 48c8-19 18-28 34-28 18 0 30 8 35 27-10-4-21-5-34-5-13 0-24 1-35 6z`,
    `M24 50c8-22 22-35 40-35 21 0 35 14 40 36-9-4-17-4-24-2-10-7-22-10-36-7-4 3-10 6-20 8z`,
  ][hairStyle];

  const accessoryMarkup = [
    '',
    `<path d="M31 58c13-11 24-16 33-16 8 0 18 5 30 15" fill="none" stroke="${palette.metal}" stroke-width="5" stroke-linecap="round" opacity="0.9" />`,
    `<path d="M21 59h20l7-10 16 20 15-20 8 10h20" fill="none" stroke="${palette.accent}" stroke-width="4" stroke-linejoin="round" opacity="0.9" />`,
    `<circle cx="27" cy="66" r="6" fill="${palette.metal}" opacity="0.9" /><circle cx="101" cy="66" r="6" fill="${palette.metal}" opacity="0.9" /><path d="M33 66h62" stroke="${palette.metal}" stroke-width="3" opacity="0.85" />`,
    `<path d="M38 102l14-18h24l14 18" fill="none" stroke="${palette.accent}" stroke-width="4" stroke-linecap="round" opacity="0.9" />`,
    `<path d="M50 30l14-10 14 10-3 16H53z" fill="${palette.metal}" opacity="0.82" />`,
  ][accessory];

  const emblemMarkup = [
    `<circle cx="104" cy="26" r="10" fill="${palette.accent}" opacity="0.18" />`,
    `<path d="M95 18h18v18H95z" fill="${palette.accent}" opacity="0.16" transform="rotate(45 104 27)" />`,
    `<path d="M104 14l6 10 11 2-8 8 2 11-11-5-10 5 2-11-9-8 12-2z" fill="${palette.accent}" opacity="0.18" />`,
    `<path d="M95 18h18v8H95z" fill="${palette.accent}" opacity="0.18" /><path d="M101 14h6v26h-6z" fill="${palette.accent}" opacity="0.18" />`,
  ][emblem];

  const headPieceMarkup =
    headPiece === 'halo'
      ? `<ellipse cx="64" cy="19" rx="24" ry="8" fill="none" stroke="${palette.aura}" stroke-width="3" opacity="0.55" />`
      : headPiece === 'crest'
        ? `<path d="M64 6l8 14H56z" fill="${palette.metal}" opacity="0.85" /><path d="M64 6l14 20H50z" fill="none" stroke="${palette.aura}" stroke-width="2" opacity="0.5" />`
        : headPiece === 'visor'
          ? `<path d="M34 40c8-9 19-13 30-13 13 0 23 4 31 13" fill="none" stroke="${palette.metal}" stroke-width="4" opacity="0.75" />`
          : '';

  const judgeOverlay = judgeMark
    ? `<path d="M64 17l7 12 14 2-10 10 3 14-14-7-13 7 2-14-10-10 14-2z" fill="${palette.accent}" opacity="0.32" />`
    : '';

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${palette.background}" />
          <stop offset="100%" stop-color="${palette.backgroundSecondary}" />
        </linearGradient>
        <linearGradient id="coat" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${palette.coatSecondary}" />
          <stop offset="100%" stop-color="${palette.coat}" />
        </linearGradient>
        <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${palette.metal}" />
          <stop offset="100%" stop-color="${palette.accent}" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="36" fill="url(#bg)" />
      <circle cx="${glowX}" cy="${glowY}" r="34" fill="${palette.aura}" opacity="0.2" />
      <path d="M14 112c13-16 30-27 50-30 20 3 37 14 50 30" fill="url(#coat)" opacity="0.92" />
      <path d="M${64 - shoulderWidth / 2} 116c8-16 21-26 37-30 16 4 29 14 37 30" fill="${palette.coat}" opacity="0.8" />
      <path d="M32 103c10-10 21-16 32-16s22 6 32 16" fill="none" stroke="url(#metal)" stroke-width="4" opacity="0.7" />
      ${emblemMarkup}
      ${judgeOverlay}
      ${headPieceMarkup}
      <path d="${hairPath}" fill="${hair}" />
      <path d="M64 22c18 0 31 14 31 33 0 18-11 34-31 34S33 73 33 55c0-19 13-33 31-33z" fill="${skin}" />
      <path d="M${64 - jawWidth} 47c4-10 14-18 28-18 13 0 24 7 28 18" fill="none" stroke="${hair}" stroke-width="7" stroke-linecap="round" opacity="0.82" />
      <path d="M36 54c7-7 14-10 22-10M70 44c9 0 17 3 23 10" fill="none" stroke="${hair}" stroke-width="4" stroke-linecap="round" opacity="0.9" />
      <ellipse cx="49" cy="${62 + eyeTilt}" rx="6" ry="4" fill="${eye}" />
      <ellipse cx="79" cy="${60 - eyeTilt}" rx="6" ry="4" fill="${eye}" />
      <circle cx="50" cy="${62 + eyeTilt}" r="2" fill="#111827" opacity="0.8" />
      <circle cx="79" cy="${60 - eyeTilt}" r="2" fill="#111827" opacity="0.8" />
      <path d="M43 ${brow}h14M71 ${brow - 1}h14" stroke="${hair}" stroke-width="3" stroke-linecap="round" opacity="0.65" />
      <path d="M64 60v11" stroke="#8b5e3c" stroke-width="2.5" stroke-linecap="round" opacity="0.38" />
      <path d="M${64 - mouthWidth / 2} ${mouthY}c8 6 18 6 28 0" fill="none" stroke="#7c3f28" stroke-width="3.5" stroke-linecap="round" opacity="0.72" />
      <path d="M38 96c8-7 17-12 26-12 9 0 18 5 26 12" fill="none" stroke="${palette.metal}" stroke-width="2" opacity="0.2" />
      ${accessoryMarkup}
      <path d="M24 106h80" stroke="${palette.accent}" stroke-width="2" opacity="0.18" />
      <text x="64" y="118" text-anchor="middle" font-size="13" font-weight="700" font-family="ui-sans-serif, system-ui" fill="#ffffff" opacity="0.74">${initials}</text>
    </svg>
  `.trim();
}

function buildDeterministicAvatarDataUri(
  seed: string,
  options?: { team?: AgentTeam; roleType?: AgentRoleType }
): string {
  const svg = renderDeterministicAvatarSvg(seed, options);
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function getAgentTheme(team: AgentTeam, roleType: AgentRoleType = 'normal') {
  if (roleType === 'supervisor' || team === 'black-gold') {
    return {
      label: '指挥官',
      accent: 'from-amber-300 via-yellow-500 to-stone-900',
      surface: 'border-amber-300/30 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.22),_transparent_45%),linear-gradient(135deg,rgba(24,24,27,0.98),rgba(12,10,9,0.94))]',
      badge: 'bg-amber-500/15 text-amber-200 border-amber-400/30',
      halo: 'bg-amber-400/20',
    };
  }

  if (team === 'blue') {
    return {
      label: '蓝队',
      accent: 'from-sky-300 via-blue-500 to-indigo-700',
      surface: 'border-sky-400/20 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_45%),linear-gradient(135deg,rgba(15,23,42,0.95),rgba(30,41,59,0.88))]',
      badge: 'bg-sky-500/15 text-sky-200 border-sky-400/30',
      halo: 'bg-sky-400/20',
    };
  }

  if (team === 'red') {
    return {
      label: '红队',
      accent: 'from-rose-300 via-red-500 to-orange-700',
      surface: 'border-rose-400/20 bg-[radial-gradient(circle_at_top,_rgba(244,63,94,0.18),_transparent_45%),linear-gradient(135deg,rgba(69,10,10,0.96),rgba(30,27,75,0.84))]',
      badge: 'bg-rose-500/15 text-rose-200 border-rose-400/30',
      halo: 'bg-rose-400/20',
    };
  }

  if (team === 'yellow') {
    return {
      label: '黄队',
      accent: 'from-lime-200 via-yellow-400 to-amber-700',
      surface: 'border-yellow-300/25 bg-[radial-gradient(circle_at_top,_rgba(250,204,21,0.18),_transparent_45%),linear-gradient(135deg,rgba(68,64,60,0.96),rgba(120,53,15,0.84))]',
      badge: 'bg-yellow-500/15 text-yellow-100 border-yellow-300/30',
      halo: 'bg-yellow-300/20',
    };
  }

  return {
    label: '裁定席',
    accent: 'from-stone-100 via-amber-200 to-slate-500',
    surface: 'border-stone-300/25 bg-[radial-gradient(circle_at_top,_rgba(250,204,21,0.16),_transparent_45%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(51,65,85,0.9))]',
    badge: 'bg-stone-100/10 text-stone-100 border-stone-200/30',
    halo: 'bg-amber-200/20',
  };
}

export function getAgentRarity(team: AgentTeam, roleType: AgentRoleType = 'normal') {
  if (roleType === 'supervisor' || team === 'black-gold') return '传说';
  if (team === 'judge') return '史诗';
  if (team === 'yellow') return '稀有';
  return '标准';
}
