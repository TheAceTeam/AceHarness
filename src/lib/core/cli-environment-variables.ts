export const CLI_ENVIRONMENT_GROUPS = [
  {
    id: 'claude',
    label: 'Claude',
    description: '管理 Claude Code 的认证、服务地址和执行路径。',
    variables: [
      { key: 'ANTHROPIC_AUTH_TOKEN', label: '认证令牌', description: '连接 Claude 服务的认证令牌。', secret: true },
      { key: 'ANTHROPIC_API_KEY', label: 'API 密钥', description: '连接 Claude 服务的 API 密钥。', secret: true },
      { key: 'ANTHROPIC_BASE_URL', label: '服务地址', description: 'Claude Code 使用的服务地址。' },
      { key: 'CLAUDE_CODE_BASE_URL', label: '兼容服务地址', description: 'Claude Code 兼容的服务地址配置。' },
      { key: 'CLAUDE_CODE_API_BASE_URL', label: 'API 服务地址', description: 'Claude Code API 兼容的服务地址配置。' },
      { key: 'ACE_CLAUDE_CODE_EXECUTABLE', label: '执行文件', description: 'ACEHarness 使用的 Claude Code 执行文件。' },
      { key: 'CLAUDE_CODE_EXECUTABLE', label: '执行文件备用配置', description: 'Claude Code 使用的执行文件配置。' },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek Harness',
    description: '管理 DeepSeek Harness 的认证、服务地址和权限模式。',
    variables: [
      { key: 'DEEPSEEK_API_KEY', label: 'API 密钥', description: 'DeepSeek Harness 使用的 API 密钥。', secret: true },
      { key: 'DEEPSEEK_BASE_URL', label: '服务地址', description: '可选的 DeepSeek 兼容 API 服务地址。' },
      { key: 'DSH_PATH', label: 'Harness 路径', description: 'DeepSeek Harness 安装路径或 dsh 可执行文件路径。' },
      { key: 'DSH_HOME', label: '配置目录', description: 'DeepSeek Harness 用户配置和凭据目录。' },
      { key: 'DSH_MAX_TOKENS', label: '最大输出 Token', description: '单次请求的最大输出 token 数。' },
      {
        key: 'DSH_PERMISSION_MODE',
        label: '权限模式',
        description: 'DeepSeek Harness 的 ACP 权限模式。',
        allowedValues: ['read-only', 'workspace-write', 'danger-full-access'],
      },
      { key: 'DSH_SESSION_ROOT', label: '会话目录', description: 'ACP 会话持久化目录。' },
      { key: 'DSH_SYSTEM_PROMPT', label: '系统提示词', description: 'DeepSeek Harness 的系统提示词覆盖。' },
      { key: 'DSH_BASH_TIMEOUT_MS', label: 'Bash 超时', description: '前台 Bash 命令超时时间（毫秒）。' },
      { key: 'DSH_ACP_DEBUG', label: 'ACP 调试日志', description: '开启 DeepSeek ACP 调试日志。' },
    ],
  },
  {
    id: 'codex',
    label: 'Codex',
    description: '管理 Codex 使用的 API 密钥和服务地址。',
    variables: [
      { key: 'OPENAI_API_KEY', label: 'API 密钥', description: '连接 Codex 服务的 API 密钥。', secret: true },
      { key: 'OPENAI_BASE_URL', label: '服务地址', description: 'Codex 使用的服务地址。' },
    ],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    description: '管理 OpenCode 配置目录和流式运行参数。',
    variables: [
      { key: 'OPENCODE_CONFIG_DIR', label: '配置目录', description: 'OpenCode 使用的全局配置目录。' },
      { key: 'ACE_OPENCODE_STREAM_TIMEOUT_MS', label: '流式总超时', description: 'OpenCode 流式请求的总超时时间，单位为毫秒。' },
      { key: 'ACE_OPENCODE_STREAM_IDLE_TIMEOUT_MS', label: '流式空闲超时', description: 'OpenCode 流式请求的空闲超时时间，单位为毫秒。' },
    ],
  },
  {
    id: 'other-cli',
    label: '其他 CLI',
    description: '管理其他受支持 CLI 的模型、路径和服务配置。',
    variables: [
      { key: 'GEMINI_MODEL', label: 'Gemini 模型', description: 'Gemini CLI 使用的模型配置。' },
      { key: 'MAGIC_CLI_PATH', label: 'Magic CLI 路径', description: 'Magic CLI 使用的执行文件路径。' },
      { key: 'ACE_NGA_SDK_BASE_URL', label: 'NGA 服务地址', description: 'NGA SDK 使用的外部服务地址。' },
      { key: 'ACE_NGA_SDK_COMMAND', label: 'NGA 启动命令', description: 'NGA SDK 使用的启动命令。' },
      { key: 'ACE_NGA_BIN', label: 'NGA 执行文件', description: 'NGA SDK 使用的执行文件配置。' },
      { key: 'ACE_CODEGENIE_SDK_BASE_URL', label: 'CodeGenie 服务地址', description: 'CodeGenie SDK 使用的外部服务地址。' },
      { key: 'ACE_CODEGENIE_SDK_COMMAND', label: 'CodeGenie 启动命令', description: 'CodeGenie SDK 使用的启动命令。' },
      { key: 'ACE_CODEGENIE_BIN', label: 'CodeGenie 执行文件', description: 'CodeGenie SDK 使用的执行文件配置。' },
      { key: 'ACEH_NGA_COMMAND', label: 'NGA ACP 执行文件', description: 'NGA ACP 适配器使用的可执行文件路径或命令名。' },
      { key: 'ACEH_CODEAGENT_COMMAND', label: 'CodeAgent ACP 执行文件', description: 'CodeAgent ACP 适配器使用的可执行文件路径或命令名。' },
      { key: 'ACEH_CODEGENIE_COMMAND', label: 'CodeGenie ACP 执行文件', description: 'CodeGenie ACP 适配器使用的可执行文件路径或命令名。' },
    ],
  },
] as const;

export type CliEnvironmentGroupId = (typeof CLI_ENVIRONMENT_GROUPS)[number]['id'];
export type CliEnvironmentVariableDefinition = (typeof CLI_ENVIRONMENT_GROUPS)[number]['variables'][number];

const GROUP_BY_KEY = new Map<string, CliEnvironmentGroupId>();
const VARIABLE_BY_KEY = new Map<string, CliEnvironmentVariableDefinition>();

for (const group of CLI_ENVIRONMENT_GROUPS) {
  for (const variable of group.variables) {
    GROUP_BY_KEY.set(variable.key, group.id);
    VARIABLE_BY_KEY.set(variable.key, variable);
  }
}

export function getCliEnvironmentGroupId(key: string): CliEnvironmentGroupId | undefined {
  return GROUP_BY_KEY.get(key.trim().toUpperCase());
}

export function getCliEnvironmentVariable(key: string): CliEnvironmentVariableDefinition | undefined {
  return VARIABLE_BY_KEY.get(key.trim().toUpperCase());
}
