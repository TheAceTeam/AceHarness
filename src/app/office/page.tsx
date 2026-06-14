'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import Link from 'next/link';
import {
  Building2,
  Bot,
  CheckCircle2,
  Cog,
  Gauge,
  GitBranch,
  Key,
  Package,
  Pencil,
  Send,
  Settings,
  Sparkles,
  Target,
  Users,
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
import AnimatedGlowingSearchBar from '@/components/ui/animated-glowing-search-bar';
import MacOSDock, { type DockApp } from '@/components/ui/mac-os-dock';
import { RainbowBordersButton } from '@/components/ui/rainbow-borders-button';
import SpriteAvatar from '@/components/SpriteAvatar';
import { ThemeToggle } from '@/components/theme-toggle';
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

function officePositionForIndex(index: number, total: number) {
  const visibleTotal = Math.max(1, Math.min(total, OFFICE_MAX_VISIBLE_MEMBERS));
  const columns = visibleTotal <= 2 ? visibleTotal : visibleTotal <= 6 ? 3 : 4;
  const rows = Math.max(1, Math.ceil(visibleTotal / columns));
  const row = Math.floor(index / columns);
  const column = index % columns;
  const minX = columns >= 4 ? 13 : 18;
  const maxX = columns >= 4 ? 87 : 82;
  const minY = rows >= 3 ? 14 : 24;
  const maxY = rows >= 3 ? 80 : 72;
  return {
    x: columns === 1 ? 50 : minX + column * ((maxX - minX) / (columns - 1)),
    y: rows === 1 ? 50 : minY + row * ((maxY - minY) / (rows - 1)),
  };
}

function stationScaleForTotal(total: number) {
  if (total >= 10) return 0.66;
  if (total >= 7) return 0.76;
  if (total >= 4) return 0.88;
  return 0.94;
}

const OFFICE_ASSET_SHEET = '/office/6f4991eb-edc8-4ec2-b78f-975b5a140c74_mattingImg-shadow.png';
const OFFICE_ASSET_SHEET_SIZE = 1254;
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

function TeamComposer({
  prompt,
  setPrompt,
  onBuild,
  busy,
  selected,
  planReady,
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  onBuild: () => void;
  busy: boolean;
  selected: OfficeAgent[];
  planReady: boolean;
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
          disabled={busy}
          className="flex-1"
          placeholder="说出目标，例如：做一个 App，帮我组建产品、设计、开发、测试团队"
        />
        <div className="flex items-center justify-between gap-3">
          <div className="hidden -space-x-2 lg:flex">
            {selected.slice(0, 6).map((agent) => (
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
            disabled={busy || (planReady ? !selected.length : !prompt.trim())}
          >
            <Send className="mr-2 h-4 w-4" />
            {busy ? '处理中' : planReady ? '确认团队' : '生成团队'}
          </RainbowBordersButton>
        </div>
      </div>
    </section>
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

function spriteGenderForMember(member: OfficeMember, index: number): 'male' | 'female' {
  const zone = memberZone(member);
  if (zone === 'design' || zone === 'growth') return 'female';
  const text = `${member.agentName} ${member.displayName} ${member.nickname || ''} ${member.agent.category || ''}`.toLowerCase();
  if (/female|woman|girl|女士|女性|女/.test(text)) return 'female';
  if (/male|man|boy|先生|男性|男/.test(text)) return 'male';
  return index % 5 === 2 ? 'female' : 'male';
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

type OfficePresence = 'seated_work' | 'thinking_at_desk' | 'standing_idle' | 'walking_to_peer' | 'talking_with_peer';
type OfficeInteractionRole = 'host' | 'visitor';
type OfficePresencePlan = {
  member: OfficeMember;
  activity: Activity;
  presence: OfficePresence;
  peerIndex?: number;
  interactionRole?: OfficeInteractionRole;
};

function presenceForActivity(activity: Activity): OfficePresence {
  if (activity === 'walking') return 'walking_to_peer';
  if (activity === 'talking' || activity === 'presenting') return 'talking_with_peer';
  if (activity === 'thinking' || activity === 'reviewing') return 'thinking_at_desk';
  if (activity === 'typing') return 'seated_work';
  return 'standing_idle';
}

function statusTextForPresence(presence: OfficePresence) {
  if (presence === 'seated_work') return '办公中';
  if (presence === 'thinking_at_desk') return '思考中';
  if (presence === 'walking_to_peer') return '走动中';
  if (presence === 'talking_with_peer') return '交流中';
  return '待命';
}

function baseActivityForOfficeDisplay(member: OfficeMember, index: number): Activity {
  const configured = member.motion?.activity;
  if (configured === 'typing' || configured === 'thinking' || configured === 'reviewing') return configured;
  if (index % 7 === 4) return 'thinking';
  return activityForZone(member.visual.zone || zoneOf(member.agent));
}

function buildOfficePresencePlan(members: OfficeMember[]): OfficePresencePlan[] {
  const plans: OfficePresencePlan[] = members.map((member, index) => {
    const activity = baseActivityForOfficeDisplay(member, index);
    return {
      member,
      activity,
      presence: presenceForActivity(activity),
    };
  });

  if (plans.length >= 2) {
    const hostIndex: number = plans.length >= 6 ? 2 : 0;
    const visitorIndex: number = plans.length >= 6 ? 5 : 1;
    if (hostIndex !== visitorIndex && plans[hostIndex] && plans[visitorIndex]) {
      plans[hostIndex] = {
        ...plans[hostIndex],
        activity: 'talking',
        presence: 'talking_with_peer',
        peerIndex: visitorIndex,
        interactionRole: 'host',
      };
      plans[visitorIndex] = {
        ...plans[visitorIndex],
        activity: 'walking',
        presence: 'walking_to_peer',
        peerIndex: hostIndex,
        interactionRole: 'visitor',
      };
    }
  }

  if (plans.length >= 10) {
    const hostIndex = 7;
    const visitorIndex = 10;
    if (plans[hostIndex] && plans[visitorIndex]) {
      plans[hostIndex] = {
        ...plans[hostIndex],
        activity: 'talking',
        presence: 'talking_with_peer',
        peerIndex: visitorIndex,
        interactionRole: 'host',
      };
      plans[visitorIndex] = {
        ...plans[visitorIndex],
        activity: 'walking',
        presence: 'walking_to_peer',
        peerIndex: hostIndex,
        interactionRole: 'visitor',
      };
    }
  }

  return plans;
}

function directionBetween(from: { x: number; y: number }, to: { x: number; y: number }): 'left' | 'right' {
  const deltaX = to.x - from.x;
  if (Math.abs(deltaX) >= 1) return deltaX < 0 ? 'left' : 'right';
  return to.y < from.y ? 'right' : 'left';
}

function walkingRouteOffset(from: { x: number; y: number }, to: { x: number; y: number }) {
  const direction = directionBetween(from, to);
  const sideStop = direction === 'right' ? -72 : 72;
  return {
    x: Math.max(-245, Math.min(245, Math.round((to.x - from.x) * 4.2 + sideStop))),
    y: Math.max(-150, Math.min(150, Math.round((to.y - from.y) * 3.2 + 18))),
  };
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

function OfficeScreenOverlay({ zone, presence, index }: { zone: { color: string }; presence: OfficePresence; index: number }) {
  const progress = presence === 'thinking_at_desk' ? 46 : presence === 'talking_with_peer' ? 72 : presence === 'walking_to_peer' ? 58 : 84;
  return (
    <svg className="station-screen-overlay" viewBox="0 0 112 66" aria-hidden="true">
      <defs>
        <linearGradient id={`screenGradient-${index}`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#0b4dd8" />
          <stop offset="55%" stopColor="#0b7ee8" />
          <stop offset="100%" stopColor={zone.color} />
        </linearGradient>
      </defs>
      <path d="M7 9 105 4 101 48 15 60Z" fill={`url(#screenGradient-${index})`} opacity="0.82" />
      <path className="screen-scan" d="M11 16 52 13M12 23 42 21M13 31 55 29M67 14 97 12M69 22 101 20M70 31 92 29" />
      <rect x="14" y="41" width={progress} height="5" rx="2.5" fill="#7dd3fc" opacity="0.82" />
      <rect x="14" y="51" width="24" height="4" rx="2" fill="#bfdbfe" opacity="0.62" />
      <rect x="45" y="49" width="44" height="4" rx="2" fill="#bfdbfe" opacity="0.42" />
    </svg>
  );
}

function LiveOffice({ members }: { members: OfficeMember[] }) {
  const [selectedAgentName, setSelectedAgentName] = useState<string | null>(members[0]?.agentName || null);
  const visibleMembers = useMemo(() => members.slice(0, OFFICE_MAX_VISIBLE_MEMBERS), [members]);
  const presencePlans = useMemo(() => buildOfficePresencePlan(visibleMembers), [visibleMembers]);
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
            <button type="button" className="office-member-action">私聊</button>
            <button type="button" className="office-member-action">拉人协作</button>
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
            peerPlan={typeof planItem.peerIndex === 'number' ? presencePlans[planItem.peerIndex] : undefined}
            selected={planItem.member.agentName === selectedMember?.agentName}
            onSelect={() => setSelectedAgentName(planItem.member.agentName)}
          />
        ))}
      </div>
    </section>
  );
}

function OfficeStation({
  plan,
  index,
  total,
  peerPlan,
  selected,
  onSelect,
}: {
  plan: OfficePresencePlan;
  index: number;
  total: number;
  peerPlan?: OfficePresencePlan;
  selected: boolean;
  onSelect: () => void;
}) {
  const member = plan.member;
  const position = officePositionForIndex(index, total);
  const zone = ZONES[member.visual.zone || zoneOf(member.agent)] || ZONES.generalist;
  const activity = plan.activity;
  const presence = plan.presence;
  const layout = index % 3;
  const targetPosition = typeof plan.peerIndex === 'number' ? officePositionForIndex(plan.peerIndex, total) : position;
  const travelOffset = walkingRouteOffset(position, targetPosition);
  const travelDirection = directionBetween(position, targetPosition);
  const deskFacingDirection: 'left' | 'right' = 'right';
  const restingDirection =
    plan.interactionRole === 'host'
      ? 'right'
      : presence === 'seated_work' || presence === 'thinking_at_desk'
        ? deskFacingDirection
        : typeof plan.peerIndex === 'number'
          ? directionBetween(position, targetPosition)
          : index % 3 === 1 ? 'left' : 'right';
  const spriteGender = spriteGenderForMember(member, index);
  const isDeskPresence = presence === 'seated_work' || presence === 'thinking_at_desk';
  const spriteDirection = presence === 'walking_to_peer' ? travelDirection : restingDirection;
  const agentAnimation =
    plan.interactionRole === 'host'
      ? `${spriteGender}-idle-right`
      : presence === 'walking_to_peer'
        ? `${spriteGender}-walk-${travelDirection}`
        : isDeskPresence
          ? `${spriteGender}-sit-${deskFacingDirection}`
          : `${spriteGender}-idle-${restingDirection}`;
  const statusText = plan.interactionRole ? '交流中' : statusTextForPresence(presence);
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
      className={`station station-${activity} station-presence-${presence} ${plan.interactionRole ? `station-interaction-${plan.interactionRole}` : ''} station-layout-${layout} station-facing-${spriteDirection} station-travel-${travelDirection} ${selected ? 'station-selected' : ''}`}
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
        ['--travel-x' as any]: `${travelOffset.x}px`,
        ['--travel-y' as any]: `${travelOffset.y}px`,
      }}
    >
      <div className="station-scene">
        <OfficeSprite sprite="floorSlab" scale={1.22} className="station-sprite station-floor-slab" />
        <OfficeSprite sprite="cubicle" scale={1.18} className="station-sprite station-cubicle-back-shell" />
        <OfficeSprite sprite="deskTop" scale={0.93} className="station-sprite station-desk-real" />
        <OfficeSprite sprite="lamp" scale={0.32} className="station-sprite station-lamp-real" />
        <OfficeSprite sprite="plant" scale={0.25} className="station-sprite station-plant-real" />
        <OfficeSprite sprite="tablet" scale={0.17} className="station-sprite station-tablet-real" />
        <OfficeSprite sprite="tray" scale={0.2} className="station-sprite station-tray-real" />
        <OfficeSprite sprite="monitor" scale={0.5} className="station-sprite station-monitor-real" />
        <OfficeScreenOverlay zone={zone} presence={presence} index={index} />
        <OfficeSprite sprite="keyboard" scale={0.22} className="station-sprite station-keyboard-real" />
        <OfficeSprite sprite="trackpad" scale={0.15} className="station-sprite station-mouse-real" />
        <OfficeSprite sprite="mug" scale={0.17} className="station-sprite station-mug-real" />
        <OfficeSprite sprite="chairBack" scale={0.45} className="station-sprite station-chair-back-real" />
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
        <div className="station-operator">
          <span className={`station-agent-sprite station-agent-${agentAnimation}`} aria-hidden="true" />
          {presence === 'talking_with_peer' || plan.interactionRole ? <span className="station-talk-bubble" aria-hidden="true" /> : null}
          <span className="station-status-dot" />
        </div>
        {plan.interactionRole === 'host' && peerPlan ? (
          <div className="station-peer-operator">
            <span className={`station-agent-sprite station-agent-${spriteGenderForMember(peerPlan.member, plan.peerIndex ?? index)}-idle-left`} aria-hidden="true" />
            <span className="station-talk-bubble station-talk-bubble-peer" aria-hidden="true" />
          </div>
        ) : null}
        <OfficeSprite sprite="chairSeat" scale={0.36} className="station-sprite station-chair-seat-real" />
        <OfficeSprite sprite="cubicle" scale={1.18} className="station-sprite station-cubicle-front-left" />
        <OfficeSprite sprite="cubicle" scale={1.18} className="station-sprite station-cubicle-front-right" />
      </div>
    </div>
  );
}

export default function OfficePage() {
  const [members, setMembers] = useState<OfficeMember[]>([]);
  const [availableAgents, setAvailableAgents] = useState<OfficeAgent[]>([]);
  const [prompt, setPrompt] = useState('帮我搭建一个 App 开发团队');
  const [plan, setPlan] = useState<OfficeTeamPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

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

  useEffect(() => {
    loadMembers().catch((error) => setMessage(error?.message || '办公室暂时进不去'));
    loadAvailableAgents().catch((error) => setMessage(error?.message || 'Agent 列表暂时不可用'));
  }, [loadAvailableAgents, loadMembers]);

  const agentOptions = useMemo(() => {
    const byName = new Map<string, OfficeAgent>();
    for (const agent of availableAgents) byName.set(agent.name, agent);
    for (const member of members) byName.set(member.agent.name, member.agent);
    for (const member of plan?.members || []) byName.set(member.agent.name, member.agent);
    return [...byName.values()].sort((a, b) => displayName(a).localeCompare(displayName(b)));
  }, [availableAgents, members, plan]);

  const selectedAgents = useMemo(() => (
    plan?.members.map((member) => member.agent) || members.map((member) => member.agent)
  ), [members, plan]);

  const officeMembersForDisplay = useMemo<OfficeMember[]>(() => {
    const source = plan ? plan.members.map(planMemberToOfficeMember) : members;
    return source;
  }, [members, plan]);

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

  const handleTeamAction = useCallback(async () => {
    setBusy(true);
    setMessage('');
    try {
      if (!plan) {
        const res = await fetch('/api/office/team/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requirement: prompt, maxMembers: 12, minMembers: 6 }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message || data?.error || '生成团队失败');
        setPlan(data.plan);
        setMessage(`${data.plan?.members?.length || 0} 位成员已进入候选团队`);
        return;
      }

      const res = await fetch('/api/office/team/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || data?.error || '创建团队失败');
      await loadMembers();
      setPlan(null);
      setMessage(`团队已创建，${data.state?.activeAgentNames?.length || selectedAgents.length} 位成员进入办公室`);
    } catch (error: any) {
      setMessage(error?.message || '操作失败');
    } finally {
      setBusy(false);
    }
  }, [loadMembers, plan, prompt, selectedAgents.length]);

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
          <TeamComposer prompt={prompt} setPrompt={(value) => { setPrompt(value); setPlan(null); }} selected={selectedAgents} busy={busy} onBuild={handleTeamAction} planReady={!!plan} />
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
          <LiveOffice members={officeMembersForDisplay} />
        </div>
      </div>
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
          height: 330px;
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
        .station-floor-slab {
          left: 78px;
          top: 155px;
          z-index: 1;
          filter: drop-shadow(0 20px 18px rgba(15, 23, 42, 0.18));
        }
        .station-desk-shadow {
          left: 121px;
          top: 150px;
          z-index: 2;
          opacity: 0.34;
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
          top: 132px;
          z-index: 6;
          filter: drop-shadow(0 18px 18px rgba(15, 23, 42, 0.13));
        }
        .station-lamp-real {
          left: 132px;
          top: 92px;
          z-index: 6;
          filter: drop-shadow(0 8px 8px rgba(15, 23, 42, 0.14));
        }
        .station-plant-real {
          left: 111px;
          top: 134px;
          z-index: 8;
          filter: drop-shadow(0 8px 8px rgba(15, 23, 42, 0.14));
        }
        .station-tablet-real {
          left: 143px;
          top: 173px;
          z-index: 8;
          filter: drop-shadow(0 7px 8px rgba(15, 23, 42, 0.12));
        }
        .station-tray-real {
          left: 184px;
          top: 137px;
          z-index: 8;
          filter: drop-shadow(0 7px 8px rgba(15, 23, 42, 0.12));
        }
        .station-monitor-real {
          left: 162px;
          top: 86px;
          z-index: 8;
          transform: scaleX(-1) skewY(-2deg) rotate(-4deg);
          transform-origin: 52% 72%;
          filter: drop-shadow(0 12px 14px rgba(37, 99, 235, 0.18));
          animation: monitorPulse 3.6s ease-in-out infinite;
          animation-delay: var(--delay);
        }
        .station-screen-overlay {
          position: absolute;
          left: 179px;
          top: 99px;
          z-index: 9;
          width: 74px;
          height: 43px;
          transform: scaleX(-1) skewY(-10deg) rotate(-4deg);
          transform-origin: 50% 50%;
          pointer-events: none;
          filter: drop-shadow(0 4px 8px rgba(14, 165, 233, 0.22));
          opacity: 0.92;
        }
        .screen-scan {
          fill: none;
          stroke: rgba(191, 219, 254, 0.8);
          stroke-width: 2.2;
          stroke-linecap: round;
          stroke-dasharray: 36 14;
          animation: screenScan 2.8s linear infinite;
        }
        .station-keyboard-real {
          left: 176px;
          top: 168px;
          z-index: 9;
          transform: scaleX(-1) skewY(-5deg) rotate(3deg);
          transform-origin: center center;
          filter: drop-shadow(0 8px 10px rgba(15, 23, 42, 0.14));
        }
        .station-mouse-real {
          left: 154px;
          top: 178px;
          z-index: 9;
          transform: scaleX(-1) skewY(-4deg) rotate(3deg);
          transform-origin: center center;
          filter: drop-shadow(0 7px 8px rgba(15, 23, 42, 0.12));
        }
        .station-mug-real {
          left: 252px;
          top: 141px;
          z-index: 15;
          filter: drop-shadow(0 7px 8px rgba(15, 23, 42, 0.12));
        }
        .station-chair-back-real {
          left: 140px;
          top: 158px;
          z-index: 11;
          filter: drop-shadow(0 15px 16px rgba(15, 23, 42, 0.2));
        }
        .station-chair-seat-real {
          left: 151px;
          top: 224px;
          z-index: 10;
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
          z-index: 15;
          filter: none;
          clip-path: polygon(74% 45%, 100% 29%, 100% 100%, 74% 100%);
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
          z-index: 13;
        }
        .station-callout-layer {
          z-index: 22;
          pointer-events: none;
        }
        .station-presence-seated_work .station-operator,
        .station-presence-seated_work .station-callout-layer,
        .station-presence-thinking_at_desk .station-operator,
        .station-presence-thinking_at_desk .station-callout-layer {
          left: 146px;
          top: 50px;
          animation-name: seatedBreath;
        }
        .station-presence-seated_work .station-operator,
        .station-presence-thinking_at_desk .station-operator {
          z-index: 13;
        }
        .station-presence-walking_to_peer .station-operator {
          animation: agentTravel 8.4s ease-in-out infinite;
          animation-delay: var(--delay);
        }
        .station-presence-walking_to_peer .station-callout-layer {
          animation: agentTravel 8.4s ease-in-out infinite;
          animation-delay: var(--delay);
        }
        .station-agent-sprite {
          position: absolute;
          left: 0;
          top: 0;
          width: 128px;
          height: 180px;
          background-repeat: no-repeat;
          background-size: 1024px 180px;
          background-position: 0 0;
          transform: scale(0.62);
          transform-origin: 50% 100%;
          filter: drop-shadow(0 14px 14px rgba(15, 23, 42, 0.18));
          animation: none;
        }
        .station-presence-seated_work .station-agent-sprite,
        .station-presence-thinking_at_desk .station-agent-sprite {
          background-size: 512px 180px;
          transform: scale(0.6);
          clip-path: inset(0 0 18% 0);
          animation: seatedWorkFrames 1.8s steps(4) infinite, seatedWorkBob 2.4s ease-in-out infinite;
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
          right: 38px;
          bottom: 42px;
        }
        .station-presence-thinking_at_desk .station-agent-sprite {
          filter:
            drop-shadow(0 14px 14px rgba(15, 23, 42, 0.18))
            drop-shadow(0 0 10px color-mix(in srgb, var(--zone), transparent 62%));
        }
        .station-interaction-host .station-operator {
          left: 106px;
          top: 112px;
          z-index: 17;
          animation: operatorTalkNod 1.2s ease-in-out infinite;
          animation-delay: var(--delay);
        }
        .station-interaction-host .station-agent-sprite {
          transform: scale(0.64);
        }
        .station-peer-operator {
          position: absolute;
          left: 194px;
          top: 112px;
          width: 128px;
          height: 180px;
          z-index: 17;
          animation: operatorTalkNod 1.2s ease-in-out infinite reverse;
          animation-delay: var(--delay);
        }
        .station-peer-operator .station-agent-sprite {
          transform: scale(0.64);
        }
        .station-interaction-visitor .station-operator,
        .station-interaction-visitor .station-callout-layer {
          pointer-events: none;
        }
        .station-talk-bubble-peer {
          left: 28px;
          top: 10px;
        }
        .station-presence-walking_to_peer .station-agent-sprite {
          animation:
            agentSpriteFrames 0.96s steps(8) infinite,
            agentStepBob 0.54s ease-in-out infinite;
          animation-delay: var(--delay);
        }
        .station-presence-talking_with_peer .station-agent-sprite,
        .station-presenting .station-agent-sprite {
          animation: talkNod 1.2s ease-in-out infinite;
          animation-delay: var(--delay);
        }
        .station-agent-male-idle-left,
        .station-agent-idle-left {
          background-image: url('/office/agents/male-idle-left-smart.png');
          animation-duration: 2.4s;
        }
        .station-agent-male-idle-right,
        .station-agent-idle-right {
          background-image: url('/office/agents/male-idle-right-smart.png');
          animation-duration: 2.4s;
        }
        .station-agent-male-walk-left,
        .station-agent-walk-left {
          background-image: url('/office/agents/male-walk-left-smart.png');
        }
        .station-agent-male-walk-right,
        .station-agent-walk-right {
          background-image: url('/office/agents/male-walk-right-smart.png');
        }
        .station-agent-female-idle-left {
          background-image: url('/office/agents/female-idle-left-smart.png');
        }
        .station-agent-female-idle-right {
          background-image: url('/office/agents/female-idle-right-smart.png');
        }
        .station-agent-female-walk-left {
          background-image: url('/office/agents/female-walk-left-smart.png');
        }
        .station-agent-female-walk-right {
          background-image: url('/office/agents/female-walk-right-smart.png');
        }
        .station-agent-male-sit-left {
          background-image: url('/office/agents/male-sit-left-smart.png');
        }
        .station-agent-male-sit-right {
          background-image: url('/office/agents/male-sit-right-smart.png');
        }
        .station-agent-female-sit-left {
          background-image: url('/office/agents/female-sit-left-smart.png');
        }
        .station-agent-female-sit-right {
          background-image: url('/office/agents/female-sit-right-smart.png');
        }
        .station-talk-bubble {
          position: absolute;
          left: 82px;
          top: 16px;
          z-index: 5;
          width: 34px;
          height: 22px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 8px 16px rgba(15, 23, 42, 0.14);
          animation: talkBubble 1.4s ease-in-out infinite;
        }
        .station-talk-bubble::before,
        .station-talk-bubble::after {
          content: '';
          position: absolute;
          top: 9px;
          width: 4px;
          height: 4px;
          border-radius: 999px;
          background: var(--zone);
        }
        .station-talk-bubble::before {
          left: 10px;
          box-shadow: 7px 0 0 var(--zone), 14px 0 0 var(--zone);
        }
        .station-talk-bubble::after {
          left: 7px;
          top: 18px;
          width: 8px;
          height: 8px;
          transform: rotate(45deg);
          border-radius: 2px;
          background: rgba(255, 255, 255, 0.92);
        }
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
        .station-presenting .station-monitor-real { transform: scale(1.08); }
        .station {
          width: 390px;
          height: 368px;
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
          left: 86px;
          top: 116px;
          z-index: 6;
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
          left: 82px;
          top: 141px;
          z-index: 9;
          filter: drop-shadow(0 8px 8px rgba(15, 23, 42, 0.14));
        }
        .station-tablet-real {
          left: 120px;
          top: 181px;
          z-index: 9;
          filter: drop-shadow(0 7px 8px rgba(15, 23, 42, 0.12));
        }
        .station-tray-real {
          left: 204px;
          top: 114px;
          z-index: 9;
          filter: drop-shadow(0 7px 8px rgba(15, 23, 42, 0.12));
        }
        .station-monitor-real {
          left: 186px;
          top: 38px;
          z-index: 10;
          transform: none;
          transform-origin: 52% 72%;
          filter: drop-shadow(0 12px 14px rgba(37, 99, 235, 0.18));
          animation: monitorPulse 3.6s ease-in-out infinite;
          animation-delay: var(--delay);
        }
        .station-screen-overlay {
          left: 196px;
          top: 54px;
          z-index: 11;
          width: 95px;
          height: 55px;
          transform: skewY(-8deg) rotate(-1deg);
          opacity: 0.82;
          mix-blend-mode: screen;
        }
        .station-keyboard-real {
          left: 210px;
          top: 149px;
          z-index: 10;
          transform: rotate(-2deg);
          filter: drop-shadow(0 8px 10px rgba(15, 23, 42, 0.14));
        }
        .station-mouse-real {
          left: 286px;
          top: 164px;
          z-index: 10;
          transform: rotate(-8deg);
          filter: drop-shadow(0 7px 8px rgba(15, 23, 42, 0.12));
        }
        .station-mug-real {
          left: 307px;
          top: 116px;
          z-index: 11;
          filter: drop-shadow(0 7px 8px rgba(15, 23, 42, 0.12));
        }
        .station-chair-back-real {
          left: 144px;
          top: 149px;
          z-index: 13;
          filter: drop-shadow(0 15px 16px rgba(15, 23, 42, 0.2));
        }
        .station-chair-seat-real {
          left: 155px;
          top: 223px;
          z-index: 12;
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
          z-index: 14;
          clip-path: polygon(74% 35%, 100% 25%, 100% 100%, 74% 100%);
          filter: none;
        }
        .station-operator,
        .station-callout-layer {
          left: 246px;
          top: 196px;
          z-index: 15;
        }
        .station-callout-layer {
          left: 176px;
          top: 76px;
          z-index: 22;
        }
        .station-presence-seated_work .station-operator,
        .station-presence-thinking_at_desk .station-operator {
          left: 154px;
          top: 104px;
          z-index: 12;
          animation-name: seatedBreath;
        }
        .station-presence-seated_work .station-callout-layer,
        .station-presence-thinking_at_desk .station-callout-layer {
          left: 172px;
          top: 54px;
          animation: actorFloat 4.2s ease-in-out infinite;
          animation-delay: var(--delay);
        }
        .station-presence-walking_to_peer .station-operator {
          left: 246px;
          top: 196px;
          z-index: 16;
        }
        .station-presence-walking_to_peer .station-callout-layer {
          left: 246px;
          top: 158px;
        }
        .station-interaction-host .station-operator {
          left: 230px;
          top: 196px;
          z-index: 16;
          animation: operatorTalkNod 1.2s ease-in-out infinite;
          animation-delay: var(--delay);
        }
        .station-peer-operator {
          left: 288px;
          top: 196px;
          z-index: 17;
          animation: operatorTalkNod 1.2s ease-in-out infinite reverse;
          animation-delay: var(--delay);
        }
        .station-interaction-host .station-agent-sprite,
        .station-peer-operator .station-agent-sprite {
          transform: scale(0.54);
        }
        .station-talk-bubble {
          left: 78px;
          top: 14px;
        }
        .station-talk-bubble-peer {
          left: 8px;
          top: 14px;
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
        @keyframes actorWalk { 0%,100% { transform: translateX(-10px) translateY(0); } 50% { transform: translateX(10px) translateY(-4px); } }
        @keyframes seatedBreath { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
        @keyframes agentTravel {
          0%, 14% { transform: translate(0, 0); opacity: 1; }
          46%, 70% { transform: translate(var(--travel-x), var(--travel-y)); opacity: 1; }
          82%, 99% { transform: translate(var(--travel-x), var(--travel-y)); opacity: 0; }
          100% { transform: translate(0, 0); opacity: 0; }
        }
        @keyframes agentVisit {
          0%, 18% { transform: translate(0, 0); }
          42%, 76% { transform: translate(calc(var(--travel-x) * 0.72), calc(var(--travel-y) * 0.72)); }
          100% { transform: translate(0, 0); }
        }
        @keyframes agentSpriteFrames { from { background-position: 0 0; } to { background-position: -1024px 0; } }
        @keyframes seatedWorkFrames { from { background-position: 0 0; } to { background-position: -512px 0; } }
        @keyframes agentStepBob {
          0%, 100% { transform: scale(0.62) translateY(0) rotate(-1deg); }
          50% { transform: scale(0.62) translateY(-5px) rotate(1deg); }
        }
        @keyframes seatedWorkBob {
          0%, 100% { transform: scale(0.6) translateY(0); }
          50% { transform: scale(0.6) translateY(-2px); }
        }
        @keyframes screenScan { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -50; } }
        @keyframes monitorPulse { 0%,100% { filter: brightness(1) drop-shadow(0 12px 14px rgba(37,99,235,0.18)); } 50% { filter: brightness(1.08) drop-shadow(0 12px 18px rgba(37,99,235,0.3)); } }
        @keyframes badgeBlink { 0%,100% { opacity: 0.95; } 50% { opacity: 0.62; } }
        @keyframes talkNod {
          0%, 100% { transform: scale(0.62) rotate(0); }
          50% { transform: scale(0.62) rotate(-4deg) translateY(-2px); }
        }
        @keyframes operatorTalkNod {
          0%, 100% { transform: rotate(0) translateY(0); }
          50% { transform: rotate(-4deg) translateY(-2px); }
        }
        @keyframes talkBubble {
          0%, 100% { opacity: 0.78; transform: translateY(0) scale(0.96); }
          50% { opacity: 1; transform: translateY(-5px) scale(1); }
        }
        @keyframes thought { 0%,100% { transform: translateY(0); opacity: 0.45; } 50% { transform: translateY(-5px); opacity: 1; } }
        @keyframes reviewScan { 0%,100% { filter: brightness(1) hue-rotate(0deg) drop-shadow(0 12px 14px rgba(37,99,235,0.18)); } 50% { filter: brightness(1.16) hue-rotate(12deg) drop-shadow(0 12px 20px rgba(14,165,233,0.38)); } }
      `}</style>
    </main>
  );
}
