export const WORKFLOW_BOARD_DIRECTORY = '.board';
export const WORKFLOW_BOARD_MAX_BYTES = 64 * 1024;

export type WorkflowBoard = { filename: string; title: string; diagram: string; markdown?: string };

export function isWorkflowBoardFilename(filename: string): boolean {
  return /^[^/\\:\u0000-\u001f]+\.md$/i.test(filename);
}

export function parseWorkflowBoard(filename: string, content: string): WorkflowBoard | null {
  if (!isWorkflowBoardFilename(filename)) return null;
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  const match = /^#[ \t]+([^\n]+)\n[ \t\n]*(`{3,}|~{3,})[ \t]*mermaid[ \t]*\n([\s\S]+)\n(?:`{3,}|~{3,})[ \t]*$/i.exec(normalized);
  if (!match) {
    const image = /^#[ \t]+([^\n]+)\n[ \t\n]*(!\[[^\]\n]*\]\((?:\.\/)?[a-z\d][a-z\d._-]*\.(?:png|jpe?g|webp|gif|avif)\))[ \t]*$/i.exec(normalized);
    const title = image?.[1].replace(/[ \t]+#+[ \t]*$/, '').trim();
    return image && title ? { filename, title, diagram: '', markdown: image[2] } : null;
  }
  const [, heading, fence, source] = match;
  const diagram = source.trim();
  const title = heading.replace(/[ \t]+#+[ \t]*$/, '').trim();
  const closingFence = new RegExp('^' + fence[0] + '{' + fence.length + ',}[ \\t]*$');
  const lines = normalized.split('\n');
  if (!title || !diagram || !closingFence.test(lines.at(-1) || '') || lines.slice(2, -1).some((line) => closingFence.test(line))) return null;
  return { filename, title, diagram };
}
