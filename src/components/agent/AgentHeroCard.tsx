'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  getAgentTheme,
  resolveAgentAvatarSrc,
  type AgentAvatarConfig,
  type AgentRoleType,
  type AgentTeam,
} from '@/lib/agent-personas';

interface AgentHeroCardProps {
  agent: {
    name: string;
    team: AgentTeam;
    roleType?: AgentRoleType;
    avatar?: AgentAvatarConfig | string;
    category?: string;
    tags?: string[];
    description?: string;
    capabilities?: string[];
    alwaysAvailableForChat?: boolean;
  };
  selected?: boolean;
  compact?: boolean;
  className?: string;
  onClick?: () => void;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}

export function AgentHeroCard({ agent, selected, compact = false, className, onClick, meta, actions }: AgentHeroCardProps) {
  const roleType = agent.roleType || 'normal';
  const theme = getAgentTheme(agent.team, roleType);
  const avatarSrc = resolveAgentAvatarSrc(agent.avatar, agent.name, {
    team: agent.team,
    roleType,
  });
  const tags = (agent.tags || []).slice(0, compact ? 2 : 3);
  const capabilities = (agent.capabilities || []).slice(0, compact ? 2 : 3);
  const compactChips = compact ? [...tags, ...capabilities].slice(0, 3) : [];

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        'group relative overflow-hidden border text-left text-white transition-[box-shadow,border-color,transform,filter]',
        compact
          ? 'rounded-[20px] shadow-[0_10px_28px_rgba(2,6,23,0.16)] hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(2,6,23,0.22)]'
          : 'rounded-[28px] shadow-[0_18px_48px_rgba(2,6,23,0.2)] hover:-translate-y-1 hover:shadow-[0_28px_72px_rgba(2,6,23,0.28)]',
        'w-full min-w-0',
        onClick && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        theme.surface,
        selected && 'ring-2 ring-primary/60 ring-offset-2 ring-offset-background',
        compact ? 'p-3 min-h-[108px]' : 'p-4 min-h-[182px]',
        className
      )}
    >
      <div className={cn('absolute border border-white/10', compact ? 'inset-[7px] rounded-[16px]' : 'inset-[10px] rounded-[22px]')} />
      <div className={cn('absolute -right-8 -top-8 rounded-full blur-3xl', compact ? 'h-20 w-20' : 'h-24 w-24', theme.halo)} />
      <div className="absolute -left-10 bottom-4 h-24 w-24 rounded-full bg-white/5 blur-3xl" />
      <div className={cn('absolute inset-x-0 top-0 bg-gradient-to-r', compact ? 'h-[2px]' : 'h-[3px]', theme.accent)} />
      <div className={cn('absolute right-4 top-4 text-[10px] uppercase tracking-[0.32em] text-white/25', compact && 'hidden')}>
        Unit
      </div>

      <div className="relative z-10 flex h-full flex-col">
        <div className={cn('flex items-start justify-between', compact ? 'gap-2.5' : 'gap-3')}>
          <div className={cn('flex min-w-0 items-start', compact ? 'gap-2.5' : 'gap-3.5')}>
            <div className="relative shrink-0">
              <div className={cn('absolute inset-0 rounded-full opacity-60 blur-xl', theme.halo)} />
              <Avatar className={cn('relative ring-2 ring-white/20 shadow-xl', compact ? 'h-10 w-10' : 'h-16 w-16')}>
              <AvatarImage src={avatarSrc} alt={agent.name} className="object-cover" />
              <AvatarFallback>{agent.name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            </div>
            <div className="min-w-0">
              <div className={cn('mb-1 uppercase text-white/50', compact ? 'text-[9px] tracking-[0.2em]' : 'text-[10px] tracking-[0.28em]')}>
                {agent.category || '角色单位'}
              </div>
              <div className={cn('truncate font-semibold text-white', compact ? 'text-sm' : 'text-[15px]')}>
                {agent.name}
              </div>
              <div className={cn('flex flex-wrap items-center gap-1.5', compact ? 'mt-1.5' : 'mt-2')}>
                <Badge className={cn('border px-2 py-0.5 text-[10px]', theme.badge)}>{theme.label}</Badge>
                {agent.alwaysAvailableForChat ? (
                  <Badge variant="secondary" className="border-emerald-400/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-200">
                    常驻对话
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>

          {selected ? (
            <div className={cn('rounded-full border border-white/20 bg-white/10 font-medium text-white', compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-1 text-[10px]')}>
              已选择
            </div>
          ) : null}
        </div>

        {!compact && agent.description ? (
          <div className="mt-3 rounded-[20px] border border-white/10 bg-black/20 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-[0.24em] text-white/40">档案摘要</div>
            <p className="mt-1.5 line-clamp-2 text-[13px] leading-6 text-white/75">{agent.description}</p>
          </div>
        ) : null}

        {compact ? (
          compactChips.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {compactChips.map((chip, index) => (
                <Badge key={`${chip}-${index}`} variant="secondary" className="border-white/10 bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/80">
                  {chip}
                </Badge>
              ))}
            </div>
          ) : null
        ) : (
          <div className="mt-3 grid gap-2.5">
            {tags.length > 0 ? (
            <div>
              <div className="text-[10px] uppercase tracking-[0.24em] text-white/40">标签</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {tags.map((tag, index) => (
                  <Badge key={`${tag}-${index}`} variant="secondary" className="border-white/10 bg-white/10 px-2 py-0.5 text-[10px] text-white/80">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
            ) : null}
            {capabilities.length > 0 ? (
            <div>
              <div className="text-[10px] uppercase tracking-[0.24em] text-white/40">技能组</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {capabilities.map((capability, index) => (
                  <Badge key={`${capability}-${index}`} variant="secondary" className="border-white/10 bg-white/10 px-2 py-0.5 text-[10px] text-white/80">
                    {capability}
                  </Badge>
                ))}
              </div>
            </div>
            ) : null}
          </div>
        )}

        {(meta || actions) ? (
          <div className="mt-auto pt-3">
            <div className="rounded-[20px] border border-white/10 bg-black/20 px-3 py-3">
            {meta ? (
              <div className="text-[12px] leading-5 text-white/70">
                {meta}
              </div>
            ) : null}
            {actions ? (
              <div className={cn(meta ? 'mt-3' : '', 'flex flex-wrap items-center gap-2')}>
                {actions}
              </div>
            ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
