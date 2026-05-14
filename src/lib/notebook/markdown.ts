import { Node, mergeAttributes, type JSONContent } from '@tiptap/core';

export const NOTEBOOK_OUTPUT_LANGUAGE = 'text';
export const NOTEBOOK_OUTPUT_SUMMARY = 'Output';
export const NOTEBOOK_OUTPUT_ATTR = 'data-cj-notebook-output';
export const NOTEBOOK_CELL_ID_ATTR = 'data-cell-id';
export const NOTEBOOK_OUTPUT_ID_ATTR = 'data-output-id';

export interface NotebookOutputData {
  cellId: string;
  output: string;
  summary?: string;
  outputId?: string;
}

export function normalizeNotebookLanguage(language: string | null | undefined) {
  const normalized = (language || '').trim().toLowerCase();
  if (normalized === 'cj' || normalized === 'cangjie') return 'cangjie';
  if (normalized === 'plaintext') return 'text';
  if (normalized === 'shell') return 'bash';
  return normalized || 'text';
}

export function isRunnableNotebookLanguage(language: string | null | undefined) {
  const normalized = (language || '').trim().toLowerCase();
  return normalized === 'cj' || normalized === 'cangjie';
}

const CELL_ID_FRUITS = [
  'apple', 'banana', 'cherry', 'grape', 'mango', 'orange', 'peach', 'pear', 'plum', 'kiwi',
];

const CELL_ID_SNACKS = [
  'mochi', 'cookie', 'pudding', 'tart', 'donut', 'waffle', 'brownie', 'pie', 'muffin', 'macaron',
];

function pickOne(items: string[]): string {
  return items[Math.floor(Math.random() * items.length)] || 'snack';
}

export function createNotebookCellId() {
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${pickOne(CELL_ID_FRUITS)}-${pickOne(CELL_ID_SNACKS)}-${suffix}`;
}

export function displayNotebookCellId(cellId: string) {
  if (!cellId) return '';
  if (cellId.startsWith('cell-')) return cellId.slice(0, 10);
  return cellId;
}

export function createNotebookOutputId() {
  return `output-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildNotebookOutput(attrs: NotebookOutputData): JSONContent {
  return {
    type: 'notebookOutput',
    attrs: {
      cellId: attrs.cellId,
      summary: attrs.summary || NOTEBOOK_OUTPUT_SUMMARY,
      outputId: attrs.outputId || createNotebookOutputId(),
      output: attrs.output,
    },
  };
}

function parseDetailsAttributes(attrString: string) {
  const attrs: Record<string, string> = {};
  const attrRegex = /([\w-]+)="([^"]*)"/g;
  for (const match of attrString.matchAll(attrRegex)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function serializeDetailsAttributes(attrs: Record<string, any>) {
  return Object.entries(attrs)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}="${String(value).replace(/"/g, '&quot;')}"`)
    .join(' ');
}

export const NotebookOutput = Node.create({
  name: 'notebookOutput',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      cellId: {
        default: '',
      },
      outputId: {
        default: '',
      },
      summary: {
        default: NOTEBOOK_OUTPUT_SUMMARY,
      },
      output: {
        default: '',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `details[${NOTEBOOK_OUTPUT_ATTR}="true"]`,
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          return {
            cellId: element.getAttribute(NOTEBOOK_CELL_ID_ATTR) || '',
            outputId: element.getAttribute(NOTEBOOK_OUTPUT_ID_ATTR) || '',
            summary: element.getAttribute('data-summary') || NOTEBOOK_OUTPUT_SUMMARY,
            output: element.getAttribute('data-output') || '',
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['details', mergeAttributes(HTMLAttributes, {
      [NOTEBOOK_OUTPUT_ATTR]: 'true',
      [NOTEBOOK_CELL_ID_ATTR]: node.attrs.cellId,
      [NOTEBOOK_OUTPUT_ID_ATTR]: node.attrs.outputId,
      'data-summary': node.attrs.summary || NOTEBOOK_OUTPUT_SUMMARY,
      'data-output': node.attrs.output || '',
      open: 'open',
    })];
  },

  markdownTokenizer: {
    name: 'notebookOutput',
    level: 'block',
    start: src => src.indexOf(`<details ${NOTEBOOK_OUTPUT_ATTR}="true"`),
    tokenize: (src) => {
      const match = /^<details\s+([^>]*data-cj-notebook-output="true"[^>]*)>([\s\S]*?)<\/details>\s*/.exec(src);
      if (!match) return undefined;
      const attrs = parseDetailsAttributes(match[1]);
      const summaryMatch = match[2].match(/<summary>([\s\S]*?)<\/summary>/i);
      const fenceMatch = match[2].match(/```(?:text)?\n([\s\S]*?)\n```/i);
      return {
        type: 'notebookOutput',
        raw: match[0],
        cellId: attrs[NOTEBOOK_CELL_ID_ATTR] || '',
        outputId: attrs[NOTEBOOK_OUTPUT_ID_ATTR] || '',
        summary: attrs['data-summary'] || summaryMatch?.[1]?.trim() || NOTEBOOK_OUTPUT_SUMMARY,
        output: attrs['data-output'] || fenceMatch?.[1] || '',
      };
    },
  },

  parseMarkdown: (token, helpers) => helpers.createNode('notebookOutput', {
    cellId: token.cellId || '',
    outputId: token.outputId || createNotebookOutputId(),
    summary: token.summary || NOTEBOOK_OUTPUT_SUMMARY,
    output: token.output || '',
  }),

  renderMarkdown: (node) => {
    const summary = node.attrs?.summary || NOTEBOOK_OUTPUT_SUMMARY;
    const output = String(node.attrs?.output || '');
    const attrs = serializeDetailsAttributes({
      [NOTEBOOK_OUTPUT_ATTR]: 'true',
      [NOTEBOOK_CELL_ID_ATTR]: node.attrs?.cellId || '',
      [NOTEBOOK_OUTPUT_ID_ATTR]: node.attrs?.outputId || '',
      'data-summary': summary,
      'data-output': output,
      open: 'open',
    });
    return `<details ${attrs}>\n<summary>${summary}</summary>\n\n\
\`\`\`${NOTEBOOK_OUTPUT_LANGUAGE}\n${output}\n\`\`\`\n</details>`;
  },
});
