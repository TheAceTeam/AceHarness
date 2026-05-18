export interface MatrixSkill {
  id: string;
  name: string;
  enName: string;
  owner: {
    id: string;
    userId: string;
    source: string;
    account: string;
    enName: string;
    cnName: string;
    image: string;
  };
  categoryList: Array<{
    id: string;
    moduleType: string;
    enName: string;
    cnName: string;
    enDescription: string;
    cnDescription: string;
    sortOrder: number;
  }>;
  description: string;
  repository: string;
  download: number;
  apiDownload: number;
  favor: number;
  view: number;
  createTime: string;
  updateTime: string;
  author?: string;
  sourceUrl?: string;
  overallScore: string;
  utilityScore: string;
  securityScore: string;
  tags: Array<{
    id: string;
    serviceType: string;
    name: string;
    enName: string;
    createTime: string;
    updateTime: string;
    type: string;
    linked: boolean;
  }>;
  organization?: {
    id: string;
    type: string;
    name: string;
    enName: string;
    image: string;
    description: string;
    link: string;
    source: string;
  };
}

export interface MarketplaceSkill {
  id: string;
  name: string;
  enName?: string;
  description: string;
  tags: string[];
  category?: string;
  categoryId?: string;
  categoryIds?: string[];
  author: string;
  version: string;
  downloadUrl: string;
  stars: number;
  downloads: number;
  updatedAt: string;
  installed?: boolean;
  overallScore?: string;
  utilityScore?: string;
  securityScore?: string;
  organization?: string;
  owner?: {
    account: string;
    image: string;
  };
  repository?: string;
}

export interface MatrixSearchRequest {
  pageNum: number;
  pageSize: number;
  keyword?: string;
}

export interface MatrixSearchResponse {
  code: string;
  message: string;
  data: {
    count: number;
    list: MatrixSkill[];
  };
}

export interface SearchRequest {
  keyword?: string;
  category?: string;
  organization?: string;
  pageNum?: number;
  pageSize?: number;
}

export interface SearchResponse {
  success: boolean;
  data: {
    skills: MarketplaceSkill[];
    total: number;
    pageNum: number;
    pageSize: number;
  };
  error?: string;
}

export interface InstallRequest {
  skillName: string;
}

export interface InstallResponse {
  success: boolean;
  data?: {
    skillName: string;
    installPath: string;
    message: string;
  };
  error?: string;
}

export interface CategoriesResponse {
  success: boolean;
  data: {
    categories: Array<{
      id: string;
      enName: string;
      cnName: string;
      count: number;
    }>;
  };
  error?: string;
}

export interface InstallProgress {
  skillName: string;
  status: 'downloading' | 'extracting' | 'validating' | 'installing' | 'success' | 'error';
  progress: number;
  message: string;
}

export interface FilterState {
  keyword: string;
  category: string;
  organization: string;
  sortBy: 'download' | 'score' | 'updateTime';
  sortOrder: 'asc' | 'desc';
}

export interface PageState {
  current: number;
  pageSize: number;
  total: number;
}

export interface MarketplaceCache {
  skills: MarketplaceSkill[];
  timestamp: number;
  expiresIn: number;
}

export interface CategoriesCache {
  categories: Array<{
    id: string;
    enName: string;
    cnName: string;
    count: number;
  }>;
  timestamp: number;
  expiresIn: number;
}

export interface InstallHistory {
  skillName: string;
  installTime: string;
  installPath: string;
}
