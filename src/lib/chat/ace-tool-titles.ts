export function getAceToolTitle(toolName: string): string {
  const titleMap: Record<string, string> = {
    bash: '💻 执行命令',
    cmd: '💻 执行命令',
    powershell: '💻 执行命令',
    write: '📝 写入文件',
    edit: '✏️ 编辑文件',
    multiedit: '✏️ 编辑文件',
    patch: '✏️ 编辑文件',
    read: '📖 读取文件',
    glob: '🔍 搜索文件',
    grep: '🔍 搜索内容',
    ls: '📂 列出目录',
    task: '🤖 子任务',
    todo: '📋 任务列表',
    todowrite: '📋 任务列表',
    plan: '📋 执行计划',
    webfetch: '🌐 获取网页',
    websearch: '🔎 搜索网页',
    skill: '技能文档',
    'context-compression': '上下文压缩',
    'subagent-dispatch': '启动子 Agent',
    'subagent-wait': '等待子 Agent',
  };
  return titleMap[toolName] || `🔧 ${toolName}`;
}
