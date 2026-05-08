'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, ReactNodeViewRenderer, useEditor, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import { ListKit } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import { TrailingNode } from '@tiptap/extensions/trailing-node';
import { UndoRedo } from '@tiptap/extensions/undo-redo';
import { Node, mergeAttributes } from '@tiptap/core';
import { DragHandle } from '@tiptap/extension-drag-handle-react';
import type { Node as PmNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { Markdown } from '@tiptap/markdown';
import ReactFlow, { Background, Controls, MiniMap, MarkerType, Position, type Edge as RFEdge, type Node as RFNode } from 'reactflow';
import 'reactflow/dist/style.css';
import 'katex/dist/katex.min.css';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { ImperativePanelHandle, ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useToast } from '@/components/ui/toast';
import { createLowlight } from 'lowlight';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import { copyText } from '@/lib/clipboard';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import sql from 'highlight.js/lib/languages/sql';
import cangjie from '@/lib/cangjie-highlight';
import { NotebookAiSuggestionBlock, NotebookCodeBlock, NotebookMathBlock, NotebookOutputBlock } from './NotebookBlocks';
import { NotebookAskAISheet } from './NotebookAskAISheet';
import { NotebookOutput, buildNotebookOutput, createNotebookCellId, createNotebookOutputId, displayNotebookCellId, normalizeNotebookLanguage } from '@/lib/notebook-markdown';
import { uploadImageFile } from '@/lib/client-image-upload';

const lowlight = createLowlight();

lowlight.register('javascript', javascript);
lowlight.register('js', javascript);
lowlight.register('typescript', typescript);
lowlight.register('ts', typescript);
lowlight.register('json', json);
lowlight.register('html', xml);
lowlight.register('xml', xml);
lowlight.register('bash', bash);
lowlight.register('shell', bash);
lowlight.register('yaml', yaml);
lowlight.register('yml', yaml);
lowlight.register('markdown', markdown);
lowlight.register('md', markdown);
lowlight.register('python', python);
lowlight.register('py', python);
lowlight.register('java', java);
lowlight.register('cpp', cpp);
lowlight.register('c', cpp);
lowlight.register('sql', sql);
lowlight.register('cangjie', cangjie as any);
lowlight.register('cj', cangjie as any);

function parseNotebookCodeFenceInfo(rawInfo: string | null | undefined) {
  const info = String(rawInfo || '').trim();
  const idMatch = info.match(/(?:^|\s)id:([A-Za-z0-9_-]+)/);
  const depsMatch = info.match(/(?:^|\s)deps:([A-Za-z0-9,_-]+)/);
  const deps = depsMatch?.[1]
    ? depsMatch[1].split(',').map((item) => item.trim()).filter(Boolean)
    : [];
  const lang = normalizeNotebookLanguage(
    info
      .replace(/\s*id:[^\s]+/g, '')
      .replace(/\s*deps:[^\s]+/g, '')
      .trim() || null
  );
  return { language: lang, cellId: idMatch?.[1] || '', dependsOn: deps };
}

function renderNotebookCodeFenceInfo(language: string, cellId: string, dependsOn: string[]) {
  const normalizedLanguage = normalizeNotebookLanguage(language || null);
  const idPart = cellId ? ` id:${cellId}` : '';
  const depsPart = dependsOn.length > 0 ? ` deps:${dependsOn.join(',')}` : '';
  return `${normalizedLanguage}${idPart}${depsPart}`.trim();
}

function buildOutputBackedStatus(editor: Editor): Record<string, boolean> {
  const status: Record<string, boolean> = {};
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'notebookOutput') {
      const cellId = String(node.attrs.cellId || '');
      if (cellId) status[cellId] = true;
    }
    return true;
  });
  return status;
}

function findOrphanOutputRanges(editor: Editor): Array<{ from: number; to: number }> {
  const codeCellIds = new Set<string>();
  const outputs: Array<{ from: number; to: number; cellId: string }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'notebookCodeBlock') {
      const cellId = String(node.attrs.cellId || '');
      if (cellId) codeCellIds.add(cellId);
    } else if (node.type.name === 'notebookOutput') {
      outputs.push({ from: pos, to: pos + node.nodeSize, cellId: String(node.attrs.cellId || '') });
    }
    return true;
  });
  return outputs.filter((item) => !item.cellId || !codeCellIds.has(item.cellId)).map((item) => ({ from: item.from, to: item.to }));
}

function countAiSuggestionNodes(editor: Editor): number {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'notebookAiSuggestion') count += 1;
    return true;
  });
  return count;
}

function plainTextToParagraphNodes(text: string) {
  return text.split('\n').map((line) => (
    line
      ? { type: 'paragraph' as const, content: [{ type: 'text' as const, text: line }] }
      : { type: 'paragraph' as const }
  ));
}

interface DependencyGraphCell {
  cellId: string;
  language: string;
  preview: string;
  dependsOn: string[];
  pos: number;
}

function buildDependencyGraph(editor: Editor): { nodes: RFNode[]; edges: RFEdge[] } {
  const cells: DependencyGraphCell[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'notebookCodeBlock') {
      const cellId = String(node.attrs.cellId || '');
      if (!cellId) return true;
      const dependsOn = Array.isArray(node.attrs.dependsOn) ? (node.attrs.dependsOn as string[]) : [];
      const preview = (node.textContent || '').split('\n')[0]?.slice(0, 36) || '代码块';
      const language = String(node.attrs.language || 'text');
      cells.push({ cellId, language, preview, dependsOn, pos });
    }
    return true;
  });
  const byId = new Map(cells.map((item) => [item.cellId, item]));
  const depthMemo = new Map<string, number>();
  const visiting = new Set<string>();
  const getDepth = (id: string): number => {
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const current = byId.get(id);
    if (!current) return 0;
    const depth = current.dependsOn.length > 0
      ? Math.max(...current.dependsOn.map((dep) => getDepth(dep))) + 1
      : 0;
    visiting.delete(id);
    depthMemo.set(id, depth);
    return depth;
  };
  const groups = new Map<number, DependencyGraphCell[]>();
  cells.forEach((item) => {
    const depth = getDepth(item.cellId);
    const bucket = groups.get(depth) || [];
    bucket.push(item);
    groups.set(depth, bucket);
  });

  const nodeGapX = 300;
  const nodeGapY = 140;
  const maxColsPerRow = 4;
  const nodes: RFNode[] = [];
  const orderedGroups = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([depth, items]) => [depth, [...items].sort((a, b) => a.pos - b.pos)] as const);
  const maxRowCount = Math.max(1, ...orderedGroups.map(([, items]) => items.length));

  orderedGroups.forEach(([depth, items]) => {
      const columnInRow = depth % maxColsPerRow;
      const rowIndex = Math.floor(depth / maxColsPerRow);
      const startY = ((maxRowCount - items.length) * nodeGapY) / 2;
      const rowYOffset = rowIndex * (maxRowCount * nodeGapY + 140);
      items.forEach((item, index) => {
        nodes.push({
          id: item.cellId,
          position: { x: columnInRow * nodeGapX, y: rowYOffset + startY + index * nodeGapY },
          data: { label: `${displayNotebookCellId(item.cellId)} · ${item.preview}`, pos: item.pos, language: item.language },
          sourcePosition: Position.Bottom,
          targetPosition: Position.Top,
          style: { borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', color: 'hsl(var(--foreground))', fontSize: 12, minWidth: 220 },
        });
      });
    });

  const edges: RFEdge[] = [];
  cells.forEach((item) => {
    item.dependsOn.forEach((depId) => {
      if (!byId.has(depId)) return;
      edges.push({
        id: `${depId}->${item.cellId}`,
        source: depId,
        target: item.cellId,
        type: 'default',
        style: { strokeWidth: 1.8 },
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      });
    });
  });

  return { nodes, edges };
}

function updateOrInsertOutput(editor: Editor, pos: number, cellId: string, output: string) {
  const { state } = editor;
  const targetNode = state.doc.nodeAt(pos);
  if (!targetNode) return;

  const currentOutputNode = state.doc.nodeAt(pos + targetNode.nodeSize);
  const outputNode = buildNotebookOutput({
    cellId,
    outputId: currentOutputNode?.type.name === 'notebookOutput' ? String(currentOutputNode.attrs.outputId || createNotebookOutputId()) : createNotebookOutputId(),
    output,
  });

  if (currentOutputNode?.type.name === 'notebookOutput' && currentOutputNode.attrs.cellId === cellId) {
    editor.chain().focus().deleteRange({ from: pos + targetNode.nodeSize, to: pos + targetNode.nodeSize + currentOutputNode.nodeSize }).insertContentAt(pos + targetNode.nodeSize, outputNode).run();
    return;
  }

  editor.chain().focus().insertContentAt(pos + targetNode.nodeSize, outputNode).run();
}

const CARET_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

function pickCaretColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return CARET_COLORS[hash % CARET_COLORS.length];
}

const NotebookCodeBlockExtension = CodeBlockLowlight.extend({
  name: 'notebookCodeBlock',

  addAttributes() {
    return {
      ...this.parent?.(),
      cellId: {
        default: null,
        rendered: false,
      },
      dependsOn: {
        default: [],
        rendered: false,
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer((props) => <NotebookCodeBlock {...props} onRunCell={async (payload) => {
      const output = await (props.extension.options as any).onRunCell(payload, props.editor);
      if (output?.output != null) {
        updateOrInsertOutput(props.editor, payload.pos, payload.cellId, output.output);
      }
      return output;
    }} getCellRunStatus={(cellId: string) => (props.extension.options as any).getCellRunStatus?.(cellId, props.editor)} getAllCodeBlocks={() => (props.extension.options as any).getAllCodeBlocks?.(props.editor) || []} />);
  },

  parseMarkdown: (token, helpers) => {
    if (token.raw?.startsWith('```') === false && token.raw?.startsWith('~~~') === false && token.codeBlockStyle !== 'indented') {
      return [];
    }
    const parsedInfo = parseNotebookCodeFenceInfo(token.lang || null);
    return helpers.createNode('notebookCodeBlock', {
      language: parsedInfo.language,
      cellId: parsedInfo.cellId || createNotebookCellId(),
      dependsOn: parsedInfo.dependsOn,
    }, token.text ? [helpers.createTextNode(token.text)] : []);
  },

  renderMarkdown: (node, h) => {
    const language = node.attrs?.language || 'text';
    const cellId = String(node.attrs?.cellId || '');
    const dependsOn = Array.isArray(node.attrs?.dependsOn) ? node.attrs.dependsOn as string[] : [];
    const body = node.content ? h.renderChildren(node.content) : '';
    return `\`\`\`${renderNotebookCodeFenceInfo(language, cellId, dependsOn)}\n${body}\n\`\`\``;
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'pre',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-cell-id': node.attrs.cellId || '' }),
      ['code', { class: node.attrs.language ? this.options.languageClassPrefix + node.attrs.language : null }, 0],
    ];
  },
});

const NotebookBlockMathExtension = BlockMath.extend({
  addNodeView() {
    return ReactNodeViewRenderer(NotebookMathBlock);
  },
});

interface RichNotebookEditorProps {
  content: string;
  filePath: string;
  onChange: (content: string) => void;
  onRunCell: (payload: { pos: number; cellId: string; language: string; code: string }) => Promise<{ output: string | null; success: boolean }>;
  scope?: 'personal' | 'global';
  shareToken?: string;
  permission?: 'read' | 'write';
  tocOpen?: boolean;
  onTocOpenChange?: (open: boolean) => void;
  dependencyGraphOpen?: boolean;
  onDependencyGraphOpenChange?: (open: boolean) => void;
}

interface SlashMenuItem {
  id: string;
  title: string;
  subtext: string;
  aliases: string[];
  icon: string;
  group: string;
  onSelect: (editor: Editor) => void;
}

interface AiSuggestionItem {
  id: string;
  original: string;
  optimized: string;
}

interface AiSuggestionSegment {
  type: 'equal' | 'change';
  text?: string;
  itemId?: string;
}

function splitByParagraph(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildLcsMatrix(a: string[], b: string[]): number[][] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

function buildAiOptimizationDraft(sourceText: string, optimizedText: string): { items: AiSuggestionItem[]; segments: AiSuggestionSegment[] } {
  const a = splitByParagraph(sourceText);
  const b = splitByParagraph(optimizedText);
  const dp = buildLcsMatrix(a, b);
  const segments: AiSuggestionSegment[] = [];
  const items: AiSuggestionItem[] = [];
  let i = 0;
  let j = 0;
  let changeIndex = 0;

  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      segments.push({ type: 'equal', text: a[i] });
      i += 1;
      j += 1;
      continue;
    }

    const deleted: string[] = [];
    const inserted: string[] = [];
    while (i < a.length || j < b.length) {
      const canStop = i < a.length && j < b.length && a[i] === b[j];
      if (canStop) break;
      if (i < a.length && (j >= b.length || dp[i + 1][j] >= dp[i][j + 1])) {
        deleted.push(a[i]);
        i += 1;
      } else if (j < b.length) {
        inserted.push(b[j]);
        j += 1;
      }
    }

    if (deleted.length > 0 || inserted.length > 0) {
      const id = `ai-s-${changeIndex++}`;
      items.push({
        id,
        original: deleted.join('\n\n'),
        optimized: inserted.join('\n\n'),
      });
      segments.push({ type: 'change', itemId: id });
    }
  }

  return { items, segments };
}

function textToParagraphNodes(text: string) {
  const parts = splitByParagraph(text);
  if (parts.length === 0) {
    return [{ type: 'paragraph' as const }];
  }
  return parts.map((part) => ({
    type: 'paragraph' as const,
    content: [{ type: 'text' as const, text: part }],
  }));
}

function buildAiSuggestionNodes(draft: { items: AiSuggestionItem[]; segments: AiSuggestionSegment[] }) {
  const itemMap = new Map(draft.items.map((item) => [item.id, item]));
  const nodes: any[] = [];
  draft.segments.forEach((segment) => {
    if (segment.type === 'equal') {
      nodes.push(...textToParagraphNodes(segment.text || ''));
      return;
    }
    const item = itemMap.get(segment.itemId || '');
    if (!item) return;
    nodes.push({
      type: 'notebookAiSuggestion',
      attrs: {
        original: item.original || '',
        optimized: item.optimized || '',
      },
    });
  });
  return nodes.length > 0 ? nodes : [{ type: 'paragraph' }];
}

const NotebookAiSuggestionExtension = Node.create({
  name: 'notebookAiSuggestion',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      original: { default: '' },
      optimized: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="notebook-ai-suggestion"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'notebook-ai-suggestion' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer((props) => (
      <NotebookAiSuggestionBlock
        {...props}
        onAccept={(payload) => (props.extension.options as any).onAccept?.(payload, props.editor)}
        onReject={(payload) => (props.extension.options as any).onReject?.(payload, props.editor)}
      />
    ));
  },
});

function TableSizeMenuButton({ onInsert, dense = false }: { onInsert: (rows: number, cols: number) => void; dense?: boolean }) {
  const [open, setOpen] = useState(false);
  const [hoverRows, setHoverRows] = useState(3);
  const [hoverCols, setHoverCols] = useState(3);
  const maxRows = 8;
  const maxCols = 8;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={`rounded px-2 py-1 hover:bg-accent ${dense ? 'text-xs' : 'text-sm'}`} title="插入表格">
          <span className="material-symbols-outlined text-base">table_chart</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-[220px] z-[87]">
        <div className="px-2 pb-2">
          <div className="mb-2 text-xs text-muted-foreground">选择表格大小（{hoverRows} x {hoverCols}）</div>
          <div className="grid grid-cols-8 gap-1">
            {Array.from({ length: maxRows }).map((_, r) =>
              Array.from({ length: maxCols }).map((__, c) => {
                const active = r < hoverRows && c < hoverCols;
                return (
                  <button
                    key={`${r}-${c}`}
                    type="button"
                    className={`h-4 w-4 rounded-sm border ${active ? 'border-primary bg-primary/70' : 'border-border bg-muted/30 hover:bg-muted/60'}`}
                    onMouseEnter={() => {
                      setHoverRows(r + 1);
                      setHoverCols(c + 1);
                    }}
                    onClick={() => {
                      onInsert(r + 1, c + 1);
                      setOpen(false);
                    }}
                    title={`${r + 1} x ${c + 1}`}
                  />
                );
              })
            )}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RichNotebookEditor({
  content,
  filePath,
  onChange,
  onRunCell,
  scope = 'personal',
  shareToken,
  permission = 'write',
  tocOpen = false,
  onTocOpenChange = () => {},
  dependencyGraphOpen = false,
  onDependencyGraphOpenChange = () => {},
}: RichNotebookEditorProps) {
  const { toast } = useToast();
  const changeSourceRef = useRef<'internal' | 'external'>('external');
  const lastKnownContentRef = useRef(content);
  const derivedRefreshFrameRef = useRef<number | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [collabUser, setCollabUser] = useState<{ id: string; name: string; color: string }>({
    id: '',
    name: '',
    color: pickCaretColor('current-user'),
  });
  const [collabSession, setCollabSession] = useState<{ doc: Y.Doc; provider: WebsocketProvider } | null>(null);
  const [collabUsers, setCollabUsers] = useState<Array<{ clientId: number; name: string; color: string }>>([]);
  const [cellRunState, setCellRunState] = useState<Record<string, 'idle' | 'running' | 'success' | 'failed'>>({});
  const [outputBackedSuccess, setOutputBackedSuccess] = useState<Record<string, boolean>>({});
  const cellRunStateRef = useRef<Record<string, 'idle' | 'running' | 'success' | 'failed'>>({});
  const outputBackedSuccessRef = useRef<Record<string, boolean>>({});
  const editorRef = useRef<Editor | null>(null);
  // dependencyGraphOpen is controlled by parent menu
  const [dependencyNodes, setDependencyNodes] = useState<RFNode[]>([]);
  const [dependencyEdges, setDependencyEdges] = useState<RFEdge[]>([]);
  const editorPanelRef = useRef<ImperativePanelHandle | null>(null);
  const dependencyPanelRef = useRef<ImperativePanelHandle | null>(null);
  const applyingPanelResizeRef = useRef(false);
  const [dependencyPanelPercent, setDependencyPanelPercent] = useState(30);
  const [tocItems, setTocItems] = useState<Array<{ id: string; text: string; level: number; pos: number }>>([]);
  const [activeTocId, setActiveTocId] = useState<string | null>(null);
  const [inlineMathEditOpen, setInlineMathEditOpen] = useState(false);
  const [inlineMathEditPos, setInlineMathEditPos] = useState<number | null>(null);
  const [inlineMathEditLatex, setInlineMathEditLatex] = useState('');
  const [inlineMathEditAnchor, setInlineMathEditAnchor] = useState<{ top: number; left: number } | null>(null);
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const [linkEditRange, setLinkEditRange] = useState<{ from: number; to: number } | null>(null);
  const [linkDraftText, setLinkDraftText] = useState('');
  const [linkDraftUrl, setLinkDraftUrl] = useState('');
  const [linkDraftTitle, setLinkDraftTitle] = useState('');
  const [linkEditorAnchor, setLinkEditorAnchor] = useState<{ top: number; left: number } | null>(null);
  const [imageEditorOpen, setImageEditorOpen] = useState(false);
  const [imageEditorPos, setImageEditorPos] = useState<number | null>(null);
  const [imageEditorAnchor, setImageEditorAnchor] = useState<{ top: number; left: number } | null>(null);
  const [imageDraftSrc, setImageDraftSrc] = useState('');
  const [imageDraftAlt, setImageDraftAlt] = useState('');
  const [imageDraftTitle, setImageDraftTitle] = useState('');
  const setCellRunStateWithRef = useCallback((updater: (prev: Record<string, 'idle' | 'running' | 'success' | 'failed'>) => Record<string, 'idle' | 'running' | 'success' | 'failed'>) => {
    setCellRunState((prev) => {
      const next = updater(prev);
      cellRunStateRef.current = next;
      return next;
    });
  }, []);
  const setOutputBackedSuccessWithRef = useCallback((next: Record<string, boolean>) => {
    outputBackedSuccessRef.current = next;
    setOutputBackedSuccess(next);
  }, []);

  useEffect(() => {
    cellRunStateRef.current = cellRunState;
  }, [cellRunState]);

  useEffect(() => {
    outputBackedSuccessRef.current = outputBackedSuccess;
  }, [outputBackedSuccess]);

  useEffect(() => {
    lastKnownContentRef.current = content;
  }, [content]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = window.localStorage.getItem('auth-token') || null;
    if (!token) {
      setAuthToken(null);
      return;
    }
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.user?.id || !data?.user?.username) {
          setAuthToken(null);
          toast('error', '无法获取当前登录用户，协作已禁用');
          return;
        }
        const id = String(data.user.id);
        const name = String(data.user.username);
        setCollabUser({ id, name, color: pickCaretColor(id) });
        setAuthToken(token);
      })
      .catch(() => {
        setAuthToken(null);
        toast('error', '获取当前用户失败，协作已禁用');
      });
  }, [toast]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!authToken) {
      setCollabSession(null);
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const baseUrl = `${protocol}//${window.location.host}/api/notebook/collab`;
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(baseUrl, 'room', doc, {
      params: {
        scope,
        file: filePath,
        shareToken: shareToken || '',
        authToken,
      },
    });

    setCollabSession({ doc, provider });
    return () => {
      provider.destroy();
      doc.destroy();
      setCollabSession((prev) => (prev?.provider === provider ? null : prev));
      setCollabUsers([]);
    };
  }, [authToken, filePath, scope, shareToken]);

  const resolveCellStatus = useCallback((cellId: string, currentEditor?: Editor): 'idle' | 'running' | 'success' | 'failed' => {
    const state = cellRunStateRef.current[cellId];
    if (state && state !== 'idle') return state;
    if (outputBackedSuccessRef.current[cellId]) return 'success';
    const targetEditor = currentEditor || editorRef.current;
    if (targetEditor) {
      let found = false;
      targetEditor.state.doc.descendants((node) => {
        if (node.type.name === 'notebookOutput' && String(node.attrs.cellId || '') === cellId) {
          found = true;
          return false;
        }
        return true;
      });
      if (found) return 'success';
    }
    return 'idle';
  }, []);

  const refreshDependencyGraph = useCallback((targetEditor: Editor) => {
    const { nodes, edges } = buildDependencyGraph(targetEditor);
    setDependencyNodes(nodes);
    setDependencyEdges(edges);
  }, []);

  const refreshDerivedNotebookState = useCallback((targetEditor: Editor) => {
    setOutputBackedSuccessWithRef(buildOutputBackedStatus(targetEditor));
    setAiSuggestionCount(countAiSuggestionNodes(targetEditor));
    refreshDependencyGraph(targetEditor);
  }, [refreshDependencyGraph, setOutputBackedSuccessWithRef]);

  const scheduleDerivedNotebookStateRefresh = useCallback((targetEditor: Editor) => {
    if (typeof window === 'undefined') {
      refreshDerivedNotebookState(targetEditor);
      return;
    }
    if (derivedRefreshFrameRef.current !== null) {
      window.cancelAnimationFrame(derivedRefreshFrameRef.current);
    }
    derivedRefreshFrameRef.current = window.requestAnimationFrame(() => {
      derivedRefreshFrameRef.current = null;
      if (targetEditor.isDestroyed) return;
      refreshDerivedNotebookState(targetEditor);
    });
  }, [refreshDerivedNotebookState]);

  const replaceSuggestionNodeWithText = useCallback((targetEditor: Editor, pos: number, text: string) => {
    const node = targetEditor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'notebookAiSuggestion') return;
    const markdown = (text || '').trim();
    const replacement = markdown.length > 0 ? markdown : '\n';
    targetEditor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .insertContentAt(pos, replacement, { contentType: 'markdown' })
      .run();
  }, []);

  const applyAllAiSuggestions = useCallback((mode: 'accept' | 'reject') => {
    const targetEditor = editorRef.current;
    if (!targetEditor) return;
    const targets: Array<{ pos: number; original: string; optimized: string }> = [];
    targetEditor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'notebookAiSuggestion') {
        targets.push({
          pos,
          original: String(node.attrs.original || ''),
          optimized: String(node.attrs.optimized || ''),
        });
      }
      return true;
    });
    if (targets.length === 0) return;
    [...targets]
      .sort((a, b) => b.pos - a.pos)
      .forEach((item) => {
        replaceSuggestionNodeWithText(targetEditor, item.pos, mode === 'accept' ? item.optimized : item.original);
      });
    toast('success', mode === 'accept' ? `已接受全部建议（${targets.length} 条）` : `已拒绝全部建议（${targets.length} 条）`);
  }, [replaceSuggestionNodeWithText, toast]);

  const applyInlineMathEdit = useCallback(() => {
    const targetEditor = editorRef.current;
    if (!targetEditor || inlineMathEditPos === null) return;
    try {
      (targetEditor.chain().focus() as any)
        .setNodeSelection(inlineMathEditPos)
        .updateInlineMath({ latex: inlineMathEditLatex })
        .run();
      setInlineMathEditOpen(false);
      setInlineMathEditPos(null);
      setInlineMathEditAnchor(null);
    } catch {
      toast('error', '行内公式更新失败，请重试');
    }
  }, [inlineMathEditLatex, inlineMathEditPos, toast]);

  const toSafeAnchor = useCallback((left: number, top: number) => ({
    left: Math.max(16, Math.min(window.innerWidth - 16, left)),
    top: Math.max(16, Math.min(window.innerHeight - 16, top)),
  }), []);

  const getSelectionAnchor = useCallback((targetEditor: Editor, range: { from: number; to: number } | null) => {
    try {
      const from = range ? range.from : targetEditor.state.selection.from;
      const to = range ? range.to : targetEditor.state.selection.to;
      const maxPos = Math.max(1, targetEditor.state.doc.content.size);
      const anchorPos = Math.max(1, Math.min(maxPos, Math.floor((from + to) / 2)));
      const coords = targetEditor.view.coordsAtPos(anchorPos);
      return toSafeAnchor(coords.left, coords.bottom + 6);
    } catch {
      const rect = targetEditor.view.dom.getBoundingClientRect();
      return toSafeAnchor(rect.left + rect.width / 2, rect.top + 40);
    }
  }, [toSafeAnchor]);

  const openLinkEditor = useCallback(() => {
    const targetEditor = editorRef.current;
    if (!targetEditor) return;
    if (targetEditor.isActive('link')) {
      (targetEditor.chain().focus() as any).extendMarkRange('link').run();
    } else {
      targetEditor.chain().focus().run();
    }
    const { from, to, empty } = targetEditor.state.selection;
    const selectedText = empty ? '' : targetEditor.state.doc.textBetween(from, to, ' ');
    const currentHref = String(targetEditor.getAttributes('link').href || '');
    const currentTitle = String(targetEditor.getAttributes('link').title || '');
    const anchor = getSelectionAnchor(targetEditor, empty ? null : { from, to });
    setLinkEditorAnchor(anchor);
    setLinkEditRange(empty ? null : { from, to });
    setLinkDraftText(selectedText || currentHref || '');
    setLinkDraftUrl(currentHref);
    setLinkDraftTitle(currentTitle);
    setLinkEditorOpen(true);
  }, [getSelectionAnchor]);

  const openImageEditor = useCallback((pos?: number, anchor?: { top: number; left: number }) => {
    const targetEditor = editorRef.current;
    if (!targetEditor) return;
    let resolvedPos = typeof pos === 'number' ? pos : -1;
    if (resolvedPos < 0) {
      const from = targetEditor.state.selection.from;
      const direct = targetEditor.state.doc.nodeAt(from);
      const prev = from > 1 ? targetEditor.state.doc.nodeAt(from - 1) : null;
      if (direct?.type.name === 'image') resolvedPos = from;
      else if (prev?.type.name === 'image') resolvedPos = from - 1;
    }
    const node = resolvedPos >= 0 ? targetEditor.state.doc.nodeAt(resolvedPos) : null;
    if (!node || node.type.name !== 'image') return;
    setImageEditorPos(resolvedPos);
    setImageDraftSrc(String(node.attrs.src || ''));
    setImageDraftAlt(String(node.attrs.alt || ''));
    setImageDraftTitle(String(node.attrs.title || ''));
    if (anchor) {
      setImageEditorAnchor(anchor);
    } else {
      const dom = targetEditor.view.nodeDOM(resolvedPos) as HTMLElement | null;
      if (dom) {
        const rect = dom.getBoundingClientRect();
        setImageEditorAnchor({
          left: Math.max(16, Math.min(window.innerWidth - 16, rect.left + rect.width / 2)),
          top: Math.max(16, Math.min(window.innerHeight - 16, rect.bottom + 6)),
        });
      } else {
        setImageEditorAnchor(null);
      }
    }
    setImageEditorOpen(true);
  }, []);

  const applyImageEdit = useCallback(() => {
    const targetEditor = editorRef.current;
    if (!targetEditor || imageEditorPos === null) return;
    const src = imageDraftSrc.trim();
    if (!src) {
      toast('warning', '图片地址不能为空');
      return;
    }
    targetEditor
      .chain()
      .focus()
      .command(({ tr }) => {
        const node = tr.doc.nodeAt(imageEditorPos);
        if (!node || node.type.name !== 'image') return false;
        tr.setNodeMarkup(imageEditorPos, undefined, {
          ...node.attrs,
          src,
          alt: imageDraftAlt.trim(),
          title: imageDraftTitle.trim(),
        });
        return true;
      })
      .run();
    setImageEditorOpen(false);
    setImageEditorPos(null);
    setImageEditorAnchor(null);
  }, [imageDraftAlt, imageDraftSrc, imageDraftTitle, imageEditorPos, toast]);

  const applyLinkEdit = useCallback(() => {
    const targetEditor = editorRef.current;
    if (!targetEditor) return;
    const text = linkDraftText.trim();
    const rawUrl = linkDraftUrl.trim();
    if (!text) {
      toast('warning', '请输入链接文本');
      return;
    }

    if (!rawUrl) {
      if (linkEditRange) {
        targetEditor.chain().focus().insertContentAt(linkEditRange, text).run();
      } else {
        targetEditor.chain().focus().insertContent(text).run();
      }
      setLinkEditorOpen(false);
      setLinkEditorAnchor(null);
      return;
    }

    const href = /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const safeText = text.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
    const safeHref = href.replace(/\)/g, '%29');
    const titlePart = linkDraftTitle.trim() ? ` "${linkDraftTitle.trim().replace(/"/g, '\\"')}"` : '';
    const snippet = `[${safeText}](${safeHref}${titlePart})`;
    if (linkEditRange) {
      targetEditor
        .chain()
        .focus()
        .insertContentAt(linkEditRange, snippet, { contentType: 'markdown' })
        .run();
    } else {
      targetEditor.chain().focus().insertContent(snippet, { contentType: 'markdown' }).run();
    }
    setLinkEditorOpen(false);
    setLinkEditorAnchor(null);
  }, [linkDraftText, linkDraftTitle, linkDraftUrl, linkEditRange, toast]);

  const removeLink = useCallback(() => {
    const targetEditor = editorRef.current;
    if (!targetEditor) return;
    if (linkEditRange) {
      const plain = linkDraftText.trim() || targetEditor.state.doc.textBetween(linkEditRange.from, linkEditRange.to, ' ');
      targetEditor.chain().focus().insertContentAt(linkEditRange, plain).run();
    } else {
      (targetEditor.chain().focus() as any).extendMarkRange('link').unsetLink().run();
    }
    setLinkEditorOpen(false);
    setLinkEditorAnchor(null);
  }, [linkDraftText, linkEditRange]);

  const openDraftLink = useCallback(() => {
    const raw = linkDraftUrl.trim();
    if (!raw) return;
    const href = /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(raw) ? raw : `https://${raw}`;
    if (typeof window !== 'undefined') window.open(href, '_blank', 'noopener,noreferrer');
  }, [linkDraftUrl]);

  const renderLinkEditor = (dense = false) => (
    <button
      type="button"
      className={`rounded px-2 py-1 hover:bg-accent ${dense ? 'text-xs' : 'text-sm'} ${editor?.isActive('link') ? 'bg-accent' : ''}`}
      title="插入/编辑链接"
      onMouseDown={(event) => {
        event.preventDefault();
        openLinkEditor();
      }}
    >
      <span className="material-symbols-outlined text-base">link</span>
    </button>
  );

  const notebookExtensions = useMemo(() => {
    const base: any[] = [
      StarterKit.configure({
        codeBlock: false,
        link: false,
        undoRedo: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
      }),
      Markdown,
      Image,
      Link.configure({
        autolink: true,
        openOnClick: false,
        enableClickSelection: true,
        protocols: ['http', 'https', 'mailto', 'tel'],
      }),
      InlineMath.configure({
        onClick: (node, pos) => {
          const current = String((node as any)?.attrs?.latex || '');
          setInlineMathEditLatex(current);
          setInlineMathEditPos(pos);
          const dom = editorRef.current?.view.nodeDOM(pos) as HTMLElement | null;
          if (dom) {
            const rect = dom.getBoundingClientRect();
            setInlineMathEditAnchor({
              left: Math.max(16, Math.min(window.innerWidth - 16, rect.left + rect.width / 2)),
              top: Math.max(16, Math.min(window.innerHeight - 16, rect.bottom + 6)),
            });
          } else {
            setInlineMathEditAnchor(null);
          }
          setInlineMathEditOpen(true);
        },
        katexOptions: {
          throwOnError: false,
          strict: 'ignore',
        },
      }),
      NotebookBlockMathExtension.configure({
        katexOptions: {
          throwOnError: false,
          strict: 'ignore',
        },
      }),
      Placeholder.configure({
        emptyEditorClass: 'is-editor-empty',
        emptyNodeClass: 'is-empty',
        dataAttribute: 'placeholder',
        showOnlyWhenEditable: true,
        showOnlyCurrent: false,
        includeChildren: true,
        placeholder: ({ node }) => {
          if (node.type.name === 'heading') return '输入标题，例如：问题背景 / 结论';
          if (node.type.name === 'notebookCodeBlock') return '粘贴代码，右上角运行，或输入 / 触发命令菜单';
          if (node.type.name === 'blockquote') return '可写备注、限制条件或风险提示';
          return '输入 / 触发命令菜单，或直接开始记录';
        },
      }),
      Typography,
      ListKit.configure({
        taskItem: { nested: true },
      }),
      TableKit.configure({
        table: {
          resizable: false,
        },
      }),
      TrailingNode.configure({ node: 'paragraph', notAfter: ['paragraph'] }),
    ];
    if (collabSession) {
      base.push(
        Collaboration.configure({
          document: collabSession.doc,
          field: 'default',
          provider: collabSession.provider,
        }),
      );
      if (collabUser.name) {
        base.push(
          CollaborationCaret.configure({
            provider: collabSession.provider,
            user: {
              id: collabUser.id,
              name: collabUser.name,
              color: collabUser.color,
            },
            render: (user) => {
              const caret = document.createElement('span');
              caret.classList.add('notebook-collab-caret');
              caret.style.borderColor = String(user.color || '#3b82f6');
              const label = document.createElement('span');
              label.classList.add('notebook-collab-caret-label');
              label.style.background = String(user.color || '#3b82f6');
              label.textContent = String(user.name || '用户');
              caret.appendChild(label);
              return caret;
            },
            selectionRender: (user) => ({
              class: 'notebook-collab-selection',
              style: `background-color: ${String(user.color || '#3b82f6')}33`,
            }),
          }),
        );
      }
    } else {
      base.push(UndoRedo.configure({ depth: 100, newGroupDelay: 500 }));
    }
    base.push(
      NotebookAiSuggestionExtension.configure({
        onAccept: (payload: { pos: number; original: string; optimized: string }, currentEditor: Editor) => {
          replaceSuggestionNodeWithText(currentEditor, payload.pos, payload.optimized);
          toast('success', '已接受该建议');
        },
        onReject: (payload: { pos: number; original: string; optimized: string }, currentEditor: Editor) => {
          replaceSuggestionNodeWithText(currentEditor, payload.pos, payload.original);
          toast('info', '已拒绝该建议');
        },
      } as any),
      NotebookCodeBlockExtension.configure({
      lowlight,
      enableTabIndentation: true,
      tabSize: 2,
      languageClassPrefix: 'language-',
      defaultLanguage: 'text',
      HTMLAttributes: { class: 'hljs' },
      onRunCell: async (payload: { pos: number; cellId: string; language: string; code: string; dependsOn?: string[] }, currentEditor?: Editor) => {
        const dependsOn = payload.dependsOn || [];
        const unmetDependencies = dependsOn.filter((id) => resolveCellStatus(id, currentEditor) !== 'success');
        if (unmetDependencies.length > 0) {
          toast('warning', `依赖未满足：${unmetDependencies.join(', ')}`);
          return { output: null, success: false };
        }
        setCellRunStateWithRef((prev) => ({ ...prev, [payload.cellId]: 'running' }));
        const result = await onRunCell({
          pos: payload.pos,
          cellId: payload.cellId,
          language: payload.language,
          code: payload.code,
        });
        setCellRunStateWithRef((prev) => ({ ...prev, [payload.cellId]: result.success ? 'success' : 'failed' }));
        return result;
      },
      getCellRunStatus: (cellId: string) => {
        return resolveCellStatus(cellId);
      },
      getAllCodeBlocks: (currentEditor: Editor) => {
        const items: Array<{ cellId: string; language: string; preview: string }> = [];
        currentEditor.state.doc.descendants((node) => {
          if (node.type.name === 'notebookCodeBlock') {
            const id = String(node.attrs.cellId || '');
            if (!id) return true;
            const language = String(node.attrs.language || 'text');
            const preview = (node.textContent || '').split('\n')[0]?.slice(0, 36) || id.slice(0, 8);
            items.push({ cellId: id, language, preview });
          }
          return true;
        });
        return items;
      },
    } as any),
      NotebookOutput.extend({
        addNodeView() {
          return ReactNodeViewRenderer(NotebookOutputBlock);
        },
      }),
      Node.create({
        name: 'notebookKeymap',
        addKeyboardShortcuts() {
          return {
            Enter: ({ editor }) => {
              const { $from } = editor.state.selection;
              if ($from.parent.type.name === 'notebookOutput') {
                return false;
              }
              return false;
            },
          };
        },
      }),
    );
    return base;
  }, [cellRunState, collabSession, collabUser.color, collabUser.id, collabUser.name, filePath, onRunCell, outputBackedSuccess, replaceSuggestionNodeWithText, resolveCellStatus, setCellRunStateWithRef, toast]);

  const initialEditorContent = collabSession ? lastKnownContentRef.current : content;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: notebookExtensions,
    editable: permission !== 'read',
    content: initialEditorContent,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: 'tiptap prose prose-invert max-w-none min-h-full px-10 md:px-12 py-5 focus:outline-none [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:my-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:my-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/50 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_hr]:my-4 [&_hr]:border-border [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:rounded-md [&_table]:overflow-hidden [&_th]:border [&_th]:border-border [&_th]:bg-muted/50 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5 [&_img]:my-3 [&_img]:max-h-[420px] [&_img]:max-w-full [&_img]:rounded-md [&_img]:border [&_img]:border-border [&_img]:object-contain',
      },
      handleDOMEvents: {
        mousedown: (_view, event) => {
          const target = event.target as HTMLElement | null;
          const imageEl = target?.closest?.('img');
          if (imageEl) {
            event.preventDefault();
            event.stopPropagation();
            const pos = _view.posAtDOM(imageEl, 0);
            const rect = imageEl.getBoundingClientRect();
            openImageEditor(pos, {
              left: Math.max(16, Math.min(window.innerWidth - 16, rect.left + rect.width / 2)),
              top: Math.max(16, Math.min(window.innerHeight - 16, rect.bottom + 6)),
            });
            return true;
          }
          return false;
        },
        click: (_view, event) => {
          const target = event.target as HTMLElement | null;
          const imageEl = target?.closest?.('img');
          if (imageEl) {
            event.preventDefault();
            event.stopPropagation();
            const pos = _view.posAtDOM(imageEl, 0);
            const rect = imageEl.getBoundingClientRect();
            openImageEditor(pos, {
              left: Math.max(16, Math.min(window.innerWidth - 16, rect.left + rect.width / 2)),
              top: Math.max(16, Math.min(window.innerHeight - 16, rect.bottom + 6)),
            });
            return true;
          }
          return false;
        },
      },
      handlePaste: (_view, event) => {
        const clipboard = event.clipboardData;
        if (!clipboard) return false;
        const files = Array.from(clipboard.files || []).filter((file) => file.type?.startsWith('image/'));
        if (files.length === 0) return false;
        event.preventDefault();
        files.forEach((file) => {
          void insertUploadedImage(file);
        });
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const dt = event.dataTransfer;
        if (!dt) return false;
        const files = Array.from(dt.files || []).filter((file) => file.type?.startsWith('image/'));
        if (files.length === 0) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        files.forEach((file) => {
          void insertUploadedImage(file, pos);
        });
        return true;
      },
    },
    onCreate: ({ editor }) => {
      editorRef.current = editor;
      if (!collabSession && content) {
        editor.commands.setContent(content, { contentType: 'markdown', emitUpdate: false });
      }
      lastKnownContentRef.current = editor.getMarkdown();
      refreshDerivedNotebookState(editor);
    },
    onUpdate: ({ editor }) => {
      changeSourceRef.current = 'internal';
      const orphanRanges = findOrphanOutputRanges(editor);
      if (orphanRanges.length > 0) {
        const tr = editor.state.tr;
        [...orphanRanges].sort((a, b) => b.from - a.from).forEach((range) => tr.delete(range.from, range.to));
        queueMicrotask(() => {
          if (!editor.isDestroyed && tr.docChanged) editor.view.dispatch(tr);
        });
        return;
      }
      scheduleDerivedNotebookStateRefresh(editor);
      const markdown = editor.getMarkdown();
      lastKnownContentRef.current = markdown;
      onChange(markdown);
    },
  }, [collabSession?.provider, collabSession?.doc, permission, filePath, scope, shareToken, collabUser.name, collabUser.color]);

  useEffect(() => {
    editorRef.current = editor || null;
    return () => {
      if (typeof window !== 'undefined' && derivedRefreshFrameRef.current !== null) {
        window.cancelAnimationFrame(derivedRefreshFrameRef.current);
        derivedRefreshFrameRef.current = null;
      }
      editorRef.current = null;
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    let root: HTMLElement | null = null;
    let rafId = 0;
    let disposed = false;
    const interceptLinkNavigation = (event: Event) => {
      const target = event.target as HTMLElement | null;
      const linkEl = target?.closest?.('a');
      if (!root || !linkEl || !root.contains(linkEl)) return;
      event.preventDefault();
      event.stopPropagation();
      const targetEditor = editorRef.current;
      if (!targetEditor) return;
      const href = String(linkEl.getAttribute('href') || '');
      const title = String(linkEl.getAttribute('title') || '');
      const text = String(linkEl.textContent || '').trim();
      let pos = 1;
      try {
        pos = Math.max(1, targetEditor.view.posAtDOM(linkEl, 0));
      } catch {
        pos = Math.max(1, targetEditor.state.selection.from);
      }
      const from = pos;
      const to = Math.max(from, from + Math.max(1, text.length));
      targetEditor.chain().focus().setTextSelection({ from, to }).run();
      if (targetEditor.isActive('link')) {
        (targetEditor.chain().focus() as any).extendMarkRange('link').run();
      }
      const sel = targetEditor.state.selection;
      const rect = linkEl.getBoundingClientRect();
      setLinkEditorAnchor(toSafeAnchor(rect.left + rect.width / 2, rect.bottom + 6));
      setLinkEditRange(sel.empty ? null : { from: sel.from, to: sel.to });
      setLinkDraftText(targetEditor.state.doc.textBetween(sel.from, sel.to, ' ') || text || href);
      setLinkDraftUrl(String(targetEditor.getAttributes('link').href || href));
      setLinkDraftTitle(String(targetEditor.getAttributes('link').title || title));
      window.requestAnimationFrame(() => setLinkEditorOpen(true));
    };

    const bind = () => {
      if (disposed) return false;
      try {
        const dom = editor.view?.dom as HTMLElement | undefined;
        if (!dom) return false;
        root = dom;
      } catch {
        return false;
      }
      root.addEventListener('pointerdown', interceptLinkNavigation, true);
      return true;
    };

    if (!bind()) {
      const retry = () => {
        if (disposed) return;
        if (bind()) return;
        rafId = window.requestAnimationFrame(retry);
      };
      rafId = window.requestAnimationFrame(retry);
    }

    return () => {
      disposed = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      if (!root) return;
      root.removeEventListener('pointerdown', interceptLinkNavigation, true);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    if (collabSession) return;
    if (changeSourceRef.current === 'internal') {
      changeSourceRef.current = 'external';
      return;
    }
    if (content === editor.getMarkdown()) return;
    editor.commands.setContent(content, { contentType: 'markdown', emitUpdate: false });
    lastKnownContentRef.current = content;
    refreshDerivedNotebookState(editor);
  }, [collabSession, content, editor, refreshDerivedNotebookState]);

  useEffect(() => {
    if (!editor) return;
    const { tr, doc } = editor.state;
    let changed = false;
    const seenCellIds = new Set<string>();
    doc.descendants((node, pos) => {
      if (node.type.name === 'notebookCodeBlock') {
        const currentId = String(node.attrs.cellId || '');
        if (!currentId || seenCellIds.has(currentId)) {
          tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            cellId: createNotebookCellId(),
          });
          changed = true;
        } else {
          seenCellIds.add(currentId);
        }
      }
      return true;
    });
    if (changed) {
      const nextTr = tr.setSelection(TextSelection.create(tr.doc, Math.min(tr.doc.content.size, editor.state.selection.from)));
      queueMicrotask(() => {
        if (!editor.isDestroyed) {
          editor.view.dispatch(nextTr);
        }
      });
    }
  }, [editor]);

  useEffect(() => {
    if (!editor || !collabSession) return;
    const { doc, provider } = collabSession;
    const config = doc.getMap('config');
    let seedTimer: ReturnType<typeof setTimeout> | null = null;
    const trySeedInitialContent = () => {
      if (!content) return;
      if (seedTimer) clearTimeout(seedTimer);
      seedTimer = setTimeout(() => {
        if (editor.isDestroyed) return;
        if (config.get('initialContentLoaded') === true) return;
        if (doc.getXmlFragment('default').length > 0) {
          doc.transact(() => {
            config.set('initialContentLoaded', true);
          }, 'seed-mark-loaded');
          return;
        }
        const awarenessIds = Array.from(provider.awareness.getStates().keys());
        const selfId = provider.awareness.clientID;
        if (!awarenessIds.includes(selfId)) awarenessIds.push(selfId);
        const leaderId = awarenessIds.length > 0 ? Math.min(...awarenessIds) : selfId;
        if (selfId !== leaderId) return;
        changeSourceRef.current = 'internal';
        editor.commands.setContent(content, { contentType: 'markdown', emitUpdate: false });
        lastKnownContentRef.current = content;
        refreshDerivedNotebookState(editor);
        doc.transact(() => {
          config.set('initialContentLoaded', true);
        }, 'seed-init');
      }, 280);
    };

    const onProviderSync = (isSynced: boolean) => {
      if (!isSynced) return;
      trySeedInitialContent();
      scheduleDerivedNotebookStateRefresh(editor);
    };
    const onAwarenessChange = () => {
      trySeedInitialContent();
    };
    provider.on('sync', onProviderSync);
    provider.awareness.on('change', onAwarenessChange);
    return () => {
      if (seedTimer) clearTimeout(seedTimer);
      provider.off('sync', onProviderSync);
      provider.awareness.off('change', onAwarenessChange);
    };
  }, [collabSession, content, editor, refreshDerivedNotebookState, scheduleDerivedNotebookStateRefresh]);

  useEffect(() => {
    if (!collabSession || !collabUser.id || !collabUser.name) return;
    const awareness = collabSession.provider.awareness;
    awareness.setLocalStateField('user', {
      id: collabUser.id,
      name: collabUser.name,
      color: collabUser.color,
    });
    const updateUsers = () => {
      const users = Array.from(awareness.getStates().entries())
        .map(([clientId, state]) => {
          const user = (state as any)?.user;
          if (!user?.name) return null;
          return {
            clientId,
            name: String(user.name),
            color: String(user.color || pickCaretColor(String(user.id || user.name))),
          };
        })
        .filter((item): item is { clientId: number; name: string; color: string } => Boolean(item));
      setCollabUsers(users);
    };
    awareness.on('change', updateUsers);
    updateUsers();
    return () => {
      awareness.off('change', updateUsers);
    };
  }, [collabSession, collabUser.color, collabUser.id, collabUser.name]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = Number(window.localStorage.getItem('notebook-dependency-panel-percent') || '');
    if (Number.isFinite(saved) && saved >= 18 && saved <= 75) {
      setDependencyPanelPercent(saved);
    }
  }, []);

  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    const applyLayout = () => {
      if (cancelled) return;
      const editorPanel = editorPanelRef.current;
      const depPanel = dependencyPanelRef.current;
      if (!editorPanel || !depPanel) {
        raf = requestAnimationFrame(applyLayout);
        return;
      }
      applyingPanelResizeRef.current = true;
      if (dependencyGraphOpen) {
        const dep = Math.max(18, Math.min(75, dependencyPanelPercent));
        depPanel.expand();
        editorPanel.resize(`${100 - dep}%`);
        depPanel.resize(`${dep}%`);
      } else {
        editorPanel.resize('100%');
        depPanel.collapse();
      }
      raf = requestAnimationFrame(() => {
        applyingPanelResizeRef.current = false;
      });
    };
    raf = requestAnimationFrame(applyLayout);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [dependencyGraphOpen, dependencyPanelPercent]);

  // tocOpen is controlled by parent menu

  useEffect(() => {
    if (!editor) return;
    const rebuildToc = () => {
      const headings: Array<{ id: string; text: string; level: number; pos: number }> = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') {
          const level = Number(node.attrs.level || 1);
          const text = (node.textContent || '').trim() || `标题 ${headings.length + 1}`;
          headings.push({
            id: `heading-${pos}`,
            text,
            level,
            pos,
          });
        }
        return true;
      });
      setTocItems(headings);

      const cursorPos = editor.state.selection.from;
      let activeId: string | null = headings[0]?.id || null;
      for (const heading of headings) {
        if (cursorPos >= heading.pos) activeId = heading.id;
      }
      setActiveTocId(activeId);
    };

    editor.on('update', rebuildToc);
    editor.on('selectionUpdate', rebuildToc);
    rebuildToc();
    return () => {
      editor.off('update', rebuildToc);
      editor.off('selectionUpdate', rebuildToc);
    };
  }, [editor]);

  const [currentNode, setCurrentNode] = useState<PmNode | null>(null);
  const [currentNodePos, setCurrentNodePos] = useState(-1);

  const handleNodeChange = useCallback(({ node, pos }: { node: PmNode | null; editor: Editor; pos: number }) => {
    setCurrentNode(node);
    setCurrentNodePos(pos);
  }, []);

  const [menuOpen, setMenuOpen] = useState(false);
  const [askAIOpen, setAskAIOpen] = useState(false);
  const [askAIContext, setAskAIContext] = useState('');
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashPos, setSlashPos] = useState<{ top: number; left: number } | null>(null);
  const [slashRange, setSlashRange] = useState<{ from: number; to: number } | null>(null);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [askAITask, setAskAITask] = useState<{ id: string; displayText: string; prompt: string } | null>(null);
  const [askAIInsertRange, setAskAIInsertRange] = useState<{ from: number; to: number } | null>(null);
  const [askAIApplyMode, setAskAIApplyMode] = useState<'insert' | 'optimize'>('insert');
  const [askAIInsertBehavior, setAskAIInsertBehavior] = useState<'replace' | 'appendAfter'>('replace');
  const [askAIOptimizeMeta, setAskAIOptimizeMeta] = useState<{ scope: 'selection' | 'document'; range: { from: number; to: number }; sourceText: string } | null>(null);
  const [translateTarget, setTranslateTarget] = useState<'en' | 'zh' | 'ja' | 'ko'>('en');
  const [bubbleAiMenuOpen, setBubbleAiMenuOpen] = useState(false);
  const [domCodeContext, setDomCodeContext] = useState(false);
  const [bubbleAiMenuPos, setBubbleAiMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [aiSuggestionCount, setAiSuggestionCount] = useState(0);
  const [uploadingImages, setUploadingImages] = useState(0);
  const slashMenuOpenRef = useRef(false);
  const slashRangeRef = useRef<{ from: number; to: number } | null>(null);
  const slashActiveIndexRef = useRef(0);
  const slashMenuRef = useRef<HTMLDivElement | null>(null);
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const bubbleAiMenuRef = useRef<HTMLDivElement | null>(null);
  const bubbleAiTriggerRef = useRef<HTMLButtonElement | null>(null);
  const getEditorScrollContainer = useCallback((): HTMLElement | null => {
    const viewDom = editorRef.current?.view?.dom as HTMLElement | undefined;
    if (!viewDom) return null;
    return viewDom.closest('.notebook-editor-scroll') as HTMLElement | null;
  }, []);

  const getCurrentNodeRange = useCallback(() => {
    if (!editor || currentNodePos < 0 || !currentNode) return;
    const from = currentNodePos;
    const to = from + currentNode.nodeSize;
    return { from, to };
  }, [editor, currentNode, currentNodePos]);

  const insertUploadedImage = useCallback(async (file: File, atPos?: number) => {
    const targetEditor = editorRef.current;
    if (!targetEditor) return;
    setUploadingImages((prev) => prev + 1);
    try {
      const uploaded = await uploadImageFile(file);
      const safeName = uploaded.fileName?.replace(/\]/g, '') || 'image';
      const nodes = [
        {
          type: 'image' as const,
          attrs: {
            src: uploaded.url,
            alt: safeName,
            title: `local-path::${uploaded.absolutePath}`,
          },
        },
        { type: 'paragraph' as const },
      ];
      const chain = targetEditor.chain().focus();
      if (typeof atPos === 'number' && Number.isFinite(atPos)) {
        chain.insertContentAt(atPos, nodes).run();
      } else {
        chain.insertContent(nodes).run();
      }
    } catch (error) {
      console.error('[RichNotebookEditor] 图片上传失败', error);
      toast('error', '图片上传失败');
    } finally {
      setUploadingImages((prev) => Math.max(0, prev - 1));
    }
  }, [toast]);

  const getRangeWithLinkedOutput = useCallback((range: { from: number; to: number }) => {
    if (!editor) return range;
    const node = editor.state.doc.nodeAt(range.from);
    if (!node || node.type.name !== 'notebookCodeBlock') return range;
    const cellId = String(node.attrs.cellId || '');
    const nextNode = editor.state.doc.nodeAt(range.from + node.nodeSize);
    if (cellId && nextNode?.type.name === 'notebookOutput' && String(nextNode.attrs.cellId || '') === cellId) {
      return { from: range.from, to: range.from + node.nodeSize + nextNode.nodeSize };
    }
    return range;
  }, [editor]);

  const handleDeleteNode = useCallback(() => {
    const range = getCurrentNodeRange();
    if (!range || !editor) return;
    const deleteRange = getRangeWithLinkedOutput(range);
    editor.chain().focus().deleteRange(deleteRange).run();
    setMenuOpen(false);
  }, [editor, getCurrentNodeRange, getRangeWithLinkedOutput]);

  const setBlockSelection = useCallback((from: number, to: number) => {
    if (!editor) return;
    const docSize = editor.state.doc.content.size;
    const safeFrom = Math.max(1, Math.min(from + 1, docSize));
    const safeTo = Math.max(safeFrom, Math.min(Math.max(from + 1, to - 1), docSize));
    editor.chain().focus().setTextSelection({ from: safeFrom, to: safeTo }).run();
  }, [editor]);

  const insertTableWithSize = useCallback((rows: number, cols: number) => {
    if (!editor) return;
    const safeRows = Math.max(1, Math.min(12, rows));
    const safeCols = Math.max(1, Math.min(12, cols));
    (editor.chain().focus() as any).insertTable({ rows: safeRows, cols: safeCols, withHeaderRow: true }).run();
  }, [editor]);

  const transformBlock = useCallback((type: 'paragraph' | 'h1' | 'h2' | 'h3' | 'bulletList' | 'orderedList' | 'taskList' | 'blockquote' | 'codeBlock' | 'table') => {
    const range = getCurrentNodeRange();
    if (!range || !editor) return;

    if (type === 'table') {
      insertTableWithSize(3, 3);
      setMenuOpen(false);
      return;
    }

    if (type === 'codeBlock') {
      const blockText = editor.state.doc.textBetween(range.from, range.to, '\n').trim();
      editor.chain().focus().deleteRange(range).insertContentAt(range.from, {
        type: 'notebookCodeBlock',
        attrs: {
          language: 'cangjie',
          cellId: createNotebookCellId(),
        },
        content: blockText ? [{ type: 'text', text: blockText }] : [],
      }).run();
      setMenuOpen(false);
      return;
    }

    setBlockSelection(range.from, range.to);
    const chain = editor.chain().focus();
    if (type === 'paragraph') chain.clearNodes();
    if (type === 'h1') chain.toggleHeading({ level: 1 });
    if (type === 'h2') chain.toggleHeading({ level: 2 });
    if (type === 'h3') chain.toggleHeading({ level: 3 });
    if (type === 'bulletList') chain.toggleBulletList();
    if (type === 'orderedList') chain.toggleOrderedList();
    if (type === 'taskList') (chain as any).toggleTaskList();
    if (type === 'blockquote') chain.toggleBlockquote();
    chain.run();
    setMenuOpen(false);
  }, [editor, getCurrentNodeRange, insertTableWithSize, setBlockSelection]);

  const handleCopyNode = useCallback(async () => {
    const range = getCurrentNodeRange();
    if (!range || !editor) return;
    const text = editor.state.doc.textBetween(range.from, range.to, '\n\n');
    await copyText(text);
    setMenuOpen(false);
  }, [editor, getCurrentNodeRange]);

  const handleDuplicateNode = useCallback(() => {
    const range = getCurrentNodeRange();
    if (!range || !editor) return;
    const node = editor.state.doc.nodeAt(range.from);
    const nodeJson = node?.toJSON();
    if (!nodeJson) return;
    if (node?.type.name === 'notebookCodeBlock') {
      const oldId = String((nodeJson.attrs as any)?.cellId || '');
      const oldDependsOn = Array.isArray((nodeJson.attrs as any)?.dependsOn) ? ((nodeJson.attrs as any).dependsOn as string[]) : [];
      (nodeJson.attrs as any) = {
        ...(nodeJson.attrs || {}),
        cellId: createNotebookCellId(),
        dependsOn: oldDependsOn.filter((id) => id && id !== oldId),
      };
    }
    const insertRange = getRangeWithLinkedOutput(range);
    editor.chain().focus().insertContentAt(insertRange.to, nodeJson).run();
    setMenuOpen(false);
  }, [editor, getCurrentNodeRange, getRangeWithLinkedOutput]);

  const handleAskAI = useCallback(() => {
    if (!editor) return;
    const { selection } = editor.state;
    let targetRange: { from: number; to: number } | null = null;
    let contextText = '';

    if (!selection.empty) {
      const selectedText = editor.state.doc.textBetween(selection.from, selection.to, '\n\n').trim();
      if (selectedText) {
        targetRange = { from: selection.from, to: selection.to };
        contextText = selectedText;
      }
    }

    if (!contextText) {
      const range = getCurrentNodeRange();
      if (range) {
        const node = editor.state.doc.nodeAt(range.from);
        if (node) {
          contextText = editor.markdown?.serialize(node.toJSON())?.trim() || '';
          if (contextText) {
            targetRange = range;
          }
        }
      }
    }

    if (!contextText) {
      toast('warning', '请先选中内容，或将光标置于一个块内');
      return;
    }

    setAskAIApplyMode('insert');
    setAskAIInsertBehavior('replace');
    setAskAIOptimizeMeta(null);
    setAskAIContext(contextText);
    setAskAITask(null);
    setAskAIInsertRange(targetRange);
    setAskAIOpen(true);
    setMenuOpen(false);
  }, [editor, getCurrentNodeRange, toast]);

  const handleAskAIFromSelection = useCallback(() => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      toast('warning', '请先选中文本');
      return;
    }
    const contextText = editor.state.doc.textBetween(from, to, '\n\n').trim();
    if (!contextText) {
      toast('warning', '选中内容为空');
      return;
    }
    setAskAIApplyMode('insert');
    setAskAIInsertBehavior('replace');
    setAskAIOptimizeMeta(null);
    setAskAIContext(contextText);
    setAskAITask(null);
    setAskAIInsertRange({ from, to });
    setAskAIOpen(true);
  }, [editor, toast]);

  const getSelectionText = useCallback(() => {
    if (!editor) return null as { range: { from: number; to: number }; text: string } | null;
    const { from, to, empty } = editor.state.selection;
    if (empty) return null;
    const textBetween = editor.state.doc.textBetween(from, to, '\n\n').trim();
    const serialized = editor.markdown?.serialize({
      type: 'doc',
      content: editor.state.doc.slice(from, to).content.toJSON(),
    })?.trim() || '';
    const text = textBetween || serialized;
    if (!text) return null;
    return { range: { from, to }, text };
  }, [editor]);

  const getCodeTarget = useCallback(() => {
    const selected = getSelectionText();
    if (selected) return selected;
    const range = getCurrentNodeRange();
    if (!range || !editor) return null;
    const node = editor.state.doc.nodeAt(range.from);
    if (!node || node.type.name !== 'notebookCodeBlock') return null;
    const text = (node.textContent || '').trim();
    if (!text) return null;
    return { range, text };
  }, [editor, getCurrentNodeRange, getSelectionText]);

  const openCodeAiTask = useCallback((actionName: string, instruction: string, replaceSelection = false) => {
    const target = getCodeTarget();
    if (!target) {
      toast('warning', '请先选中代码块或将光标置于代码块中');
      return;
    }

    const prompt = [
      '你是 Cangjie Notebook 的代码助手。',
      `任务：${actionName}`,
      '',
      '执行要求：',
      instruction,
      '',
      '请直接输出结果，不要添加与任务无关的前后缀。',
      '',
      '待处理代码：',
      target.text,
    ].join('\n');

    setAskAIApplyMode('insert');
    setAskAIInsertBehavior('replace');
    setAskAIOptimizeMeta(null);
    setAskAIContext(target.text);
    setAskAIInsertRange(replaceSelection ? target.range : null);
    setAskAITask({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      displayText: `${actionName}（自动任务）`,
      prompt,
    });
    setAskAIOpen(true);
    setMenuOpen(false);
  }, [getCodeTarget, toast]);

  const getCurrentNodeText = useCallback(() => {
    const range = getCurrentNodeRange();
    if (!range || !editor) return null;
    const node = editor.state.doc.nodeAt(range.from);
    const textBetween = editor.state.doc.textBetween(range.from, range.to, '\n\n').trim();
    const serialized = node ? (editor.markdown?.serialize(node.toJSON())?.trim() || '') : '';
    const text = textBetween || serialized;
    if (!text) return null;
    return { range, text };
  }, [editor, getCurrentNodeRange]);

  const openAiActionDialog = useCallback((actionName: string, instruction: string) => {
    const target = getSelectionText() || getCurrentNodeText();
    if (!target) {
      toast('warning', '请先选中要处理的内容，或将光标置于一个块内');
      return;
    }
    const prompt = [
      '你是 Cangjie Notebook 的文本改写助手。',
      `任务：${actionName}`,
      '',
      '执行要求：',
      instruction,
      '',
      '关键约束：务必直接返回改进后的内容，不要解释，不要加标题，不要加前后缀。',
      '输出格式要求：必须严格使用下面格式，不得输出其他任何文字：',
      '<result>',
      '改进后的内容',
      '</result>',
      '',
      '待处理文本：',
      target.text,
    ].join('\n');

    setAskAIApplyMode('insert');
    setAskAIInsertBehavior(actionName === '总结内容' ? 'appendAfter' : 'replace');
    setAskAIOptimizeMeta(null);
    setAskAIContext(target.text);
    setAskAIInsertRange(target.range);
    setAskAITask({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      displayText: `${actionName}（自动任务）`,
      prompt,
    });
    setAskAIOpen(true);
    setMenuOpen(false);
  }, [getCurrentNodeText, getSelectionText, toast]);

  const openAiOptimizeTask = useCallback((scope: 'selection' | 'document') => {
    if (!editor) return;
    if (scope === 'selection') {
      const selected = getSelectionText();
      const blockRange = getCurrentNodeRange();
      const blockNode = blockRange ? editor.state.doc.nodeAt(blockRange.from) : null;
      const isCodeBlockTarget = blockNode?.type.name === 'notebookCodeBlock';
      const fallbackRange = blockRange
        ? (isCodeBlockTarget
          ? { from: blockRange.from + 1, to: Math.max(blockRange.from + 1, blockRange.to - 1) }
          : blockRange)
        : null;
      const fallbackText = isCodeBlockTarget
        ? (blockNode?.textContent || '').trim()
        : (fallbackRange ? editor.state.doc.textBetween(fallbackRange.from, fallbackRange.to, '\n\n').trim() : '');

      const targetRange = selected?.range || fallbackRange;
      const targetText = selected?.text || fallbackText;
      if (!targetRange || !targetText) {
        toast('warning', '请先选中要优化的内容，或将光标放在要优化的块内');
        return;
      }

      const prompt = [
        isCodeBlockTarget
          ? '你是 Cangjie Notebook 的代码优化助手。'
          : '你是 Cangjie Notebook 的编辑优化助手。',
        isCodeBlockTarget
          ? '请在不改变业务逻辑与输出行为的前提下优化代码：提高可读性、可维护性与性能（若可行）。'
          : '请在不改变事实和技术含义的前提下优化文本表达：提高清晰度、结构性、可读性，保留 Markdown 结构。',
        isCodeBlockTarget
          ? '禁止改变功能语义，禁止添加与任务无关内容。'
          : '禁止添加编造信息，禁止输出解释。',
        '如果无需改动，请原样返回。',
        '',
        '输出格式要求：只允许输出下面格式，不要输出其它任何内容：',
        '<result>',
        isCodeBlockTarget ? '优化后的完整代码' : '优化后的内容',
        '</result>',
        '',
        isCodeBlockTarget ? '待优化代码：' : '待优化内容：',
        targetText,
      ].join('\n');
      setAskAIApplyMode('optimize');
      setAskAIInsertBehavior('replace');
      setAskAIOptimizeMeta({ scope: 'selection', range: targetRange, sourceText: targetText });
      setAskAIContext(targetText);
      setAskAIInsertRange(targetRange);
      setAskAITask({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        displayText: isCodeBlockTarget ? 'AI优化（当前代码块）' : 'AI优化（选中/当前块）',
        prompt,
      });
      setAskAIOpen(true);
      setMenuOpen(false);
      return;
    }

    const sourceText = editor.getMarkdown().trim();
    if (!sourceText) {
      toast('warning', '全文为空，暂无可优化内容');
      return;
    }
    const docTo = Math.max(1, editor.state.doc.content.size - 1);
    const prompt = [
      '你是 Cangjie Notebook 的编辑优化助手。',
      '请在不改变事实和技术含义的前提下优化全文表达：提高清晰度、结构性、可读性，保留 Markdown 结构。',
      '禁止添加编造信息，禁止输出解释。',
      '如果无需改动，请原样返回。',
      '',
      '输出格式要求：只允许输出下面格式，不要输出其它任何内容：',
      '<result>',
      '优化后的内容',
      '</result>',
      '',
      '待优化全文：',
      sourceText,
    ].join('\n');
    setAskAIApplyMode('optimize');
    setAskAIInsertBehavior('replace');
    setAskAIOptimizeMeta({ scope: 'document', range: { from: 1, to: docTo }, sourceText });
    setAskAIContext(sourceText.length > 5000 ? `${sourceText.slice(0, 5000)}\n\n...（全文较长，已截断预览）` : sourceText);
    setAskAIInsertRange({ from: 1, to: docTo });
    setAskAITask({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      displayText: 'AI优化（全文）',
      prompt,
    });
    setAskAIOpen(true);
    setMenuOpen(false);
  }, [editor, getCurrentNodeRange, getSelectionText, toast]);

  const buildTrackedSuggestionCount = useCallback((sourceText: string, optimizedText: string) => {
    const draftCore = buildAiOptimizationDraft(sourceText, optimizedText);
    if (draftCore.items.length === 0) return { count: 0, nodes: null as any };
    return { count: draftCore.items.length, nodes: buildAiSuggestionNodes(draftCore) };
  }, []);

  const insertAiResultBack = useCallback((result: string) => {
    if (!editor) return;
    const text = result.trim();
    if (!text) {
      toast('warning', 'AI 返回内容为空');
      return;
    }

    if (askAIApplyMode === 'optimize' && askAIOptimizeMeta) {
      const sourceText = askAIOptimizeMeta.sourceText.trim();
      if (!sourceText) {
        toast('warning', '缺少原始文本，无法生成建议');
        return;
      }
      if (text === sourceText) {
        toast('info', 'AI 认为无需优化');
        setAskAIOpen(false);
        return;
      }
      const tracked = buildTrackedSuggestionCount(sourceText, text);
      if (tracked.count === 0 || !tracked.nodes) {
        toast('info', '未检测到可审阅的差异');
        setAskAIOpen(false);
        return;
      }
      if (askAIOptimizeMeta.scope === 'document') {
        editor.commands.setContent(tracked.nodes);
      } else {
        editor
          .chain()
          .focus()
          .deleteRange(askAIOptimizeMeta.range)
          .setTextSelection(askAIOptimizeMeta.range.from)
          .insertContent(tracked.nodes)
          .run();
      }
      setAskAIOpen(false);
      toast('success', `已生成 ${tracked.count} 条可接受/拒绝建议`);
      return;
    }

    if (askAIInsertRange) {
      if (askAIInsertBehavior === 'appendAfter') {
        editor
          .chain()
          .focus()
          .setTextSelection(askAIInsertRange.to)
          .insertContent({
            type: 'notebookAiSuggestion',
            attrs: {
              original: '',
              optimized: text,
            },
          })
          .run();
        setAskAIOpen(false);
        toast('success', '已生成 1 条可接受/拒绝建议');
        return;
      }

      const sourceTextBetween = editor.state.doc.textBetween(askAIInsertRange.from, askAIInsertRange.to, '\n\n').trim();
      const sourceSerialized = editor.markdown?.serialize({
        type: 'doc',
        content: editor.state.doc.slice(askAIInsertRange.from, askAIInsertRange.to).content.toJSON(),
      })?.trim() || '';
      const sourceText = sourceTextBetween || sourceSerialized;
      const tracked = buildTrackedSuggestionCount(sourceText, text);
      if (tracked.count === 0 || !tracked.nodes) {
        toast('info', '未检测到可审阅的差异');
        setAskAIOpen(false);
        return;
      }
      editor
        .chain()
        .focus()
        .deleteRange(askAIInsertRange)
        .setTextSelection(askAIInsertRange.from)
        .insertContent(tracked.nodes)
        .run();
      setAskAIOpen(false);
      toast('success', `已生成 ${tracked.count} 条可接受/拒绝建议`);
      return;
    }

    editor
      .chain()
      .focus()
      .insertContent({
        type: 'notebookAiSuggestion',
        attrs: {
          original: '',
          optimized: text,
        },
      })
      .run();
    setAskAIOpen(false);
    toast('success', '已生成 1 条可接受/拒绝建议');
  }, [askAIApplyMode, askAIInsertBehavior, askAIInsertRange, askAIOptimizeMeta, buildTrackedSuggestionCount, editor, toast]);

  const translateTargetLabel = translateTarget === 'en'
    ? '英语'
    : translateTarget === 'zh'
      ? '中文'
      : translateTarget === 'ja'
        ? '日语'
        : '韩语';
  const translateInstruction = translateTarget === 'en'
    ? '将文本完整翻译为英语。只输出英文译文，不要附加中文、解释或注释。'
    : translateTarget === 'zh'
      ? '将文本完整翻译为中文。只输出中文译文，不要附加其他语言、解释或注释。'
      : translateTarget === 'ja'
        ? '将文本完整翻译为日语。只输出日语译文，不要附加其他语言、解释或注释。'
        : '将文本完整翻译为韩语。只输出韩语译文，不要附加其他语言、解释或注释。';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem('notebook-translate-target');
    if (saved === 'en' || saved === 'zh' || saved === 'ja' || saved === 'ko') {
      setTranslateTarget(saved);
    }
  }, []);

  useEffect(() => {
    if (!bubbleAiMenuOpen) return;
    const onDocDown = (event: MouseEvent) => {
      const target = event.target as globalThis.Node | null;
      if (!bubbleAiMenuRef.current || (target && bubbleAiMenuRef.current.contains(target))) return;
      setBubbleAiMenuOpen(false);
    };
    const recalcPosition = () => {
      const trigger = bubbleAiTriggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const menuWidth = 256;
      const menuHeight = 260;
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const left = Math.max(margin, Math.min(rect.left, vw - menuWidth - margin));
      const preferAbove = rect.bottom + menuHeight + margin > vh && rect.top - menuHeight - margin > margin;
      const top = preferAbove
        ? Math.max(margin, rect.top - menuHeight - 6)
        : Math.min(rect.bottom + 6, vh - menuHeight - margin);
      setBubbleAiMenuPos({ top, left });
    };
    recalcPosition();
    window.addEventListener('mousedown', onDocDown, true);
    window.addEventListener('resize', recalcPosition, true);
    window.addEventListener('scroll', recalcPosition, true);
    const scroller = getEditorScrollContainer();
    if (scroller) scroller.addEventListener('scroll', recalcPosition, true);
    return () => {
      window.removeEventListener('mousedown', onDocDown, true);
      window.removeEventListener('resize', recalcPosition, true);
      window.removeEventListener('scroll', recalcPosition, true);
      if (scroller) scroller.removeEventListener('scroll', recalcPosition, true);
    };
  }, [bubbleAiMenuOpen, getEditorScrollContainer]);

  useEffect(() => {
    if (!inlineMathEditOpen || inlineMathEditPos === null) return;
    const recalc = () => {
      const targetEditor = editorRef.current;
      if (!targetEditor) return;
      const dom = targetEditor.view.nodeDOM(inlineMathEditPos) as HTMLElement | null;
      if (!dom) return;
      const rect = dom.getBoundingClientRect();
      setInlineMathEditAnchor({
        left: Math.max(16, Math.min(window.innerWidth - 16, rect.left + rect.width / 2)),
        top: Math.max(16, Math.min(window.innerHeight - 16, rect.bottom + 6)),
      });
    };
    recalc();
    window.addEventListener('resize', recalc, true);
    window.addEventListener('scroll', recalc, true);
    const scroller = getEditorScrollContainer();
    if (scroller) scroller.addEventListener('scroll', recalc, true);
    return () => {
      window.removeEventListener('resize', recalc, true);
      window.removeEventListener('scroll', recalc, true);
      if (scroller) scroller.removeEventListener('scroll', recalc, true);
    };
  }, [getEditorScrollContainer, inlineMathEditOpen, inlineMathEditPos]);

  useEffect(() => {
    if (!linkEditorOpen || !linkEditRange) return;
    const recalc = () => {
      const targetEditor = editorRef.current;
      if (!targetEditor) return;
      setLinkEditorAnchor(getSelectionAnchor(targetEditor, linkEditRange));
    };
    recalc();
    window.addEventListener('resize', recalc, true);
    window.addEventListener('scroll', recalc, true);
    const scroller = getEditorScrollContainer();
    if (scroller) scroller.addEventListener('scroll', recalc, true);
    return () => {
      window.removeEventListener('resize', recalc, true);
      window.removeEventListener('scroll', recalc, true);
      if (scroller) scroller.removeEventListener('scroll', recalc, true);
    };
  }, [getEditorScrollContainer, getSelectionAnchor, linkEditorOpen, linkEditRange]);

  useEffect(() => {
    if (!imageEditorOpen || imageEditorPos === null) return;
    const recalc = () => {
      const targetEditor = editorRef.current;
      if (!targetEditor) return;
      const dom = targetEditor.view.nodeDOM(imageEditorPos) as HTMLElement | null;
      if (!dom) return;
      const rect = dom.getBoundingClientRect();
      setImageEditorAnchor({
        left: Math.max(16, Math.min(window.innerWidth - 16, rect.left + rect.width / 2)),
        top: Math.max(16, Math.min(window.innerHeight - 16, rect.bottom + 6)),
      });
    };
    recalc();
    window.addEventListener('resize', recalc, true);
    window.addEventListener('scroll', recalc, true);
    const scroller = getEditorScrollContainer();
    if (scroller) scroller.addEventListener('scroll', recalc, true);
    return () => {
      window.removeEventListener('resize', recalc, true);
      window.removeEventListener('scroll', recalc, true);
      if (scroller) scroller.removeEventListener('scroll', recalc, true);
    };
  }, [getEditorScrollContainer, imageEditorOpen, imageEditorPos]);

  useEffect(() => {
    const scroller = getEditorScrollContainer();
    if (!scroller) return;
    const onScroll = () => {
      window.dispatchEvent(new Event('scroll'));
    };
    scroller.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll, true);
    };
  }, [getEditorScrollContainer]);

  const setTranslateTargetAndPersist = useCallback((target: 'en' | 'zh' | 'ja' | 'ko') => {
    setTranslateTarget(target);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('notebook-translate-target', target);
    }
    const label = target === 'en' ? '英语' : target === 'zh' ? '中文' : target === 'ja' ? '日语' : '韩语';
    toast('info', `翻译目标已切换为${label}`);
  }, [toast]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const checkDomCodeContext = () => {
      const sel = window.getSelection();
      const anchor = sel?.anchorNode || null;
      const anchorEl = anchor instanceof Element ? anchor : anchor?.parentElement || null;
      const activeEl = document.activeElement instanceof Element ? document.activeElement : null;
      const inCode = Boolean(
        anchorEl?.closest('.notebook-code-node') ||
        activeEl?.closest('.notebook-code-node'),
      );
      setDomCodeContext(inCode);
    };
    document.addEventListener('selectionchange', checkDomCodeContext, true);
    window.addEventListener('focusin', checkDomCodeContext, true);
    window.addEventListener('click', checkDomCodeContext, true);
    checkDomCodeContext();
    return () => {
      document.removeEventListener('selectionchange', checkDomCodeContext, true);
      window.removeEventListener('focusin', checkDomCodeContext, true);
      window.removeEventListener('click', checkDomCodeContext, true);
    };
  }, []);

  const isSelectionInCodeBlock = editor ? editor.state.selection.$from.parent.type.name === 'notebookCodeBlock' : false;
  const isCodeContext = editor ? (editor.isActive('notebookCodeBlock') || editor.isActive('codeBlock') || isSelectionInCodeBlock) : false;
  const isCodeNodeContext = currentNode?.type.name === 'notebookCodeBlock';
  const isOutputNodeContext = currentNode?.type.name === 'notebookOutput';
  const isTableContext = editor ? (editor.isActive('table') || editor.isActive('tableRow') || editor.isActive('tableCell') || editor.isActive('tableHeader')) : false;
  const isImageContext = editor ? editor.isActive('image') : false;
  const hasTextSelection = editor ? !editor.state.selection.empty : false;
  const isCodeSelectionMode = isCodeContext || isCodeNodeContext || domCodeContext;
  const showContextToolbar = editor ? editor.isFocused : false;
  const linkPopoverOpen = linkEditorOpen && Boolean(linkEditorAnchor);
  const imagePopoverOpen = imageEditorOpen && Boolean(imageEditorAnchor);
  const inlineMathPopoverOpen = inlineMathEditOpen && Boolean(inlineMathEditAnchor);

  useEffect(() => {
    if (!isOutputNodeContext) return;
    if (menuOpen) setMenuOpen(false);
    if (bubbleAiMenuOpen) setBubbleAiMenuOpen(false);
  }, [bubbleAiMenuOpen, isOutputNodeContext, menuOpen]);

  const renderAiActionMenu = (dense = false, inBubble = false) => {
    if (inBubble) {
      const commonBtn = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent';
      return (
        <div className="relative" ref={bubbleAiMenuRef}>
          <button
            type="button"
            ref={bubbleAiTriggerRef}
            className={`rounded px-2 py-1 hover:bg-accent ${dense ? 'text-xs' : 'text-sm'}`}
            title="AI 助手"
            onMouseDown={(event) => {
              event.preventDefault();
              setBubbleAiMenuOpen((v) => !v);
            }}
          >
            <span className="material-symbols-outlined text-base">smart_toy</span>
          </button>
          {bubbleAiMenuOpen && bubbleAiMenuPos && (
            <div
              className="fixed z-[220] w-64 rounded-md border bg-popover p-1 shadow-xl"
              style={{ top: bubbleAiMenuPos.top, left: bubbleAiMenuPos.left }}
            >
              {isCodeSelectionMode ? (
                <>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">代码块 AI</div>
                  <button type="button" className={commonBtn} onClick={() => { handleAskAIFromSelection(); setBubbleAiMenuOpen(false); }}>
                    <span className="material-symbols-outlined text-base">forum</span>
                    问AI
                  </button>
                  <button type="button" className={commonBtn} onClick={() => { openCodeAiTask('解释代码', '解释代码的功能、关键逻辑、输入输出与注意事项，使用简洁分点。'); setBubbleAiMenuOpen(false); }}>
                    <span className="material-symbols-outlined text-base">help</span>
                    解释代码
                  </button>
                  <button type="button" className={commonBtn} onClick={() => { openCodeAiTask('AI检视', '对代码做检视，指出潜在 bug、风险、可维护性和性能问题，并给出改进建议。'); setBubbleAiMenuOpen(false); }}>
                    <span className="material-symbols-outlined text-base">fact_check</span>
                    AI检视
                  </button>
                  <button type="button" className={commonBtn} onClick={() => { openAiOptimizeTask('selection'); setBubbleAiMenuOpen(false); }}>
                    <span className="material-symbols-outlined text-base">auto_fix_high</span>
                    AI优化（选中）
                  </button>
                  <button type="button" className={commonBtn} onClick={() => { openAiOptimizeTask('document'); setBubbleAiMenuOpen(false); }}>
                    <span className="material-symbols-outlined text-base">dataset</span>
                    AI优化（全文）
                  </button>
                  <button type="button" className={commonBtn} onClick={() => { openCodeAiTask('添加注释', '在不改变代码行为的前提下，为代码添加必要且精炼的注释，返回完整代码。', true); setBubbleAiMenuOpen(false); }}>
                    <span className="material-symbols-outlined text-base">add_comment</span>
                    添加注释
                  </button>
                </>
              ) : (
                <>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">通用 AI</div>
                  <button type="button" className={commonBtn} onClick={() => { handleAskAI(); setBubbleAiMenuOpen(false); }}>
                    <span className="material-symbols-outlined text-base">forum</span>
                    问 AI
                  </button>
                  <button type="button" className={commonBtn} onClick={() => { openAiActionDialog('总结内容', '提炼核心观点，输出简洁摘要。'); setBubbleAiMenuOpen(false); }}>
                    <span className="material-symbols-outlined text-base">summarize</span>
                    总结内容
                  </button>
                  <button type="button" className={commonBtn} onClick={() => { openAiOptimizeTask('selection'); setBubbleAiMenuOpen(false); }}>
                    <span className="material-symbols-outlined text-base">auto_fix_high</span>
                    AI优化（选中）
                  </button>
                  <button type="button" className={commonBtn} onClick={() => { openAiOptimizeTask('document'); setBubbleAiMenuOpen(false); }}>
                    <span className="material-symbols-outlined text-base">dataset</span>
                    AI优化（全文）
                  </button>
                  <button type="button" className={commonBtn} onClick={() => { openAiActionDialog('翻译文本', translateInstruction); setBubbleAiMenuOpen(false); }}>
                    <span className="material-symbols-outlined text-base">translate</span>
                    翻译文本（{translateTargetLabel}）
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      );
    }
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`rounded px-2 py-1 hover:bg-accent ${dense ? 'text-xs' : 'text-sm'}`}
            title="AI 助手"
          >
            <span className="material-symbols-outlined text-base">smart_toy</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start" className="w-64 z-[86]">
          {isCodeSelectionMode ? (
            <>
              <DropdownMenuLabel>代码块 AI</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => handleAskAIFromSelection()}>
                <span className="material-symbols-outlined mr-2 text-base">forum</span>
                问AI
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { openCodeAiTask('解释代码', '解释代码的功能、关键逻辑、输入输出与注意事项，使用简洁分点。'); }}>
                <span className="material-symbols-outlined mr-2 text-base">help</span>
                解释代码
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { openCodeAiTask('AI检视', '对代码做检视，指出潜在 bug、风险、可维护性和性能问题，并给出改进建议。'); }}>
                <span className="material-symbols-outlined mr-2 text-base">fact_check</span>
                AI检视
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { openAiOptimizeTask('selection'); }}>
                <span className="material-symbols-outlined mr-2 text-base">auto_fix_high</span>
                AI优化（选中）
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { openAiOptimizeTask('document'); }}>
                <span className="material-symbols-outlined mr-2 text-base">dataset</span>
                AI优化（全文）
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { openCodeAiTask('添加注释', '在不改变代码行为的前提下，为代码添加必要且精炼的注释，返回完整代码。', true); }}>
                <span className="material-symbols-outlined mr-2 text-base">add_comment</span>
                添加注释
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuLabel>通用</DropdownMenuLabel>
              <DropdownMenuItem onClick={handleAskAI}>
                <span className="material-symbols-outlined mr-2 text-base">forum</span>
                问 AI
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>文本增强</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => { openAiActionDialog('修正拼写和语法', '修正拼写、标点和语法错误，保持原意与结构。'); }}>
                <span className="material-symbols-outlined mr-2 text-base">spellcheck</span>
                修正拼写和语法
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { openAiActionDialog('扩展文本', '在不偏离主题的前提下扩展内容，增加细节和上下文。'); }}>
                <span className="material-symbols-outlined mr-2 text-base">expand_content</span>
                扩展文本
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { openAiActionDialog('精简文本', '压缩篇幅，保留核心信息，去除冗余表达。'); }}>
                <span className="material-symbols-outlined mr-2 text-base">compress</span>
                精简文本
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { openAiActionDialog('简化表达', '改写为更清晰易懂的表达，降低阅读门槛。'); }}>
                <span className="material-symbols-outlined mr-2 text-base">text_fields</span>
                简化表达
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { openAiActionDialog('添加 Emoji', '在合适位置加入少量相关 emoji，保持专业和可读性。'); }}>
                <span className="material-symbols-outlined mr-2 text-base">mood</span>
                添加 Emoji
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>内容操作</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => { openAiActionDialog('补全句子', '补全不完整句子并确保语义连贯自然。'); }}>
                <span className="material-symbols-outlined mr-2 text-base">format_list_bulleted_add</span>
                补全句子
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { openAiActionDialog('总结内容', '提炼核心观点，输出简洁摘要。'); }}>
                <span className="material-symbols-outlined mr-2 text-base">summarize</span>
                总结内容
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { openAiOptimizeTask('selection'); }}>
                <span className="material-symbols-outlined mr-2 text-base">auto_fix_high</span>
                AI优化（选中）
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { openAiOptimizeTask('document'); }}>
                <span className="material-symbols-outlined mr-2 text-base">dataset</span>
                AI优化（全文）
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>高级选项</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => { openAiActionDialog('调整语气', '改写为专业、友好且清晰的语气，不改变事实。'); }}>
                <span className="material-symbols-outlined mr-2 text-base">tune</span>
                调整语气
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { openAiActionDialog('翻译文本', translateInstruction); }}>
                <span className="material-symbols-outlined mr-2 text-base">translate</span>
                翻译文本（{translateTargetLabel}）
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const handleJumpToHeading = useCallback((pos: number, id: string) => {
    if (!editor) return;
    editor.chain().focus().setTextSelection(Math.max(1, pos + 1)).scrollIntoView().run();
    setActiveTocId(id);
  }, [editor]);

  const handleJumpToCodeBlock = useCallback((pos: number) => {
    if (!editor) return;
    editor.chain().focus().setTextSelection(Math.max(1, pos + 1)).scrollIntoView().run();
  }, [editor]);

  const toolbarDisabled = !showContextToolbar;

  const slashMenuItems = useMemo<SlashMenuItem[]>(() => {
    const openAIFromSlash = (targetEditor: Editor) => {
      const target = getCurrentNodeText();
      const text = target?.text || '';
      setAskAIContext(text);
      setAskAITask(null);
      setAskAIInsertRange(target?.range || null);
      setAskAIOpen(true);
    };

    return [
      {
        id: 'text',
        title: '正文',
        subtext: '普通段落文本',
        aliases: ['paragraph', 'text'],
        icon: 'notes',
        group: '格式',
        onSelect: (targetEditor) => {
          targetEditor.chain().focus().clearNodes().run();
        },
      },
      {
        id: 'heading_1',
        title: '标题 1',
        subtext: '一级标题',
        aliases: ['h1', 'heading'],
        icon: 'title',
        group: '格式',
        onSelect: (targetEditor) => {
          targetEditor.chain().focus().toggleHeading({ level: 1 }).run();
        },
      },
      {
        id: 'heading_2',
        title: '标题 2',
        subtext: '二级标题',
        aliases: ['h2', 'heading'],
        icon: 'title',
        group: '格式',
        onSelect: (targetEditor) => {
          targetEditor.chain().focus().toggleHeading({ level: 2 }).run();
        },
      },
      {
        id: 'heading_3',
        title: '标题 3',
        subtext: '三级标题',
        aliases: ['h3', 'heading'],
        icon: 'title',
        group: '格式',
        onSelect: (targetEditor) => {
          targetEditor.chain().focus().toggleHeading({ level: 3 }).run();
        },
      },
      {
        id: 'bullet_list',
        title: '无序列表',
        subtext: '创建项目符号列表',
        aliases: ['ul', 'list', 'bullet'],
        icon: 'format_list_bulleted',
        group: '列表',
        onSelect: (targetEditor) => {
          targetEditor.chain().focus().toggleBulletList().run();
        },
      },
      {
        id: 'ordered_list',
        title: '有序列表',
        subtext: '创建编号列表',
        aliases: ['ol', 'list', 'ordered'],
        icon: 'format_list_numbered',
        group: '列表',
        onSelect: (targetEditor) => {
          targetEditor.chain().focus().toggleOrderedList().run();
        },
      },
      {
        id: 'task_list',
        title: '任务列表',
        subtext: '创建待办事项',
        aliases: ['todo', 'task', 'checklist'],
        icon: 'checklist',
        group: '列表',
        onSelect: (targetEditor) => {
          (targetEditor.chain().focus() as any).toggleTaskList().run();
        },
      },
      {
        id: 'quote',
        title: '引用',
        subtext: '插入引用块',
        aliases: ['blockquote', 'quote'],
        icon: 'format_quote',
        group: '块',
        onSelect: (targetEditor) => {
          targetEditor.chain().focus().toggleBlockquote().run();
        },
      },
      {
        id: 'code_block',
        title: '代码块',
        subtext: '插入代码块',
        aliases: ['code', 'snippet'],
        icon: 'code',
        group: '块',
        onSelect: (targetEditor) => {
          targetEditor.chain().focus().insertContent({
            type: 'notebookCodeBlock',
            attrs: {
              language: 'cangjie',
              cellId: createNotebookCellId(),
            },
          }).run();
        },
      },
      {
        id: 'horizontal_rule',
        title: '分割线',
        subtext: '插入水平分割线',
        aliases: ['hr', 'divider', 'line'],
        icon: 'horizontal_rule',
        group: '块',
        onSelect: (targetEditor) => {
          targetEditor.chain().focus().setHorizontalRule().run();
        },
      },
      {
        id: 'table',
        title: '表格',
        subtext: '插入 3x3 表格',
        aliases: ['table', 'grid'],
        icon: 'table_chart',
        group: '块',
        onSelect: (targetEditor) => {
          (targetEditor.chain().focus() as any).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        },
      },
      {
        id: 'inline_math',
        title: '行内公式',
        subtext: '插入行内 LaTeX 公式',
        aliases: ['math', 'latex', 'equation', 'inline'],
        icon: 'functions',
        group: '块',
        onSelect: (targetEditor) => {
          (targetEditor.chain().focus() as any).insertInlineMath({ latex: 'a^2+b^2=c^2' }).run();
        },
      },
      {
        id: 'block_math',
        title: '块级公式',
        subtext: '插入独立展示的 LaTeX 公式块',
        aliases: ['math block', 'latex block', 'equation block'],
        icon: 'calculate',
        group: '块',
        onSelect: (targetEditor) => {
          (targetEditor.chain().focus() as any).insertBlockMath({ latex: '\\frac{a}{b}' }).run();
        },
      },
      {
        id: 'ask_ai',
        title: '问 AI',
        subtext: '打开 Notebook AI 助手',
        aliases: ['ai', 'ask'],
        icon: 'smart_toy',
        group: 'AI 助手',
        onSelect: openAIFromSlash,
      },
      {
        id: 'fix_spelling_grammar',
        title: '修正拼写和语法',
        subtext: '自动修复拼写与语法错误',
        aliases: ['grammar', 'spelling', 'fix'],
        icon: 'spellcheck',
        group: 'AI 助手',
        onSelect: () => { openAiActionDialog('修正拼写和语法', '修正拼写、标点和语法错误，保持原意与结构。'); },
      },
      {
        id: 'extend_text',
        title: '扩展文本',
        subtext: '补充相关信息并展开内容',
        aliases: ['extend', 'expand', 'more'],
        icon: 'expand_content',
        group: 'AI 助手',
        onSelect: () => { openAiActionDialog('扩展文本', '在不偏离主题的前提下扩展内容，增加细节和上下文。'); },
      },
      {
        id: 'reduce_text',
        title: '精简文本',
        subtext: '缩短文本并保留核心含义',
        aliases: ['shorten', 'reduce', 'brief'],
        icon: 'compress',
        group: 'AI 助手',
        onSelect: () => { openAiActionDialog('精简文本', '压缩篇幅，保留核心信息，去除冗余表达。'); },
      },
      {
        id: 'simplify_text',
        title: '简化表达',
        subtext: '让复杂文本更易读',
        aliases: ['simplify', 'readable', 'easy'],
        icon: 'text_fields',
        group: 'AI 助手',
        onSelect: () => { openAiActionDialog('简化表达', '改写为更清晰易懂的表达，降低阅读门槛。'); },
      },
      {
        id: 'emojify',
        title: '添加 Emoji',
        subtext: '加入合适表情让内容更生动',
        aliases: ['emoji', 'emojify'],
        icon: 'mood',
        group: 'AI 助手',
        onSelect: () => { openAiActionDialog('添加 Emoji', '在合适位置加入少量相关 emoji，保持专业和可读性。'); },
      },
      {
        id: 'complete_sentence',
        title: '补全句子',
        subtext: '智能补全未完成句子',
        aliases: ['complete', 'sentence', 'finish'],
        icon: 'format_list_bulleted_add',
        group: 'AI 助手',
        onSelect: () => { openAiActionDialog('补全句子', '补全不完整句子并确保语义连贯自然。'); },
      },
      {
        id: 'summarize',
        title: '总结内容',
        subtext: '生成更精炼的摘要',
        aliases: ['summary', 'summarize'],
        icon: 'summarize',
        group: 'AI 助手',
        onSelect: () => { openAiActionDialog('总结内容', '提炼核心观点，输出简洁摘要。'); },
      },
      {
        id: 'adjust_tone',
        title: '调整语气',
        subtext: '改为更专业/友好/口语化语气',
        aliases: ['tone', 'style', 'professional', 'casual'],
        icon: 'tune',
        group: 'AI 助手',
        onSelect: () => { openAiActionDialog('调整语气', '改写为专业、友好且清晰的语气，不改变事实。'); },
      },
      {
        id: 'translate',
        title: '翻译文本',
        subtext: `翻译为${translateTargetLabel}`,
        aliases: ['translate', 'translation', 'cn', 'en'],
        icon: 'translate',
        group: 'AI 助手',
        onSelect: () => { openAiActionDialog('翻译文本', translateInstruction); },
      },
      {
        id: 'translate_target_en',
        title: '翻译目标：英语',
        subtext: '设置默认翻译语言为英语',
        aliases: ['translate en', 'english'],
        icon: 'language',
        group: 'AI 助手',
        onSelect: () => { setTranslateTargetAndPersist('en'); },
      },
      {
        id: 'translate_target_zh',
        title: '翻译目标：中文',
        subtext: '设置默认翻译语言为中文',
        aliases: ['translate zh', 'chinese'],
        icon: 'language',
        group: 'AI 助手',
        onSelect: () => { setTranslateTargetAndPersist('zh'); },
      },
      {
        id: 'translate_target_ja',
        title: '翻译目标：日语',
        subtext: '设置默认翻译语言为日语',
        aliases: ['translate ja', 'japanese'],
        icon: 'language',
        group: 'AI 助手',
        onSelect: () => { setTranslateTargetAndPersist('ja'); },
      },
      {
        id: 'translate_target_ko',
        title: '翻译目标：韩语',
        subtext: '设置默认翻译语言为韩语',
        aliases: ['translate ko', 'korean'],
        icon: 'language',
        group: 'AI 助手',
        onSelect: () => { setTranslateTargetAndPersist('ko'); },
      },
    ];
  }, [getCurrentNodeText, openAiActionDialog, setTranslateTargetAndPersist, translateInstruction, translateTargetLabel]);

  const filteredSlashItems = useMemo(() => {
    const q = slashQuery.trim().toLowerCase();
    if (!q) return slashMenuItems;
    return slashMenuItems.filter((item) => {
      const haystack = [item.title, item.subtext, ...item.aliases].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [slashMenuItems, slashQuery]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    const btn = slashItemRefs.current[slashActiveIndex];
    if (btn) {
      btn.scrollIntoView({ block: 'nearest' });
    }
  }, [slashActiveIndex, slashMenuOpen]);

  const closeSlashMenu = useCallback(() => {
    setSlashMenuOpen(false);
    setSlashPos(null);
    setSlashRange(null);
    setSlashActiveIndex(0);
  }, []);

  const applySlashItem = useCallback((item: SlashMenuItem) => {
    if (!editor || !slashRangeRef.current) return;
    editor.chain().focus().deleteRange(slashRangeRef.current).run();
    item.onSelect(editor);
    closeSlashMenu();
  }, [closeSlashMenu, editor]);

  useEffect(() => {
    slashMenuOpenRef.current = slashMenuOpen;
  }, [slashMenuOpen]);

  useEffect(() => {
    slashRangeRef.current = slashRange;
  }, [slashRange]);

  useEffect(() => {
    slashActiveIndexRef.current = slashActiveIndex;
  }, [slashActiveIndex]);

  useEffect(() => {
    if (!editor) return;

    const updateSlashMenu = () => {
      const { state, view } = editor;
      const selection = state.selection;
      if (!selection.empty || !editor.isFocused) {
        closeSlashMenu();
        return;
      }

      const { $from } = selection;
      if (!$from.parent.isTextblock || $from.parent.type.name === 'notebookOutput') {
        closeSlashMenu();
        return;
      }

      const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n');
      const slashIndex = textBefore.lastIndexOf('/');
      if (slashIndex < 0) {
        closeSlashMenu();
        return;
      }

      const beforeSlash = textBefore.slice(0, slashIndex);
      if (beforeSlash.length > 0 && !/\s$/.test(beforeSlash)) {
        closeSlashMenu();
        return;
      }

      const query = textBefore.slice(slashIndex + 1);
      if (/\s/.test(query)) {
        closeSlashMenu();
        return;
      }

      const from = $from.start() + slashIndex;
      const to = from + 1 + query.length;
      const coords = view.coordsAtPos(selection.from);
      const menuWidth = 320;
      const menuHeight = 320;
      const margin = 12;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const left = Math.max(margin, Math.min(coords.left, viewportWidth - menuWidth - margin));
      const showAbove = coords.bottom + menuHeight + margin > viewportHeight && coords.top - menuHeight - margin > margin;
      const top = showAbove
        ? Math.max(margin, coords.top - menuHeight - 8)
        : Math.min(coords.bottom + 8, viewportHeight - menuHeight - margin);

      setSlashQuery(query);
      setSlashRange({ from, to });
      setSlashPos({ top, left });
      setSlashMenuOpen(true);
      setSlashActiveIndex(0);
    };

    const onUpdate = () => updateSlashMenu();
    const onSelectionUpdate = () => updateSlashMenu();
    const onBlur = () => {
      setTimeout(() => {
        closeSlashMenu();
      }, 90);
    };

    editor.on('update', onUpdate);
    editor.on('selectionUpdate', onSelectionUpdate);
    editor.on('blur', onBlur);
    updateSlashMenu();

    return () => {
      editor.off('update', onUpdate);
      editor.off('selectionUpdate', onSelectionUpdate);
      editor.off('blur', onBlur);
    };
  }, [closeSlashMenu, editor]);

  useEffect(() => {
    if (!editor) return;
    const handleKeydown = (event: KeyboardEvent) => {
      if (!editor.isFocused) return;
      if (!slashMenuOpenRef.current) return;
      const availableItems = filteredSlashItems;
      if (availableItems.length === 0) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashActiveIndex((prev) => (prev + 1) % availableItems.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashActiveIndex((prev) => (prev - 1 + availableItems.length) % availableItems.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const index = Math.max(0, Math.min(slashActiveIndexRef.current, availableItems.length - 1));
        applySlashItem(availableItems[index]);
      } else if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        closeSlashMenu();
      }
    };
    window.addEventListener('keydown', handleKeydown, true);
    return () => {
      window.removeEventListener('keydown', handleKeydown, true);
    };
  }, [applySlashItem, closeSlashMenu, editor, filteredSlashItems]);

  if (!editor) {
    return <div className="flex items-center justify-center h-full text-muted-foreground">加载 Notebook 编辑器...</div>;
  }

  return (
    <div className="notebook-rich-editor h-full min-w-0 flex [&_.tiptap_p]:my-3 [&_.tiptap_code]:font-mono">
      <div className="relative min-w-0 flex h-full flex-1 flex-col">
      <div className="sticky top-0 z-20 flex min-h-10 items-center gap-1 border-b bg-background/95 px-3 py-2 backdrop-blur">
          <div className={`flex items-center gap-1 ${toolbarDisabled ? 'pointer-events-none opacity-45' : ''}`}>
          {!isCodeContext && !isImageContext && (
            <>
              <button type="button" className={`rounded px-2 py-1 text-xs hover:bg-accent ${editor.isActive('bold') ? 'bg-accent' : ''}`} onClick={() => editor.chain().focus().toggleBold().run()} title="加粗">
                <span className="material-symbols-outlined text-base">format_bold</span>
              </button>
              <button type="button" className={`rounded px-2 py-1 text-xs hover:bg-accent ${editor.isActive('italic') ? 'bg-accent' : ''}`} onClick={() => editor.chain().focus().toggleItalic().run()} title="斜体">
                <span className="material-symbols-outlined text-base">format_italic</span>
              </button>
              <button type="button" className={`rounded px-2 py-1 text-xs hover:bg-accent ${editor.isActive('strike') ? 'bg-accent' : ''}`} onClick={() => editor.chain().focus().toggleStrike().run()} title="删除线">
                <span className="material-symbols-outlined text-base">strikethrough_s</span>
              </button>
              {renderLinkEditor(true)}
              <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => editor.chain().focus().toggleBulletList().run()} title="无序列表">
                <span className="material-symbols-outlined text-base">format_list_bulleted</span>
              </button>
              <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => editor.chain().focus().toggleOrderedList().run()} title="有序列表">
                <span className="material-symbols-outlined text-base">format_list_numbered</span>
              </button>
            </>
          )}
          {isCodeContext && (
            <>
              <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => editor.chain().focus().clearNodes().run()} title="转为正文">
                <span className="material-symbols-outlined text-base">notes</span>
              </button>
            </>
          )}
          {isTableContext && (
            <>
              <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => (editor.chain().focus() as any).addRowBefore().run()} title="上方插入">
                <span className="material-symbols-outlined text-base">add_row_above</span>
              </button>
              <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => (editor.chain().focus() as any).addRowAfter().run()} title="下方插入">
                <span className="material-symbols-outlined text-base">add_row_below</span>
              </button>
              <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => (editor.chain().focus() as any).addColumnBefore().run()} title="左侧插入">
                <span className="material-symbols-outlined text-base">add_column_left</span>
              </button>
              <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => (editor.chain().focus() as any).addColumnAfter().run()} title="右侧插入">
                <span className="material-symbols-outlined text-base">add_column_right</span>
              </button>
              <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => (editor.chain().focus() as any).deleteRow().run()} title="删除行">
                <span className="material-symbols-outlined text-base" style={{ color: '#ef4444' }}>table_rows</span>
              </button>
              <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => (editor.chain().focus() as any).deleteColumn().run()} title="删除列">
                <span className="material-symbols-outlined text-base" style={{ color: '#ef4444' }}>view_column_2</span>
              </button>
            </>
          )}
          {isImageContext && (
            <>
              <button
                type="button"
                className="rounded px-2 py-1 text-xs hover:bg-accent"
                onClick={() => openImageEditor()}
                title="编辑图片"
              >
                <span className="material-symbols-outlined text-base">image</span>
              </button>
              <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => editor.chain().focus().deleteSelection().run()} title="删除图片">
                <span className="material-symbols-outlined text-base">delete</span>
              </button>
            </>
          )}
          {!isCodeContext && <TableSizeMenuButton dense onInsert={insertTableWithSize} />}
          {renderAiActionMenu(true)}
          </div>
          <div className="ml-auto flex items-center gap-1">
            {uploadingImages > 0 && (
              <span className="mr-2 text-[11px] text-muted-foreground">图片上传中...</span>
            )}
            {aiSuggestionCount > 0 && (
              <>
                <button
                  type="button"
                  className="rounded px-2 py-1 text-xs hover:bg-accent"
                  onClick={() => applyAllAiSuggestions('accept')}
                  title={`接受全部建议（${aiSuggestionCount}）`}
                >
                  <span className="material-symbols-outlined text-base">check_circle</span>
                </button>
                <button
                  type="button"
                  className="rounded px-2 py-1 text-xs hover:bg-accent"
                  onClick={() => applyAllAiSuggestions('reject')}
                  title={`拒绝全部建议（${aiSuggestionCount}）`}
                >
                  <span className="material-symbols-outlined text-base">cancel</span>
                </button>
              </>
            )}
            {collabUsers.length > 0 && (
              <div className="mr-2 hidden items-center gap-1 md:flex">
                {collabUsers.slice(0, 4).map((user) => (
                  <span key={user.clientId} className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: user.color }} />
                    {user.name}
                  </span>
                ))}
                {collabUsers.length > 4 && (
                  <span className="text-[11px] text-muted-foreground">+{collabUsers.length - 4}</span>
                )}
              </div>
            )}
            <button
              type="button"
              className={`rounded px-2 py-1 text-xs hover:bg-accent ${dependencyGraphOpen ? 'bg-accent/60' : ''}`}
              onClick={() => onDependencyGraphOpenChange(!dependencyGraphOpen)}
              title={dependencyGraphOpen ? '隐藏依赖图' : '显示依赖图'}
            >
              <span className="material-symbols-outlined text-base">account_tree</span>
            </button>
            <button
              type="button"
              className={`rounded px-2 py-1 text-xs hover:bg-accent ${tocOpen ? 'bg-accent/60' : ''}`}
              onClick={() => onTocOpenChange(!tocOpen)}
              title={tocOpen ? '隐藏目录' : '显示目录'}
            >
              <span className="material-symbols-outlined text-base">toc</span>
            </button>
          </div>
      </div>
      <BubbleMenu
        editor={editor}
        pluginKey="notebookBubbleMenu"
        updateDelay={100}
        shouldShow={({ editor: e }) => {
          const inOutput = e.isActive('notebookOutput')
            || e.state.selection.$from.parent.type.name === 'notebookOutput'
            || e.state.selection.$to.parent.type.name === 'notebookOutput';
          if (inOutput) return false;
          const inCode = e.isActive('notebookCodeBlock') || e.isActive('codeBlock');
          const inTable = e.isActive('table') || e.isActive('tableCell') || e.isActive('tableHeader') || e.isActive('tableRow');
          const inImage = e.isActive('image');
          return bubbleAiMenuOpen || domCodeContext || !e.state.selection.empty || inCode || inTable || inImage;
        }}
      >
        <div className="notebook-bubble-menu flex items-center gap-1 rounded-md border bg-popover p-1 shadow-lg">
          {!isCodeContext && !isImageContext && (
            <>
              <button type="button" className={`rounded px-2 py-1 text-xs hover:bg-accent ${editor.isActive('bold') ? 'bg-accent' : ''}`} onClick={() => editor.chain().focus().toggleBold().run()} title="加粗">
                <span className="material-symbols-outlined text-base">format_bold</span>
              </button>
              <button type="button" className={`rounded px-2 py-1 text-xs hover:bg-accent ${editor.isActive('italic') ? 'bg-accent' : ''}`} onClick={() => editor.chain().focus().toggleItalic().run()} title="斜体">
                <span className="material-symbols-outlined text-base">format_italic</span>
              </button>
              <button type="button" className={`rounded px-2 py-1 text-xs hover:bg-accent ${editor.isActive('strike') ? 'bg-accent' : ''}`} onClick={() => editor.chain().focus().toggleStrike().run()} title="删除线">
                <span className="material-symbols-outlined text-base">strikethrough_s</span>
              </button>
              {renderLinkEditor(true)}
            </>
          )}
          {isCodeContext && (
            <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => editor.chain().focus().clearNodes().run()} title="转为正文">
              <span className="material-symbols-outlined text-base">notes</span>
            </button>
          )}
          {isTableContext && (
            <>
              <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => (editor.chain().focus() as any).addRowBefore().run()} title="上方插入">
                <span className="material-symbols-outlined text-base">add_row_above</span>
              </button>
              <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => (editor.chain().focus() as any).addRowAfter().run()} title="下方插入">
                <span className="material-symbols-outlined text-base">add_row_below</span>
              </button>
              <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => (editor.chain().focus() as any).addColumnBefore().run()} title="左侧插入">
                <span className="material-symbols-outlined text-base">add_column_left</span>
              </button>
              <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => (editor.chain().focus() as any).addColumnAfter().run()} title="右侧插入">
                <span className="material-symbols-outlined text-base">add_column_right</span>
              </button>
              <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => (editor.chain().focus() as any).deleteRow().run()} title="删除行">
                <span className="material-symbols-outlined text-base" style={{ color: '#ef4444' }}>table_rows</span>
              </button>
              <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => (editor.chain().focus() as any).deleteColumn().run()} title="删除列">
                <span className="material-symbols-outlined text-base" style={{ color: '#ef4444' }}>view_column_2</span>
              </button>
              <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => (editor.chain().focus() as any).deleteTable().run()} title="删除表格">
                <span className="material-symbols-outlined text-base">table_view</span>
              </button>
            </>
          )}
          {isImageContext && (
            <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => editor.chain().focus().deleteSelection().run()} title="删除图片">
              <span className="material-symbols-outlined text-base">delete</span>
            </button>
          )}
          {renderAiActionMenu(true, true)}
        </div>
      </BubbleMenu>
      <DragHandle editor={editor} onNodeChange={handleNodeChange}>
        <DropdownMenu
          open={menuOpen}
          onOpenChange={(next) => {
            if (isOutputNodeContext && next) return;
            setMenuOpen(next);
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={`notebook-drag-handle-btn ${isOutputNodeContext ? 'pointer-events-none opacity-0' : ''}`}
              draggable={!isOutputNodeContext}
              data-drag-handle
              title={isOutputNodeContext ? '' : '拖拽或打开块菜单'}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>drag_indicator</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-56 z-[80]">
            <DropdownMenuGroup>
              <DropdownMenuLabel>块操作</DropdownMenuLabel>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <span className="material-symbols-outlined mr-2 text-base">edit_note</span>
                  转为
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52 z-[81]">
                  <DropdownMenuItem onClick={() => transformBlock('paragraph')}>
                    <span className="material-symbols-outlined mr-2 text-base">notes</span>
                    正文
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => transformBlock('h1')}>
                    <span className="material-symbols-outlined mr-2 text-base">title</span>
                    标题 1
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => transformBlock('h2')}>
                    <span className="material-symbols-outlined mr-2 text-base">title</span>
                    标题 2
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => transformBlock('h3')}>
                    <span className="material-symbols-outlined mr-2 text-base">title</span>
                    标题 3
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => transformBlock('bulletList')}>
                    <span className="material-symbols-outlined mr-2 text-base">format_list_bulleted</span>
                    无序列表
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => transformBlock('orderedList')}>
                    <span className="material-symbols-outlined mr-2 text-base">format_list_numbered</span>
                    有序列表
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => transformBlock('taskList')}>
                    <span className="material-symbols-outlined mr-2 text-base">checklist</span>
                    任务列表
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => transformBlock('blockquote')}>
                    <span className="material-symbols-outlined mr-2 text-base">format_quote</span>
                    引用
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => transformBlock('codeBlock')}>
                    <span className="material-symbols-outlined mr-2 text-base">code</span>
                    代码块
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => transformBlock('table')}>
                    <span className="material-symbols-outlined mr-2 text-base">table_chart</span>
                    表格
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="material-symbols-outlined mr-2 text-base">smart_toy</span>
                AI 助手
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64 z-[81]">
                {isCodeSelectionMode ? (
                  <>
                    <DropdownMenuLabel>代码块 AI</DropdownMenuLabel>
                    <DropdownMenuItem onClick={handleAskAIFromSelection}>
                      <span className="material-symbols-outlined mr-2 text-base">forum</span>
                      问AI
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { openCodeAiTask('解释代码', '解释代码的功能、关键逻辑、输入输出与注意事项，使用简洁分点。'); }}>
                      <span className="material-symbols-outlined mr-2 text-base">help</span>
                      解释代码
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { openCodeAiTask('AI检视', '对代码做检视，指出潜在 bug、风险、可维护性和性能问题，并给出改进建议。'); }}>
                      <span className="material-symbols-outlined mr-2 text-base">fact_check</span>
                      AI检视
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { openAiOptimizeTask('selection'); }}>
                      <span className="material-symbols-outlined mr-2 text-base">auto_fix_high</span>
                      AI优化（选中）
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { openAiOptimizeTask('document'); }}>
                      <span className="material-symbols-outlined mr-2 text-base">dataset</span>
                      AI优化（全文）
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { openCodeAiTask('添加注释', '在不改变代码行为的前提下，为代码添加必要且精炼的注释，返回完整代码。', true); }}>
                      <span className="material-symbols-outlined mr-2 text-base">add_comment</span>
                      添加注释
                    </DropdownMenuItem>
                  </>
                ) : (
                  <>
                    <DropdownMenuLabel>通用</DropdownMenuLabel>
                    <DropdownMenuItem onClick={handleAskAI}>
                      <span className="material-symbols-outlined mr-2 text-base">forum</span>
                      问 AI
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>文本增强</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => { openAiActionDialog('修正拼写和语法', '修正拼写、标点和语法错误，保持原意与结构。'); }}>
                      <span className="material-symbols-outlined mr-2 text-base">spellcheck</span>
                      修正拼写和语法
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { openAiActionDialog('扩展文本', '在不偏离主题的前提下扩展内容，增加细节和上下文。'); }}>
                      <span className="material-symbols-outlined mr-2 text-base">expand_content</span>
                      扩展文本
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { openAiActionDialog('精简文本', '压缩篇幅，保留核心信息，去除冗余表达。'); }}>
                      <span className="material-symbols-outlined mr-2 text-base">compress</span>
                      精简文本
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { openAiActionDialog('简化表达', '改写为更清晰易懂的表达，降低阅读门槛。'); }}>
                      <span className="material-symbols-outlined mr-2 text-base">text_fields</span>
                      简化表达
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { openAiActionDialog('添加 Emoji', '在合适位置加入少量相关 emoji，保持专业和可读性。'); }}>
                      <span className="material-symbols-outlined mr-2 text-base">mood</span>
                      添加 Emoji
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>内容操作</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => { openAiActionDialog('补全句子', '补全不完整句子并确保语义连贯自然。'); }}>
                      <span className="material-symbols-outlined mr-2 text-base">format_list_bulleted_add</span>
                      补全句子
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { openAiActionDialog('总结内容', '提炼核心观点，输出简洁摘要。'); }}>
                      <span className="material-symbols-outlined mr-2 text-base">summarize</span>
                      总结内容
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { openAiOptimizeTask('selection'); }}>
                      <span className="material-symbols-outlined mr-2 text-base">auto_fix_high</span>
                      AI优化（选中）
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { openAiOptimizeTask('document'); }}>
                      <span className="material-symbols-outlined mr-2 text-base">dataset</span>
                      AI优化（全文）
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>高级选项</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => { openAiActionDialog('调整语气', '改写为专业、友好且清晰的语气，不改变事实。'); }}>
                      <span className="material-symbols-outlined mr-2 text-base">tune</span>
                      调整语气
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { openAiActionDialog('翻译文本', translateInstruction); }}>
                      <span className="material-symbols-outlined mr-2 text-base">translate</span>
                      翻译文本（{translateTargetLabel}）
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <span className="material-symbols-outlined mr-2 text-base">language</span>
                        翻译目标语言
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-52 z-[82]">
                        <DropdownMenuItem onClick={() => setTranslateTargetAndPersist('en')}>
                          <span className="material-symbols-outlined mr-2 text-base">check</span>
                          英语 {translateTarget === 'en' ? '（当前）' : ''}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTranslateTargetAndPersist('zh')}>
                          <span className="material-symbols-outlined mr-2 text-base">check</span>
                          中文 {translateTarget === 'zh' ? '（当前）' : ''}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTranslateTargetAndPersist('ja')}>
                          <span className="material-symbols-outlined mr-2 text-base">check</span>
                          日语 {translateTarget === 'ja' ? '（当前）' : ''}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTranslateTargetAndPersist('ko')}>
                          <span className="material-symbols-outlined mr-2 text-base">check</span>
                          韩语 {translateTarget === 'ko' ? '（当前）' : ''}
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={handleCopyNode}>
              <span className="material-symbols-outlined mr-2 text-base">content_copy</span>
              复制块内容
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDuplicateNode}>
              <span className="material-symbols-outlined mr-2 text-base">control_point_duplicate</span>
              创建副本
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={handleDeleteNode}>
              <span className="material-symbols-outlined mr-2 text-base">delete</span>
              删除块
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </DragHandle>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
          <ResizablePanel panelRef={editorPanelRef} defaultSize={dependencyGraphOpen ? '70%' : '100%'} minSize="25%">
            <EditorContent editor={editor} className="notebook-editor-scroll h-full min-h-0 overflow-y-auto" />
          </ResizablePanel>
          <ResizableHandle className={`${dependencyGraphOpen ? '' : 'hidden'}`} />
          <ResizablePanel
            panelRef={dependencyPanelRef}
            defaultSize={dependencyGraphOpen ? '30%' : '0%'}
            minSize="18%"
            collapsible
            collapsedSize={0}
            onResize={(size: any) => {
              if (applyingPanelResizeRef.current) return;
              const numeric = typeof size === 'number'
                ? size
                : typeof size === 'object' && size && 'asPercentage' in size
                  ? Number((size as any).asPercentage)
                  : Number(String(size).replace('%', ''));
              if (Number.isFinite(numeric) && numeric >= 18 && Math.abs(numeric - dependencyPanelPercent) >= 0.5) {
                setDependencyPanelPercent(numeric);
                if (typeof window !== 'undefined') {
                  window.localStorage.setItem('notebook-dependency-panel-percent', String(numeric));
                }
              }
            }}
          >
            <div className={`h-full overflow-hidden border-t bg-background ${dependencyGraphOpen ? '' : 'hidden'}`}>
              <div className="flex items-center justify-between border-b px-3 py-2">
                <div className="text-xs font-medium text-muted-foreground">代码块依赖图</div>
                <button type="button" className="rounded px-1.5 py-1 text-xs hover:bg-accent" onClick={() => onDependencyGraphOpenChange(false)} title="关闭依赖图">
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>
              <div className="h-[calc(100%-2.25rem)] overflow-hidden">
                {dependencyNodes.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">暂无代码块依赖关系</div>
                ) : (
                  <ReactFlow
                    nodes={dependencyNodes}
                    edges={dependencyEdges}
                    fitView
                    fitViewOptions={{ padding: 0.2 }}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    elementsSelectable
                    onNodeClick={(_, node) => handleJumpToCodeBlock(Number((node.data as any)?.pos || 0))}
                  >
                    <MiniMap pannable zoomable />
                    <Controls showInteractive={false} />
                    <Background gap={20} color="hsl(var(--border))" />
                  </ReactFlow>
                )}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      {slashMenuOpen && slashPos && (
        <div
          ref={slashMenuRef}
          className="fixed z-[85] w-[320px] max-h-[320px] overflow-auto rounded-md border bg-popover p-1 shadow-xl"
          style={{ top: slashPos.top, left: slashPos.left }}
        >
          {filteredSlashItems.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">无匹配项</div>
          ) : (
            (() => {
              let lastGroup = '';
              return filteredSlashItems.map((item, index) => {
                const showGroup = item.group !== lastGroup;
                lastGroup = item.group;
                return (
                  <div key={item.id}>
                    {showGroup && <div className="px-2 pt-2 pb-1 text-[11px] text-muted-foreground">{item.group}</div>}
                    <button
                      type="button"
                      ref={(el) => {
                        slashItemRefs.current[index] = el;
                      }}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${index === slashActiveIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/70'}`}
                      onMouseEnter={() => setSlashActiveIndex(index)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        applySlashItem(item);
                      }}
                    >
                      <span className="material-symbols-outlined text-base text-muted-foreground">{item.icon}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block truncate">{item.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{item.subtext}</span>
                      </span>
                    </button>
                  </div>
                );
              });
            })()
          )}
        </div>
      )}
      <NotebookAskAISheet
        open={askAIOpen}
        onOpenChange={setAskAIOpen}
        context={askAIContext}
        autoTask={askAITask}
        insertButtonLabel={askAIApplyMode === 'optimize' ? '生成建议列表' : '插入回原文'}
        onInsertResult={insertAiResultBack}
      />
      <Popover
        open={linkPopoverOpen}
        onOpenChange={(open) => {
          setLinkEditorOpen(open);
          if (!open) {
            setLinkEditRange(null);
            setLinkEditorAnchor(null);
          }
        }}
      >
        {linkEditorAnchor && (
          <PopoverAnchor asChild>
            <div style={{ position: 'fixed', left: linkEditorAnchor.left, top: linkEditorAnchor.top }} />
          </PopoverAnchor>
        )}
        <PopoverContent className="w-80">
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">链接文本</div>
            <input
              value={linkDraftText}
              onChange={(event) => setLinkDraftText(event.target.value)}
              className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="显示文本"
            />
            <div className="text-xs font-medium text-muted-foreground">链接地址</div>
            <input
              value={linkDraftUrl}
              onChange={(event) => setLinkDraftUrl(event.target.value)}
              className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="https://example.com"
            />
            <div className="text-xs font-medium text-muted-foreground">链接标题（可选）</div>
            <input
              value={linkDraftTitle}
              onChange={(event) => setLinkDraftTitle(event.target.value)}
              className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="鼠标悬停提示"
            />
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                className="rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-40"
                onClick={openDraftLink}
                disabled={!linkDraftUrl.trim()}
              >
                跳转
              </button>
              <button type="button" className="rounded border px-2 py-1 text-xs hover:bg-accent" onClick={removeLink}>
                去除链接
              </button>
              <button type="button" className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90" onClick={applyLinkEdit}>
                保存
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <Popover
        open={imagePopoverOpen}
        onOpenChange={(open) => {
          setImageEditorOpen(open);
          if (!open) {
            setImageEditorPos(null);
            setImageEditorAnchor(null);
          }
        }}
      >
        {imageEditorAnchor && (
          <PopoverAnchor asChild>
            <div style={{ position: 'fixed', left: imageEditorAnchor.left, top: imageEditorAnchor.top }} />
          </PopoverAnchor>
        )}
        <PopoverContent className="w-80">
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">图片地址</div>
            <input
              value={imageDraftSrc}
              onChange={(event) => setImageDraftSrc(event.target.value)}
              className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="/uploads/images/..."
            />
            <div className="text-xs font-medium text-muted-foreground">Alt 文本</div>
            <input
              value={imageDraftAlt}
              onChange={(event) => setImageDraftAlt(event.target.value)}
              className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="图片描述"
            />
            <div className="text-xs font-medium text-muted-foreground">Title（可选）</div>
            <input
              value={imageDraftTitle}
              onChange={(event) => setImageDraftTitle(event.target.value)}
              className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="悬停提示"
            />
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                className="rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-40"
                onClick={() => {
                  const href = imageDraftSrc.trim();
                  if (!href || typeof window === 'undefined') return;
                  window.open(href, '_blank', 'noopener,noreferrer');
                }}
                disabled={!imageDraftSrc.trim()}
              >
                打开
              </button>
              <button
                type="button"
                className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90"
                onClick={applyImageEdit}
              >
                保存
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <Popover
        open={inlineMathPopoverOpen}
        onOpenChange={(open) => {
          setInlineMathEditOpen(open);
          if (!open) {
            setInlineMathEditPos(null);
            setInlineMathEditAnchor(null);
          }
        }}
      >
        {inlineMathEditAnchor && (
          <PopoverAnchor asChild>
            <div style={{ position: 'fixed', left: inlineMathEditAnchor.left, top: inlineMathEditAnchor.top }} />
          </PopoverAnchor>
        )}
        <PopoverContent className="w-[520px] max-w-[calc(100vw-24px)]">
          <div className="space-y-2">
            <div className="text-sm font-medium">编辑行内公式</div>
            <div className="text-xs text-muted-foreground">输入 LaTeX 表达式并保存。</div>
            <textarea
              value={inlineMathEditLatex}
              onChange={(event) => setInlineMathEditLatex(event.target.value)}
              className="min-h-[120px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="例如：\\frac{a}{b}"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm hover:bg-accent"
                onClick={() => {
                  setInlineMathEditOpen(false);
                  setInlineMathEditPos(null);
                  setInlineMathEditAnchor(null);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:opacity-90"
                onClick={applyInlineMathEdit}
              >
                保存
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      </div>
      {tocOpen && (
        <aside className="h-full w-64 shrink-0 border-l bg-muted/20">
          <div className="flex h-10 items-center justify-between border-b px-3">
            <span className="text-sm font-medium">目录</span>
            <button type="button" className="rounded p-1 hover:bg-accent" onClick={() => onTocOpenChange(false)} title="关闭目录">
              <span className="material-symbols-outlined text-base">close</span>
            </button>
          </div>
          <div className="h-[calc(100%-2.5rem)] overflow-y-auto px-2 py-2">
            {tocItems.length === 0 ? (
              <div className="px-2 py-2 text-xs text-muted-foreground">暂无标题，使用 H1/H2/H3 可生成目录</div>
            ) : (
              tocItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`mb-1 block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-accent ${activeTocId === item.id ? 'bg-accent text-accent-foreground' : ''}`}
                  style={{ paddingLeft: `${8 + (item.level - 1) * 12}px` }}
                  onClick={() => handleJumpToHeading(item.pos, item.id)}
                  title={item.text}
                >
                  {item.text}
                </button>
              ))
            )}
          </div>
        </aside>
      )}
      <style jsx global>{`
        .hljs { display: block; color: #e5e7eb; background: transparent; }
        .ProseMirror .hljs { white-space: pre; }
        .ProseMirror pre code { caret-color: white; }
        .hljs-comment,
        .hljs-quote { color: #5c6370; font-style: italic; }
        .hljs-keyword,
        .hljs-selector-tag,
        .hljs-literal,
        .hljs-section,
        .hljs-link { color: #c678dd; }
        .hljs-string,
        .hljs-title,
        .hljs-name,
        .hljs-type,
        .hljs-attribute,
        .hljs-symbol,
        .hljs-bullet,
        .hljs-addition { color: #98c379; }
        .hljs-number,
        .hljs-built_in,
        .hljs-builtin-name,
        .hljs-meta,
        .hljs-variable,
        .hljs-template-variable { color: #d19a66; }
        .hljs-attr,
        .hljs-operator,
        .hljs-punctuation,
        .hljs-subst { color: #56b6c2; }
        .hljs-function .hljs-title,
        .hljs-title.function_ { color: #61afef; }
        .notebook-collab-selection { border-radius: 2px; }
        .notebook-collab-caret {
          position: relative;
          border-left: 2px solid;
          margin-left: -1px;
          margin-right: -1px;
        }
        .notebook-collab-caret-label {
          position: absolute;
          top: -1.2em;
          left: -1px;
          padding: 1px 6px;
          border-radius: 999px;
          color: #fff;
          font-size: 10px;
          line-height: 1.2;
          white-space: nowrap;
          user-select: none;
          pointer-events: none;
        }
        .notebook-rich-editor .tiptap p.is-empty:last-child::before,
        .notebook-rich-editor .tiptap h1.is-empty:last-child::before,
        .notebook-rich-editor .tiptap h2.is-empty:last-child::before,
        .notebook-rich-editor .tiptap h3.is-empty:last-child::before,
        .notebook-rich-editor .tiptap blockquote.is-empty:last-child::before {
          color: hsl(var(--muted-foreground));
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
          opacity: 0.7;
        }
        .notebook-rich-editor .tiptap a {
          color: #2563eb;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .notebook-rich-editor .tiptap a:hover {
          color: #1d4ed8;
        }
        .notebook-rich-editor .tiptap-mathematics-render {
          border: 1px solid hsl(var(--border));
          background: hsl(var(--muted) / 0.45);
          border-radius: 8px;
          padding: 4px 8px;
        }
        .notebook-rich-editor .tiptap-mathematics-render[data-type="inline-math"] {
          display: inline-flex;
          margin: 0 2px;
          padding: 2px 6px;
          border-radius: 6px;
          cursor: pointer;
        }
        .notebook-rich-editor .tiptap-mathematics-render[data-type="block-math"] {
          display: block;
          margin: 8px 0;
          padding: 8px 10px;
          overflow-x: auto;
        }
      `}</style>
    </div>
  );
}
