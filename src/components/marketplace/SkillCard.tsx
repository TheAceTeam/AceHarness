'use client';

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
    <div className="border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow bg-card">
      <div className="flex justify-between items-start mb-2">
        <div>
          <h3 className="text-lg font-semibold">{displayName}</h3>
          {skill.enName && skill.name !== skill.enName && (
            <p className="text-xs text-muted-foreground">{skill.name}</p>
          )}
        </div>
        {skill.organization && (
          <Badge variant="secondary" className="ml-2">
            {skill.organization}
          </Badge>
        )}
      </div>

      <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
        {skill.description}
      </p>

      <div className="flex items-center gap-2 mb-3 text-sm">
        <span className="text-yellow-500">
          ⭐ {skill.overallScore || 'N/A'}
        </span>
        <span className="text-muted-foreground">
          📊 {skill.downloads}
        </span>
        <span className="text-muted-foreground">
          🏢 {skill.author}
        </span>
      </div>

      <div className="flex flex-wrap gap-1 mb-3">
        {skill.tags.slice(0, 5).map(tag => (
          <Badge key={tag} variant="outline" className="text-xs">
            {tag}
          </Badge>
        ))}
      </div>

      <div className="flex gap-2">
        <Button
          onClick={() => onInstall(installName)}
          className="flex-1"
          size="sm"
        >
          安装
        </Button>
        <Button
          onClick={() => onViewDetail(skill)}
          variant="outline"
          className="flex-1"
          size="sm"
        >
          详情
        </Button>
      </div>
    </div>
  );
}