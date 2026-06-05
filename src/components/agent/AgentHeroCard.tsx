'use client';

import SpriteAvatar from '@/components/SpriteAvatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/core/utils';
import {
  getAgentTheme,
  resolveAgentAvatarSrc,
  type AgentAvatarConfig,
  type AgentRoleType,
  type AgentTeam,
} from '@/lib/agent/personas';

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
    skills?: string[];
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
  const tags = (agent.tags || []).slice(0, compact ? 2 : 2);
  const capabilities = (agent.capabilities || []).slice(0, compact ? 2 : 2);
  const skills = (agent.skills || []).slice(0, compact ? 3 : 5);
  const compactChips = compact ? [...skills, ...tags, ...capabilities].slice(0, 4) : [];

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
        'group relative overflow-hidden border bg-card text-left text-foreground transition-[box-shadow,border-color,transform]',
        compact
          ? 'rounded-xl shadow-sm hover:border-border hover:shadow-md'
          : 'rounded-xl shadow-sm hover:border-border hover:shadow-md',
        'w-full min-w-0',
        onClick && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'border-border/70',
        selected && 'ring-2 ring-primary/60 ring-offset-2 ring-offset-background',
        compact ? 'p-3 min-h-[104px]' : 'p-3 min-h-[156px]',
        className
      )}
    >
      <div className={cn('absolute border border-border/50', compact ? 'inset-[7px] rounded-[10px]' : 'inset-[8px] rounded-[10px]')} />
      <div className={cn('absolute inset-x-0 top-0 bg-gradient-to-r', compact ? 'h-[2px]' : 'h-[3px]', theme.accent)} />
      <div className="hidden">
        Unit
      </div>

      <div className="relative z-10 flex h-full flex-col">
        <div className={cn('flex items-start justify-between', compact ? 'gap-2.5' : 'gap-2.5')}>
          <div className={cn('flex min-w-0 items-start', compact ? 'gap-2.5' : 'gap-3')}>
            <div className="relative shrink-0">
              <div className={cn('absolute inset-0 rounded-full opacity-60 blur-xl', theme.halo)} />
              <SpriteAvatar
                avatar={avatarSrc}
                seed={agent.name}
                category="agent-default"
                alt={agent.name}
                fallback={agent.name.slice(0, 2).toUpperCase()}
                className={cn('relative ring-2 ring-white/20 shadow-xl', compact ? 'h-10 w-10' : 'h-12 w-12')}
              />
            </div>
            <div className="min-w-0">
              <div className={cn('mb-0.5 uppercase text-muted-foreground', compact ? 'text-[9px] tracking-[0.2em]' : 'text-[9px] tracking-[0.24em]')}>
                {agent.category || '角色单位'}
              </div>
              <div className={cn('truncate font-semibold text-foreground', compact ? 'text-sm' : 'text-[14px] leading-5')}>
                {agent.name}
              </div>
              <div className={cn('flex flex-wrap items-center gap-1', compact ? 'mt-1' : 'mt-1.5')}>
                <Badge className={cn('h-5 border px-1.5 py-0 text-[10px]', theme.badge)}>{theme.label}</Badge>
              </div>
            </div>
          </div>

          {selected ? (
            <div className={cn('rounded-full border border-border bg-muted font-medium text-foreground', compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-1.5 py-0.5 text-[9px]')}>
              已选择
            </div>
          ) : null}
        </div>

        {!compact && agent.description ? (
          <div className="mt-2 rounded-[10px] border border-border/60 bg-muted/30 px-2.5 py-2">
            <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">档案摘要</div>
            <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-foreground/80">{agent.description}</p>
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
          <div className="mt-2 grid gap-2">
            {skills.length > 0 ? (
            <div>
              <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Skills</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {skills.map((skill, index) => (
                  <Badge key={`${skill}-${index}`} variant="secondary" className="h-5 border-primary/20 bg-primary/10 px-1.5 py-0 text-[10px] text-primary">
                    {skill}
                  </Badge>
                ))}
                {(agent.skills || []).length > skills.length ? (
                  <Badge variant="secondary" className="h-5 border-border/60 bg-muted/40 px-1.5 py-0 text-[10px] text-muted-foreground">
                    +{(agent.skills || []).length - skills.length}
                  </Badge>
                ) : null}
              </div>
            </div>
            ) : null}
            {tags.length > 0 ? (
            <div>
              <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">标签</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {tags.map((tag, index) => (
                  <Badge key={`${tag}-${index}`} variant="secondary" className="h-5 border-border/60 bg-muted/40 px-1.5 py-0 text-[10px] text-muted-foreground">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
            ) : null}
            {capabilities.length > 0 ? (
            <div>
              <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">技能组</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {capabilities.map((capability, index) => (
                  <Badge key={`${capability}-${index}`} variant="secondary" className="h-5 border-border/60 bg-muted/40 px-1.5 py-0 text-[10px] text-muted-foreground">
                    {capability}
                  </Badge>
                ))}
              </div>
            </div>
            ) : null}
          </div>
        )}

        {(meta || actions) ? (
          <div className="mt-auto pt-2">
            <div className="rounded-[10px] border border-border/60 bg-muted/20 px-2.5 py-2">
            {meta ? (
              <div className="text-[11px] leading-5 text-muted-foreground">
                {meta}
              </div>
            ) : null}
            {actions ? (
              <div className={cn(meta ? 'mt-2' : '', 'flex flex-wrap items-center gap-1.5')}>
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
