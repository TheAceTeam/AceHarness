import { adaptMatrixSkills } from '@/lib/marketplace/adapter';
import { downloadCatalogPackage, listCatalogCategories, searchCatalog } from '@/lib/marketplace/catalog';
import { MarketplaceClient } from '@/lib/marketplace/client';
import { downloadSkillHubPackage, listSkillHubCategories, searchSkillHub } from '@/lib/marketplace/skillhub';
import type { MarketplaceCategory, MarketplaceSourceConfig } from '@/types/marketplace';

export async function searchMarketplaceSource(
  source: MarketplaceSourceConfig, pageNum: number, pageSize: number, keyword?: string, category?: string,
) {
  if (source.protocol === 'catalog') return searchCatalog(source, pageNum, pageSize, keyword, category);
  if (source.protocol === 'skillhub') {
    const page = await searchSkillHub(source.url, pageNum, pageSize, keyword, category);
    return { ...page, skills: page.skills.map((skill) => ({ ...skill, source: source.id, id: source.id + ':' + skill.id })) };
  }
  const response = await new MarketplaceClient(source.url).searchSkills({
    pageNum,
    pageSize,
    keyword: keyword || '',
    categoryId: category || undefined,
    statusList: ['2', '3'],
  });
  const skills = adaptMatrixSkills(response.data.list || []).map((skill) => ({
    ...skill, source: source.id, id: source.builtin ? skill.id : source.id + ':' + skill.id,
  }));
  return { skills, total: Number(response.data.count || 0) };
}

export async function listMarketplaceCategories(source: MarketplaceSourceConfig): Promise<MarketplaceCategory[]> {
  if (source.protocol === 'catalog') return listCatalogCategories(source);
  if (source.protocol === 'skillhub') return listSkillHubCategories(source.url);
  const categoryMap = await new MarketplaceClient(source.url).getAllCategories();
  return Array.from(categoryMap, ([id, value]) => ({ id, ...value })).sort((a, b) => b.count - a.count);
}

export function downloadMarketplacePackage(source: MarketplaceSourceConfig, name: string, version?: string, namespace?: string): Promise<ArrayBuffer> {
  if (source.protocol === 'catalog') return downloadCatalogPackage(source, name, version);
  if (source.protocol === 'skillhub') return downloadSkillHubPackage(source.url, name, version, namespace);
  return new MarketplaceClient(source.url).downloadSkill(name);
}
