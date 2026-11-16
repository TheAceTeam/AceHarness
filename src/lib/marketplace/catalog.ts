import { validateSkillName } from '@/lib/marketplace/validators';
import type { MarketplaceSkill, MarketplaceSourceConfig } from '@/types/marketplace';

type CatalogSkill = {
  slug: string;
  name: string;
  description?: string;
  author?: string;
  version?: string;
  category?: string;
  tags?: string[];
  downloadUrl: string;
};

async function readCatalog(source: MarketplaceSourceConfig): Promise<CatalogSkill[]> {
  const response = await fetch(source.url, { redirect: 'error', signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error('市场目录 HTTP ' + response.status);
  const value = await response.json() as { skills?: unknown };
  if (!Array.isArray(value?.skills)) throw new Error('市场目录缺少 skills 数组。');
  const skills = new Map<string, CatalogSkill>();
  for (const skill of value.skills) {
    if (!skill || typeof skill.slug !== 'string' || !validateSkillName(skill.slug, source.id)
      || typeof skill.name !== 'string' || !skill.name.trim() || typeof skill.downloadUrl !== 'string' || !skill.downloadUrl.trim()) {
      throw new Error('目录中的技能必须提供有效的 slug、name 和 downloadUrl。');
    }
    if (skills.has(skill.slug)) throw new Error('目录中存在重复的 slug。');
    catalogPackageUrl(source, skill.downloadUrl);
    skills.set(skill.slug, skill);
  }
  return Array.from(skills.values());
}

function catalogPackageUrl(source: MarketplaceSourceConfig, downloadUrl: string): URL {
  const target = new URL(downloadUrl, source.url);
  if (target.origin !== new URL(source.url).origin || target.username || target.password) {
    throw new Error('目录中的 downloadUrl 必须与目录同源。');
  }
  return target;
}

export async function searchCatalog(source: MarketplaceSourceConfig, pageNum: number, pageSize: number, keyword?: string, category?: string) {
  const query = keyword?.trim().toLowerCase() || '';
  const skills = (await readCatalog(source)).filter((skill) =>
    (!category || skill.category === category)
    && [skill.slug, skill.name, skill.description].some((part) => typeof part === 'string' && part.toLowerCase().includes(query)),
  );
  const start = (pageNum - 1) * pageSize;
  return {
    total: skills.length,
    skills: skills.slice(start, start + pageSize).map((skill): MarketplaceSkill => ({
      id: source.id + ':' + skill.slug,
      source: source.id,
      installName: skill.slug,
      name: skill.name,
      description: typeof skill.description === 'string' ? skill.description : '',
      tags: Array.isArray(skill.tags) ? skill.tags.filter((tag) => typeof tag === 'string') : [],
      category: typeof skill.category === 'string' ? skill.category : undefined,
      author: typeof skill.author === 'string' ? skill.author : '',
      version: typeof skill.version === 'string' ? skill.version : '',
      stars: 0,
      downloads: 0,
      updatedAt: '',
    })),
  };
}

export async function listCatalogCategories(source: MarketplaceSourceConfig) {
  const counts = new Map<string, number>();
  for (const skill of await readCatalog(source)) {
    if (typeof skill.category === 'string' && skill.category) {
      counts.set(skill.category, (counts.get(skill.category) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([id, count]) => ({ id, cnName: id, enName: id, count }));
}

export async function downloadCatalogPackage(source: MarketplaceSourceConfig, slug: string, version?: string): Promise<ArrayBuffer> {
  const skill = (await readCatalog(source)).find((item) => item.slug === slug);
  if (!skill || (version && version !== skill.version)) {
    throw new Error('技能或版本已变更，请重新搜索后安装。');
  }
  const response = await fetch(catalogPackageUrl(source, skill.downloadUrl), {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('技能下载失败 (HTTP ' + response.status + ')');
  return response.arrayBuffer();
}
