import { MatrixSearchRequest, MatrixSearchResponse } from '@/types/marketplace';
import { MATRIX_API_BASE } from '@/constants/marketplace';

export class MarketplaceClient {
  constructor(private readonly baseUrl = MATRIX_API_BASE) {}

  async searchSkills(params: MatrixSearchRequest): Promise<MatrixSearchResponse> {
    const response = await fetch(this.baseUrl + '/skills', {
      method: 'POST',
      signal: AbortSignal.timeout(12_000),
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`Matrix API request failed: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.code !== '20000') {
      throw new Error(data.message || 'Matrix API request failed');
    }

    return data;
  }

  async downloadSkill(skillName: string): Promise<ArrayBuffer> {
    const response = await fetch(this.baseUrl + '/' + encodeURIComponent(skillName) + '/install?format=zip', {
      signal: AbortSignal.timeout(30_000),
      redirect: this.baseUrl === MATRIX_API_BASE ? 'follow' : 'error',
    });

    if (!response.ok) {
      throw new Error(`Failed to download skill: ${response.statusText}`);
    }

    return await response.arrayBuffer();
  }

  async getAllCategories(): Promise<Map<string, { count: number; enName: string; cnName: string }>> {
    const response = await this.searchSkills({
      pageNum: 1,
      pageSize: 1891,
    });

    const categoryMap = new Map<string, { count: number; enName: string; cnName: string }>();

    response.data.list.forEach(skill => {
      skill.categoryList.forEach(category => {
        const existing = categoryMap.get(category.id);
        if (existing) {
          existing.count++;
        } else {
          categoryMap.set(category.id, {
            count: 1,
            enName: category.enName,
            cnName: category.cnName,
          });
        }
      });
    });

    return categoryMap;
  }
}