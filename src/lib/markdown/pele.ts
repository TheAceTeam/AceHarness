import type { DiagramPlugin } from 'streamdown';

export async function renderMermaidDiagram(source: string, id: string, fontFamily?: string) {
  const { renderAsync } = await import('pele/lazy');
  return renderAsync(source, {
    idPrefix: 'ace-' + id.replace(/[^a-zA-Z0-9_-]/g, '-'),
    fontFamily,
    links: false,
    images: false,
  });
}

export const peleMermaid: DiagramPlugin = {
  name: 'mermaid',
  type: 'diagram',
  language: 'mermaid',
  getMermaid(config) {
    return {
      initialize() {},
      render: (id, source) => renderMermaidDiagram(source, id, config?.fontFamily),
    };
  },
};
