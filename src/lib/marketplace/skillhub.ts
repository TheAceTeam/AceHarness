import { SKILLHUB_API_BASE } from '@/constants/marketplace';
import type { MarketplaceCategory, MarketplaceSkill } from '@/types/marketplace';

interface SkillHubSkill {
  slug: string;
  namespace?: { handle?: string };
  name: string;
  description?: string;
  description_zh?: string;
  ownerName?: string;
  version?: string;
  category?: string;
  tags?: string[] | null;
  downloads?: number;
  stars?: number;
  updated_at?: number;
}

async function requestSkillHub(baseUrl: string, path: string, params?: URLSearchParams): Promise<Response> {
  const url = new URL(baseUrl + path);
  if (params) url.search = params.toString();
  const apiKey = baseUrl === SKILLHUB_API_BASE ? process.env.SKILLHUB_API_KEY?.trim() : undefined;
  const response = await fetch(url, {
    headers: apiKey ? { 'X-API-Key': apiKey } : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok && !(path === '/api/v1/download' && response.status === 302)) {
    throw new Error('SkillHub HTTP ' + response.status);
  }
  return response;
}

export async function searchSkillHub(baseUrl: string, page: number, pageSize: number, keyword?: string, category?: string) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (keyword) params.set('keyword', keyword);
  if (category) params.set('category', category);
  const response = await requestSkillHub(baseUrl, '/api/skills', params);
  const payload = await response.json() as {
    code: number;
    message?: string;
    data?: { total: number; skills: SkillHubSkill[] };
  };
  if (payload.code !== 0 || !Array.isArray(payload.data?.skills)) {
    throw new Error(payload.message || 'Invalid SkillHub search response');
  }

  const skills = payload.data.skills.map((skill): MarketplaceSkill => ({
    id: skill.namespace?.handle ? skill.namespace.handle + '/' + skill.slug : skill.slug,
    source: 'skillhub',
    installName: skill.slug,
    namespace: skill.namespace?.handle,
    name: skill.name || skill.slug,
    description: skill.description_zh || skill.description || '',
    tags: skill.tags || [],
    categoryId: skill.category,
    author: skill.ownerName || '',
    version: skill.version || '',
    stars: skill.stars ?? 0,
    downloads: skill.downloads ?? 0,
    updatedAt: skill.updated_at ? new Date(skill.updated_at).toISOString() : '',
  }));
  return { skills, total: payload.data.total };
}

export async function listSkillHubCategories(baseUrl: string): Promise<MarketplaceCategory[]> {
  const response = await requestSkillHub(baseUrl, '/api/v1/categories');
  const payload = await response.json() as {
    items: { key: string; name: string; nameEn: string }[];
  };
  return payload.items.map((item) => ({ id: item.key, cnName: item.name, enName: item.nameEn }));
}

export async function downloadSkillHubPackage(baseUrl: string, slug: string, version?: string, namespace?: string): Promise<ArrayBuffer> {
  const params = new URLSearchParams({ slug: namespace ? '@' + namespace + '/' + slug : slug });
  if (version) params.set('version', version);
  let response = await requestSkillHub(baseUrl, '/api/v1/download', params);
  if (response.status === 302) {
    const location = response.headers.get('location');
    if (!location) throw new Error('Missing SkillHub download URL');
    const target = new URL(location, baseUrl);
    if (target.protocol !== 'https:' || target.username || target.password) throw new Error('Invalid SkillHub download URL');
    response = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  }
  if (!response.ok) throw new Error('SkillHub download failed (HTTP ' + response.status + ')');
  return response.arrayBuffer();
}
