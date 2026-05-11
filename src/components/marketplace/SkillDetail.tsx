'use client';

import { MarketplaceSkill } from '@/types/marketplace';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface SkillDetailProps {
  skill: MarketplaceSkill;
  onClose: () => void;
  onInstall: (skillName: string) => void;
}

export function SkillDetail({ skill, onClose, onInstall }: SkillDetailProps) {
  const displayName = skill.enName || skill.name;
  const installName = skill.enName || skill.name;
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-card rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-lg">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-2xl font-bold">{displayName}</h2>
            {skill.enName && skill.name !== skill.enName && (
              <p className="text-sm text-muted-foreground mt-1">{skill.name}</p>
            )}
          </div>
          <Button onClick={onClose} variant="ghost" size="sm">
            ✕
          </Button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {skill.organization ? (
            <Badge variant="secondary">{skill.organization}</Badge>
          ) : null}
        </div>

        <div className="mb-6">
          <h3 className="font-semibold mb-2">描述</h3>
          <p className="text-muted-foreground">{skill.description}</p>
        </div>

        <div className="mb-6">
          <h3 className="font-semibold mb-2">评分信息</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="border rounded p-3">
              <div className="text-sm text-muted-foreground">综合评分</div>
              <div className="text-xl font-bold text-yellow-500">
                ⭐ {skill.overallScore || 'N/A'}
              </div>
            </div>
            <div className="border rounded p-3">
              <div className="text-sm text-muted-foreground">实用性评分</div>
              <div className="text-xl font-bold text-green-500">
                {skill.utilityScore || 'N/A'}
              </div>
            </div>
            <div className="border rounded p-3">
              <div className="text-sm text-muted-foreground">安全性评分</div>
              <div className="text-xl font-bold text-blue-500">
                {skill.securityScore || 'N/A'}
              </div>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <h3 className="font-semibold mb-2">统计信息</h3>
          <div className="flex gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">下载量：</span>
              <span className="font-medium">{skill.downloads}</span>
            </div>
            <div>
              <span className="text-muted-foreground">收藏数：</span>
              <span className="font-medium">{skill.stars}</span>
            </div>
            <div>
              <span className="text-muted-foreground">更新时间：</span>
              <span className="font-medium">{skill.updatedAt}</span>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <h3 className="font-semibold mb-2">作者信息</h3>
          <div className="flex items-center gap-2">
            {skill.owner?.image && (
              <img
                src={skill.owner.image}
                alt={skill.author}
                className="w-10 h-10 rounded-full"
                referrerPolicy="no-referrer"
              />
            )}
            <div>
              <div className="font-medium">{skill.author}</div>
              {skill.repository && (
                <a
                  href={skill.repository}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  {skill.repository}
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="mb-6">
          <h3 className="font-semibold mb-2">标签</h3>
          <div className="flex flex-wrap gap-2">
            {skill.tags.map(tag => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={() => onInstall(installName)}
            className="flex-1"
            disabled={Boolean(skill.installed)}
          >
            {skill.installed ? '已安装' : '安装'}
          </Button>
          <Button
            onClick={onClose}
            variant="outline"
            className="flex-1"
          >
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
}
