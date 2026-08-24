/**
 * A deliberately conservative shell policy for startup preflight. Keep this
 * module browser-safe because the workflow editor validates the same contract
 * before it is saved.
 */
export function getUnsafePreflightCommandReason(command: string): string | null {
  const normalized = command.trim();
  if (!normalized) return '命令为空';
  if (/\r|\n|[;&|]|`|\$\(|[<>]/.test(normalized)) {
    return '包含重定向、管道或命令拼接，不能作为启动前只读检查执行';
  }
  if (/\b(?:rm|mv|cp|mkdir|touch|tee|chmod|chown)\b/i.test(normalized)) {
    return '包含可能写入工作区的文件操作';
  }
  if (/\bgit\s+(?:update-ref|commit|push|fetch|pull|reset|checkout|switch|clean|rebase|merge|cherry-pick|tag|worktree)\b/i.test(normalized)) {
    return '包含会修改 Git 引用或工作区的 Git 操作';
  }
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:install|ci|add|remove|run\s+(?:build|test|prepare|postinstall))\b/i.test(normalized)) {
    return '包含可能安装依赖、构建或写入产物的包管理操作';
  }
  if (/\b(?:cjpm|cargo|make)\s+(?:build|test|run|install)\b/i.test(normalized)) {
    return '包含可能构建或写入产物的命令';
  }
  return null;
}
