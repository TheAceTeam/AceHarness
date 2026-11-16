import type { MatrixSkill, MarketplaceSkill } from '@/types/marketplace';

export function adaptMatrixSkill(skill: MatrixSkill): MarketplaceSkill {
  return {
    source: 'matrix',
    id: skill.id,
    installName: skill.enName || skill.name,
    name: skill.name,
    enName: skill.enName,
    description: skill.description?.substring(0, 200) || '',
    tags: skill.tags?.map(tag => tag.name) || [],
    category: skill.categoryList?.[0]?.cnName,
    categoryId: skill.categoryList?.[0]?.id,
    categoryIds: skill.categoryList?.map(c => c.id) || [],
    author: skill.author || skill.owner.account,
    version: '1.0.0',
    stars: skill.favor,
    downloads: skill.download,
    updatedAt: skill.updateTime,
    installed: false,
    overallScore: skill.overallScore,
    utilityScore: skill.utilityScore,
    securityScore: skill.securityScore,
    organization: skill.organization?.name,
    owner: {
      account: skill.owner.account,
      image: skill.owner.image,
    },
    repository: skill.repository,
  };
}

export function adaptMatrixSkills(skills: MatrixSkill[]): MarketplaceSkill[] {
  return skills.map(adaptMatrixSkill);
}