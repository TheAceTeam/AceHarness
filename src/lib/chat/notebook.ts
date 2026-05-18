import type { ChatMessage, ChatSession } from '@/contexts/ChatContext'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

function formatFileTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())
  return `${year}${month}${day}-${hours}${minutes}${seconds}`
}

export function createDefaultNotebookFileName(timestamp = Date.now()): string {
  return `${formatFileTimestamp(timestamp)}.cj.md`
}

function cleanTitle(title?: string): string {
  const normalized = (title || '').trim().replace(/\s+/g, ' ')
  return normalized || '未命名会话'
}

function sanitizeFileName(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function getMessageMarkdown(message: ChatMessage): string {
  return (message.rawContent || message.content || '').trim()
}

function filterExportableMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((message) => {
    if (message.role === 'error') return false
    return Boolean(getMessageMarkdown(message))
  })
}

export function buildNotebookFromConversation(session: ChatSession): string {
  const title = cleanTitle(session.title)
  const exportMessages = filterExportableMessages(session.messages)

  const sections = exportMessages.map((message) => {
    const heading = message.role === 'user' ? '## User' : '## Assistant'
    return [
      heading,
      '',
      `- 时间: ${formatTimestamp(message.timestamp)}`,
      message.engine ? `- 引擎: ${message.engine}` : null,
      message.model ? `- 模型: ${message.model}` : null,
      '',
      getMessageMarkdown(message),
    ].filter(Boolean).join('\n')
  })

  return [
    `# ${title}`,
    '',
    `- 导出时间: ${formatTimestamp(Date.now())}`,
    session.engine ? `- 会话引擎: ${session.engine}` : null,
    session.model ? `- 会话模型: ${session.model}` : null,
    '',
    sections.length > 0 ? sections.join('\n\n---\n\n') : '暂无可导出的会话内容。',
    '',
  ].filter(Boolean).join('\n')
}

export function buildNotebookFromAssistantMessage(message: ChatMessage): string {
  const content = getMessageMarkdown(message)

  return [
    '# AI Response',
    '',
    `- 导出时间: ${formatTimestamp(Date.now())}`,
    `- 消息时间: ${formatTimestamp(message.timestamp)}`,
    message.engine ? `- 引擎: ${message.engine}` : null,
    message.model ? `- 模型: ${message.model}` : null,
    '',
    '## Content',
    '',
    content || '暂无内容。',
    '',
  ].filter(Boolean).join('\n')
}

export function createConversationNotebookFileName(session: ChatSession): string {
  const baseTitle = sanitizeFileName(cleanTitle(session.title)) || 'chat'
  return `${baseTitle}-${formatFileTimestamp(Date.now())}.cj.md`
}

export function createAssistantNotebookFileName(message: ChatMessage): string {
  const snippet = sanitizeFileName(getMessageMarkdown(message).slice(0, 24))
  const prefix = snippet || 'ai-message'
  return `${prefix}-${formatFileTimestamp(Date.now())}.cj.md`
}
