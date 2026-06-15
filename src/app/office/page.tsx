'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import Link from 'next/link';
import {
  Building2,
  Bot,
  CheckCircle2,
  ClipboardList,
  Cog,
  Gauge,
  GitBranch,
  Key,
  Loader2,
  MessageSquareText,
  Package,
  Pencil,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Target,
  Users,
  UsersRound,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import AnimatedGlowingSearchBar from '@/components/ui/animated-glowing-search-bar';
import MacOSDock, { type DockApp } from '@/components/ui/mac-os-dock';
import { RainbowBordersButton } from '@/components/ui/rainbow-borders-button';
import SpriteAvatar from '@/components/SpriteAvatar';
import { ThemeToggle } from '@/components/theme-toggle';
import { AgoraShell } from '@/components/collaboration/AgoraShell';
import { useChat } from '@/contexts/ChatContext';
import { resolveAgentAvatarSrc } from '@/lib/agent/personas';
import { withOfficeSource } from '@/lib/navigation/return-target';

type Activity = 'typing' | 'walking' | 'talking' | 'thinking' | 'reviewing' | 'presenting';

type OfficeAgent = {
  name: string;
  title?: string;
  team?: 'blue' | 'red' | 'judge' | 'black-gold';
  roleType?: 'normal' | 'supervisor';
  category?: string;
  tags?: string[];
  capabilities?: string[];
  skills?: string[];
  avatar?: any;
  workspaceProfile?: any;
};

type OfficeMember = {
  agentName: string;
  displayName: string;
  nickname?: string;
  officeRole?: string;
  defaultDirectRoom: boolean;
  visual: {
    accent?: string;
    zone?: string;
    order: number;
  };
  motion?: {
    activity?: Activity;
    speed?: number;
  };
  agent: OfficeAgent;
};

type OfficeTeamPlan = {
  id: string;
  requirement: string;
  generatedAt: number;
  members: Array<{
    agentName: string;
    displayName: string;
    zone: string;
    officeRole: string;
    score: number;
    matchReasons: string[];
    agent: OfficeAgent;
  }>;
  missingZones: string[];
  availableAgentCount: number;
};

type OfficeOrgClarificationOption = {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
};

type OfficeOrgClarificationQuestion = {
  id: string;
  label: string;
  question: string;
  selectionMode: 'single' | 'multiple';
  options: OfficeOrgClarificationOption[];
  placeholder?: string;
  required?: boolean;
};

type OfficeOrgClarification = {
  summary: string;
  knownFacts: string[];
  missingFields: string[];
  questions: OfficeOrgClarificationQuestion[];
};

type OfficeOrgDraft = {
  id: string;
  requirement: string;
  nodes: Array<{
    id: string;
    title: string;
    zone?: string;
    agentName?: string;
    vacancy?: boolean;
    responsibilities?: string[];
    evidence?: string[];
    risks?: string[];
  }>;
  gaps: Array<{
    id: string;
    title: string;
    description: string;
    severity?: 'info' | 'warning' | 'critical';
  }>;
};

type CollaborationRoomRecord = {
  id: string;
  spaceType: 'office' | 'meeting-room';
  roomType: 'direct' | 'meeting';
  topic?: string;
  participantAgentNames: string[];
  agentSnapshots?: Record<string, {
    agentName: string;
    displayName: string;
    title?: string;
    team?: string;
    officeRole?: string;
    avatar?: any;
  }>;
  sessionId?: string;
  status?: 'active' | 'archived';
  updatedAt?: number;
  createdAt?: number;
};

type WorkspaceStatusTab = 'office' | 'meeting' | 'workflow';
type TeamBuilderStep = 'goal' | 'clarify' | 'draft' | 'confirm';

type DashboardDockAction = {
  id: string;
  label: string;
  href?: string;
  icon: LucideIcon;
  color: string;
};

const DASHBOARD_DOCK_ACTIONS: DashboardDockAction[] = [
  { id: 'workflows', label: '工作流管理', href: withOfficeSource('/workflows'), icon: Workflow, color: 'from-cyan-500 to-cyan-600' },
  { id: 'agents', label: 'Agent 管理', href: withOfficeSource('/agents'), icon: Bot, color: 'from-purple-500 to-purple-600' },
  { id: 'models', label: '模型管理', href: withOfficeSource('/models'), icon: Settings, color: 'from-orange-500 to-orange-600' },
  { id: 'skills', label: 'Skills/MCP', href: withOfficeSource('/skills'), icon: Package, color: 'from-pink-500 to-pink-600' },
  { id: 'engines', label: '引擎管理', href: withOfficeSource('/engines'), icon: Cog, color: 'from-indigo-500 to-indigo-600' },
  { id: 'settings', label: '系统设置', href: withOfficeSource('/account/system-settings'), icon: Key, color: 'from-amber-500 to-amber-600' },
];

const ZONES: Record<string, { label: string; color: string; brief: string; weight: number }> = {
  core: { label: 'CEO / Founder', color: '#0f4fd8', brief: 'Set Direction / Make Key Decisions', weight: 0 },
  product: { label: 'Product Lead', color: '#2563eb', brief: 'Define Problems / Validate Value', weight: 10 },
  design: { label: 'Design Lead', color: '#16a34a', brief: 'Design Experience / Create Solutions', weight: 20 },
  engineering: { label: 'Engineering Lead', color: '#f97316', brief: 'Build Product / Ensure Quality', weight: 30 },
  growth: { label: 'Growth Lead', color: '#7c3aed', brief: 'Drive Growth / Deliver Value', weight: 40 },
  operations: { label: 'Operations Lead', color: '#0891b2', brief: 'Streamline Ops / Improve Efficiency', weight: 50 },
  quality: { label: 'Quality Lead', color: '#0284c7', brief: 'Verify Risk / Keep Quality', weight: 60 },
  decision: { label: 'Decision Lead', color: '#7c3aed', brief: 'Review / Decide / Align', weight: 70 },
  knowledge: { label: 'Knowledge Lead', color: '#0d9488', brief: 'Capture / Share Context', weight: 80 },
  generalist: { label: 'Generalist', color: '#475569', brief: 'Solve Problems / Support Anywhere', weight: 90 },
};

const ORG_REQUIRED_ZONES = ['core', 'product', 'design', 'engineering', 'quality', 'decision'];

const OPC_CORE_ITEMS = [
  ['O', 'One-Person Core'],
  ['P', 'Product as Core'],
  ['C', 'AI Copilots Everywhere'],
];

const POWERED_BY_ITEMS = [
  { icon: Users, label: 'AI Collaboration', detail: 'Work together' },
  { icon: Zap, label: 'Fast Decisions', detail: 'Faster execution' },
  { icon: CheckCircle2, label: 'Transparency', detail: 'Clear alignment' },
  { icon: GitBranch, label: 'Knowledge', detail: 'Capture and share' },
  { icon: Gauge, label: 'Data-Driven', detail: 'Measure and improve' },
  { icon: Target, label: 'Impact', detail: 'Deliver results' },
];

const ROLE_ICONS: Record<string, LucideIcon> = {
  product: Target,
  design: Pencil,
  engineering: Cog,
  growth: Zap,
  operations: Settings,
  generalist: Package,
  quality: CheckCircle2,
  decision: GitBranch,
  knowledge: Users,
};

const CATEGORY_ZONE: Record<string, string> = {
  总裁: 'core',
  产品: 'product',
  设计: 'design',
  架构: 'design',
  编码: 'engineering',
  开发: 'engineering',
  性能: 'quality',
  测试: 'quality',
  裁定: 'decision',
  审查: 'decision',
  审计: 'decision',
  文档: 'knowledge',
  文案: 'knowledge',
};

const OFFICE_MAX_VISIBLE_MEMBERS = 12;
const OFFICE_WALK_SPEED_PERCENT_PER_SECOND = 3.2;

type OfficePoint = { x: number; y: number };
type OfficeRect = { left: number; right: number; top: number; bottom: number };

type OfficeGridLayout = {
  columns: number;
  rows: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

function officeGridLayoutForTotal(total: number): OfficeGridLayout {
  const visibleTotal = Math.max(1, Math.min(total, OFFICE_MAX_VISIBLE_MEMBERS));
  const columns = visibleTotal <= 2 ? visibleTotal : visibleTotal <= 6 ? 3 : 4;
  const rows = Math.max(1, Math.ceil(visibleTotal / columns));
  return {
    columns,
    rows,
    minX: columns >= 4 ? 13 : 18,
    maxX: columns >= 4 ? 87 : 82,
    minY: rows >= 3 ? 14 : 24,
    maxY: rows >= 3 ? 80 : 72,
  };
}

function officeGridAxisPoints(count: number, min: number, max: number) {
  if (count <= 1) return [50];
  return Array.from({ length: count }, (_item, index) => min + index * ((max - min) / (count - 1)));
}

function officePositionForIndex(index: number, total: number) {
  const layout = officeGridLayoutForTotal(total);
  const row = Math.floor(index / layout.columns);
  const column = index % layout.columns;
  const xs = officeGridAxisPoints(layout.columns, layout.minX, layout.maxX);
  const ys = officeGridAxisPoints(layout.rows, layout.minY, layout.maxY);
  return {
    x: xs[column] ?? 50,
    y: ys[row] ?? ys[ys.length - 1] ?? 50,
  };
}

function officeVerticalAislesForLayout(layout: OfficeGridLayout) {
  const columns = officeGridAxisPoints(layout.columns, layout.minX, layout.maxX);
  if (columns.length === 1) {
    return [clampPercent(columns[0] < 50 ? columns[0] + 18 : columns[0] - 18)];
  }

  const aisles = columns.slice(1).map((column, index) => (columns[index] + column) / 2);
  aisles.unshift(clampPercent(columns[0] - 10));
  aisles.push(clampPercent(columns[columns.length - 1] + 10));
  return [...new Set(aisles.map((aisle) => Number(clampPercent(aisle).toFixed(2))))];
}

function uniqueSortedPercent(values: number[]) {
  return [...new Set(values.map((value) => Number(clampPercent(value).toFixed(2))))].sort((a, b) => a - b);
}

function officeStationFootprint(total: number) {
  const layout = officeGridLayoutForTotal(total);
  const columnSpacing = layout.columns > 1 ? (layout.maxX - layout.minX) / (layout.columns - 1) : 42;
  const rowSpacing = layout.rows > 1 ? (layout.maxY - layout.minY) / (layout.rows - 1) : 40;
  return {
    halfX: Math.max(8.5, Math.min(16, columnSpacing / 2 - 3)),
    halfY: Math.max(9, Math.min(15, rowSpacing / 2 - 5)),
  };
}

function officeFrontAisleY(positionY: number, total: number) {
  return clampPercent(positionY + officeStationFootprint(total).halfY + 5);
}

function officeBackAisleY(positionY: number, total: number) {
  return clampPercent(positionY - officeStationFootprint(total).halfY - 5);
}

function officeSideExitX(positionX: number, towardRight: boolean, total: number) {
  return clampPercent(positionX + (towardRight ? 1 : -1) * (officeStationFootprint(total).halfX + 3));
}

function officeTalkPoints(host: OfficePoint, visitorOnLeft: boolean, roadY: number) {
  const hostTalkPoint = {
    x: clampPercent(host.x + (visitorOnLeft ? 3.7 : -3.7)),
    y: roadY,
  };
  const visitorTalkPoint = {
    x: clampPercent(hostTalkPoint.x + (visitorOnLeft ? -8.6 : 8.6)),
    y: roadY,
  };

  return {
    visitorOnLeft,
    hostTalkPoint,
    visitorTalkPoint,
  };
}

function officeStationObstacles(total: number): OfficeRect[] {
  const footprint = officeStationFootprint(total);
  return Array.from({ length: Math.min(total, OFFICE_MAX_VISIBLE_MEMBERS) }, (_item, index) => {
    const position = officePositionForIndex(index, total);
    return {
      left: position.x - footprint.halfX - 2,
      right: position.x + footprint.halfX + 2,
      top: position.y - footprint.halfY - 2,
      bottom: position.y + footprint.halfY + 2,
    };
  });
}

function officePointInObstacle(point: OfficePoint, obstacles: OfficeRect[]) {
  return obstacles.some((rect) => (
    point.x > rect.left
    && point.x < rect.right
    && point.y > rect.top
    && point.y < rect.bottom
  ));
}

function officeSegmentHitsObstacle(from: OfficePoint, to: OfficePoint, obstacles: OfficeRect[]) {
  if (pointDistance(from, to) < 0.01) return officePointInObstacle(from, obstacles);
  return obstacles.some((rect) => {
    if (Math.abs(from.x - to.x) < 0.01) {
      const minY = Math.min(from.y, to.y);
      const maxY = Math.max(from.y, to.y);
      return from.x > rect.left && from.x < rect.right && maxY > rect.top && minY < rect.bottom;
    }
    if (Math.abs(from.y - to.y) < 0.01) {
      const minX = Math.min(from.x, to.x);
      const maxX = Math.max(from.x, to.x);
      return from.y > rect.top && from.y < rect.bottom && maxX > rect.left && minX < rect.right;
    }

    const steps = Math.max(6, Math.ceil(pointDistance(from, to) / 2));
    for (let index = 1; index < steps; index += 1) {
      const point = {
        x: from.x + ((to.x - from.x) * index) / steps,
        y: from.y + ((to.y - from.y) * index) / steps,
      };
      if (officePointInObstacle(point, obstacles)) return true;
    }
    return false;
  });
}

function officeRouteCandidateAxes(start: OfficePoint, goal: OfficePoint, total: number) {
  const layout = officeGridLayoutForTotal(total);
  const footprint = officeStationFootprint(total);
  const positions = Array.from({ length: Math.min(total, OFFICE_MAX_VISIBLE_MEMBERS) }, (_item, index) => officePositionForIndex(index, total));
  const xLines = uniqueSortedPercent([
    8,
    92,
    start.x,
    goal.x,
    ...officeVerticalAislesForLayout(layout),
    ...positions.flatMap((position) => [
      position.x - footprint.halfX - 5,
      position.x + footprint.halfX + 5,
    ]),
  ]);
  const yLines = uniqueSortedPercent([
    8,
    92,
    start.y,
    goal.y,
    ...positions.flatMap((position) => [
      officeBackAisleY(position.y, total),
      officeFrontAisleY(position.y, total),
    ]),
  ]);
  return { xLines, yLines };
}

function officePointKey(point: OfficePoint) {
  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
}

function pruneOfficePath(points: OfficePoint[]) {
  const compact: OfficePoint[] = [];
  points.forEach((point) => pushRoutePoint(compact, point));
  for (let index = compact.length - 2; index > 0; index -= 1) {
    const previous = compact[index - 1];
    const current = compact[index];
    const next = compact[index + 1];
    const sameColumn = Math.abs(previous.x - current.x) < 0.01 && Math.abs(current.x - next.x) < 0.01;
    const sameRow = Math.abs(previous.y - current.y) < 0.01 && Math.abs(current.y - next.y) < 0.01;
    if (sameColumn || sameRow) compact.splice(index, 1);
  }
  return compact;
}

function officeFindPath(start: OfficePoint, goal: OfficePoint, total: number): OfficePoint[] {
  const obstacles = officeStationObstacles(total);
  const { xLines, yLines } = officeRouteCandidateAxes(start, goal, total);
  const nodes = new Map<string, OfficePoint>();
  const addNode = (point: OfficePoint) => {
    const normalized = { x: Number(clampPercent(point.x).toFixed(2)), y: Number(clampPercent(point.y).toFixed(2)) };
    if (!officePointInObstacle(normalized, obstacles)) nodes.set(officePointKey(normalized), normalized);
  };

  for (const x of xLines) {
    for (const y of yLines) addNode({ x, y });
  }
  addNode(start);
  addNode(goal);

  const startKey = officePointKey(start);
  const goalKey = officePointKey(goal);
  const nodeList = [...nodes.values()];
  const neighbors = new Map<string, Array<{ key: string; cost: number }>>();

  const addEdge = (from: OfficePoint, to: OfficePoint) => {
    if (officeSegmentHitsObstacle(from, to, obstacles)) return;
    const fromKey = officePointKey(from);
    const toKey = officePointKey(to);
    const cost = pointDistance(from, to);
    neighbors.set(fromKey, [...(neighbors.get(fromKey) || []), { key: toKey, cost }]);
    neighbors.set(toKey, [...(neighbors.get(toKey) || []), { key: fromKey, cost }]);
  };

  for (const x of xLines) {
    const column = nodeList.filter((point) => Math.abs(point.x - x) < 0.01).sort((a, b) => a.y - b.y);
    for (let index = 1; index < column.length; index += 1) addEdge(column[index - 1], column[index]);
  }
  for (const y of yLines) {
    const row = nodeList.filter((point) => Math.abs(point.y - y) < 0.01).sort((a, b) => a.x - b.x);
    for (let index = 1; index < row.length; index += 1) addEdge(row[index - 1], row[index]);
  }

  const open = new Set([startKey]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const heuristic = (key: string) => pointDistance(nodes.get(key) || start, goal);

  while (open.size) {
    let current = [...open][0];
    for (const key of open) {
      if ((gScore.get(key) ?? Infinity) + heuristic(key) < (gScore.get(current) ?? Infinity) + heuristic(current)) current = key;
    }
    if (current === goalKey) {
      const path = [nodes.get(current) || goal];
      while (cameFrom.has(current)) {
        current = cameFrom.get(current) as string;
        path.unshift(nodes.get(current) as OfficePoint);
      }
      return pruneOfficePath(path);
    }

    open.delete(current);
    for (const edge of neighbors.get(current) || []) {
      const tentative = (gScore.get(current) ?? Infinity) + edge.cost;
      if (tentative >= (gScore.get(edge.key) ?? Infinity)) continue;
      cameFrom.set(edge.key, current);
      gScore.set(edge.key, tentative);
      open.add(edge.key);
    }
  }

  const perimeterY = start.y < 50 && goal.y < 50 ? 8 : 92;
  return pruneOfficePath([
    start,
    { x: start.x, y: perimeterY },
    { x: goal.x, y: perimeterY },
    goal,
  ]);
}

function stationScaleForTotal(total: number) {
  if (total >= 10) return 0.66;
  if (total >= 7) return 0.76;
  if (total >= 4) return 0.88;
  return 0.94;
}

const OFFICE_ASSET_SHEET = '/office/6f4991eb-edc8-4ec2-b78f-975b5a140c74_mattingImg-shadow.png';
const OFFICE_ASSET_SHEET_SIZE = 1254;
const OFFICE_AGENT_ASSET_VERSION = '20260615-v3-clean';
const OFFICE_SPRITES = {
  floorSlab: { x: 22, y: 95, w: 307, h: 203 },
  deskShadow: { x: 360, y: 148, w: 252, h: 144 },
  cubicle: { x: 643, y: 93, w: 265, h: 219 },
  deskTop: { x: 949, y: 122, w: 289, h: 141 },
  chairBack: { x: 88, y: 369, w: 165, h: 267 },
  chairSeat: { x: 373, y: 414, w: 208, h: 239 },
  monitor: { x: 669, y: 367, w: 228, h: 263 },
  keyboard: { x: 965, y: 461, w: 251, h: 151 },
  trackpad: { x: 89, y: 771, w: 172, h: 120 },
  plant: { x: 395, y: 691, w: 180, h: 241 },
  mug: { x: 713, y: 730, w: 156, h: 192 },
  lamp: { x: 1022, y: 693, w: 146, h: 234 },
  notebook: { x: 48, y: 1022, w: 258, h: 172 },
  tablet: { x: 363, y: 1026, w: 240, h: 153 },
  tray: { x: 669, y: 1024, w: 230, h: 161 },
} as const;

type OfficeSpriteKey = keyof typeof OFFICE_SPRITES;

const OFFICE_WORKSTATION_WIDTH = 390;
const OFFICE_WORKSTATION_HEIGHT = 386;

const WORKSTATION_SHEET_ASSETS = [
  { sprite: 'floorSlab', left: 19.4, top: 128.99, width: 371.5, height: 246.28, zIndex: 1 },
  { sprite: 'deskShadow', left: 103.72, top: 183.48, width: 204.33, height: 116.06, zIndex: 2 },
  { sprite: 'cubicle', left: 30.63, top: 64.39, width: 354.37, height: 254.4, zIndex: 3 },
  { sprite: 'deskTop', left: 90.3, top: 106.42, width: 208.16, height: 101.93, zIndex: 4 },
  { sprite: 'lamp', left: 147.82, top: 85.69, width: 48.49, height: 77.45, zIndex: 5, flipH: true },
  { sprite: 'plant', left: 107.54, top: 134.02, width: 34.83, height: 55.18, zIndex: 6 },
  { sprite: 'notebook', left: 159.01, top: 123.94, width: 36.31, height: 24.05, zIndex: 7 },
  { sprite: 'tray', left: 191.34, top: 114.54, width: 40.15, height: 28.31, zIndex: 8 },
  { sprite: 'keyboard', left: 186.61, top: 140.35, width: 60.54, height: 36.35, zIndex: 9, flipH: true },
  { sprite: 'trackpad', left: 244.45, top: 168.44, width: 25.93, height: 18.13, zIndex: 10, flipH: true },
  { sprite: 'mug', left: 271.92, top: 143.87, width: 20.06, height: 24.33, zIndex: 11 },
  { sprite: 'tablet', left: 138.03, top: 172.44, width: 27.28, height: 17.19, zIndex: 12 },
  { sprite: 'monitor', left: 192.06, top: 45.09, width: 101.14, height: 116.72, zIndex: 13, flipH: true },
  { sprite: 'chairSeat', left: 162.1, top: 197.55, width: 100.66, height: 115.25, zIndex: 17 },
  { sprite: 'chairBack', left: 162.02, top: 135.35, width: 70.52, height: 114.44, zIndex: 18 },
] as const;

type WorkstationSheetAsset = (typeof WORKSTATION_SHEET_ASSETS)[number];

function OfficeSprite({
  sprite,
  scale = 1,
  className = '',
  style,
}: {
  sprite: OfficeSpriteKey;
  scale?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const asset = OFFICE_SPRITES[sprite];
  return (
    <span
      aria-hidden="true"
      className={`office-sheet-sprite ${className}`}
      style={{
        width: `${asset.w * scale}px`,
        height: `${asset.h * scale}px`,
        backgroundImage: `url(${OFFICE_ASSET_SHEET})`,
        backgroundSize: `${OFFICE_ASSET_SHEET_SIZE * scale}px ${OFFICE_ASSET_SHEET_SIZE * scale}px`,
        backgroundPosition: `${-asset.x * scale}px ${-asset.y * scale}px`,
        ...style,
      }}
    />
  );
}

function initials(value: string) {
  return value.trim().slice(0, 2).toUpperCase() || 'AI';
}

function displayName(agent: OfficeAgent) {
  return agent.workspaceProfile?.nickname || agent.workspaceProfile?.displayName || agent.title || agent.name;
}

function zoneOf(agent: OfficeAgent) {
  const explicit = agent.workspaceProfile?.visual?.zone;
  if (explicit && ZONES[explicit]) return explicit;
  if (agent.category && CATEGORY_ZONE[agent.category]) return CATEGORY_ZONE[agent.category];
  const text = `${agent.name} ${(agent.tags || []).join(' ')}`.toLowerCase();
  if (text.includes('ceo') || text.includes('supervisor')) return 'core';
  if (text.includes('product')) return 'product';
  if (text.includes('design') || text.includes('architect')) return 'design';
  if (text.includes('develop') || text.includes('code') || text.includes('fix')) return 'engineering';
  if (text.includes('test') || text.includes('hunter') || text.includes('breaker') || text.includes('performance')) return 'quality';
  if (text.includes('judge') || text.includes('review') || text.includes('auditor')) return 'decision';
  if (text.includes('doc') || text.includes('writer') || text.includes('copy')) return 'knowledge';
  return 'generalist';
}

function activityForZone(zone: string): Activity {
  if (zone === 'product') return 'thinking';
  if (zone === 'quality' || zone === 'decision') return 'reviewing';
  return 'typing';
}

function OfficeDock() {
  const router = useRouter();
  const dockApps = useMemo<DockApp[]>(() => DASHBOARD_DOCK_ACTIONS.map((action) => {
    const Icon = action.icon;
    return {
      id: action.id,
      name: action.label,
      icon: (
        <span className={`office-dock-app-icon bg-gradient-to-br ${action.color}`}>
          <Icon className="h-[46%] w-[46%] text-white" strokeWidth={2.3} />
        </span>
      ),
    };
  }), []);

  const handleDockClick = useCallback((appId: string) => {
    const action = DASHBOARD_DOCK_ACTIONS.find((item) => item.id === appId);
    if (action?.href) {
      router.push(action.href);
    }
  }, [router]);

  return (
    <div className="office-dock-stage" aria-label="办公室快捷入口">
      <MacOSDock
        apps={dockApps}
        onAppClick={handleDockClick}
        surfaceClassName="office-dock-surface"
        tooltipClassName="office-dock-tooltip"
      />
    </div>
  );
}

function candidateNamesForRequest(candidateAgentNames: string[], agents: OfficeAgent[]) {
  const availableNames = new Set(agents.map((agent) => agent.name));
  const scoped = candidateAgentNames.filter((name) => availableNames.has(name));
  if (!scoped.length || scoped.length >= agents.length) return undefined;
  return scoped;
}

function sampleAgentPreview(agents: OfficeAgent[], limit = 6) {
  const next = [...agents];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next.slice(0, limit);
}

function AgentScopeDialog({
  open,
  onOpenChange,
  agents,
  candidateAgentNames,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: OfficeAgent[];
  candidateAgentNames: string[];
  onApply: (agentNames: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [draftNames, setDraftNames] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setDraftNames(new Set(candidateAgentNames.length ? candidateAgentNames : agents.map((agent) => agent.name)));
  }, [agents, candidateAgentNames, open]);

  const filteredAgents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return agents;
    return agents.filter((agent) => [
      agent.name,
      displayName(agent),
      agent.category,
      ...(agent.tags || []),
      ...(agent.capabilities || []),
      ...(agent.skills || []),
    ].filter(Boolean).join(' ').toLowerCase().includes(normalized));
  }, [agents, query]);

  const zones = useMemo(() => {
    const grouped = new Map<string, OfficeAgent[]>();
    for (const agent of agents) {
      const zone = zoneOf(agent);
      grouped.set(zone, [...(grouped.get(zone) || []), agent]);
    }
    return [...grouped.entries()].sort((a, b) => (ZONES[a[0]]?.weight ?? 99) - (ZONES[b[0]]?.weight ?? 99));
  }, [agents]);

  const toggleAgent = useCallback((agentName: string, checked: boolean) => {
    setDraftNames((current) => {
      const next = new Set(current);
      if (checked) next.add(agentName);
      else next.delete(agentName);
      return next;
    });
  }, []);

  const toggleZone = useCallback((zone: string) => {
    const names = (zones.find(([key]) => key === zone)?.[1] || []).map((agent) => agent.name);
    if (!names.length) return;
    setDraftNames((current) => {
      const next = new Set(current);
      const allSelected = names.every((name) => next.has(name));
      for (const name of names) {
        if (allSelected) next.delete(name);
        else next.add(name);
      }
      return next;
    });
  }, [zones]);

  const selectedCount = draftNames.size;
  const allSelected = selectedCount >= agents.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl gap-5 rounded-3xl p-0">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <SlidersHorizontal className="h-5 w-5 text-blue-600" />
            候选 Agent 范围
          </DialogTitle>
          <DialogDescription>
            这里决定后续生成团队时可以从哪些 Agent 中挑选。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 px-6 md:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <div className="rounded-2xl border bg-muted/40 p-3">
              <div className="text-xs font-semibold text-muted-foreground">当前范围</div>
              <div className="mt-1 text-2xl font-black">{allSelected ? '全部' : selectedCount}</div>
              <div className="text-xs text-muted-foreground">共 {agents.length} 个 Agent</div>
            </div>
            <div className="space-y-2">
              <Button type="button" variant="outline" className="w-full justify-start" onClick={() => setDraftNames(new Set(agents.map((agent) => agent.name)))}>
                全选
              </Button>
              <Button type="button" variant="outline" className="w-full justify-start" onClick={() => setDraftNames(new Set())}>
                清空
              </Button>
            </div>
            <div className="space-y-2">
              {zones.map(([zone, zoneAgents]) => {
                const meta = ZONES[zone] || ZONES.generalist;
                const checked = zoneAgents.every((agent) => draftNames.has(agent.name));
                return (
                  <button
                    key={zone}
                    type="button"
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-xs font-bold transition ${checked ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-200' : 'bg-background hover:bg-muted'}`}
                    onClick={() => toggleZone(zone)}
                  >
                    <span>{meta.label}</span>
                    <span>{zoneAgents.length}</span>
                  </button>
                );
              })}
            </div>
          </aside>
          <section className="min-w-0 space-y-3">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、能力、技能或标签" />
            <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
              {filteredAgents.map((agent) => {
                const zone = ZONES[zoneOf(agent)] || ZONES.generalist;
                const checked = draftNames.has(agent.name);
                return (
                  <label
                    key={agent.name}
                    className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-3 transition ${checked ? 'border-blue-300 bg-blue-50/80 dark:border-blue-500/50 dark:bg-blue-500/10' : 'bg-background hover:bg-muted/60'}`}
                  >
                    <Checkbox checked={checked} onCheckedChange={(value) => toggleAgent(agent.name, value === true)} />
                    <SpriteAvatar
                      avatar={resolveAgentAvatarSrc(agent.avatar, agent.name, { team: agent.team || 'blue', roleType: agent.roleType || 'normal' })}
                      seed={agent.name}
                      category="agent-default"
                      alt={displayName(agent)}
                      fallback={initials(displayName(agent))}
                      className="h-10 w-10"
                      fallbackClassName="text-[10px]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-black">{displayName(agent)}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        <span>{zone.label}</span>
                        {agent.category ? <span>· {agent.category}</span> : null}
                        {(agent.skills || []).slice(0, 2).map((skill) => <Badge key={skill} variant="outline" className="h-5 px-1.5 text-[10px]">{skill}</Badge>)}
                      </span>
                    </span>
                  </label>
                );
              })}
              {!filteredAgents.length ? (
                <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  没有匹配的 Agent
                </div>
              ) : null}
            </div>
          </section>
        </div>
        <DialogFooter className="border-t px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            type="button"
            onClick={() => {
              const names = [...draftNames].filter((name) => agents.some((agent) => agent.name === name));
              onApply(names.length >= agents.length ? [] : names);
              onOpenChange(false);
            }}
          >
            应用范围
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeamComposer({
  prompt,
  setPrompt,
  onBuild,
  onFilterClick,
  busy,
  previewAgents,
  planReady,
  filterActive,
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  onBuild: () => void;
  onFilterClick: () => void;
  busy: boolean;
  previewAgents: OfficeAgent[];
  planReady: boolean;
  filterActive: boolean;
}) {
  return (
    <section className="mx-auto w-full max-w-5xl rounded-[30px] border border-white/70 bg-white/72 p-4 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg">
          <Sparkles className="h-5 w-5" />
        </div>
        <AnimatedGlowingSearchBar
          value={prompt}
          onChange={setPrompt}
          onEnter={onBuild}
          onFilterClick={onFilterClick}
          filterActive={filterActive}
          disabled={busy}
          className="flex-1"
          placeholder="说出目标，例如：做一个 App，帮我组建产品、设计、开发、测试团队"
        />
        <div className="flex items-center justify-between gap-3">
          <div className="hidden -space-x-2 lg:flex">
            {previewAgents.slice(0, 6).map((agent) => (
              <SpriteAvatar
                key={agent.name}
                avatar={resolveAgentAvatarSrc(agent.avatar, agent.name, { team: agent.team || 'blue', roleType: agent.roleType || 'normal' })}
                seed={agent.name}
                category="agent-default"
                alt={displayName(agent)}
                fallback={initials(displayName(agent))}
                className="h-9 w-9 border-2 border-white shadow-sm"
                fallbackClassName="text-[10px]"
              />
            ))}
          </div>
          <RainbowBordersButton
            className="h-11"
            onClick={onBuild}
            disabled={busy || (planReady ? false : !prompt.trim())}
          >
            <Send className="mr-2 h-4 w-4" />
            {busy ? '处理中' : planReady ? '确认团队' : '生成团队'}
          </RainbowBordersButton>
        </div>
      </div>
    </section>
  );
}

function defaultClarificationAnswers(clarification: OfficeOrgClarification): Record<string, string | string[]> {
  const answers: Record<string, string | string[]> = {};
  for (const question of clarification.questions || []) {
    const recommended = question.options.find((option) => option.recommended) || question.options[0];
    if (!recommended) continue;
    answers[question.id] = question.selectionMode === 'multiple' ? [recommended.id] : recommended.id;
  }
  return answers;
}

function answerLabels(question: OfficeOrgClarificationQuestion, value: string | string[] | undefined) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .map((id) => question.options.find((option) => option.id === id)?.label || id)
    .filter(Boolean);
}

function buildTeamRequirementWithAnswers(
  requirement: string,
  clarification: OfficeOrgClarification | null,
  answers: Record<string, string | string[]>
) {
  const answerLines = (clarification?.questions || [])
    .map((question) => {
      const labels = answerLabels(question, answers[question.id]);
      return labels.length ? `- ${question.label}：${labels.join('、')}` : '';
    })
    .filter(Boolean);
  return [
    requirement.trim(),
    answerLines.length ? `补充回答：\n${answerLines.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

function teamSizeFromAnswers(answers: Record<string, string | string[]>) {
  const value = answers.team_size;
  const size = Array.isArray(value) ? value[0] : value;
  if (size === 'large') return { minMembers: 8, maxMembers: 12 };
  if (size === 'standard') return { minMembers: 6, maxMembers: 8 };
  return { minMembers: 4, maxMembers: 6 };
}

function TeamBuilderFlowModal({
  open,
  onOpenChange,
  requirement,
  onRequirementChange,
  agents,
  candidateAgentNames,
  initialPlan,
  onPlanReady,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requirement: string;
  onRequirementChange: (value: string) => void;
  agents: OfficeAgent[];
  candidateAgentNames: string[];
  initialPlan: OfficeTeamPlan | null;
  onPlanReady: (plan: OfficeTeamPlan) => void;
  onApply: (input: { plan: OfficeTeamPlan; draftId?: string }) => Promise<void>;
}) {
  const [step, setStep] = useState<TeamBuilderStep>('goal');
  const [localRequirement, setLocalRequirement] = useState(requirement);
  const [clarification, setClarification] = useState<OfficeOrgClarification | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [draft, setDraft] = useState<OfficeOrgDraft | null>(null);
  const [plan, setPlan] = useState<OfficeTeamPlan | null>(initialPlan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setLocalRequirement(requirement);
    setClarification(null);
    setAnswers({});
    setDraft(null);
    setPlan(initialPlan);
    setStep(initialPlan ? 'confirm' : 'goal');
    setError('');
    setBusy(false);
  }, [initialPlan, open, requirement]);

  const scopedCandidateNames = useMemo(
    () => candidateNamesForRequest(candidateAgentNames, agents),
    [agents, candidateAgentNames]
  );
  const scopeLabel = scopedCandidateNames ? `${scopedCandidateNames.length} 个候选 Agent` : `全部 ${agents.length} 个 Agent`;

  const updateAnswer = useCallback((question: OfficeOrgClarificationQuestion, optionId: string) => {
    setAnswers((current) => {
      if (question.selectionMode === 'multiple') {
        const values = Array.isArray(current[question.id]) ? [...(current[question.id] as string[])] : [];
        const exists = values.includes(optionId);
        return {
          ...current,
          [question.id]: exists ? values.filter((value) => value !== optionId) : [...values, optionId],
        };
      }
      return { ...current, [question.id]: optionId };
    });
  }, []);

  const generateClarification = useCallback(async () => {
    const nextRequirement = localRequirement.trim();
    if (!nextRequirement) {
      setError('先说清楚你要搭建什么团队。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      onRequirementChange(nextRequirement);
      const res = await fetch('/api/office/org/clarify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requirement: nextRequirement,
          candidateAgentNames: scopedCandidateNames,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || data?.error || '生成补充问题失败');
      const nextClarification = data.clarification as OfficeOrgClarification;
      setClarification(nextClarification);
      setAnswers(defaultClarificationAnswers(nextClarification));
      setStep('clarify');
    } catch (error: any) {
      setError(error?.message || '生成补充问题失败');
    } finally {
      setBusy(false);
    }
  }, [localRequirement, onRequirementChange, scopedCandidateNames]);

  const generateDraft = useCallback(async () => {
    const nextRequirement = buildTeamRequirementWithAnswers(localRequirement, clarification, answers);
    if (!nextRequirement.trim()) {
      setError('团队目标不能为空。');
      return;
    }
    setBusy(true);
    setError('');
    setStep('draft');
    try {
      const size = teamSizeFromAnswers(answers);
      const planRes = await fetch('/api/office/team/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requirement: nextRequirement,
          ...size,
          candidateAgentNames: scopedCandidateNames,
        }),
      });
      const planData = await planRes.json();
      if (!planRes.ok) throw new Error(planData?.message || planData?.error || '生成团队草案失败');
      const nextPlan = planData.plan as OfficeTeamPlan;

      const draftRes = await fetch('/api/office/org/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requirement: nextRequirement,
          plan: nextPlan,
          mode: 'heuristic',
          clarificationAnswers: answers,
        }),
      });
      const draftData = await draftRes.json();
      if (!draftRes.ok) throw new Error(draftData?.message || draftData?.error || '保存组织草案失败');
      setPlan(nextPlan);
      setDraft(draftData.draft || null);
      onPlanReady(nextPlan);
      setStep('confirm');
    } catch (error: any) {
      setError(error?.message || '生成团队草案失败');
      setStep('clarify');
    } finally {
      setBusy(false);
    }
  }, [answers, clarification, localRequirement, onPlanReady, scopedCandidateNames]);

  const applyDraft = useCallback(async () => {
    if (!plan) return;
    setBusy(true);
    setError('');
    try {
      await onApply({ plan, draftId: draft?.id });
      onOpenChange(false);
    } catch (error: any) {
      setError(error?.message || '确认创建失败');
    } finally {
      setBusy(false);
    }
  }, [draft?.id, onApply, onOpenChange, plan]);

  const stepItems: Array<{ key: TeamBuilderStep; label: string }> = [
    { key: 'goal', label: '目标' },
    { key: 'clarify', label: '问答' },
    { key: 'draft', label: '草案' },
    { key: 'confirm', label: '确认' },
  ];
  const stepIndex = stepItems.findIndex((item) => item.key === step);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl gap-0 overflow-hidden rounded-3xl p-0">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-blue-600" />
            组建一人公司团队
          </DialogTitle>
          <DialogDescription>先补齐关键上下文，再生成候选团队，确认后才写入办公室。</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-[560px] md:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="border-r bg-muted/30 p-5">
            <div className="space-y-3">
              {stepItems.map((item, index) => (
                <div
                  key={item.key}
                  className={`flex items-center gap-3 rounded-2xl px-3 py-2 text-sm font-bold ${index <= stepIndex ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
                >
                  <span className={`grid h-7 w-7 place-items-center rounded-full text-xs ${index <= stepIndex ? 'bg-blue-600 text-white' : 'bg-muted text-muted-foreground'}`}>
                    {index + 1}
                  </span>
                  {item.label}
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-2xl border bg-background/70 p-3 text-xs text-muted-foreground">
              <div className="font-bold text-foreground">候选范围</div>
              <div className="mt-1">{scopeLabel}</div>
            </div>
          </aside>
          <section className="min-w-0 p-6">
            {step === 'goal' ? (
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-black">你想搭建什么团队？</div>
                  <Textarea
                    value={localRequirement}
                    onChange={(event) => setLocalRequirement(event.target.value)}
                    className="mt-2 min-h-[150px] resize-none text-base"
                    placeholder="例如：帮我搭建一个 App 开发团队，先做 MVP，覆盖产品、设计、开发、测试和评审。"
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border p-4">
                    <ClipboardList className="h-5 w-5 text-blue-600" />
                    <div className="mt-2 text-sm font-black">先问答</div>
                    <p className="mt-1 text-xs text-muted-foreground">生成前会补齐目标产物、规模、你的角色和成员来源。</p>
                  </div>
                  <div className="rounded-2xl border p-4">
                    <UsersRound className="h-5 w-5 text-emerald-600" />
                    <div className="mt-2 text-sm font-black">再编队</div>
                    <p className="mt-1 text-xs text-muted-foreground">只从当前候选范围里挑选 Agent，不提前写入配置。</p>
                  </div>
                  <div className="rounded-2xl border p-4">
                    <CheckCircle2 className="h-5 w-5 text-purple-600" />
                    <div className="mt-2 text-sm font-black">最后确认</div>
                    <p className="mt-1 text-xs text-muted-foreground">你确认后才更新办公室常驻成员和组织草案。</p>
                  </div>
                </div>
              </div>
            ) : null}

            {step === 'clarify' && clarification ? (
              <div className="space-y-4">
                <div className="rounded-2xl border bg-blue-50/70 p-4 text-sm text-blue-950 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-100">
                  <div className="font-black">{clarification.summary}</div>
                  {clarification.knownFacts.length ? (
                    <div className="mt-2 text-xs opacity-80">{clarification.knownFacts.join(' / ')}</div>
                  ) : null}
                </div>
                <div className="space-y-4">
                  {clarification.questions.map((question) => (
                    <div key={question.id} className="rounded-2xl border p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-black">{question.question}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{question.label}</div>
                        </div>
                        {question.required ? <Badge variant="outline">必填</Badge> : null}
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {question.options.map((option) => {
                          const current = answers[question.id];
                          const selected = Array.isArray(current) ? current.includes(option.id) : current === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              className={`rounded-2xl border p-3 text-left transition ${selected ? 'border-blue-400 bg-blue-50 text-blue-950 dark:border-blue-500/60 dark:bg-blue-500/15 dark:text-blue-100' : 'bg-background hover:bg-muted/60'}`}
                              onClick={() => updateAnswer(question, option.id)}
                            >
                              <div className="flex items-center justify-between gap-2 text-sm font-black">
                                <span>{option.label}</span>
                                {option.recommended ? <Badge variant="secondary">推荐</Badge> : null}
                              </div>
                              {option.description ? <p className="mt-1 text-xs text-muted-foreground">{option.description}</p> : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {step === 'draft' ? (
              <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center">
                <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
                <div className="mt-4 text-lg font-black">正在生成团队草案</div>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">会结合你的回答和候选 Agent 范围，生成一个可确认的组织草案。</p>
              </div>
            ) : null}

            {step === 'confirm' && plan ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-black">候选团队</div>
                    <div className="text-sm text-muted-foreground">{plan.members.length} 位成员 / {plan.availableAgentCount} 个候选 Agent</div>
                  </div>
                  {plan.missingZones.length ? <Badge variant="destructive">有 {plan.missingZones.length} 个职责缺口</Badge> : <Badge variant="outline">职责完整</Badge>}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {sortPlanMembers(plan.members).map((member) => {
                    const zone = ZONES[member.zone] || ZONES.generalist;
                    return (
                      <div key={member.agentName} className="rounded-2xl border p-4" style={{ ['--zone' as any]: zone.color }}>
                        <div className="flex items-center gap-3">
                          <SpriteAvatar
                            avatar={resolveAgentAvatarSrc(member.agent.avatar, member.agentName, { team: member.agent.team || 'blue', roleType: member.agent.roleType || 'normal' })}
                            seed={member.agentName}
                            category="agent-default"
                            alt={member.displayName}
                            fallback={initials(member.displayName)}
                            className="h-10 w-10"
                            fallbackClassName="text-[10px]"
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-black">{member.displayName}</div>
                            <div className="text-xs font-bold" style={{ color: zone.color }}>{zone.label}</div>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1">
                          {(member.matchReasons.length ? member.matchReasons : [member.officeRole]).slice(0, 3).map((reason) => (
                            <Badge key={reason} variant="outline" className="text-[10px]">{reason}</Badge>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {draft?.gaps?.length ? (
                  <div className="rounded-2xl border border-amber-300/50 bg-amber-50/80 p-4 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                    <div className="font-black">缺口</div>
                    <ul className="mt-2 space-y-1">
                      {draft.gaps.map((gap) => <li key={gap.id}>{gap.title}：{gap.description}</li>)}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <div className="mt-4 rounded-2xl border border-red-300/60 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
                {error}
              </div>
            ) : null}
          </section>
        </div>
        <DialogFooter className="border-t px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button>
          {step === 'clarify' ? <Button type="button" variant="outline" onClick={() => setStep('goal')} disabled={busy}>上一步</Button> : null}
          {step === 'confirm' && !initialPlan ? <Button type="button" variant="outline" onClick={() => setStep('clarify')} disabled={busy}>继续调整</Button> : null}
          {step === 'goal' ? (
            <Button type="button" onClick={() => void generateClarification()} disabled={busy || !localRequirement.trim()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              生成补充问题
            </Button>
          ) : null}
          {step === 'clarify' ? (
            <Button type="button" onClick={() => void generateDraft()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              生成团队草案
            </Button>
          ) : null}
          {step === 'confirm' && plan ? (
            <Button type="button" onClick={() => void applyDraft()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              确认创建
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function memberZone(member: OfficeMember) {
  return member.visual.zone || zoneOf(member.agent);
}

function memberAvatar(member: OfficeMember) {
  return resolveAgentAvatarSrc(member.agent.avatar, member.agent.name, {
    team: member.agent.team || 'blue',
    roleType: member.agent.roleType || 'normal',
  });
}

function ArchitectureDiagram({
  members,
  availableAgents,
  planReady,
  onAddAgent,
  onReplaceAgent,
  onRemoveAgent,
}: {
  members: OfficeMember[];
  availableAgents: OfficeAgent[];
  planReady: boolean;
  onAddAgent: (agentName: string) => void;
  onReplaceAgent: (currentAgentName: string, nextAgentName: string) => void;
  onRemoveAgent: (agentName: string) => void;
}) {
  const [manageMode, setManageMode] = useState(false);
  const [selectedAgentName, setSelectedAgentName] = useState<string | null>(members[0]?.agentName || null);
  const [addSelectKey, setAddSelectKey] = useState(0);
  const sortedMembers = useMemo(() => sortOrgMembers(members), [members]);
  const leader = sortedMembers.find((member) => memberZone(member) === 'core') || sortedMembers[0];
  const reports = leader ? sortedMembers.filter((member) => member.agentName !== leader.agentName) : sortedMembers;
  const usedAgentNames = useMemo(() => new Set(sortedMembers.map((member) => member.agentName)), [sortedMembers]);
  const availableToAdd = useMemo(
    () => availableAgents.filter((agent) => !usedAgentNames.has(agent.name)),
    [availableAgents, usedAgentNames]
  );
  const selectedMember = sortedMembers.find((member) => member.agentName === selectedAgentName) || leader || sortedMembers[0];
  const selectedZoneMeta = selectedMember ? ZONES[memberZone(selectedMember)] || ZONES.generalist : ZONES.generalist;
  const leaderZone = leader ? ZONES[memberZone(leader)] || ZONES.core : ZONES.core;
  const memberCount = members.length;

  useEffect(() => {
    if (!sortedMembers.length) {
      setSelectedAgentName(null);
      return;
    }
    if (!selectedAgentName || !sortedMembers.some((member) => member.agentName === selectedAgentName)) {
      setSelectedAgentName((leader || sortedMembers[0]).agentName);
    }
  }, [leader, selectedAgentName, sortedMembers]);

  const handleAddAgent = useCallback((agentName: string) => {
    onAddAgent(agentName);
    setAddSelectKey((value) => value + 1);
    setManageMode(true);
    setSelectedAgentName(agentName);
  }, [onAddAgent]);

  return (
    <section className="org-manager">
      <div className="org-reference-title">
        <h2>OPC Company Roles</h2>
        <div className="org-reference-subtitle">
          <span />
          <p>One Team. AI-Powered. Maximum Impact.</p>
          <span />
        </div>
        <div className="org-header-actions">
          <span className="org-status-pill">{planReady ? '组织草案待确认' : `${memberCount} 个成员`}</span>
          <Select key={addSelectKey} onValueChange={handleAddAgent} disabled={!availableToAdd.length}>
            <SelectTrigger className="org-add-trigger" aria-label="添加组织成员">
              <SelectValue placeholder={availableToAdd.length ? '添加成员' : '暂无可添加'} />
            </SelectTrigger>
            <SelectContent>
              {availableToAdd.map((agent) => {
                const zone = ZONES[zoneOf(agent)] || ZONES.generalist;
                return (
                  <SelectItem key={agent.name} value={agent.name}>
                    {displayName(agent)} / {zone.label}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Button type="button" className="org-mode-button" onClick={() => setManageMode((value) => !value)}>
            <Pencil className="h-4 w-4" />
            {manageMode ? '退出管理' : '管理组织'}
          </Button>
        </div>
      </div>

      <div className="org-blueprint">
        {leader ? (
          <button
            type="button"
            className={`org-core-card ${selectedMember?.agentName === leader.agentName ? 'org-node-selected' : ''}`}
            style={{ ['--zone' as any]: leaderZone.color }}
            onClick={() => {
              setSelectedAgentName(leader.agentName);
              if (manageMode) setManageMode(true);
            }}
          >
            <div className="org-core-avatar">
              <SpriteAvatar avatar={memberAvatar(leader)} seed={leader.agentName} category="agent-default" alt={leader.displayName} fallback={initials(leader.displayName)} className="h-full w-full" fallbackClassName="text-sm" />
            </div>
            <div className="org-core-content">
              <div className="org-role-title">{memberRoleLabel(leader)}</div>
              <div className="org-agent-name">{leader.nickname || leader.displayName}</div>
              <div className="org-core-missions">
                <span><Target className="h-4 w-4" /> Set Direction</span>
                <span><CheckCircle2 className="h-4 w-4" /> Make Key Decisions</span>
                <span><GitBranch className="h-4 w-4" /> Drive Alignment</span>
              </div>
            </div>
          </button>
        ) : (
          <div className="org-empty-state">
            <Building2 className="h-10 w-10" />
            <strong>还没有办公室成员</strong>
            <p>从现有 Agent 中添加第一个成员，形成组织草案后再确认写入办公室。</p>
          </div>
        )}

        <div className="org-core-side">
          <div className="org-side-title">OPC Core</div>
          {OPC_CORE_ITEMS.map(([mark, label]) => (
            <div key={mark} className="org-core-item">
              <span>{mark}</span>
              {label}
            </div>
          ))}
        </div>

        {reports.length ? <div className="org-connector" style={{ ['--org-count' as any]: reports.length }} aria-hidden="true" /> : null}

        <div className="org-member-grid" style={{ ['--org-count' as any]: Math.max(1, reports.length) }}>
          {reports.map((member) => (
            <OrgMemberCard
              key={member.agentName}
              member={member}
              selected={selectedMember?.agentName === member.agentName}
              manageMode={manageMode}
              availableAgents={availableAgents}
              usedAgentNames={usedAgentNames}
              onSelect={() => {
                setSelectedAgentName(member.agentName);
                if (!manageMode) return;
                setManageMode(true);
              }}
              onReplaceAgent={onReplaceAgent}
              onRemoveAgent={onRemoveAgent}
            />
          ))}
        </div>

        <div className="org-powered-strip">
          <div className="org-powered-title">Powered By <span>ACE Harness</span></div>
          <div className="org-powered-items">
            {POWERED_BY_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="org-powered-item">
                  <Icon className="h-5 w-5" />
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="org-ace-banner">
          <span className="org-ace-mark">A</span>
          <strong>ACE</strong>
          <p>OPC is a super team of <b>people and AI</b>, creating <b>maximum impact</b> together.</p>
        </div>
      </div>

      {selectedMember ? (
        <aside className={`org-editor ${manageMode ? 'org-editor-open' : ''}`} style={{ ['--zone' as any]: selectedZoneMeta.color }}>
          <div className="org-panel-title">
            <GitBranch className="h-4 w-4" />
            组织管理
          </div>
          <div className="org-editor-main">
            <SpriteAvatar avatar={memberAvatar(selectedMember)} seed={selectedMember.agentName} category="agent-default" alt={selectedMember.displayName} fallback={initials(selectedMember.displayName)} className="org-editor-avatar" fallbackClassName="text-sm" />
            <div>
              <span>{selectedZoneMeta.label}</span>
              <strong>{selectedMember.nickname || selectedMember.displayName}</strong>
              <p>{memberRoleLabel(selectedMember)}</p>
            </div>
          </div>
          <div className="org-editor-section">
            <div className="org-editor-label">职责边界</div>
            <div className="org-editor-tags">
              {memberSkillTags(selectedMember).map((item) => <span key={item}>{item}</span>)}
            </div>
          </div>
          <div className="org-editor-section">
            <div className="org-editor-label">替换成员</div>
            <Select
              value={selectedMember.agentName}
              onValueChange={(agentName) => {
                if (agentName !== selectedMember.agentName) {
                  onReplaceAgent(selectedMember.agentName, agentName);
                  setSelectedAgentName(agentName);
                }
              }}
            >
              <SelectTrigger className="org-select-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableAgents
                  .filter((agent) => agent.name === selectedMember.agentName || !usedAgentNames.has(agent.name))
                  .map((agent) => (
                    <SelectItem key={agent.name} value={agent.name}>
                      {displayName(agent)} / {(ZONES[zoneOf(agent)] || ZONES.generalist).label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <div className="org-editor-hint">
              {planReady ? '当前是组织草案，确认前不会写入 Agent YAML。' : '选择后会创建可确认的手动组织草案。'}
            </div>
          </div>
          <div className="org-editor-actions">
            <Button type="button" variant="outline" onClick={() => setManageMode(true)}>编辑关系</Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                onRemoveAgent(selectedMember.agentName);
                setSelectedAgentName(leader?.agentName || sortedMembers[0]?.agentName || null);
              }}
            >
              删除成员
            </Button>
          </div>
        </aside>
      ) : null}
    </section>
  );
}

function sortOrgMembers(members: OfficeMember[]) {
  return [...members].sort((a, b) => {
    const zoneDiff = (ZONES[memberZone(a)]?.weight ?? 99) - (ZONES[memberZone(b)]?.weight ?? 99);
    if (zoneDiff) return zoneDiff;
    const orderDiff = (a.visual.order ?? 999) - (b.visual.order ?? 999);
    if (orderDiff) return orderDiff;
    return (a.nickname || a.displayName).localeCompare(b.nickname || b.displayName, 'zh-Hans-CN');
  });
}

function memberRoleLabel(member: OfficeMember) {
  const zone = memberZone(member);
  return member.officeRole || ZONES[zone]?.label || ZONES.generalist.label;
}

function memberSkillTags(member: OfficeMember) {
  const zone = memberZone(member);
  const source = [
    ...(member.agent.capabilities || []),
    ...(member.agent.skills || []),
    ...(member.agent.tags || []),
  ].filter(Boolean);
  const fallback = [ZONES[zone]?.brief || ZONES.generalist.brief, member.agent.category || '协作成员'];
  return [...new Set(source.length ? source : fallback)].slice(0, 4);
}

function OrgMemberCard({
  member,
  selected,
  manageMode,
  availableAgents,
  usedAgentNames,
  onSelect,
  onReplaceAgent,
  onRemoveAgent,
}: {
  member: OfficeMember;
  selected: boolean;
  manageMode: boolean;
  availableAgents: OfficeAgent[];
  usedAgentNames: Set<string>;
  onSelect: () => void;
  onReplaceAgent: (currentAgentName: string, nextAgentName: string) => void;
  onRemoveAgent: (agentName: string) => void;
}) {
  const zoneKey = memberZone(member);
  const zone = ZONES[zoneKey] || ZONES.generalist;
  const RoleIcon = ROLE_ICONS[zoneKey] || Bot;
  const replaceOptions = availableAgents.filter((agent) => agent.name === member.agentName || !usedAgentNames.has(agent.name));
  return (
    <article
      className={`org-member-card ${selected ? 'org-node-selected' : ''}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
      style={{ ['--zone' as any]: zone.color }}
    >
      <div className="org-member-card-header">
        <span>{zone.label}</span>
        <RoleIcon className="h-4 w-4" />
      </div>
      <div className="org-member-main">
        <SpriteAvatar avatar={memberAvatar(member)} seed={member.agentName} category="agent-default" alt={member.displayName} fallback={initials(member.displayName)} className="org-member-avatar" fallbackClassName="text-sm" />
        <div>
          <strong>{member.nickname || member.displayName}</strong>
          <span>{memberRoleLabel(member)}</span>
        </div>
      </div>
      <div className="org-member-mission">
        <RoleIcon className="h-5 w-5" />
        <span>{zone.brief}</span>
      </div>
      <div className="org-member-tags">
        {memberSkillTags(member).map((item) => <span key={item}>{item}</span>)}
      </div>
      {manageMode ? (
        <div className="org-member-controls" onClick={(event) => event.stopPropagation()}>
          <Select
            value={member.agentName}
            onValueChange={(agentName) => {
              if (agentName !== member.agentName) onReplaceAgent(member.agentName, agentName);
            }}
          >
            <SelectTrigger className="org-select-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {replaceOptions.map((agent) => (
                <SelectItem key={agent.name} value={agent.name}>
                  {displayName(agent)} / {(ZONES[zoneOf(agent)] || ZONES.generalist).label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" className="org-remove-button" onClick={() => onRemoveAgent(member.agentName)}>
            删除
          </Button>
        </div>
      ) : (
        <div className="org-member-copilot">
        <Bot className="h-5 w-5" />
        <div>
          <strong>AI Copilot</strong>
          <span>{member.agent.category || 'Office Agent'}</span>
        </div>
      </div>
      )}
    </article>
  );
}

type OfficePresence = 'seated_work' | 'thinking_at_desk' | 'visiting_peer' | 'hosting_peer';
type OfficeScreenScene = 'coding' | 'testing' | 'planning' | 'reviewing' | 'ops';
type OfficeSpriteGender = 'male' | 'female';
type OfficeSpriteDirection = 'left' | 'right';
type OfficeInteractionRole = 'visitor' | 'host';
type OfficePresencePlan = {
  member: OfficeMember;
  activity: Activity;
  presence: OfficePresence;
  gender: OfficeSpriteGender;
  interactionRole?: OfficeInteractionRole;
  targetIndex?: number;
};
type OfficeInteractionRoute = {
  visitorPlan: OfficePresencePlan;
  visitorIndex: number;
  hostPlan: OfficePresencePlan;
  hostIndex: number;
  routeOffset: number;
};
type OfficeInteractionPair = {
  visitorIndex: number;
  hostIndex: number;
};

function presenceForActivity(activity: Activity): OfficePresence {
  if (activity === 'thinking' || activity === 'reviewing') return 'thinking_at_desk';
  return 'seated_work';
}

function statusTextForPresence(presence: OfficePresence) {
  if (presence === 'seated_work') return '办公中';
  if (presence === 'thinking_at_desk') return '思考中';
  if (presence === 'visiting_peer') return '走动中';
  return '交流中';
}

function screenSceneForOfficePlan(plan: OfficePresencePlan, index: number): OfficeScreenScene {
  const zone = memberZone(plan.member);
  if (plan.activity === 'reviewing' || zone === 'decision') return 'reviewing';
  if (zone === 'quality') return 'testing';
  if (zone === 'product' || zone === 'design' || zone === 'core') return 'planning';
  if (zone === 'engineering') return 'coding';
  return index % 2 === 0 ? 'coding' : 'ops';
}

function baseActivityForOfficeDisplay(member: OfficeMember, index: number): Activity {
  const configured = member.motion?.activity;
  if (configured === 'typing' || configured === 'thinking' || configured === 'reviewing') return configured;
  if (configured === 'walking' || configured === 'talking' || configured === 'presenting') {
    return activityForZone(member.visual.zone || zoneOf(member.agent));
  }
  if (index % 7 === 4) return 'thinking';
  return activityForZone(member.visual.zone || zoneOf(member.agent));
}

function spriteGenderForMember(member: OfficeMember, index: number): OfficeSpriteGender {
  const text = `${member.agentName} ${member.displayName} ${member.nickname || ''} ${member.agent.title || ''}`.toLowerCase();
  if (/\b(female|woman|girl|she|her)\b/.test(text) || text.includes('女')) return 'female';
  if (/\b(male|man|boy|he|him)\b/.test(text) || text.includes('男')) return 'male';
  return index % 3 === 1 ? 'female' : 'male';
}

function isInteractionPreferred(member: OfficeMember) {
  const configured = member.motion?.activity;
  return configured === 'walking' || configured === 'talking' || configured === 'presenting';
}

function indexesShareOfficeColumn(firstIndex: number, secondIndex: number, total: number) {
  return Math.abs(officePositionForIndex(firstIndex, total).x - officePositionForIndex(secondIndex, total).x) < 8;
}

function findAvailableMemberIndex(
  plans: OfficePresencePlan[],
  zones: string[],
  usedIndexes: Set<number>,
  excludeIndex?: number
) {
  const zoneSet = new Set(zones);
  const candidates = plans
    .map((plan, index) => ({ plan, index }))
    .filter(({ plan, index }) => (
    !usedIndexes.has(index)
    && index !== excludeIndex
    && zoneSet.has(memberZone(plan.member))
    ));

  if (typeof excludeIndex === 'number') {
    const differentColumn = candidates.find(({ index }) => !indexesShareOfficeColumn(index, excludeIndex, plans.length));
    if (differentColumn) return differentColumn.index;
  }

  return candidates[0]?.index ?? -1;
}

function buildOfficeInteractionPairs(plans: OfficePresencePlan[]): OfficeInteractionPair[] {
  if (plans.length < 2) return [];

  const maxPairs = 1;
  const pairs: OfficeInteractionPair[] = [];
  const usedIndexes = new Set<number>();
  const preferredVisitors = plans
    .map((plan, index) => ({ plan, index }))
    .filter(({ plan }) => isInteractionPreferred(plan.member));
  const relationshipRules = [
    { visitors: ['product'], hosts: ['engineering', 'design'] },
    { visitors: ['design'], hosts: ['engineering', 'product'] },
    { visitors: ['quality', 'decision'], hosts: ['engineering', 'product'] },
    { visitors: ['core'], hosts: ['product', 'engineering'] },
    { visitors: ['growth', 'operations', 'knowledge'], hosts: ['product', 'engineering', 'core'] },
  ];

  const addPair = (visitorIndex: number, hostIndex: number) => {
    if (visitorIndex < 0 || hostIndex < 0 || visitorIndex === hostIndex) return false;
    if (usedIndexes.has(visitorIndex) || usedIndexes.has(hostIndex)) return false;
    pairs.push({ visitorIndex, hostIndex });
    usedIndexes.add(visitorIndex);
    usedIndexes.add(hostIndex);
    return true;
  };

  for (const preferred of preferredVisitors) {
    if (pairs.length >= maxPairs) break;
    const visitorZone = memberZone(preferred.plan.member);
    const rule = relationshipRules.find((item) => item.visitors.includes(visitorZone));
    const hostIndex = rule
      ? findAvailableMemberIndex(plans, rule.hosts, usedIndexes, preferred.index)
      : plans.findIndex((_plan, index) => !usedIndexes.has(index) && index !== preferred.index);
    addPair(preferred.index, hostIndex);
  }

  return pairs;
}

function buildOfficePresencePlan(members: OfficeMember[]): OfficePresencePlan[] {
  const plans: OfficePresencePlan[] = members.map((member, index) => {
    const activity = baseActivityForOfficeDisplay(member, index);
    const presence = presenceForActivity(activity);
    return {
      member,
      activity,
      presence,
      gender: spriteGenderForMember(member, index),
    };
  });

  for (const pair of buildOfficeInteractionPairs(plans)) {
    plans[pair.visitorIndex] = {
      ...plans[pair.visitorIndex],
      activity: 'walking',
      presence: 'visiting_peer',
      interactionRole: 'visitor',
      targetIndex: pair.hostIndex,
    };
    plans[pair.hostIndex] = {
      ...plans[pair.hostIndex],
      activity: 'talking',
      presence: 'hosting_peer',
      interactionRole: 'host',
      targetIndex: pair.visitorIndex,
    };
  }

  return plans;
}

function planMemberToOfficeMember(member: OfficeTeamPlan['members'][number], index: number): OfficeMember {
  return {
    agentName: member.agentName,
    displayName: member.displayName,
    nickname: member.agent.workspaceProfile?.nickname,
    officeRole: member.officeRole,
    defaultDirectRoom: true,
    visual: {
      accent: member.agent.workspaceProfile?.visual?.accent,
      zone: member.zone,
      order: member.agent.workspaceProfile?.visual?.order ?? index,
    },
    motion: member.agent.workspaceProfile?.motion,
    agent: member.agent,
  };
}

function officeMemberToPlanMember(member: OfficeMember, index: number): OfficeTeamPlan['members'][number] {
  const zone = member.visual.zone || zoneOf(member.agent);
  return {
    agentName: member.agentName,
    displayName: member.displayName,
    zone,
    officeRole: member.officeRole || ZONES[zone]?.label || ZONES.generalist.label,
    score: 100 - index,
    matchReasons: ['当前办公室成员'],
    agent: member.agent,
  };
}

function agentToPlanMember(agent: OfficeAgent, zone: string, index: number): OfficeTeamPlan['members'][number] {
  return {
    agentName: agent.name,
    displayName: displayName(agent),
    zone,
    officeRole: ZONES[zone]?.label || ZONES.generalist.label,
    score: 100,
    matchReasons: ['用户手动选择'],
    agent,
  };
}

function sortPlanMembers(members: OfficeTeamPlan['members']) {
  return [...members].sort((a, b) => {
    const zoneDiff = (ZONES[a.zone]?.weight ?? 99) - (ZONES[b.zone]?.weight ?? 99);
    if (zoneDiff) return zoneDiff;
    return a.displayName.localeCompare(b.displayName);
  });
}

function missingOrgZones(members: OfficeTeamPlan['members']) {
  const filled = new Set(members.map((member) => member.zone));
  return ORG_REQUIRED_ZONES.filter((zone) => !filled.has(zone));
}

function OfficeScreenWorkOverlay({ scene, zone, index }: { scene: OfficeScreenScene; zone: { color: string }; index: number }) {
  const gradientId = `screenWorkGradient-${index}`;
  return (
    <svg className={`station-work-screen station-work-screen-${scene}`} viewBox="0 0 120 72" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#031a46" />
          <stop offset="55%" stopColor="#075fc7" />
          <stop offset="100%" stopColor={zone.color} />
        </linearGradient>
      </defs>
      <path d="M5 10 114 3 118 58 11 68Z" fill={`url(#${gradientId})`} opacity="0.72" />
      {scene === 'coding' && (
        <>
          <path className="screen-scan" d="M15 16 47 14M15 23 69 20M15 31 42 29M15 39 58 36M72 15 104 13M76 24 108 21M68 34 101 31M74 44 111 40" />
          <rect x="18" y="50" width="26" height="4" rx="2" fill="#22c55e" opacity="0.52" />
          <rect x="49" y="48" width="43" height="4" rx="2" fill="#38bdf8" opacity="0.42" />
        </>
      )}
      {scene === 'testing' && (
        <>
          <path className="screen-scan" d="M18 16 54 14M18 25 48 23M18 34 62 31M18 43 41 41" />
          {[0, 1, 2].map((row) => (
            <g key={row} opacity={0.7 - row * 0.1}>
              <circle cx={73} cy={17 + row * 14} r="3" fill="#22c55e" />
              <rect x={81} y={14 + row * 14} width={27 + row * 5} height="4" rx="2" fill="#bfdbfe" />
            </g>
          ))}
        </>
      )}
      {scene === 'planning' && (
        <>
          {[0, 1, 2].map((col) => (
            <g key={col} opacity={0.52 + col * 0.08}>
              <rect x={16 + col * 31} y="14" width="22" height="40" rx="4" fill="#dbeafe" opacity="0.16" />
              <rect x={20 + col * 31} y="20" width="13" height="5" rx="2.5" fill={col === 1 ? '#facc15' : '#60a5fa'} />
              <rect x={20 + col * 31} y="31" width="15" height="4" rx="2" fill="#bfdbfe" />
              <rect x={20 + col * 31} y="40" width="10" height="4" rx="2" fill="#bfdbfe" opacity="0.7" />
            </g>
          ))}
        </>
      )}
      {scene === 'reviewing' && (
        <>
          <rect x="16" y="14" width="40" height="37" rx="4" fill="#16a34a" opacity="0.22" />
          <rect x="65" y="13" width="39" height="38" rx="4" fill="#ef4444" opacity="0.18" />
          <path className="screen-scan" d="M21 23 49 20M21 32 45 29M21 41 51 38M70 22 97 19M70 31 92 28M70 40 99 37" />
        </>
      )}
      {scene === 'ops' && (
        <>
          <path d="M15 48 C30 29 39 42 51 27 S79 38 102 18" fill="none" stroke="#67e8f9" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
          <path d="M17 56 106 50" stroke="#bfdbfe" strokeWidth="2" opacity="0.25" />
          <circle cx="51" cy="27" r="4" fill="#22c55e" opacity="0.75" />
          <circle cx="102" cy="18" r="4" fill="#facc15" opacity="0.75" />
        </>
      )}
    </svg>
  );
}

function OfficeSheetPlacedAsset({ asset }: { asset: WorkstationSheetAsset }) {
  const sprite = OFFICE_SPRITES[asset.sprite as OfficeSpriteKey];
  const scaleX = asset.width / sprite.w;
  const scaleY = asset.height / sprite.h;
  return (
    <span
      aria-hidden="true"
      className={`station-sheet-asset station-sheet-${asset.sprite}`}
      style={{
        left: `${asset.left}px`,
        top: `${asset.top}px`,
        width: `${asset.width}px`,
        height: `${asset.height}px`,
        backgroundImage: `url(${OFFICE_ASSET_SHEET})`,
        backgroundSize: `${OFFICE_ASSET_SHEET_SIZE * scaleX}px ${OFFICE_ASSET_SHEET_SIZE * scaleY}px`,
        backgroundPosition: `${-sprite.x * scaleX}px ${-sprite.y * scaleY}px`,
        zIndex: asset.zIndex,
        transform: 'flipH' in asset && asset.flipH ? 'scaleX(-1)' : undefined,
      }}
    />
  );
}

function clampPercent(value: number) {
  return Math.max(6, Math.min(94, value));
}

type OfficeWalkwayPath = {
  visitorPoints: OfficePoint[];
  hostPoints: OfficePoint[];
  travelDistance: number;
  visitorTalkPoint: OfficePoint;
  hostTalkPoint: OfficePoint;
  visitorDirection: OfficeSpriteDirection;
  hostDirection: OfficeSpriteDirection;
  returnDirection: OfficeSpriteDirection;
  hostReturnDirection: OfficeSpriteDirection;
};

function directionBetweenPoints(from: OfficePoint, to: OfficePoint): OfficeSpriteDirection {
  if (Math.abs(to.x - from.x) < 0.2) return to.y >= from.y ? 'right' : 'left';
  return to.x >= from.x ? 'right' : 'left';
}

function oppositeDirection(direction: OfficeSpriteDirection): OfficeSpriteDirection {
  return direction === 'right' ? 'left' : 'right';
}

function pointDistance(a: OfficePoint, b: OfficePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pathDistance(points: OfficePoint[]) {
  return points.slice(1).reduce((sum, point, index) => sum + pointDistance(points[index], point), 0);
}

function pushRoutePoint(points: OfficePoint[], point: OfficePoint) {
  const previous = points[points.length - 1];
  if (previous && pointDistance(previous, point) < 0.45) return;
  points.push(point);
}

function officeWalkwayPath(visitorIndex: number, hostIndex: number, total: number, routeOffset: number): OfficeWalkwayPath {
  const from = officePositionForIndex(visitorIndex, total);
  const host = officePositionForIndex(hostIndex, total);
  const visitorOnLeft = from.x <= host.x;
  const talkY = officeFrontAisleY(host.y, total);
  const { hostTalkPoint, visitorTalkPoint } = officeTalkPoints(host, visitorOnLeft, talkY);
  const visitorExitPoint = {
    x: officeSideExitX(from.x, host.x >= from.x, total),
    y: officeFrontAisleY(from.y, total),
  };
  const hostExitPoint = {
    x: officeSideExitX(host.x, visitorOnLeft, total),
    y: officeFrontAisleY(host.y, total),
  };
  const visitorPoints = officeFindPath(visitorExitPoint, visitorTalkPoint, total);
  const hostPoints = officeFindPath(hostExitPoint, hostTalkPoint, total);
  const visitorDistance = Math.max(1, pathDistance(visitorPoints));
  const hostDistance = Math.max(1, pathDistance(hostPoints));

  return {
    visitorPoints,
    hostPoints,
    travelDistance: Math.max(visitorDistance, hostDistance),
    visitorTalkPoint,
    hostTalkPoint,
    visitorDirection: visitorOnLeft ? 'right' : 'left',
    hostDirection: visitorOnLeft ? 'left' : 'right',
    returnDirection: oppositeDirection(directionBetweenPoints(visitorPoints[visitorPoints.length - 2] || visitorTalkPoint, visitorTalkPoint)),
    hostReturnDirection: oppositeDirection(directionBetweenPoints(hostPoints[hostPoints.length - 2] || hostPoints[0], hostTalkPoint)),
  };
}

function deskSpriteClass(plan: OfficePresencePlan): string {
  const action = plan.presence === 'thinking_at_desk' ? 'think-back' : 'work-back';
  return `station-agent-${plan.gender}-${action}-right`;
}

function OfficeDeskOperator({ plan }: { plan: OfficePresencePlan }) {
  if (plan.presence === 'visiting_peer' || plan.presence === 'hosting_peer') {
    return <span className="station-status-dot" aria-hidden="true" />;
  }
  return (
    <div className="station-operator" aria-hidden="true">
      <span className={`station-agent-sprite ${deskSpriteClass(plan)}`} />
    </div>
  );
}

function pct(value: number, total: number) {
  return `${Math.max(0, Math.min(100, (value / total) * 100)).toFixed(3)}%`;
}

function officeTravelKeyframes(name: string, points: OfficePoint[], distance: number, timing: {
  holdStart: number;
  moveOut: number;
  longestMove: number;
  talk: number;
  total: number;
}) {
  const outboundLines: string[] = [];
  let covered = 0;
  points.forEach((point, index) => {
    if (index > 0) covered += pointDistance(points[index - 1], point);
    const seconds = timing.holdStart + (covered / distance) * timing.moveOut;
    outboundLines.push(`${pct(seconds, timing.total)} { left: ${point.x.toFixed(2)}%; top: ${point.y.toFixed(2)}%; }`);
  });

  const returnLines: string[] = [];
  const reversed = [...points].reverse();
  covered = 0;
  reversed.forEach((point, index) => {
    if (index > 0) covered += pointDistance(reversed[index - 1], point);
    const seconds = timing.holdStart + timing.longestMove + timing.talk + (covered / distance) * timing.moveOut;
    returnLines.push(`${pct(seconds, timing.total)} { left: ${point.x.toFixed(2)}%; top: ${point.y.toFixed(2)}%; }`);
  });

  const first = points[0];
  const last = points[points.length - 1];
  return `
    @keyframes ${name} {
      0%, ${pct(timing.holdStart, timing.total)} { left: ${first.x.toFixed(2)}%; top: ${first.y.toFixed(2)}%; }
      ${outboundLines.join('\n')}
      ${pct(timing.holdStart + timing.moveOut, timing.total)}, ${pct(timing.holdStart + timing.longestMove + timing.talk, timing.total)} { left: ${last.x.toFixed(2)}%; top: ${last.y.toFixed(2)}%; }
      ${returnLines.join('\n')}
      ${pct(timing.holdStart + timing.longestMove + timing.talk + timing.moveOut, timing.total)}, 100% { left: ${first.x.toFixed(2)}%; top: ${first.y.toFixed(2)}%; }
    }
  `;
}

function officeVisibilityKeyframes(names: {
  visitorWalkOut: string;
  visitorWalkBack: string;
  visitorTalk: string;
  hostWalkOut: string;
  hostWalkBack: string;
  hostTalk: string;
  bubble: string;
}, timing: {
  holdStart: number;
  visitorMove: number;
  hostMove: number;
  longestMove: number;
  talk: number;
  total: number;
}) {
  const talkStart = timing.holdStart + timing.longestMove;
  const talkEnd = talkStart + timing.talk;
  const visitorOutEnd = timing.holdStart + timing.visitorMove;
  const hostOutEnd = timing.holdStart + timing.hostMove;
  const visitorReturnEnd = talkEnd + timing.visitorMove;
  const hostReturnEnd = talkEnd + timing.hostMove;
  const nudge = 0.08;
  return `
    @keyframes ${names.visitorWalkOut} {
      0%, ${pct(visitorOutEnd - nudge, timing.total)} { opacity: 1; }
      ${pct(visitorOutEnd, timing.total)}, 100% { opacity: 0; }
    }
    @keyframes ${names.visitorWalkBack} {
      0%, ${pct(talkEnd, timing.total)} { opacity: 0; }
      ${pct(talkEnd + nudge, timing.total)}, ${pct(visitorReturnEnd, timing.total)} { opacity: 1; }
      ${pct(visitorReturnEnd + nudge, timing.total)}, 100% { opacity: 0; }
    }
    @keyframes ${names.visitorTalk} {
      0%, ${pct(talkStart - nudge, timing.total)} { opacity: 0; }
      ${pct(talkStart, timing.total)}, ${pct(talkEnd, timing.total)} { opacity: 1; }
      ${pct(talkEnd + nudge, timing.total)}, 100% { opacity: 0; }
    }
    @keyframes ${names.hostWalkOut} {
      0%, ${pct(hostOutEnd - nudge, timing.total)} { opacity: 1; }
      ${pct(hostOutEnd, timing.total)}, 100% { opacity: 0; }
    }
    @keyframes ${names.hostWalkBack} {
      0%, ${pct(talkEnd, timing.total)} { opacity: 0; }
      ${pct(talkEnd + nudge, timing.total)}, ${pct(hostReturnEnd, timing.total)} { opacity: 1; }
      ${pct(hostReturnEnd + nudge, timing.total)}, 100% { opacity: 0; }
    }
    @keyframes ${names.hostTalk} {
      0%, ${pct(talkStart - nudge, timing.total)} { opacity: 0; }
      ${pct(talkStart, timing.total)}, ${pct(talkEnd, timing.total)} { opacity: 1; }
      ${pct(talkEnd + nudge, timing.total)}, 100% { opacity: 0; }
    }
    @keyframes ${names.bubble} {
      0%, ${pct(talkStart + 0.35, timing.total)} { opacity: 0; transform: translateY(4px) scale(0.94); }
      ${pct(talkStart + 0.75, timing.total)}, ${pct(talkEnd - 0.35, timing.total)} { opacity: 1; transform: translateY(0) scale(1); }
      ${pct(talkEnd, timing.total)}, 100% { opacity: 0; transform: translateY(4px) scale(0.94); }
    }
  `;
}

function OfficeInteraction({
  visitorPlan,
  visitorIndex,
  total,
  hostPlan,
  hostIndex,
  routeOffset,
}: {
  visitorPlan: OfficePresencePlan;
  visitorIndex: number;
  total: number;
  hostPlan: OfficePresencePlan;
  hostIndex: number;
  routeOffset: number;
}) {
  const path = officeWalkwayPath(visitorIndex, hostIndex, total, routeOffset);
  const zone = ZONES[memberZone(visitorPlan.member)] || ZONES.generalist;
  const actorScale = Math.min(0.78, stationScaleForTotal(total) * 0.88);
  const visitorDistance = Math.max(1, pathDistance(path.visitorPoints));
  const hostDistance = Math.max(1, pathDistance(path.hostPoints));
  const visitorMoveSeconds = Math.max(3.5, visitorDistance / OFFICE_WALK_SPEED_PERCENT_PER_SECOND);
  const hostMoveSeconds = Math.max(2.4, hostDistance / OFFICE_WALK_SPEED_PERCENT_PER_SECOND);
  const longestMoveSeconds = Math.max(visitorMoveSeconds, hostMoveSeconds);
  const timing = {
    holdStart: 1.1,
    visitorMove: visitorMoveSeconds,
    hostMove: hostMoveSeconds,
    longestMove: longestMoveSeconds,
    talk: 4.6,
    total: longestMoveSeconds + Math.max(visitorMoveSeconds, hostMoveSeconds) + 6.8,
  };
  const routeId = `officeInteraction${visitorIndex}x${hostIndex}`;
  const names = {
    visitorMotion: `${routeId}VisitorMotion`,
    hostMotion: `${routeId}HostMotion`,
    visitorWalkOut: `${routeId}VisitorWalkOut`,
    visitorWalkBack: `${routeId}VisitorWalkBack`,
    visitorTalk: `${routeId}VisitorTalk`,
    hostWalkOut: `${routeId}HostWalkOut`,
    hostWalkBack: `${routeId}HostWalkBack`,
    hostTalk: `${routeId}HostTalk`,
    bubble: `${routeId}Bubble`,
  };
  const keyframes = [
    officeTravelKeyframes(names.visitorMotion, path.visitorPoints, visitorDistance, {
      holdStart: timing.holdStart,
      moveOut: timing.visitorMove,
      longestMove: timing.longestMove,
      talk: timing.talk,
      total: timing.total,
    }),
    officeTravelKeyframes(names.hostMotion, path.hostPoints, hostDistance, {
      holdStart: timing.holdStart,
      moveOut: timing.hostMove,
      longestMove: timing.longestMove,
      talk: timing.talk,
      total: timing.total,
    }),
    officeVisibilityKeyframes(names, timing),
  ].join('');
  const label = `${visitorPlan.member.nickname || visitorPlan.member.displayName} 走到 ${hostPlan.member.nickname || hostPlan.member.displayName} 的工位旁交流`;
  const routeY = [
    ...path.visitorPoints.map((point) => point.y),
    ...path.hostPoints.map((point) => point.y),
    path.hostTalkPoint.y,
  ];

  return (
    <div
      className="office-interaction"
      aria-label={label}
      style={{
        ['--actor-scale' as any]: actorScale,
        ['--interaction-duration' as any]: `${timing.total}s`,
        ['--zone' as any]: zone.color,
        zIndex: Math.round(Math.max(...routeY) + 72),
      }}
    >
      <style>{keyframes}</style>
      <div
        className="office-interaction-visitor"
        style={{
          animationName: names.visitorMotion,
          animationDuration: `${timing.total}s`,
        }}
      >
        <span className="office-interaction-shadow" aria-hidden="true" />
        <span
          className={`office-interaction-sprite station-agent-${visitorPlan.gender}-walk-${path.visitorDirection}`}
          aria-hidden="true"
          style={{ animationName: `${names.visitorWalkOut}, agentSprite6`, animationDuration: `${timing.total}s, 0.82s` }}
        />
        <span
          className={`office-interaction-sprite station-agent-${visitorPlan.gender}-walk-${path.returnDirection}`}
          aria-hidden="true"
          style={{ animationName: `${names.visitorWalkBack}, agentSprite6`, animationDuration: `${timing.total}s, 0.82s` }}
        />
        <span
          className={`office-interaction-sprite office-interaction-talk-sprite station-agent-${visitorPlan.gender}-talk-${path.visitorDirection}`}
          aria-hidden="true"
          style={{ animationName: `${names.visitorTalk}, agentSprite6`, animationDuration: `${timing.total}s, 1.15s` }}
        />
      </div>
      <div
        className={`office-interaction-host office-interaction-host-${path.hostDirection}`}
        style={{
          animationName: names.hostMotion,
          animationDuration: `${timing.total}s`,
        }}
      >
        <span className="office-interaction-shadow" aria-hidden="true" />
        <span
          className={`office-interaction-sprite station-agent-${hostPlan.gender}-walk-${path.hostDirection}`}
          aria-hidden="true"
          style={{ animationName: `${names.hostWalkOut}, agentSprite6`, animationDuration: `${timing.total}s, 0.82s` }}
        />
        <span
          className={`office-interaction-sprite station-agent-${hostPlan.gender}-walk-${path.hostReturnDirection}`}
          aria-hidden="true"
          style={{ animationName: `${names.hostWalkBack}, agentSprite6`, animationDuration: `${timing.total}s, 0.82s` }}
        />
        <span
          className={`office-interaction-sprite office-interaction-talk-sprite station-agent-${hostPlan.gender}-talk-${path.hostDirection}`}
          aria-hidden="true"
          style={{ animationName: `${names.hostTalk}, agentSprite6`, animationDuration: `${timing.total}s, 1.15s` }}
        />
        <span className="office-interaction-bubble" aria-hidden="true" style={{ animationName: names.bubble, animationDuration: `${timing.total}s` }}>
          <span />
          <span />
          <span />
        </span>
      </div>
    </div>
  );
}

function buildOfficeInteractionRoutes(plans: OfficePresencePlan[]): OfficeInteractionRoute[] {
  const routes: OfficeInteractionRoute[] = [];
  plans.forEach((plan, index) => {
    if (plan.presence !== 'visiting_peer' || typeof plan.targetIndex !== 'number') return;
    const hostPlan = plans[plan.targetIndex];
    if (!hostPlan || hostPlan.presence !== 'hosting_peer') return;
    routes.push({
      visitorPlan: plan,
      visitorIndex: index,
      hostPlan,
      hostIndex: plan.targetIndex,
      routeOffset: routes.length % 2 === 0 ? -7 : 7,
    });
  });

  return routes;
}

function LiveOffice({
  members,
  onOpenDirectRoom,
  onOpenGroupRoom,
}: {
  members: OfficeMember[];
  onOpenDirectRoom?: (member: OfficeMember) => void;
  onOpenGroupRoom?: (members: OfficeMember[]) => void;
}) {
  const [selectedAgentName, setSelectedAgentName] = useState<string | null>(members[0]?.agentName || null);
  const visibleMembers = useMemo(() => members.slice(0, OFFICE_MAX_VISIBLE_MEMBERS), [members]);
  const presencePlans = useMemo(() => buildOfficePresencePlan(visibleMembers), [visibleMembers]);
  const interactionRoutes = useMemo(() => buildOfficeInteractionRoutes(presencePlans), [presencePlans]);
  const selectedPlan = presencePlans.find((planItem) => planItem.member.agentName === selectedAgentName) || presencePlans[0];
  const selectedMember = selectedPlan?.member || visibleMembers[0];
  const selectedZone = selectedMember ? ZONES[selectedMember.visual.zone || zoneOf(selectedMember.agent)] || ZONES.generalist : null;
  const selectedPresence = selectedPlan?.presence || 'seated_work';
  const selectedAvatar = selectedMember ? resolveAgentAvatarSrc(selectedMember.agent.avatar, selectedMember.agent.name, {
    team: selectedMember.agent.team || 'blue',
    roleType: selectedMember.agent.roleType || 'normal',
  }) : null;

  if (!members.length) return null;
  return (
    <section className="rounded-[34px] border border-white/70 bg-white/62 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-3xl font-black tracking-normal">办公室实时状态</h2>
        </div>
        <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600">{members.length} 人在线</span>
      </div>
      {selectedMember && selectedZone && selectedAvatar ? (
        <aside className="office-member-panel" style={{ ['--zone' as any]: selectedZone.color }}>
          <div className="flex items-center gap-3">
            <SpriteAvatar
              avatar={selectedAvatar}
              seed={selectedMember.agentName}
              category="agent-default"
              alt={selectedMember.displayName}
              fallback={initials(selectedMember.displayName)}
              className="h-11 w-11 border-2 border-white shadow-sm"
              fallbackClassName="text-[10px]"
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-black">{selectedMember.nickname || selectedMember.displayName}</div>
              <div className="mt-0.5 text-xs font-semibold" style={{ color: selectedZone.color }}>{selectedZone.label}</div>
            </div>
          </div>
          <div className="office-member-status">
            <div className="font-bold text-slate-900 dark:text-white">{statusTextForPresence(selectedPresence)}</div>
            <div className="mt-1 line-clamp-2">{selectedZone.brief}</div>
          </div>
          <div className="office-member-actions">
            <button type="button" className="office-member-action" onClick={() => onOpenDirectRoom?.(selectedMember)}>私聊</button>
            <button type="button" className="office-member-action" onClick={() => onOpenGroupRoom?.(visibleMembers)}>拉人协作</button>
            <Link href={withOfficeSource('/agents')} className="office-member-action">配置</Link>
            <button type="button" className="office-member-action">记忆</button>
          </div>
        </aside>
      ) : null}
      <div className="office-floor">
        {presencePlans.map((planItem, index) => (
          <OfficeStation
            key={planItem.member.agentName}
            plan={planItem}
            index={index}
            total={presencePlans.length}
            selected={planItem.member.agentName === selectedMember?.agentName}
            onSelect={() => setSelectedAgentName(planItem.member.agentName)}
          />
        ))}
        <div className="office-interaction-layer">
          {interactionRoutes.map((route) => (
            <OfficeInteraction
              key={`interaction-${route.visitorPlan.member.agentName}-${route.hostPlan.member.agentName}`}
              visitorPlan={route.visitorPlan}
              visitorIndex={route.visitorIndex}
              total={presencePlans.length}
              hostPlan={route.hostPlan}
              hostIndex={route.hostIndex}
              routeOffset={route.routeOffset}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function roomTitle(room: CollaborationRoomRecord | null) {
  if (!room) return '会议室';
  if (room.topic?.trim()) return room.topic.trim();
  const names = room.participantAgentNames
    .map((agentName) => room.agentSnapshots?.[agentName]?.displayName || agentName)
    .filter(Boolean);
  if (room.roomType === 'direct' && names[0]) return `${names[0]} · 私聊`;
  if (names.length) return `${names.slice(0, 3).join('、')} · 协作`;
  return '会议室';
}

function MeetingRoomTab({
  room,
  sessionId,
  activeSession,
  setSessionWorkbenchState,
  appendSessionMessage,
  recentRooms,
  onSelectRoom,
}: {
  room: CollaborationRoomRecord | null;
  sessionId: string | null;
  activeSession: any;
  setSessionWorkbenchState: any;
  appendSessionMessage: any;
  recentRooms: CollaborationRoomRecord[];
  onSelectRoom: (room: CollaborationRoomRecord) => void;
}) {
  if (!room || !sessionId) {
    return (
      <div className="grid min-h-[560px] gap-4 rounded-[34px] border border-white/70 bg-white/62 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5 md:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed bg-background/50 p-8 text-center">
          <MessageSquareText className="h-10 w-10 text-blue-600" />
          <div className="mt-4 text-xl font-black">还没有打开会议室</div>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            在办公室里选择成员后点“私聊”或“拉人协作”，这里会直接进入对应的会议室对话。
          </p>
        </div>
        <aside className="rounded-3xl border bg-background/70 p-4">
          <div className="text-sm font-black">最近会议室</div>
          <div className="mt-3 space-y-2">
            {recentRooms.slice(0, 8).map((item) => (
              <button
                key={item.id}
                type="button"
                className="flex w-full items-center justify-between rounded-2xl border p-3 text-left transition hover:bg-muted/60"
                onClick={() => onSelectRoom(item)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{roomTitle(item)}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{item.participantAgentNames.length} 位成员</span>
                </span>
                <Badge variant="outline">{item.roomType === 'direct' ? '私聊' : '群聊'}</Badge>
              </button>
            ))}
            {!recentRooms.length ? (
              <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                暂无会议室
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div className="h-[720px] min-h-0 overflow-hidden rounded-[34px] border border-white/70 bg-white/62 p-3 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
      <AgoraShell
        activeSessionId={sessionId}
        sessionTitle={roomTitle(room)}
        sessionWorkbenchState={activeSession?.sessionWorkbenchState}
        setSessionWorkbenchState={setSessionWorkbenchState}
        appendSessionMessage={appendSessionMessage}
        workingDirectory=""
        hideComposer={false}
        allowOpeningMessages
        allowGuestManagement
        allowTopicControls
        showComposerControls
        inlineContentSpeakerName="办公室"
      />
    </div>
  );
}

function WorkflowStatusTab() {
  return (
    <div className="min-h-[560px] rounded-[34px] border border-white/70 bg-white/62 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
      <div className="flex h-full min-h-[500px] flex-col items-center justify-center rounded-3xl border border-dashed bg-background/50 p-8 text-center">
        <Workflow className="h-10 w-10 text-blue-600" />
        <div className="mt-4 text-xl font-black">工作流协作</div>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          工作流启动后的协作议题、编队和人工确认会在这里集中呈现。
        </p>
        <Button asChild className="mt-5">
          <Link href={withOfficeSource('/workflows')}>进入工作流管理</Link>
        </Button>
      </div>
    </div>
  );
}

function WorkspaceStatusTabs({
  members,
  activeTab,
  onTabChange,
  onOpenDirectRoom,
  onOpenGroupRoom,
  activeRoom,
  activeRoomSessionId,
  activeSession,
  setSessionWorkbenchState,
  appendSessionMessage,
  recentRooms,
  onSelectRoom,
}: {
  members: OfficeMember[];
  activeTab: WorkspaceStatusTab;
  onTabChange: (tab: WorkspaceStatusTab) => void;
  onOpenDirectRoom: (member: OfficeMember) => void;
  onOpenGroupRoom: (members: OfficeMember[]) => void;
  activeRoom: CollaborationRoomRecord | null;
  activeRoomSessionId: string | null;
  activeSession: any;
  setSessionWorkbenchState: any;
  appendSessionMessage: any;
  recentRooms: CollaborationRoomRecord[];
  onSelectRoom: (room: CollaborationRoomRecord) => void;
}) {
  return (
    <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as WorkspaceStatusTab)} className="space-y-4">
      <TabsList className="h-12 rounded-full bg-white/72 p-1 shadow-sm backdrop-blur dark:bg-white/10">
        <TabsTrigger value="office" className="rounded-full px-5">
          <Building2 className="mr-2 h-4 w-4" />
          办公室
        </TabsTrigger>
        <TabsTrigger value="meeting" className="rounded-full px-5">
          <MessageSquareText className="mr-2 h-4 w-4" />
          会议室
        </TabsTrigger>
        <TabsTrigger value="workflow" className="rounded-full px-5">
          <Workflow className="mr-2 h-4 w-4" />
          工作流
        </TabsTrigger>
      </TabsList>
      <TabsContent value="office" className="mt-0">
        <LiveOffice members={members} onOpenDirectRoom={onOpenDirectRoom} onOpenGroupRoom={onOpenGroupRoom} />
      </TabsContent>
      <TabsContent value="meeting" className="mt-0">
        <MeetingRoomTab
          room={activeRoom}
          sessionId={activeRoomSessionId}
          activeSession={activeSession}
          setSessionWorkbenchState={setSessionWorkbenchState}
          appendSessionMessage={appendSessionMessage}
          recentRooms={recentRooms}
          onSelectRoom={onSelectRoom}
        />
      </TabsContent>
      <TabsContent value="workflow" className="mt-0">
        <WorkflowStatusTab />
      </TabsContent>
    </Tabs>
  );
}

function OfficeStation({
  plan,
  index,
  total,
  selected,
  onSelect,
}: {
  plan: OfficePresencePlan;
  index: number;
  total: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const member = plan.member;
  const position = officePositionForIndex(index, total);
  const zone = ZONES[member.visual.zone || zoneOf(member.agent)] || ZONES.generalist;
  const activity = plan.activity;
  const presence = plan.presence;
  const layout = index % 3;
  const statusText = statusTextForPresence(presence);
  const screenScene = screenSceneForOfficePlan(plan, index);
  const avatar = resolveAgentAvatarSrc(member.agent.avatar, member.agent.name, {
    team: member.agent.team || 'blue',
    roleType: member.agent.roleType || 'normal',
  });
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  };
  return (
    <div
      className={`station station-${activity} station-presence-${presence} station-layout-${layout} ${selected ? 'station-selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`查看 ${member.nickname || member.displayName}，当前${statusText}`}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        zIndex: Math.round(position.y),
        ['--zone' as any]: zone.color,
        ['--delay' as any]: `${index * 0.2}s`,
        ['--station-scale' as any]: stationScaleForTotal(total),
      }}
    >
      <div className="station-scene">
        {WORKSTATION_SHEET_ASSETS.map((asset) => (
          <OfficeSheetPlacedAsset key={asset.sprite} asset={asset} />
        ))}
        <OfficeScreenWorkOverlay scene={screenScene} zone={zone} index={index} />
        <OfficeDeskOperator plan={plan} />
        <div className="station-callout-layer">
          <div className="station-agent-callout">
            <SpriteAvatar avatar={avatar} seed={member.agentName} category="agent-default" alt={member.displayName} fallback={initials(member.displayName)} className="station-callout-avatar" fallbackClassName="text-[8px]" />
            <span className="station-callout-text">
              <span className="station-callout-name">{member.nickname || member.displayName}</span>
              <span className="station-callout-status">{statusText}</span>
            </span>
            <span className="station-callout-arrow" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function OfficePage() {
  const {
    activeSession,
    setActiveSessionId,
    setSessionWorkbenchState,
    appendSessionMessage,
  } = useChat();
  const [members, setMembers] = useState<OfficeMember[]>([]);
  const [availableAgents, setAvailableAgents] = useState<OfficeAgent[]>([]);
  const [prompt, setPrompt] = useState('帮我搭建一个 App 开发团队');
  const [plan, setPlan] = useState<OfficeTeamPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [agentScopeOpen, setAgentScopeOpen] = useState(false);
  const [teamBuilderOpen, setTeamBuilderOpen] = useState(false);
  const [candidateAgentNames, setCandidateAgentNames] = useState<string[]>([]);
  const [statusTab, setStatusTab] = useState<WorkspaceStatusTab>('office');
  const [recentRooms, setRecentRooms] = useState<CollaborationRoomRecord[]>([]);
  const [activeRoom, setActiveRoom] = useState<CollaborationRoomRecord | null>(null);
  const [activeRoomSessionId, setActiveRoomSessionId] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    const res = await fetch('/api/collaboration/members?spaceType=office');
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || data?.error || '加载办公室失败');
    setMembers(Array.isArray(data.members) ? data.members : []);
  }, []);

  const loadAvailableAgents = useCallback(async () => {
    const res = await fetch('/api/agents');
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || data?.error || '加载 Agent 失败');
    setAvailableAgents(Array.isArray(data.agents) ? data.agents : []);
  }, []);

  const loadRecentRooms = useCallback(async () => {
    const res = await fetch('/api/collaboration/rooms?spaceType=office&status=active');
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || data?.error || '加载会议室失败');
    setRecentRooms(Array.isArray(data.rooms) ? data.rooms : []);
  }, []);

  useEffect(() => {
    loadMembers().catch((error) => setMessage(error?.message || '办公室暂时进不去'));
    loadAvailableAgents().catch((error) => setMessage(error?.message || 'Agent 列表暂时不可用'));
    loadRecentRooms().catch(() => {});
  }, [loadAvailableAgents, loadMembers, loadRecentRooms]);

  const agentOptions = useMemo(() => {
    const byName = new Map<string, OfficeAgent>();
    for (const agent of availableAgents) byName.set(agent.name, agent);
    for (const member of members) byName.set(member.agent.name, member.agent);
    for (const member of plan?.members || []) byName.set(member.agent.name, member.agent);
    return [...byName.values()].sort((a, b) => displayName(a).localeCompare(displayName(b)));
  }, [availableAgents, members, plan]);

  const officeMembersForDisplay = useMemo<OfficeMember[]>(() => {
    const source = plan ? plan.members.map(planMemberToOfficeMember) : members;
    return source;
  }, [members, plan]);

  const scopedCandidateNames = useMemo(
    () => candidateNamesForRequest(candidateAgentNames, agentOptions),
    [agentOptions, candidateAgentNames]
  );

  const previewAgents = useMemo(() => {
    const scopedNames = scopedCandidateNames ? new Set(scopedCandidateNames) : null;
    const pool = scopedNames ? agentOptions.filter((agent) => scopedNames.has(agent.name)) : agentOptions;
    return sampleAgentPreview(pool, 6);
  }, [agentOptions, scopedCandidateNames]);

  const handleSelectRoom = useCallback((room: CollaborationRoomRecord) => {
    if (!room.sessionId) {
      setMessage('这个会议室还没有绑定对话，请从办公室成员重新发起。');
      return;
    }
    setActiveRoom(room);
    setActiveRoomSessionId(room.sessionId);
    setActiveSessionId(room.sessionId);
    setStatusTab('meeting');
  }, [setActiveSessionId]);

  const buildManualPlan = useCallback((currentPlan: OfficeTeamPlan | null, nextMembers: OfficeTeamPlan['members']): OfficeTeamPlan => {
    const sortedMembers = sortPlanMembers(nextMembers);
    return {
      id: currentPlan?.id || `manual-org-${Date.now()}`,
      requirement: currentPlan?.requirement || `手动组织草案：${prompt}`,
      generatedAt: currentPlan?.generatedAt || Date.now(),
      members: sortedMembers,
      missingZones: missingOrgZones(sortedMembers),
      availableAgentCount: agentOptions.length,
    };
  }, [agentOptions.length, prompt]);

  const handleAddAgent = useCallback((agentName: string) => {
    setPlan((currentPlan) => {
      const currentMembers = currentPlan?.members || members.map(officeMemberToPlanMember);
      if (currentMembers.some((member) => member.agentName === agentName)) return currentPlan;
      const agent = agentOptions.find((item) => item.name === agentName);
      if (!agent) return currentPlan;
      const nextMembers = [...currentMembers, agentToPlanMember(agent, zoneOf(agent), currentMembers.length)];
      setMessage('已添加成员到组织草案，确认团队后才会写入办公室。');
      return buildManualPlan(currentPlan, nextMembers);
    });
  }, [agentOptions, buildManualPlan, members]);

  const handleReplaceAgent = useCallback((currentAgentName: string, nextAgentName: string) => {
    setPlan((currentPlan) => {
      const currentMembers = currentPlan?.members || members.map(officeMemberToPlanMember);
      const target = currentMembers.find((member) => member.agentName === currentAgentName);
      const agent = agentOptions.find((item) => item.name === nextAgentName);
      if (!target || !agent) return currentPlan;
      const nextMembers = currentMembers
        .filter((member) => member.agentName !== nextAgentName)
        .map((member) => {
          if (member.agentName !== currentAgentName) return member;
          return {
            ...agentToPlanMember(agent, target.zone || zoneOf(agent), member.score),
            officeRole: target.officeRole || agent.workspaceProfile?.officeRole || ZONES[target.zone]?.label || ZONES.generalist.label,
            matchReasons: ['用户手动替换'],
          };
        });
      setMessage('已替换组织成员，确认团队后才会写入办公室。');
      return buildManualPlan(currentPlan, nextMembers);
    });
  }, [agentOptions, buildManualPlan, members]);

  const handleRemoveAgent = useCallback((agentName: string) => {
    setPlan((currentPlan) => {
      const currentMembers = currentPlan?.members || members.map(officeMemberToPlanMember);
      const nextMembers = currentMembers.filter((member) => member.agentName !== agentName);
      setMessage('已从组织草案移除成员，确认团队后才会写入办公室。');
      return buildManualPlan(currentPlan, nextMembers);
    });
  }, [buildManualPlan, members]);

  const applyTeamPlan = useCallback(async (input: { plan: OfficeTeamPlan; draftId?: string }) => {
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch(input.draftId ? '/api/office/org/apply' : '/api/office/team/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input.draftId ? { draftId: input.draftId } : { plan: input.plan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || data?.error || '创建团队失败');
      await loadMembers();
      setPlan(null);
      setStatusTab('office');
      const count = data.state?.activeAgentNames?.length || data.teamState?.activeAgentNames?.length || input.plan.members.length;
      setMessage(`团队已创建，${count} 位成员进入办公室`);
    } catch (error: any) {
      setMessage(error?.message || '操作失败');
      throw error;
    } finally {
      setBusy(false);
    }
  }, [loadMembers]);

  const handleTeamAction = useCallback(() => {
    setTeamBuilderOpen(true);
  }, []);

  const openDirectRoom = useCallback(async (member: OfficeMember) => {
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch('/api/collaboration/rooms/direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: member.agentName,
          spaceType: 'office',
          ensureSession: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || data?.error || '创建私聊失败');
      setActiveRoom(data.room);
      setActiveRoomSessionId(data.session?.id || data.room?.sessionId || null);
      if (data.session?.id) setActiveSessionId(data.session.id);
      setStatusTab('meeting');
      await loadRecentRooms().catch(() => {});
    } catch (error: any) {
      setMessage(error?.message || '创建私聊失败');
    } finally {
      setBusy(false);
    }
  }, [loadRecentRooms, setActiveSessionId]);

  const openGroupRoom = useCallback(async (targetMembers: OfficeMember[]) => {
    const names = [...new Set(targetMembers.map((member) => member.agentName).filter(Boolean))];
    if (!names.length) return;
    setBusy(true);
    setMessage('');
    try {
      const firstName = names[0];
      const createRes = await fetch('/api/collaboration/rooms/direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: firstName,
          spaceType: 'office',
          forceNew: names.length > 1,
          ensureSession: true,
          topic: names.length > 1 ? '办公室协作' : undefined,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(createData?.message || createData?.error || '创建会议室失败');
      let room = createData.room as CollaborationRoomRecord;
      let session = createData.session;
      const restNames = names.slice(1);
      if (restNames.length) {
        const joinRes = await fetch(`/api/collaboration/rooms/${encodeURIComponent(room.id)}/participants`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentNames: restNames }),
        });
        const joinData = await joinRes.json();
        if (!joinRes.ok) throw new Error(joinData?.message || joinData?.error || '添加会议室成员失败');
        room = joinData.room || room;
        session = joinData.session || session;
      }
      setActiveRoom(room);
      setActiveRoomSessionId(session?.id || room.sessionId || null);
      if (session?.id || room.sessionId) setActiveSessionId(session?.id || room.sessionId);
      setStatusTab('meeting');
      await loadRecentRooms().catch(() => {});
    } catch (error: any) {
      setMessage(error?.message || '创建会议室失败');
    } finally {
      setBusy(false);
    }
  }, [loadRecentRooms, setActiveSessionId]);

  return (
    <main className="office-page min-h-screen overflow-x-hidden bg-[#f8fbff] pb-56 text-slate-950 dark:bg-slate-950 dark:text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(37,99,235,0.16),transparent_30%),radial-gradient(circle_at_82%_12%,rgba(20,184,166,0.14),transparent_28%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-[1760px] flex-col px-5 py-5 lg:px-10">
        <header className="flex items-center justify-between">
          <Button asChild variant="outline" className="rounded-full bg-white/70 backdrop-blur dark:bg-white/10">
            <Link href="/dashboard"><Gauge className="mr-2 h-4 w-4" />开发工程师桌面</Link>
          </Button>
          <ThemeToggle />
        </header>

        <section className="mx-auto mt-7 w-full max-w-5xl text-center">
          <div className="text-[11px] font-semibold uppercase tracking-[0.42em] text-blue-600">ACE Harness</div>
          <h1 className="mt-2 text-5xl font-black tracking-normal sm:text-7xl">OPC Company Roles</h1>
          <p className="mt-3 text-xl font-semibold text-slate-700 dark:text-slate-300">One Team. AI-Powered. Maximum Impact.</p>
        </section>

        <div className="mt-8">
          <TeamComposer
            prompt={prompt}
            setPrompt={(value) => { setPrompt(value); setPlan(null); }}
            previewAgents={previewAgents}
            busy={busy}
            onBuild={handleTeamAction}
            onFilterClick={() => setAgentScopeOpen(true)}
            filterActive={Boolean(scopedCandidateNames)}
            planReady={!!plan}
          />
          {message ? <div className="mx-auto mt-3 w-fit rounded-full bg-white/70 px-4 py-2 text-sm text-slate-600 shadow-sm backdrop-blur dark:bg-white/10 dark:text-slate-300">{message}</div> : null}
        </div>

        <div className="mt-10 space-y-8">
          <ArchitectureDiagram
            members={officeMembersForDisplay}
            availableAgents={agentOptions}
            planReady={!!plan}
            onAddAgent={handleAddAgent}
            onReplaceAgent={handleReplaceAgent}
            onRemoveAgent={handleRemoveAgent}
          />
          <WorkspaceStatusTabs
            members={officeMembersForDisplay}
            activeTab={statusTab}
            onTabChange={setStatusTab}
            onOpenDirectRoom={openDirectRoom}
            onOpenGroupRoom={openGroupRoom}
            activeRoom={activeRoom}
            activeRoomSessionId={activeRoomSessionId}
            activeSession={activeSession}
            setSessionWorkbenchState={setSessionWorkbenchState}
            appendSessionMessage={appendSessionMessage}
            recentRooms={recentRooms}
            onSelectRoom={handleSelectRoom}
          />
        </div>
      </div>
      <AgentScopeDialog
        open={agentScopeOpen}
        onOpenChange={setAgentScopeOpen}
        agents={agentOptions}
        candidateAgentNames={candidateAgentNames}
        onApply={(names) => {
          setCandidateAgentNames(names);
          setPlan(null);
        }}
      />
      <TeamBuilderFlowModal
        open={teamBuilderOpen}
        onOpenChange={setTeamBuilderOpen}
        requirement={prompt}
        onRequirementChange={setPrompt}
        agents={agentOptions}
        candidateAgentNames={candidateAgentNames}
        initialPlan={plan}
        onPlanReady={setPlan}
        onApply={applyTeamPlan}
      />
      <OfficeDock />
      <style jsx global>{`
        .office-dock-stage {
          position: fixed;
          left: 50%;
          bottom: 1.1rem;
          z-index: 50;
          transform: translateX(-50%);
          max-width: calc(100vw - 1.5rem);
        }
        .office-dock-surface {
          background: rgba(248, 250, 252, 0.58);
          border: 1px solid rgba(15, 23, 42, 0.14);
          box-shadow:
            0 18px 48px rgba(15, 23, 42, 0.16),
            0 4px 12px rgba(15, 23, 42, 0.12),
            inset 0 1px 0 rgba(255, 255, 255, 0.78),
            inset 0 -1px 0 rgba(15, 23, 42, 0.08);
          backdrop-filter: blur(22px) saturate(1.18);
        }
        .dark .office-dock-surface {
          background: rgba(15, 23, 42, 0.58);
          border-color: rgba(255, 255, 255, 0.16);
          box-shadow:
            0 18px 52px rgba(0, 0, 0, 0.42),
            0 4px 14px rgba(0, 0, 0, 0.32),
            inset 0 1px 0 rgba(255, 255, 255, 0.16),
            inset 0 -1px 0 rgba(0, 0, 0, 0.28);
        }
        .office-dock-tooltip {
          background: rgba(15, 23, 42, 0.92);
          color: #fff;
          border: 1px solid rgba(255, 255, 255, 0.18);
        }
        .dark .office-dock-tooltip {
          background: rgba(255, 255, 255, 0.92);
          color: #0f172a;
          border-color: rgba(15, 23, 42, 0.12);
        }
        .office-dock-app-icon {
          display: flex;
          height: 100%;
          width: 100%;
          align-items: center;
          justify-content: center;
          border-radius: 22%;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.28),
            0 10px 18px rgba(15, 23, 42, 0.24);
        }
        .office-dock-stage [role="button"]:focus-visible {
          outline: 2px solid rgba(255, 255, 255, 0.88);
          outline-offset: 4px;
          border-radius: 16px;
        }
        .org-manager {
          position: relative;
          overflow: hidden;
          border-radius: 24px;
          border: 1px solid rgba(191, 219, 254, 0.92);
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.96)),
            radial-gradient(circle at 50% 0%, rgba(37, 99, 235, 0.08), transparent 42%);
          padding: 28px 24px;
          box-shadow:
            0 24px 80px rgba(15, 23, 42, 0.12),
            inset 0 1px 0 rgba(255, 255, 255, 0.82);
          backdrop-filter: blur(18px);
        }
        .dark .org-manager {
          border-color: rgba(191, 219, 254, 0.82);
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(241, 245, 249, 0.96)),
            radial-gradient(circle at 50% 0%, rgba(37, 99, 235, 0.09), transparent 42%);
        }
        .org-reference-title {
          position: relative;
          display: grid;
          justify-items: center;
          gap: 6px;
          margin-bottom: 22px;
          padding-top: 56px;
          text-align: center;
        }
        .org-reference-title h2 {
          margin: 0;
          color: #020f2d;
          font-size: clamp(46px, 6vw, 84px);
          font-weight: 950;
          line-height: 1;
          letter-spacing: 0;
        }
        .org-reference-subtitle {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 24px;
          color: #061532;
          font-size: clamp(18px, 2vw, 30px);
          font-weight: 850;
          line-height: 1.2;
        }
        .org-reference-subtitle p {
          margin: 0;
        }
        .org-reference-subtitle span {
          width: clamp(72px, 8vw, 120px);
          height: 2px;
          border-radius: 999px;
          background: #0f62d7;
        }
        .org-header-actions {
          position: absolute;
          top: 24px;
          right: 24px;
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 10px;
        }
        .org-status-pill,
        .org-mode-button {
          display: inline-flex;
          min-height: 40px;
          align-items: center;
          gap: 8px;
          border-radius: 999px;
          padding: 0 14px;
          font-size: 12px;
          font-weight: 900;
        }
        .org-status-pill {
          border: 1px solid rgba(37, 99, 235, 0.16);
          background: rgba(37, 99, 235, 0.1);
          color: #1d4ed8;
        }
        .org-mode-button {
          border: 1px solid rgba(15, 23, 42, 0.12);
          background: #020f2d;
          color: white;
          box-shadow: 0 12px 26px rgba(15, 23, 42, 0.16);
          transition: transform 160ms ease, box-shadow 160ms ease;
        }
        .org-mode-button:hover,
        .org-mode-button:focus-visible {
          transform: translateY(-1px);
          box-shadow: 0 16px 34px rgba(15, 23, 42, 0.2);
          outline: none;
        }
        .org-blueprint {
          position: relative;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(440px, 640px) minmax(240px, 320px);
          gap: 18px 32px;
          align-items: start;
        }
        .org-core-card {
          position: relative;
          grid-column: 2;
          display: grid;
          grid-template-columns: 36% minmax(0, 1fr);
          gap: 0;
          align-items: center;
          min-height: 160px;
          overflow: hidden;
          border-radius: 14px;
          border: 1px solid rgba(2, 15, 45, 0.12);
          background: linear-gradient(135deg, #031739, #08274f 58%, #020f2d);
          color: white;
          box-shadow: 0 18px 44px rgba(2, 15, 45, 0.18);
        }
        .dark .org-core-card {
          border-color: rgba(2, 15, 45, 0.12);
          background: linear-gradient(135deg, #031739, #08274f 58%, #020f2d);
        }
        .org-core-avatar {
          display: grid;
          width: 100%;
          height: 160px;
          place-items: center;
          overflow: hidden;
          border-radius: 0;
          background:
            radial-gradient(circle at 50% 28%, rgba(56, 189, 248, 0.28), transparent 34%),
            linear-gradient(135deg, rgba(59, 130, 246, 0.38), rgba(2, 15, 45, 0.62));
          padding: 18px;
        }
        .org-core-avatar > * {
          width: 104px !important;
          height: 104px !important;
          border: 4px solid rgba(255, 255, 255, 0.88);
          box-shadow: 0 16px 36px rgba(0, 0, 0, 0.28);
        }
        .org-core-content {
          padding: 18px 26px;
        }
        .org-role-title {
          color: inherit;
          font-size: 30px;
          font-weight: 950;
          line-height: 1;
        }
        .org-agent-name {
          margin-top: 10px;
          color: inherit;
          font-size: 18px;
          font-weight: 950;
          line-height: 1.15;
          opacity: 0.9;
        }
        .dark .org-agent-name {
          color: inherit;
        }
        .org-core-missions {
          display: grid;
          gap: 8px;
          margin-top: 12px;
        }
        .org-core-missions span {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          color: rgba(255, 255, 255, 0.94);
          font-size: 16px;
          font-weight: 900;
        }
        .org-core-missions svg {
          color: #38bdf8;
        }
        .org-core-side {
          grid-column: 3;
          display: grid;
          gap: 13px;
          min-height: 160px;
          border-radius: 16px;
          border: 1px solid rgba(37, 99, 235, 0.2);
          background: rgba(255, 255, 255, 0.9);
          padding: 20px 22px;
          box-shadow: 0 14px 36px rgba(15, 23, 42, 0.08);
        }
        .dark .org-core-side {
          border-color: rgba(37, 99, 235, 0.2);
          background: rgba(255, 255, 255, 0.9);
        }
        .org-side-title {
          color: #1557c0;
          font-size: 22px;
          font-weight: 950;
        }
        .dark .org-side-title {
          color: #1557c0;
        }
        .org-core-item {
          display: flex;
          align-items: center;
          gap: 12px;
          color: #061532;
          font-size: 15px;
          font-weight: 900;
        }
        .dark .org-core-item {
          color: #061532;
        }
        .org-core-item span {
          display: grid;
          width: 34px;
          height: 34px;
          place-items: center;
          border-radius: 999px;
          background: #1557c0;
          color: white;
          font-size: 16px;
        }
        .org-connector {
          grid-column: 1 / -1;
          position: relative;
          height: 48px;
          margin: -2px 7% -10px;
          border-top: 2px solid rgba(15, 94, 215, 0.72);
        }
        .org-connector::before {
          content: '';
          position: absolute;
          left: 50%;
          top: -18px;
          width: 2px;
          height: 18px;
          background: rgba(15, 94, 215, 0.72);
        }
        .org-connector::after {
          content: '';
          position: absolute;
          inset: 0 2%;
          background:
            linear-gradient(90deg, transparent calc(8.33% - 1px), rgba(15, 94, 215, 0.72) calc(8.33% - 1px) calc(8.33% + 1px), transparent calc(8.33% + 1px)),
            linear-gradient(90deg, transparent calc(25% - 1px), rgba(15, 94, 215, 0.72) calc(25% - 1px) calc(25% + 1px), transparent calc(25% + 1px)),
            linear-gradient(90deg, transparent calc(41.67% - 1px), rgba(15, 94, 215, 0.72) calc(41.67% - 1px) calc(41.67% + 1px), transparent calc(41.67% + 1px)),
            linear-gradient(90deg, transparent calc(58.33% - 1px), rgba(15, 94, 215, 0.72) calc(58.33% - 1px) calc(58.33% + 1px), transparent calc(58.33% + 1px)),
            linear-gradient(90deg, transparent calc(75% - 1px), rgba(15, 94, 215, 0.72) calc(75% - 1px) calc(75% + 1px), transparent calc(75% + 1px)),
            linear-gradient(90deg, transparent calc(91.67% - 1px), rgba(15, 94, 215, 0.72) calc(91.67% - 1px) calc(91.67% + 1px), transparent calc(91.67% + 1px));
          background-size: 100% 20px;
          background-repeat: no-repeat;
        }
        .org-role-grid {
          grid-column: 1 / -1;
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 18px;
        }
        .org-role-card {
          position: relative;
          display: grid;
          grid-template-rows: auto 150px auto auto auto;
          min-height: 430px;
          gap: 12px;
          border-radius: 14px;
          border: 1px solid color-mix(in srgb, var(--zone), white 72%);
          background: rgba(255, 255, 255, 0.94);
          padding: 14px 14px 16px;
          text-align: left;
          box-shadow: 0 16px 38px rgba(15, 23, 42, 0.07);
          transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
        }
        .org-role-card:hover,
        .org-role-card:focus-visible,
        .org-role-card-selected {
          transform: translateY(-2px);
          border-color: color-mix(in srgb, var(--zone), white 36%);
          box-shadow: 0 20px 48px color-mix(in srgb, var(--zone), transparent 82%);
          outline: none;
        }
        .dark .org-role-card {
          border-color: color-mix(in srgb, var(--zone), white 72%);
          background: rgba(255, 255, 255, 0.94);
        }
        .org-role-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          color: var(--zone);
          font-size: 20px;
          font-weight: 950;
        }
        .org-role-visual {
          position: relative;
          display: grid;
          place-items: center;
          overflow: hidden;
          border-radius: 10px;
          background:
            linear-gradient(135deg, color-mix(in srgb, var(--zone), white 84%), rgba(255, 255, 255, 0.78)),
            radial-gradient(circle at 70% 20%, color-mix(in srgb, var(--zone), transparent 70%), transparent 34%);
        }
        .org-role-visual::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            linear-gradient(120deg, transparent 0 46%, rgba(255, 255, 255, 0.45) 47% 62%, transparent 63%),
            linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(15, 23, 42, 0.08));
        }
        .org-role-visual-avatar {
          position: relative;
          z-index: 1;
          width: 104px;
          height: 104px;
          border: 4px solid rgba(255, 255, 255, 0.88);
          box-shadow: 0 18px 30px color-mix(in srgb, var(--zone), transparent 72%);
        }
        .org-role-visual-empty {
          position: relative;
          z-index: 1;
          display: grid;
          width: 100px;
          height: 100px;
          place-items: center;
          border-radius: 28px;
          border: 1px dashed color-mix(in srgb, var(--zone), white 28%);
          background: rgba(255, 255, 255, 0.72);
          color: var(--zone);
        }
        .org-role-portrait {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .org-role-mini-avatar {
          width: 42px;
          height: 42px;
          border: 3px solid white;
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.12);
        }
        .org-role-portrait strong {
          display: block;
          max-width: 150px;
          overflow: hidden;
          color: #0f172a;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 15px;
          font-weight: 950;
        }
        .dark .org-role-portrait strong {
          color: #0f172a;
        }
        .org-role-portrait span {
          display: block;
          margin-top: 3px;
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
        }
        .dark .org-role-portrait span {
          color: #64748b;
        }
        .org-vacancy-avatar {
          display: grid;
          width: 42px;
          height: 42px;
          flex: none;
          place-items: center;
          border-radius: 14px;
          border: 1px dashed color-mix(in srgb, var(--zone), white 30%);
          background: color-mix(in srgb, var(--zone), white 90%);
          color: var(--zone);
        }
        .org-role-mission {
          display: grid;
          grid-template-columns: 38px minmax(0, 1fr);
          align-items: center;
          min-height: 58px;
          gap: 10px;
          border-top: 1px solid rgba(15, 23, 42, 0.08);
          border-bottom: 1px solid rgba(15, 23, 42, 0.08);
          padding: 8px 0;
          color: #475569;
          font-size: 13px;
          font-weight: 850;
          line-height: 1.35;
        }
        .org-role-mission svg {
          color: var(--zone);
          width: 34px;
          height: 34px;
        }
        .dark .org-role-mission {
          color: #475569;
        }
        .org-role-copilot {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: auto;
          border-radius: 0;
          background: transparent;
          padding: 0;
          color: #061532;
        }
        .org-role-copilot svg {
          width: 42px;
          height: 42px;
          padding: 8px;
          border-radius: 14px;
          background: color-mix(in srgb, var(--zone), white 82%);
          color: var(--zone);
        }
        .org-role-copilot strong,
        .org-role-copilot span {
          display: block;
          font-size: 13px;
          font-weight: 900;
          line-height: 1.25;
        }
        .org-role-copilot strong {
          color: var(--zone);
          font-size: 16px;
        }
        .org-role-copilot span {
          margin-top: 2px;
          color: #061532;
          opacity: 0.86;
        }
        .org-powered-strip {
          grid-column: 1 / -1;
          display: grid;
          grid-template-columns: 210px minmax(0, 1fr);
          gap: 14px;
          align-items: center;
          margin-top: 8px;
          border-radius: 14px;
          border: 1px solid rgba(191, 219, 254, 0.92);
          background: rgba(255, 255, 255, 0.92);
          padding: 14px 18px;
          color: #061532;
          box-shadow: 0 14px 34px rgba(15, 23, 42, 0.08);
        }
        .org-powered-title {
          text-align: center;
          font-size: 22px;
          font-weight: 950;
        }
        .org-powered-title span {
          display: inline;
          margin-left: 6px;
          color: #1557c0;
        }
        .org-powered-items {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 0;
        }
        .org-powered-item {
          display: flex;
          min-height: 66px;
          align-items: center;
          gap: 10px;
          border-left: 1px solid rgba(37, 99, 235, 0.16);
          padding: 8px 12px;
        }
        .org-powered-item svg {
          width: 30px;
          height: 30px;
          color: #1557c0;
        }
        .org-powered-item strong,
        .org-powered-item span {
          display: block;
          font-size: 12px;
          font-weight: 900;
          line-height: 1.2;
        }
        .org-powered-item span {
          margin-top: 4px;
          color: #061532;
          opacity: 0.72;
        }
        .org-ace-banner {
          grid-column: 1 / -1;
          display: flex;
          min-height: 68px;
          align-items: center;
          gap: 18px;
          margin: 2px 12px 0;
          border-radius: 999px;
          background:
            linear-gradient(90deg, #063c92, #020f2d 24%, #020f2d 78%, #063c92);
          padding: 0 36px;
          color: white;
          box-shadow: 0 18px 36px rgba(2, 15, 45, 0.18);
        }
        .org-ace-mark {
          display: grid;
          width: 42px;
          height: 42px;
          place-items: center;
          border-radius: 12px;
          background: linear-gradient(135deg, #1d4ed8, #38bdf8);
          font-size: 26px;
          font-weight: 950;
        }
        .org-ace-banner strong {
          padding-right: 18px;
          border-right: 1px solid rgba(255, 255, 255, 0.42);
          font-size: 30px;
          line-height: 1;
        }
        .org-ace-banner p {
          margin: 0;
          color: rgba(255, 255, 255, 0.94);
          font-size: 18px;
          font-weight: 850;
        }
        .org-ace-banner b {
          color: #38bdf8;
        }
        .org-management-row {
          display: grid;
          grid-template-columns: minmax(0, 1.3fr) minmax(320px, 0.7fr);
          gap: 14px;
          margin-top: 16px;
        }
        .org-support-panel,
        .org-editor {
          border-radius: 22px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: rgba(255, 255, 255, 0.72);
          padding: 14px;
        }
        .dark .org-support-panel,
        .dark .org-editor {
          border-color: rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.06);
        }
        .org-panel-title {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #0f172a;
          font-size: 13px;
          font-weight: 950;
        }
        .dark .org-panel-title {
          color: white;
        }
        .org-support-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 12px;
        }
        .org-support-chip,
        .org-bench-member {
          display: inline-flex;
          min-height: 44px;
          align-items: center;
          gap: 8px;
          border-radius: 14px;
          border: 1px solid color-mix(in srgb, var(--zone, #64748b), white 70%);
          background: rgba(255, 255, 255, 0.78);
          padding: 7px 10px;
          color: #0f172a;
        }
        .dark .org-support-chip,
        .dark .org-bench-member {
          background: rgba(15, 23, 42, 0.56);
          color: white;
        }
        .org-support-chip {
          flex-direction: column;
          align-items: flex-start;
          min-width: 148px;
          text-align: left;
        }
        .org-support-chip:hover,
        .org-support-chip:focus-visible,
        .org-support-chip-active {
          border-color: var(--zone);
          outline: none;
        }
        .org-support-chip span {
          color: var(--zone);
          font-size: 11px;
          font-weight: 950;
        }
        .org-support-chip strong,
        .org-bench-member span {
          max-width: 132px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12px;
          font-weight: 900;
        }
        .org-bench-member {
          border-color: rgba(15, 23, 42, 0.08);
        }
        .org-editor {
          display: grid;
          align-content: start;
          gap: 12px;
          border-color: color-mix(in srgb, var(--zone), white 70%);
        }
        .org-editor-role {
          border-radius: 16px;
          background: color-mix(in srgb, var(--zone), white 90%);
          padding: 12px;
        }
        .org-editor-role span {
          display: block;
          color: var(--zone);
          font-size: 12px;
          font-weight: 950;
        }
        .org-editor-role strong {
          display: block;
          margin-top: 4px;
          color: #0f172a;
          font-size: 18px;
          font-weight: 950;
          line-height: 1.15;
        }
        .org-editor-role p {
          margin-top: 8px;
          color: #475569;
          font-size: 12px;
          font-weight: 800;
        }
        .org-editor-section {
          display: grid;
          gap: 8px;
        }
        .org-editor-label {
          color: #475569;
          font-size: 12px;
          font-weight: 950;
        }
        .dark .org-editor-label {
          color: #cbd5e1;
        }
        .org-editor-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .org-editor-tags span {
          border-radius: 999px;
          background: color-mix(in srgb, var(--zone), white 88%);
          padding: 6px 9px;
          color: color-mix(in srgb, var(--zone), #0f172a 20%);
          font-size: 11px;
          font-weight: 900;
        }
        .org-agent-select {
          width: 100%;
          min-height: 42px;
          border-radius: 12px;
          border: 1px solid color-mix(in srgb, var(--zone), white 62%);
          background: rgba(255, 255, 255, 0.92);
          padding: 0 12px;
          color: #0f172a;
          font-size: 13px;
          font-weight: 800;
          outline: none;
        }
        .org-agent-select:focus {
          border-color: var(--zone);
          box-shadow: 0 0 0 4px color-mix(in srgb, var(--zone), transparent 84%);
        }
        .org-editor-hint,
        .org-evidence-list,
        .org-vacancy-note {
          color: #64748b;
          font-size: 12px;
          font-weight: 750;
        }
        .org-evidence-list {
          margin: 0;
          padding-left: 18px;
        }
        .org-vacancy-note {
          display: flex;
          align-items: center;
          gap: 8px;
          border-radius: 14px;
          background: rgba(245, 158, 11, 0.12);
          padding: 10px;
          color: #92400e;
        }
        .org-warning {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 14px;
          border-radius: 16px;
          background: rgba(245, 158, 11, 0.12);
          padding: 12px 14px;
          color: #92400e;
          font-size: 13px;
          font-weight: 900;
        }
        @media (max-width: 640px) {
          .office-dock-stage {
            bottom: 0.75rem;
            overflow-x: auto;
            overflow-y: visible;
            scrollbar-width: none;
          }
          .office-dock-stage::-webkit-scrollbar {
            display: none;
          }
          .org-manager {
            padding: 16px;
          }
          .org-header-actions {
            position: static;
            justify-content: flex-start;
            margin-top: 12px;
          }
          .org-reference-title {
            justify-items: start;
            padding-top: 0;
            text-align: left;
          }
          .org-reference-subtitle {
            justify-content: flex-start;
            gap: 10px;
            font-size: 16px;
          }
          .org-reference-subtitle span {
            display: none;
          }
        }
        @media (max-width: 1160px) {
          .org-blueprint {
            grid-template-columns: 1fr;
          }
          .org-core-card,
          .org-core-side {
            grid-column: 1;
          }
          .org-role-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .org-powered-strip,
          .org-management-row {
            grid-template-columns: 1fr;
          }
          .org-powered-items {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .org-connector {
            display: none;
          }
        }
        @media (max-width: 760px) {
          .org-role-grid,
          .org-powered-items {
            grid-template-columns: 1fr;
          }
          .org-core-card {
            grid-template-columns: 1fr;
          }
          .org-core-avatar {
            height: 128px;
          }
          .org-powered-items {
            grid-template-columns: 1fr;
          }
          .org-powered-item {
            border-left: 0;
            border-top: 1px solid rgba(37, 99, 235, 0.16);
          }
          .org-ace-banner {
            align-items: flex-start;
            border-radius: 22px;
            flex-direction: column;
            padding: 18px;
          }
          .org-ace-banner strong {
            border-right: 0;
            padding-right: 0;
          }
        }
        .org-manager {
          color: #061532;
        }
        .dark .org-manager {
          color: #061532;
        }
        .org-header-actions {
          align-items: center;
        }
        .org-add-trigger {
          min-height: 40px;
          width: 148px;
          border-radius: 999px;
          border-color: rgba(37, 99, 235, 0.2);
          background: rgba(255, 255, 255, 0.92);
          color: #061532;
          font-size: 12px;
          font-weight: 900;
          box-shadow: 0 12px 26px rgba(15, 23, 42, 0.08);
        }
        .org-mode-button {
          height: 40px;
          border-radius: 999px;
          background: #020f2d;
          color: white;
          padding: 0 14px;
          font-size: 12px;
          font-weight: 900;
        }
        .org-blueprint {
          grid-template-columns: minmax(280px, 420px) minmax(0, 1fr);
          gap: 20px 24px;
          align-items: stretch;
        }
        .org-core-card {
          grid-column: 1;
          width: 100%;
          min-height: 172px;
          text-align: left;
          cursor: pointer;
        }
        .org-empty-state {
          grid-column: 1;
          display: grid;
          min-height: 172px;
          align-content: center;
          gap: 8px;
          border-radius: 16px;
          border: 1px dashed rgba(37, 99, 235, 0.36);
          background: rgba(255, 255, 255, 0.82);
          padding: 22px;
          color: #1557c0;
        }
        .org-empty-state strong {
          color: #061532;
          font-size: 20px;
          font-weight: 950;
        }
        .org-empty-state p {
          margin: 0;
          color: #475569;
          font-size: 13px;
          font-weight: 800;
        }
        .org-core-side {
          grid-column: 2;
        }
        .org-node-selected {
          outline: 3px solid color-mix(in srgb, var(--zone), transparent 70%);
          outline-offset: 3px;
        }
        .org-connector {
          grid-column: 1 / -1;
          height: 42px;
          margin: -2px 9% -12px;
          border-top: 2px solid rgba(15, 94, 215, 0.62);
        }
        .org-connector::after {
          inset: 0;
          background:
            repeating-linear-gradient(
              90deg,
              transparent 0,
              transparent calc((100% / max(var(--org-count), 1)) - 2px),
              rgba(15, 94, 215, 0.54) calc((100% / max(var(--org-count), 1)) - 2px),
              rgba(15, 94, 215, 0.54) calc(100% / max(var(--org-count), 1))
            );
          mask-image: linear-gradient(#000 0 20px, transparent 20px);
        }
        .org-member-grid {
          grid-column: 1 / -1;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(226px, 1fr));
          gap: 16px;
        }
        .org-member-card {
          position: relative;
          display: grid;
          min-height: 260px;
          align-content: start;
          gap: 12px;
          border-radius: 16px;
          border: 1px solid color-mix(in srgb, var(--zone), white 72%);
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 252, 0.92)),
            radial-gradient(circle at 80% 8%, color-mix(in srgb, var(--zone), transparent 72%), transparent 36%);
          padding: 15px;
          box-shadow: 0 14px 34px rgba(15, 23, 42, 0.08);
          cursor: pointer;
          transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
        }
        .org-member-card:hover,
        .org-member-card:focus-visible {
          transform: translateY(-2px);
          border-color: color-mix(in srgb, var(--zone), white 34%);
          box-shadow: 0 18px 44px color-mix(in srgb, var(--zone), transparent 82%);
          outline: none;
        }
        .org-member-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          color: var(--zone);
          font-size: 14px;
          font-weight: 950;
        }
        .org-member-main {
          display: flex;
          min-width: 0;
          align-items: center;
          gap: 12px;
        }
        .org-member-avatar,
        .org-editor-avatar {
          flex: none;
          border: 3px solid white;
          box-shadow: 0 12px 26px rgba(15, 23, 42, 0.14);
        }
        .org-member-avatar {
          width: 72px;
          height: 72px;
        }
        .org-member-main strong,
        .org-editor-main strong {
          display: block;
          max-width: 150px;
          overflow: hidden;
          color: #061532;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 18px;
          font-weight: 950;
          line-height: 1.1;
        }
        .org-member-main span,
        .org-editor-main span,
        .org-editor-main p {
          display: block;
          margin: 4px 0 0;
          color: #64748b;
          font-size: 12px;
          font-weight: 850;
          line-height: 1.25;
        }
        .org-member-mission {
          display: grid;
          grid-template-columns: 28px minmax(0, 1fr);
          align-items: center;
          gap: 8px;
          border-top: 1px solid rgba(15, 23, 42, 0.08);
          padding-top: 10px;
          color: #475569;
          font-size: 12px;
          font-weight: 850;
        }
        .org-member-mission svg {
          color: var(--zone);
        }
        .org-member-tags,
        .org-editor-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .org-member-tags span,
        .org-editor-tags span {
          max-width: 100%;
          overflow: hidden;
          border-radius: 999px;
          background: color-mix(in srgb, var(--zone), white 88%);
          padding: 6px 9px;
          color: color-mix(in srgb, var(--zone), #0f172a 16%);
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 11px;
          font-weight: 900;
        }
        .org-member-copilot {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: auto;
          color: #061532;
        }
        .org-member-copilot svg {
          width: 36px;
          height: 36px;
          padding: 8px;
          border-radius: 12px;
          background: color-mix(in srgb, var(--zone), white 84%);
          color: var(--zone);
        }
        .org-member-copilot strong,
        .org-member-copilot span {
          display: block;
          font-size: 12px;
          font-weight: 900;
          line-height: 1.2;
        }
        .org-member-copilot strong {
          color: var(--zone);
          font-size: 14px;
        }
        .org-member-controls {
          display: grid;
          gap: 8px;
          margin-top: auto;
        }
        .org-select-trigger {
          width: 100%;
          min-height: 42px;
          border-radius: 12px;
          border-color: color-mix(in srgb, var(--zone), white 62%);
          background: rgba(255, 255, 255, 0.94);
          color: #061532;
          font-size: 12px;
          font-weight: 900;
        }
        .org-remove-button {
          min-height: 38px;
          border-radius: 12px;
          font-weight: 900;
        }
        .org-editor {
          display: grid;
          grid-template-columns: minmax(260px, 1fr) minmax(220px, 0.8fr) minmax(260px, 0.9fr) auto;
          gap: 14px;
          align-items: center;
          margin-top: 16px;
          border-color: color-mix(in srgb, var(--zone), white 68%);
          background: rgba(255, 255, 255, 0.9);
          color: #061532;
          box-shadow: 0 16px 38px rgba(15, 23, 42, 0.08);
        }
        .dark .org-editor {
          background: rgba(255, 255, 255, 0.9);
          color: #061532;
        }
        .org-panel-title {
          color: var(--zone);
        }
        .dark .org-panel-title {
          color: var(--zone);
        }
        .org-editor-main {
          display: flex;
          min-width: 0;
          align-items: center;
          gap: 12px;
          border-radius: 16px;
          background: color-mix(in srgb, var(--zone), white 90%);
          padding: 10px;
        }
        .org-editor-avatar {
          width: 58px;
          height: 58px;
        }
        .org-editor-section {
          min-width: 0;
        }
        .org-editor-label {
          margin-bottom: 8px;
          color: #475569;
          font-size: 12px;
          font-weight: 950;
        }
        .dark .org-editor-label {
          color: #475569;
        }
        .org-editor-hint {
          margin-top: 7px;
          color: #64748b;
          font-size: 11px;
          font-weight: 800;
        }
        .org-editor-actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
        }
        .org-editor-actions button {
          min-height: 40px;
          border-radius: 12px;
          font-weight: 900;
          white-space: nowrap;
        }
        @media (max-width: 1160px) {
          .org-blueprint {
            grid-template-columns: 1fr;
          }
          .org-core-card,
          .org-core-side,
          .org-empty-state {
            grid-column: 1;
          }
          .org-editor {
            grid-template-columns: 1fr;
          }
          .org-editor-actions {
            justify-content: flex-start;
          }
        }
        .office-floor {
          position: relative;
          min-height: 1240px;
          overflow: hidden;
          border-radius: 32px;
          background:
            linear-gradient(135deg, rgba(148, 163, 184, 0.045) 0 1px, transparent 1px 112px),
            linear-gradient(45deg, rgba(148, 163, 184, 0.035) 0 1px, transparent 1px 112px),
            radial-gradient(circle at 18% 18%, rgba(15,23,42,0.06), transparent 18%),
            radial-gradient(circle at 78% 72%, rgba(37,99,235,0.07), transparent 20%),
            linear-gradient(180deg, rgba(255,255,255,0.94), rgba(241,245,249,0.72));
          box-shadow:
            inset 0 0 0 1px rgba(255,255,255,0.72),
            0 28px 90px rgba(15,23,42,0.08);
        }
        .office-member-panel {
          position: relative;
          z-index: 2;
          display: grid;
          grid-template-columns: minmax(180px, 1fr) minmax(220px, 1.2fr) minmax(260px, 1fr);
          gap: 12px;
          align-items: center;
          margin: -4px 0 14px;
          width: 100%;
          border-radius: 20px;
          border: 1px solid color-mix(in srgb, var(--zone), white 72%);
          background: rgba(255, 255, 255, 0.78);
          padding: 14px;
          color: #0f172a;
          box-shadow:
            0 22px 52px rgba(15, 23, 42, 0.14),
            inset 0 1px 0 rgba(255, 255, 255, 0.82);
          backdrop-filter: blur(18px) saturate(1.12);
        }
        .dark .office-member-panel {
          background: rgba(15, 23, 42, 0.72);
          border-color: color-mix(in srgb, var(--zone), transparent 52%);
          color: white;
        }
        .office-member-status {
          border-radius: 14px;
          background: rgba(15, 23, 42, 0.05);
          padding: 10px 12px;
          font-size: 12px;
          color: #475569;
        }
        .dark .office-member-status {
          background: rgba(255, 255, 255, 0.1);
          color: #cbd5e1;
        }
        .office-member-actions {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
          font-size: 12px;
          font-weight: 800;
        }
        .office-member-action {
          display: flex;
          min-height: 34px;
          align-items: center;
          justify-content: center;
          border-radius: 10px;
          background: rgba(15, 23, 42, 0.08);
          color: #0f172a;
          text-align: center;
          transition: transform 160ms ease, background 160ms ease, color 160ms ease;
        }
        .office-member-action:hover,
        .office-member-action:focus-visible {
          background: var(--zone);
          color: white;
          transform: translateY(-1px);
          outline: none;
        }
        .dark .office-member-action {
          background: rgba(255, 255, 255, 0.1);
          color: white;
        }
        @media (max-width: 900px) {
          .office-member-panel {
            grid-template-columns: 1fr;
          }
          .office-member-actions {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        .station {
          position: absolute;
          width: 390px;
          height: 386px;
          transform: translate(-50%, -50%) scale(var(--station-scale, 1));
          transform-origin: 50% 58%;
          cursor: pointer;
          outline: none;
        }
        .station-scene {
          position: absolute;
          inset: 0;
          isolation: isolate;
          --scene-scale: 1;
          --scene-rotate: 0deg;
          transform-origin: 50% 72%;
          animation: stationIdle 5.2s ease-in-out infinite;
          animation-delay: var(--delay);
        }
        .station:hover .station-scene,
        .station:focus-visible .station-scene,
        .station-selected .station-scene {
          filter: drop-shadow(0 22px 24px color-mix(in srgb, var(--zone), transparent 72%));
        }
        .station:focus-visible .station-scene {
          outline: 2px solid color-mix(in srgb, var(--zone), white 12%);
          outline-offset: 10px;
          border-radius: 24px;
        }
        .office-sheet-sprite,
        .station-sprite {
          position: absolute;
          display: block;
          flex: none;
          background-repeat: no-repeat;
          pointer-events: none;
          user-select: none;
        }
        .station-sheet-asset {
          position: absolute;
          display: block;
          background-repeat: no-repeat;
          pointer-events: none;
          transform-origin: center center;
          user-select: none;
        }
        .station-work-screen {
          position: absolute;
          left: 205px;
          top: 61px;
          z-index: 16;
          width: 70px;
          height: 42px;
          transform: scaleX(-1) rotate(-4deg) skewY(-8deg);
          transform-origin: 50% 50%;
          pointer-events: none;
          mix-blend-mode: screen;
          opacity: 0.68;
          filter:
            drop-shadow(0 1px 2px rgba(14, 165, 233, 0.18))
            saturate(1.08);
        }
        .station-work-screen-testing,
        .station-work-screen-reviewing {
          opacity: 0.72;
        }
        .station-work-screen-planning {
          opacity: 0.62;
        }
        .station-floor-slab {
          left: 78px;
          top: 155px;
          z-index: 1;
          filter: drop-shadow(0 20px 18px rgba(15, 23, 42, 0.18));
        }
        .station-desk-shadow {
          left: 106px;
          top: 138px;
          z-index: 2;
          opacity: 0.32;
          transform: skewY(-3deg) scaleX(1.04);
          transform-origin: 50% 50%;
          filter: blur(0.2px);
        }
        .station-cubicle-back-shell,
        .station-cubicle-front-left,
        .station-cubicle-front-right {
          left: 86px;
          top: 82px;
        }
        .station-cubicle-back-shell {
          z-index: 3;
          filter:
            drop-shadow(0 22px 14px rgba(15, 23, 42, 0.16))
            drop-shadow(0 2px 0 rgba(15, 23, 42, 0.1));
          clip-path: polygon(0 0, 100% 0, 100% 70%, 86% 68%, 52% 53%, 33% 70%, 0 54%);
        }
        .station-desk-real {
          left: 108px;
          top: 106px;
          z-index: 7;
          filter: drop-shadow(0 18px 18px rgba(15, 23, 42, 0.13));
        }
        .station-lamp-real {
          left: 132px;
          top: 92px;
          z-index: 6;
          filter: drop-shadow(0 8px 8px rgba(15, 23, 42, 0.14));
        }
        .station-plant-real {
          left: 102px;
          top: 122px;
          z-index: 16;
          filter: drop-shadow(0 8px 8px rgba(15, 23, 42, 0.14));
        }
        .station-tablet-real {
          left: 131px;
          top: 166px;
          z-index: 16;
          filter: drop-shadow(0 7px 8px rgba(15, 23, 42, 0.12));
        }
        .station-tray-real {
          left: 190px;
          top: 118px;
          z-index: 10;
          filter: drop-shadow(0 7px 8px rgba(15, 23, 42, 0.12));
        }
        .station-monitor-real {
          left: 166px;
          top: 52px;
          z-index: 15;
          transform: scaleX(-1) rotate(-5deg) skewY(-8deg);
          transform-origin: 50% 74%;
          filter: drop-shadow(0 12px 14px rgba(37, 99, 235, 0.18));
          animation: monitorPulse 3.6s ease-in-out infinite;
          animation-delay: var(--delay);
        }
        .station-screen-overlay {
          position: absolute;
          left: 176px;
          top: 98px;
          z-index: 9;
          width: 82px;
          height: 48px;
          transform: scaleX(-1) skewY(-7deg) rotate(-4deg);
          transform-origin: 50% 50%;
          pointer-events: none;
          filter: drop-shadow(0 2px 5px rgba(14, 165, 233, 0.18));
          mix-blend-mode: screen;
          opacity: 0.72;
        }
        .screen-scan {
          fill: none;
          stroke: rgba(191, 219, 254, 0.28);
          stroke-width: 1.45;
          stroke-linecap: round;
          stroke-dasharray: 26 18;
          animation: screenScan 2.8s linear infinite;
        }
        .station-keyboard-real {
          left: 188px;
          top: 160px;
          z-index: 12;
          transform: scaleX(-1) rotate(8deg) skewX(-5deg);
          transform-origin: center center;
          filter: drop-shadow(0 8px 10px rgba(15, 23, 42, 0.14));
        }
        .station-mouse-real {
          left: 267px;
          top: 170px;
          z-index: 16;
          transform: rotate(-8deg);
          transform-origin: center center;
          filter: drop-shadow(0 7px 8px rgba(15, 23, 42, 0.12));
        }
        .station-mug-real {
          left: 268px;
          top: 122px;
          z-index: 16;
          filter: drop-shadow(0 7px 8px rgba(15, 23, 42, 0.12));
        }
        .station-chair-back-real {
          left: 140px;
          top: 158px;
          z-index: 18;
          filter: drop-shadow(0 15px 16px rgba(15, 23, 42, 0.2));
        }
        .station-chair-seat-real {
          left: 151px;
          top: 224px;
          z-index: 17;
          filter: drop-shadow(0 12px 14px rgba(15, 23, 42, 0.18));
        }
        .station-desk-front-mask {
          display: none;
          left: 108px;
          top: 132px;
          z-index: 13;
          clip-path: polygon(0 52%, 100% 40%, 100% 100%, 0 100%);
          filter: none;
        }
        .station-cubicle-front-left {
          z-index: 15;
          filter: none;
          clip-path: polygon(0 28%, 44% 48%, 44% 100%, 0 100%);
        }
        .station-cubicle-front-right {
          z-index: 6;
          filter: none;
          clip-path: polygon(74% 32%, 100% 22%, 100% 88%, 74% 98%);
        }
        .station-operator,
        .station-callout-layer {
          position: absolute;
          left: 142px;
          top: 132px;
          width: 128px;
          height: 180px;
          animation: actorFloat 4.2s ease-in-out infinite;
          animation-delay: var(--delay);
        }
        .station-operator {
          z-index: 16;
        }
        .station-callout-layer {
          z-index: 22;
          pointer-events: none;
        }
        .station-presence-seated_work .station-operator,
        .station-presence-seated_work .station-callout-layer,
        .station-presence-thinking_at_desk .station-operator,
        .station-presence-thinking_at_desk .station-callout-layer {
          left: 154px;
          top: 68px;
          animation-name: seatedBreath;
        }
        .station-presence-seated_work .station-operator,
        .station-presence-thinking_at_desk .station-operator {
          z-index: 16;
        }
        .station-agent-sprite {
          position: absolute;
          left: 0;
          top: 0;
          width: 128px;
          height: 180px;
          background-repeat: no-repeat;
          background-size: 768px 180px;
          background-position: 0 0;
          transform: scale(0.72);
          transform-origin: 50% 100%;
          filter: drop-shadow(0 14px 14px rgba(15, 23, 42, 0.18));
          animation: agentSprite6 1.3s steps(6) infinite;
          animation-delay: var(--delay);
        }
        .station-presence-seated_work .station-agent-sprite,
        .station-presence-thinking_at_desk .station-agent-sprite {
          transform: scale(0.76);
          animation: agentSprite6 1.45s steps(6) infinite, seatedWorkBob 2.4s ease-in-out infinite;
          animation-delay: var(--delay);
        }
        .station-presence-seated_work .station-chair-back-real,
        .station-presence-thinking_at_desk .station-chair-back-real {
          z-index: 14;
        }
        .station-presence-seated_work .station-chair-seat-real,
        .station-presence-thinking_at_desk .station-chair-seat-real {
          z-index: 13;
        }
        .station-presence-seated_work .station-status-dot,
        .station-presence-thinking_at_desk .station-status-dot {
          display: none;
        }
        .station-presence-thinking_at_desk .station-agent-sprite {
          filter:
            drop-shadow(0 14px 14px rgba(15, 23, 42, 0.18))
            drop-shadow(0 0 10px color-mix(in srgb, var(--zone), transparent 62%));
        }
        .station-agent-male-work-back-right { background-image: url('/office/agents/male-work-back-right-smart.png?v=${OFFICE_AGENT_ASSET_VERSION}'); }
        .station-agent-male-work-back-left { background-image: url('/office/agents/male-work-back-left-smart.png?v=${OFFICE_AGENT_ASSET_VERSION}'); }
        .station-agent-male-think-back-right { background-image: url('/office/agents/male-think-back-right-smart.png?v=${OFFICE_AGENT_ASSET_VERSION}'); }
        .station-agent-male-think-back-left { background-image: url('/office/agents/male-think-back-left-smart.png?v=${OFFICE_AGENT_ASSET_VERSION}'); }
        .station-agent-female-work-back-right { background-image: url('/office/agents/female-work-back-right-smart.png?v=${OFFICE_AGENT_ASSET_VERSION}'); }
        .station-agent-female-work-back-left { background-image: url('/office/agents/female-work-back-left-smart.png?v=${OFFICE_AGENT_ASSET_VERSION}'); }
        .station-agent-female-think-back-right { background-image: url('/office/agents/female-think-back-right-smart.png?v=${OFFICE_AGENT_ASSET_VERSION}'); }
        .station-agent-female-think-back-left { background-image: url('/office/agents/female-think-back-left-smart.png?v=${OFFICE_AGENT_ASSET_VERSION}'); }
        .station-agent-male-talk-right { background-image: url('/office/agents/male-talk-right-smart.png?v=${OFFICE_AGENT_ASSET_VERSION}'); }
        .station-agent-male-talk-left { background-image: url('/office/agents/male-talk-left-smart.png?v=${OFFICE_AGENT_ASSET_VERSION}'); }
        .station-agent-female-talk-right { background-image: url('/office/agents/female-talk-right-smart.png?v=${OFFICE_AGENT_ASSET_VERSION}'); }
        .station-agent-female-talk-left { background-image: url('/office/agents/female-talk-left-smart.png?v=${OFFICE_AGENT_ASSET_VERSION}'); }
        .station-agent-male-walk-right { background-image: url('/office/agents/male-walk-right-smart.png?v=${OFFICE_AGENT_ASSET_VERSION}'); }
        .station-agent-male-walk-left { background-image: url('/office/agents/male-walk-left-smart.png?v=${OFFICE_AGENT_ASSET_VERSION}'); }
        .station-agent-female-walk-right { background-image: url('/office/agents/female-walk-right-smart.png?v=${OFFICE_AGENT_ASSET_VERSION}'); }
        .station-agent-female-walk-left { background-image: url('/office/agents/female-walk-left-smart.png?v=${OFFICE_AGENT_ASSET_VERSION}'); }
        .office-interaction-layer {
          position: absolute;
          inset: 0;
          z-index: 220;
          pointer-events: none;
        }
        .office-interaction {
          position: absolute;
          inset: 0;
          overflow: visible;
        }
        .office-interaction-visitor,
        .office-interaction-host {
          position: absolute;
          width: 128px;
          height: 180px;
          transform: translate(-50%, -100%) scale(var(--actor-scale, 0.72));
          transform-origin: 50% 100%;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
          will-change: left, top, transform;
        }
        .office-interaction-host {
          opacity: 0;
          animation-timing-function: ease-in-out;
        }
        .office-interaction-sprite {
          position: absolute;
          left: 0;
          top: 0;
          width: 128px;
          height: 180px;
          background-repeat: no-repeat;
          background-size: 768px 180px;
          background-position: 0 0;
          filter: drop-shadow(0 18px 16px rgba(15, 23, 42, 0.22));
          animation-timing-function: ease-in-out, steps(6);
          animation-iteration-count: infinite, infinite;
          animation-fill-mode: both, none;
        }
        .office-interaction-talk-sprite {
          opacity: 0;
        }
        .office-interaction-host .office-interaction-sprite {
          animation: agentSprite6 1.15s steps(6) infinite;
        }
        .office-interaction-shadow {
          position: absolute;
          left: 50%;
          bottom: 4px;
          width: 70px;
          height: 18px;
          transform: translateX(-50%);
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.18);
          filter: blur(5px);
          opacity: 0.48;
        }
        .office-interaction-bubble {
          position: absolute;
          left: 88px;
          top: 16px;
          display: flex;
          gap: 4px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.8);
          background: rgba(255,255,255,0.88);
          padding: 6px 8px;
          box-shadow: 0 10px 24px rgba(15,23,42,0.16);
          opacity: 0;
          transform: translateY(4px);
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
        }
        .office-interaction-host-left .office-interaction-bubble {
          left: auto;
          right: 88px;
        }
        .office-interaction-bubble span {
          width: 5px;
          height: 5px;
          border-radius: 999px;
          background: var(--zone, #2563eb);
          animation: bubbleDot 900ms ease-in-out infinite;
        }
        .office-interaction-bubble span:nth-child(2) { animation-delay: 120ms; }
        .office-interaction-bubble span:nth-child(3) { animation-delay: 240ms; }
        .station-agent-callout {
          position: absolute;
          left: 50%;
          top: -42px;
          z-index: 8;
          display: flex;
          min-width: 132px;
          max-width: 172px;
          align-items: center;
          gap: 7px;
          transform: translateX(-50%);
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.78);
          background: rgba(255, 255, 255, 0.86);
          padding: 5px 9px 5px 5px;
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.14);
          backdrop-filter: blur(14px);
          transition: transform 180ms ease, opacity 180ms ease;
        }
        .station:hover .station-agent-callout,
        .station:focus-visible .station-agent-callout,
        .station-selected .station-agent-callout {
          transform: translateX(-50%) translateY(-4px);
        }
        .station-callout-avatar {
          width: 26px;
          height: 26px;
          border: 2px solid white;
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--zone), transparent 68%);
        }
        .station-callout-text {
          display: flex;
          min-width: 0;
          flex-direction: column;
          line-height: 1.05;
        }
        .station-callout-name {
          max-width: 112px;
          overflow: hidden;
          color: #0f172a;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 11px;
          font-weight: 900;
        }
        .station-callout-status {
          margin-top: 2px;
          color: var(--zone);
          font-size: 10px;
          font-weight: 800;
        }
        .station-callout-arrow {
          position: absolute;
          left: 50%;
          bottom: -7px;
          width: 12px;
          height: 12px;
          transform: translateX(-50%) rotate(45deg);
          border-right: 1px solid rgba(255, 255, 255, 0.78);
          border-bottom: 1px solid rgba(255, 255, 255, 0.78);
          background: rgba(255, 255, 255, 0.86);
        }
        .station-status-dot {
          position: absolute;
          right: 34px;
          bottom: 28px;
          z-index: 3;
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: var(--zone);
          border: 2px solid white;
          box-shadow: 0 0 0 5px color-mix(in srgb, var(--zone), transparent 82%);
          animation: badgeBlink 2.5s ease-in-out infinite;
        }
        .station-layout-1 .station-scene {
          --scene-scale: 1;
          --scene-rotate: 0deg;
        }
        .station-layout-2 .station-scene {
          --scene-scale: 1;
          --scene-rotate: 0deg;
        }
        .station-thinking .station-scene::after {
          content: '?';
          position: absolute;
          left: 198px;
          top: 46px;
          z-index: 18;
          width: 24px;
          height: 24px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          background: color-mix(in srgb, var(--zone), white 24%);
          color: white;
          font-size: 14px;
          font-weight: 900;
          box-shadow: 0 10px 18px rgba(15, 23, 42, 0.14);
          animation: thought 2s ease-in-out infinite;
        }
        .station-reviewing .station-monitor-real { animation-name: reviewScan; }
        .station-presenting .station-monitor-real { transform: scaleX(-1) rotate(-5deg) skewY(-8deg) scale(1.05); }
        .station {
          width: 390px;
          height: 386px;
          transform-origin: 50% 72%;
        }
        .station-floor-slab {
          left: 8px;
          top: 118px;
          z-index: 1;
          filter: drop-shadow(0 22px 18px rgba(15, 23, 42, 0.18));
        }
        .station-cubicle-back-shell,
        .station-cubicle-front-left,
        .station-cubicle-front-right {
          left: 36px;
          top: 38px;
        }
        .station-cubicle-back-shell {
          z-index: 3;
          clip-path: none;
          filter:
            drop-shadow(0 20px 14px rgba(15, 23, 42, 0.12))
            drop-shadow(0 1px 0 rgba(255, 255, 255, 0.36));
        }
        .station-desk-real {
          left: 76px;
          top: 90px;
          z-index: 7;
          filter: drop-shadow(0 12px 12px rgba(15, 23, 42, 0.12));
        }
        .station-lamp-real {
          left: 142px;
          top: 86px;
          z-index: 8;
          transform: scaleX(-1);
          transform-origin: center center;
          filter: drop-shadow(0 8px 8px rgba(15, 23, 42, 0.14));
        }
        .station-plant-real {
          left: 88px;
          top: 126px;
          z-index: 16;
          filter: drop-shadow(0 8px 8px rgba(15, 23, 42, 0.14));
        }
        .station-tablet-real {
          left: 122px;
          top: 169px;
          z-index: 16;
          filter: drop-shadow(0 7px 8px rgba(15, 23, 42, 0.12));
        }
        .station-tray-real {
          left: 196px;
          top: 122px;
          z-index: 11;
          filter: drop-shadow(0 7px 8px rgba(15, 23, 42, 0.12));
        }
        .station-monitor-real {
          left: 166px;
          top: 48px;
          z-index: 13;
          transform: scaleX(-1) rotate(-5deg) skewY(-8deg);
          transform-origin: 50% 74%;
          filter: drop-shadow(0 12px 14px rgba(37, 99, 235, 0.18));
          animation: monitorPulse 3.6s ease-in-out infinite;
          animation-delay: var(--delay);
        }
        .station-screen-overlay {
          left: 172px;
          top: 60px;
          z-index: 14;
          width: 95px;
          height: 55px;
          transform: scaleX(-1) skewY(8deg) rotate(1deg);
          transform-origin: 50% 50%;
          opacity: 0.82;
          mix-blend-mode: screen;
        }
        .station-keyboard-real {
          left: 186px;
          top: 158px;
          z-index: 12;
          transform: scaleX(-1) rotate(8deg) skewX(-5deg);
          transform-origin: center center;
          filter: drop-shadow(0 8px 10px rgba(15, 23, 42, 0.14));
        }
        .station-mouse-real {
          left: 276px;
          top: 170px;
          z-index: 12;
          transform: rotate(-8deg);
          filter: drop-shadow(0 7px 8px rgba(15, 23, 42, 0.12));
        }
        .station-mug-real {
          left: 274px;
          top: 118px;
          z-index: 16;
          filter: drop-shadow(0 7px 8px rgba(15, 23, 42, 0.12));
        }
        .station-chair-back-real {
          left: 144px;
          top: 149px;
          z-index: 18;
          filter: drop-shadow(0 15px 16px rgba(15, 23, 42, 0.2));
        }
        .station-chair-seat-real {
          left: 155px;
          top: 223px;
          z-index: 17;
          filter: drop-shadow(0 12px 14px rgba(15, 23, 42, 0.18));
        }
        .station-cubicle-front-left {
          display: block;
          z-index: 14;
          clip-path: polygon(0 35%, 34% 27%, 34% 100%, 0 100%);
          filter: none;
        }
        .station-cubicle-front-right {
          display: block;
          z-index: 6;
          clip-path: polygon(74% 32%, 100% 22%, 100% 88%, 74% 98%);
          filter: none;
        }
        .station-operator,
        .station-callout-layer {
          left: 246px;
          top: 196px;
          z-index: 16;
        }
        .station-callout-layer {
          left: 176px;
          top: 76px;
          z-index: 22;
        }
        .station-presence-seated_work .station-operator,
        .station-presence-thinking_at_desk .station-operator {
          left: 154px;
          top: 68px;
          z-index: 16;
          animation-name: seatedBreath;
        }
        .station-presence-seated_work .station-callout-layer,
        .station-presence-thinking_at_desk .station-callout-layer {
          left: 172px;
          top: 54px;
          animation: actorFloat 4.2s ease-in-out infinite;
          animation-delay: var(--delay);
        }
        @media (max-width: 900px) {
          .office-floor {
            min-height: 940px;
          }
          .station {
            transform: translate(-50%, -50%) scale(calc(var(--station-scale, 1) * 0.86));
          }
          .station:nth-child(3n + 1) { left: 30% !important; }
          .station:nth-child(3n + 2) { left: 70% !important; }
          .station:nth-child(3n) { left: 50% !important; }
        }
        @media (max-width: 640px) {
          .office-floor {
            min-height: 2240px;
          }
          .station {
            left: 50% !important;
            transform: translate(-50%, -50%) scale(0.68);
          }
          .station:nth-child(1) { top: 8% !important; }
          .station:nth-child(2) { top: 19% !important; }
          .station:nth-child(3) { top: 30% !important; }
          .station:nth-child(4) { top: 41% !important; }
          .station:nth-child(5) { top: 52% !important; }
          .station:nth-child(6) { top: 63% !important; }
          .station:nth-child(7) { top: 74% !important; }
          .station:nth-child(8) { top: 85% !important; }
          .station:nth-child(9) { top: 96% !important; }
        }
        @keyframes stationIdle {
          0%, 100% { transform: scale(var(--scene-scale)) rotate(var(--scene-rotate)) translateY(0); }
          50% { transform: scale(var(--scene-scale)) rotate(var(--scene-rotate)) translateY(-3px); }
        }
        @keyframes actorFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes seatedBreath { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
        @keyframes agentSprite6 { from { background-position: 0 0; } to { background-position: -768px 0; } }
        @keyframes seatedWorkBob {
          0%, 100% { transform: scale(0.76) translateY(0); }
          50% { transform: scale(0.76) translateY(-2px); }
        }
        @keyframes bubbleDot { 0%,100% { transform: translateY(0); opacity: 0.55; } 50% { transform: translateY(-2px); opacity: 1; } }
        @keyframes screenScan { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -50; } }
        @keyframes monitorPulse { 0%,100% { filter: brightness(1) drop-shadow(0 12px 14px rgba(37,99,235,0.18)); } 50% { filter: brightness(1.08) drop-shadow(0 12px 18px rgba(37,99,235,0.3)); } }
        @keyframes badgeBlink { 0%,100% { opacity: 0.95; } 50% { opacity: 0.62; } }
        @keyframes thought { 0%,100% { transform: translateY(0); opacity: 0.45; } 50% { transform: translateY(-5px); opacity: 1; } }
        @keyframes reviewScan { 0%,100% { filter: brightness(1) hue-rotate(0deg) drop-shadow(0 12px 14px rgba(37,99,235,0.18)); } 50% { filter: brightness(1.16) hue-rotate(12deg) drop-shadow(0 12px 20px rgba(14,165,233,0.38)); } }
      `}</style>
    </main>
  );
}
