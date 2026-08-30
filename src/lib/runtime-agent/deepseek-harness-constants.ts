/** Environment keys documented by @openma/deepseek-harness-acp. */
export const DEEPSEEK_HARNESS_DSH_HOME_ENV = 'DSH_HOME';
export const DEEPSEEK_HARNESS_PROVIDER_ENV = 'DSH_PROVIDER';
export const DEEPSEEK_HARNESS_MODEL_ENV = 'DSH_MODEL';
export const DEEPSEEK_HARNESS_SESSION_ROOT_ENV = 'DSH_SESSION_ROOT';

export const DEEPSEEK_HARNESS_DEFAULT_MODELS = [
  { modelId: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
  { modelId: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  { modelId: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek V4 Flash Vision' },
] as const;
