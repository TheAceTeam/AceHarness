'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import {
  Bot,
  Cog,
  Gauge,
  Key,
  Package,
  Send,
  Settings,
  Sparkles,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
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

const OFFICE_POSITIONS = [
  { x: 18, y: 19 }, { x: 50, y: 18 }, { x: 82, y: 19 },
  { x: 22, y: 51 }, { x: 52, y: 50 }, { x: 80, y: 52 },
  { x: 18, y: 80 }, { x: 48, y: 80 }, { x: 76, y: 80 },
];

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
  if (zone === 'core') return 'presenting';
  if (zone === 'design') return 'talking';
  if (zone === 'quality' || zone === 'decision') return 'reviewing';
  if (zone === 'growth' || zone === 'operations') return 'walking';
  if (zone === 'product') return 'thinking';
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
          <RainbowBordersButton className="h-11" onClick={onBuild} disabled={busy || !selected.length}>
            <Send className="mr-2 h-4 w-4" />
            {busy ? '处理中' : planReady ? '确认团队' : '生成团队'}
          </RainbowBordersButton>
        </div>
      </div>
    </section>
  );
}

function ArchitectureDiagram({ members }: { members: OfficeMember[] }) {
  const sorted = [...members].sort((a, b) => a.visual.order - b.visual.order);
  const leader = sorted.find((member) => (member.visual.zone || zoneOf(member.agent)) === 'core') || sorted[0];
  const rest = leader ? sorted.filter((member) => member.agentName !== leader.agentName) : [];

  if (!leader) {
    return (
      <section className="rounded-[34px] border border-white/70 bg-white/62 p-10 text-center shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
        <h2 className="text-2xl font-bold">先创建团队</h2>
        <p className="mt-2 text-slate-500">输入目标后，办公室会自动生成团队架构和实时工位。</p>
      </section>
    );
  }

  return (
    <section className="rounded-[34px] border border-white/70 bg-white/62 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
      <div className="mb-5 text-center">
        <h2 className="text-3xl font-black tracking-normal">团队架构</h2>
        <p className="mt-1 text-slate-500">自动匹配出来的协作关系</p>
      </div>
      <div className="flex flex-col items-center">
        <OrgNode member={leader} large />
        {rest.length ? <div className="h-8 w-px bg-blue-300" /> : null}
        {rest.length ? <div className="mb-4 h-px w-[86%] bg-blue-300" /> : null}
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {rest.map((member) => (
            <OrgNode key={member.agentName} member={member} />
          ))}
        </div>
      </div>
    </section>
  );
}

function OrgNode({ member, large = false }: { member: OfficeMember; large?: boolean }) {
  const zone = ZONES[member.visual.zone || zoneOf(member.agent)] || ZONES.generalist;
  const avatar = resolveAgentAvatarSrc(member.agent.avatar, member.agent.name, {
    team: member.agent.team || 'blue',
    roleType: member.agent.roleType || 'normal',
  });
  return (
    <div className={`rounded-2xl border bg-white/76 p-3 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 ${large ? 'w-full max-w-xl' : ''}`} style={{ borderColor: `${zone.color}55` }}>
      <div className="flex items-center gap-3">
        <SpriteAvatar avatar={avatar} seed={member.agentName} category="agent-default" alt={member.displayName} fallback={initials(member.displayName)} className={large ? 'h-16 w-16' : 'h-12 w-12'} fallbackClassName="text-xs" />
        <div className="min-w-0">
          <div className={large ? 'text-xl font-bold' : 'text-sm font-bold'}>{member.nickname || member.displayName}</div>
          <div className="mt-0.5 text-xs font-semibold" style={{ color: zone.color }}>{zone.label}</div>
          <div className="mt-1 text-xs text-slate-500">{zone.brief}</div>
        </div>
      </div>
    </div>
  );
}

function LiveOffice({ members }: { members: OfficeMember[] }) {
  if (!members.length) return null;
  return (
    <section className="rounded-[34px] border border-white/70 bg-white/62 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-3xl font-black tracking-normal">办公室实时状态</h2>
          <p className="mt-1 text-slate-500">成员会按自己的动作在工位上工作、走动和交流</p>
        </div>
        <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600">{members.length} 人在线</span>
      </div>
      <div className="office-floor">
        {members.slice(0, 9).map((member, index) => (
          <OfficeStation key={member.agentName} member={member} index={index} />
        ))}
      </div>
    </section>
  );
}

function OfficeStation({ member, index }: { member: OfficeMember; index: number }) {
  const position = OFFICE_POSITIONS[index % OFFICE_POSITIONS.length];
  const zone = ZONES[member.visual.zone || zoneOf(member.agent)] || ZONES.generalist;
  const activity = member.motion?.activity || activityForZone(member.visual.zone || zoneOf(member.agent));
  const layout = index % 3;
  const avatar = resolveAgentAvatarSrc(member.agent.avatar, member.agent.name, {
    team: member.agent.team || 'blue',
    roleType: member.agent.roleType || 'normal',
  });
  return (
    <div className={`station station-${activity} station-layout-${layout}`} style={{ left: `${position.x}%`, top: `${position.y}%`, ['--zone' as any]: zone.color, ['--delay' as any]: `${index * 0.2}s` }}>
      <div className="station-scene">
        <OfficeSprite sprite="deskShadow" scale={0.52} className="station-sprite station-desk-shadow" />
        <OfficeSprite sprite="cubicle" scale={0.54} className="station-sprite station-cubicle-back" />
        <OfficeSprite sprite="deskTop" scale={0.54} className="station-sprite station-desk-real" />
        <OfficeSprite sprite="monitor" scale={0.28} className="station-sprite station-monitor-real" />
        <OfficeSprite sprite="keyboard" scale={0.22} className="station-sprite station-keyboard-real" />
        <OfficeSprite sprite="trackpad" scale={0.14} className="station-sprite station-mouse-real" />
        <OfficeSprite sprite="chairBack" scale={0.31} className="station-sprite station-chair-back-real" />
        <OfficeSprite sprite="chairSeat" scale={0.24} className="station-sprite station-chair-seat-real" />
        <OfficeSprite sprite="cubicle" scale={0.54} className="station-sprite station-cubicle-front-left" />
        <OfficeSprite sprite="cubicle" scale={0.54} className="station-sprite station-cubicle-front-right" />
        <div className="station-operator">
          <SpriteAvatar avatar={avatar} seed={member.agentName} category="agent-default" alt={member.displayName} fallback={initials(member.displayName)} className="station-avatar" fallbackClassName="text-[10px]" />
          <span className="station-status-dot" />
        </div>
        <div className="station-name">{member.nickname || member.displayName}</div>
      </div>
    </div>
  );
}

export default function OfficePage() {
  const [members, setMembers] = useState<OfficeMember[]>([]);
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

  useEffect(() => {
    loadMembers().catch((error) => setMessage(error?.message || '办公室暂时进不去'));
  }, [loadMembers]);

  const selectedAgents = useMemo(() => (
    plan?.members.map((member) => member.agent) || members.map((member) => member.agent)
  ), [members, plan]);

  const handleTeamAction = useCallback(async () => {
    setBusy(true);
    setMessage('');
    try {
      if (!plan) {
        const res = await fetch('/api/office/team/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requirement: prompt, maxMembers: 6 }),
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
          <ArchitectureDiagram members={plan ? plan.members.map((member, index) => ({
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
          })) : members} />
          <LiveOffice members={members} />
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
        }
        .office-floor {
          position: relative;
          min-height: 760px;
          overflow: hidden;
          border-radius: 32px;
          background:
            linear-gradient(135deg, rgba(148, 163, 184, 0.11) 0 1px, transparent 1px 96px),
            linear-gradient(45deg, rgba(148, 163, 184, 0.09) 0 1px, transparent 1px 96px),
            radial-gradient(circle at 18% 18%, rgba(15,23,42,0.06), transparent 18%),
            radial-gradient(circle at 78% 72%, rgba(37,99,235,0.07), transparent 20%),
            linear-gradient(180deg, rgba(255,255,255,0.94), rgba(241,245,249,0.72));
          box-shadow:
            inset 0 0 0 1px rgba(255,255,255,0.72),
            0 28px 90px rgba(15,23,42,0.08);
        }
        .station {
          position: absolute;
          width: 340px;
          height: 250px;
          transform: translate(-50%, -50%);
        }
        .station-scene {
          position: absolute;
          inset: 0;
          transform-origin: 50% 64%;
          animation: stationIdle 5.2s ease-in-out infinite;
          animation-delay: var(--delay);
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
        .station-desk-shadow {
          left: 72px;
          top: 105px;
          z-index: 1;
          opacity: 0.36;
        }
        .station-cubicle-back,
        .station-cubicle-front-left,
        .station-cubicle-front-right {
          left: 98px;
          top: 24px;
          filter: drop-shadow(0 18px 18px rgba(15, 23, 42, 0.16));
        }
        .station-cubicle-back {
          z-index: 2;
          clip-path: polygon(0 0, 100% 0, 100% 58%, 68% 58%, 68% 38%, 30% 38%, 30% 58%, 0 58%);
        }
        .station-desk-real {
          left: 88px;
          top: 93px;
          z-index: 3;
          clip-path: polygon(0 28%, 100% 28%, 100% 84%, 72% 84%, 72% 100%, 0 100%);
          filter: drop-shadow(0 18px 18px rgba(15, 23, 42, 0.13));
        }
        .station-monitor-real {
          left: 142px;
          top: 103px;
          z-index: 4;
          filter: drop-shadow(0 12px 14px rgba(37, 99, 235, 0.18));
          animation: monitorPulse 3.6s ease-in-out infinite;
          animation-delay: var(--delay);
        }
        .station-keyboard-real {
          left: 186px;
          top: 154px;
          z-index: 5;
          filter: drop-shadow(0 8px 10px rgba(15, 23, 42, 0.14));
        }
        .station-mouse-real {
          left: 238px;
          top: 158px;
          z-index: 7;
          filter: drop-shadow(0 7px 8px rgba(15, 23, 42, 0.12));
        }
        .station-chair-back-real {
          left: 56px;
          top: 92px;
          z-index: 6;
          filter: drop-shadow(0 14px 16px rgba(15, 23, 42, 0.18));
        }
        .station-chair-seat-real {
          left: 92px;
          top: 146px;
          z-index: 7;
          filter: drop-shadow(0 12px 14px rgba(15, 23, 42, 0.18));
        }
        .station-cubicle-front-left {
          z-index: 8;
          clip-path: polygon(0 46%, 34% 46%, 34% 100%, 0 100%);
        }
        .station-cubicle-front-right {
          z-index: 8;
          clip-path: polygon(70% 42%, 100% 42%, 100% 100%, 70% 100%);
        }
        .station-operator {
          position: absolute;
          left: 82px;
          top: 126px;
          z-index: 9;
          width: 54px;
          height: 60px;
          animation: actorFloat 4.2s ease-in-out infinite;
          animation-delay: var(--delay);
        }
        .station-avatar {
          position: relative;
          z-index: 2;
          width: 46px;
          height: 46px;
          border: 3px solid rgba(255, 255, 255, 0.92);
          box-shadow:
            0 10px 24px rgba(15,23,42,0.22),
            0 0 0 2px color-mix(in srgb, var(--zone), transparent 64%);
        }
        .station-status-dot {
          position: absolute;
          right: 4px;
          bottom: 8px;
          z-index: 3;
          width: 13px;
          height: 13px;
          border-radius: 999px;
          background: var(--zone);
          border: 2px solid white;
          box-shadow: 0 0 0 5px color-mix(in srgb, var(--zone), transparent 82%);
          animation: badgeBlink 2.5s ease-in-out infinite;
        }
        .station-name {
          position: absolute; left: 50%; bottom: 0; z-index: 10; max-width: 170px; transform: translateX(-50%);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-radius: 999px; background: rgba(255,255,255,0.76);
          padding: 4px 10px; font-size: 12px; font-weight: 700; color: #0f172a; box-shadow: 0 8px 18px rgba(15,23,42,0.08);
        }
        .station-layout-2 .station-scene {
          transform: scale(0.96) rotate(-1deg);
        }
        .station-walking .station-operator { animation-name: actorWalk; }
        .station-talking .station-avatar { animation: talkNod 1.8s ease-in-out infinite; }
        .station-thinking .station-scene::after {
          content: '?';
          position: absolute;
          left: 198px;
          top: 46px;
          z-index: 11;
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
        @media (max-width: 900px) {
          .office-floor {
            min-height: 940px;
          }
          .station {
            transform: translate(-50%, -50%) scale(0.78);
          }
          .station:nth-child(3n + 1) { left: 30% !important; }
          .station:nth-child(3n + 2) { left: 70% !important; }
          .station:nth-child(3n) { left: 50% !important; }
        }
        @keyframes stationIdle { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        @keyframes actorFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes actorWalk { 0%,100% { transform: translateX(-10px) translateY(0); } 50% { transform: translateX(10px) translateY(-4px); } }
        @keyframes monitorPulse { 0%,100% { filter: brightness(1) drop-shadow(0 12px 14px rgba(37,99,235,0.18)); } 50% { filter: brightness(1.08) drop-shadow(0 12px 18px rgba(37,99,235,0.3)); } }
        @keyframes badgeBlink { 0%,100% { opacity: 0.95; } 50% { opacity: 0.62; } }
        @keyframes talkNod { 0%,100% { transform: rotate(0); } 50% { transform: rotate(-4deg); } }
        @keyframes thought { 0%,100% { transform: translateY(0); opacity: 0.45; } 50% { transform: translateY(-5px); opacity: 1; } }
        @keyframes reviewScan { 0%,100% { filter: brightness(1) hue-rotate(0deg) drop-shadow(0 12px 14px rgba(37,99,235,0.18)); } 50% { filter: brightness(1.16) hue-rotate(12deg) drop-shadow(0 12px 20px rgba(14,165,233,0.38)); } }
      `}</style>
    </main>
  );
}
