export const MATRIX_API_BASE = 'https://matrix.openharmony.cn/api/registry/skill';

export const API_ENDPOINTS = {
  SEARCH: `${MATRIX_API_BASE}/skills`,
  INSTALL: (name: string) => `${MATRIX_API_BASE}/${name}/install?format=zip`,
} as const;

export const DEFAULT_PAGE_SIZE = 15;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_SORT_BY = 'download';
export const DEFAULT_SORT_ORDER = 'desc';

export const INSTALL_STATUS = {
  DOWNLOADING: 'downloading',
  EXTRACTING: 'extracting',
  VALIDATING: 'validating',
  INSTALLING: 'installing',
  SUCCESS: 'success',
  ERROR: 'error',
} as const;

export const INSTALL_STATUS_TEXT: Record<string, string> = {
  [INSTALL_STATUS.DOWNLOADING]: '下载中',
  [INSTALL_STATUS.EXTRACTING]: '解压中',
  [INSTALL_STATUS.VALIDATING]: '验证中',
  [INSTALL_STATUS.INSTALLING]: '安装中',
  [INSTALL_STATUS.SUCCESS]: '安装成功',
  [INSTALL_STATUS.ERROR]: '安装失败',
} as const;

export const STORAGE_KEYS = {
  MARKETPLACE_CACHE: 'marketplace_cache',
  CATEGORIES_CACHE: 'categories_cache',
  INSTALL_HISTORY: 'install_history',
} as const;

export const CACHE_DURATION = 3600000; // 1小时