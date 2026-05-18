'use client';

import { Download, Star, UserRound } from 'lucide-react';
import { MarketplaceSkill } from '@/types/marketplace';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface SkillCardProps {
  skill: MarketplaceSkill;
  onInstall: (skillName: string) => void;
  onViewDetail: (skill: MarketplaceSkill) => void;
}

export function SkillCard({ skill, onInstall, onViewDetail }: SkillCardProps) {
  const displayName = skill.enName || skill.name;
  const installName = skill.enName || skill.name;

  return (
    <div className="rounded-[24px] border border-border/70 bg-card/88 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur transition-all hover:-translate-y-0.5 hover:shadow-[0_24px_70px_rgba(15,23,42,0.14)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{displayName}</h3>
          {skill.enName && skill.name !== skill.enName && (
            <p className="mt-1 text-xs text-muted-foreground">{skill.name}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {skill.organization ? (
            <Badge variant="secondary" className="rounded-full px-3">
              {skill.organization}
            </Badge>
          ) : null}
        </div>
      </div>

      <p className="mb-4 text-sm leading-6 text-muted-foreground line-clamp-3">
        {skill.description}
      </p>

      <div className="mb-4 grid grid-cols-3 gap-2 rounded-[20px] border border-border/60 bg-background/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Star className="h-3.5 w-3.5" />
            评分
          </div>
          <div className="text-sm font-medium">{skill.overallScore || 'N/A'}</div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Download className="h-3.5 w-3.5" />
            下载
          </div>
          <div className="text-sm font-medium">{skill.downloads}</div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <UserRound className="h-3.5 w-3.5" />
            作者
          </div>
          <div className="truncate text-sm font-medium">{skill.author}</div>
        </div>
      </div>

      <div className="mb-4 flex min-h-12 flex-wrap gap-1.5">
        {skill.tags.slice(0, 5).map(tag => (
          <Badge key={tag} variant="outline" className="rounded-full text-xs">
            {tag}
          </Badge>
        ))}
      </div>

      <div className="flex gap-2">
        {skill.installed ? (
          <>
            <Button
              className="h-9 flex-1 rounded-xl"
              size="sm"
              variant="secondary"
              disabled
            >
              已安装
            </Button>
            <Button
              onClick={() => onInstall(installName)}
              className="h-9 flex-1 rounded-xl"
              size="sm"
            >
              重新安装
            </Button>
          </>
        ) : (
          <Button
            onClick={() => onInstall(installName)}
            className="h-9 flex-1 rounded-xl"
            size="sm"
          >
            安装
          </Button>
        )}
        <Button
          onClick={() => onViewDetail(skill)}
          variant="outline"
          className="h-9 flex-1 rounded-xl"
          size="sm"
        >
          详情
        </Button>
      </div>
    </div>
  );
}
