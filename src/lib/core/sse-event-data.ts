export function parseSseJsonEventData(data: string | null | undefined): Record<string, any> {
  if (!data || data === '[DONE]') return {};
  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, any>;
    return { content: String(parsed ?? '') };
  } catch {
    return { content: data };
  }
}
