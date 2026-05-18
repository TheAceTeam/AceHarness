'use client';

import { useEffect, useRef, useState } from 'react';
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { Check, Loader2, Play } from 'lucide-react';
import katex from 'katex';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { createNotebookCellId, displayNotebookCellId, isRunnableNotebookLanguage, normalizeNotebookLanguage } from '@/lib/notebook/markdown';
import { copyText } from '@/lib/core/clipboard';

interface NotebookCodeBlockProps extends ReactNodeViewProps {
  onRunCell: (payload: { pos: number; cellId: string; language: string; code: string; dependsOn: string[] }) => Promise<{ output: string | null; success: boolean }>;
  getCellRunStatus?: (cellId: string) => 'idle' | 'running' | 'success' | 'failed';
  getAllCodeBlocks?: () => Array<{ cellId: string; language: string; preview: string }>;
}

const CODE_LANG_OPTIONS = [
  'cangjie',
  'typescript',
  'javascript',
  'python',
  'java',
  'cpp',
  'sql',
  'json',
  'yaml',
  'markdown',
  'bash',
  'text',
];

export function NotebookCodeBlock({ editor, node, selected, getPos, updateAttributes, onRunCell, getCellRunStatus, getAllCodeBlocks }: NotebookCodeBlockProps) {
  const [copying, setCopying] = useState(false);
  const [running, setRunning] = useState(false);
  const [, setRefreshTick] = useState(0);
  const copyTimerRef = useRef<number | null>(null);
  const language = normalizeNotebookLanguage(node.attrs.language);
  const code = node.textContent;
  const cellId = String(node.attrs.cellId || '');
  const dependsOn = Array.isArray(node.attrs.dependsOn) ? (node.attrs.dependsOn as string[]) : [];
  const unmetDependencies = dependsOn.filter((id) => (getCellRunStatus?.(id) ?? 'idle') !== 'success');
  const canRun = isRunnableNotebookLanguage(language) && unmetDependencies.length === 0;
  const runState = getCellRunStatus?.(cellId) ?? 'idle';
  const allCodeBlocks = (getAllCodeBlocks?.() || []).filter((item) => item.cellId && item.cellId !== cellId);
  const codeBlockLabelMap = new Map(allCodeBlocks.map((item) => [
    item.cellId,
    `${item.preview || '代码块'} (${displayNotebookCellId(item.cellId)})`,
  ]));

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!cellId) {
      queueMicrotask(() => {
        updateAttributes({ cellId: createNotebookCellId() });
      });
    }
  }, [cellId, updateAttributes]);

  useEffect(() => {
    const refresh = () => setRefreshTick((prev) => prev + 1);
    editor.on('update', refresh);
    editor.on('selectionUpdate', refresh);
    return () => {
      editor.off('update', refresh);
      editor.off('selectionUpdate', refresh);
    };
  }, [editor]);

  const handleCopy = async () => {
    try {
      const ok = await copyText(code);
      if (!ok) {
        setCopying(false);
        return;
      }
      setCopying(true);
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => setCopying(false), 1200);
    } catch {
      setCopying(false);
    }
  };

  const handleRun = async () => {
    if (!canRun || running) return;
    setRunning(true);
    try {
      await onRunCell({
        pos: typeof getPos === 'function' ? (getPos() ?? 0) : 0,
        cellId,
        language,
        code,
        dependsOn,
      });
    } finally {
      setRunning(false);
    }
  };

  const handleLanguageChange = (nextLanguage: string) => {
    const normalized = normalizeNotebookLanguage(nextLanguage);
    updateAttributes({ language: normalized });
  };

  const toggleDependency = (targetCellId: string, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...dependsOn, targetCellId]))
      : dependsOn.filter((id) => id !== targetCellId);
    updateAttributes({ dependsOn: next });
  };

  return (
    <NodeViewWrapper className={`notebook-code-node my-4 overflow-hidden rounded-lg border bg-[#1f2430] text-slate-100 ${selected ? 'ring-1 ring-primary' : ''}`}>
      <div contentEditable={false} className="flex items-center justify-between gap-2 border-b border-white/10 bg-black/20 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-slate-300">
          <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px]" title="代码块 ID">
            {displayNotebookCellId(cellId)}
          </span>
          <label className="flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5">
            <span className="material-symbols-outlined text-[13px] text-slate-300">code</span>
            <select
              value={language}
              onChange={(event) => handleLanguageChange(event.target.value)}
              className="bg-transparent text-xs font-mono uppercase tracking-wide text-slate-100 outline-none"
              title="切换代码语言"
            >
              {CODE_LANG_OPTIONS.map((lang) => (
                <option key={lang} value={lang} className="bg-[#1f2430] text-slate-100">
                  {lang}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/20" title="配置依赖">
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>link</span>
                <span>依赖{dependsOn.length > 0 ? `(${dependsOn.length})` : ''}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" className="w-72">
              <DropdownMenuLabel>运行依赖</DropdownMenuLabel>
              <div className="px-2 pb-2 text-xs text-muted-foreground">未运行成功的依赖将阻止当前代码块执行</div>
              <DropdownMenuSeparator />
              {allCodeBlocks.length === 0 ? (
                <div className="px-2 py-2 text-xs text-muted-foreground">暂无可选依赖代码块</div>
              ) : (
                allCodeBlocks.map((item) => (
                  <DropdownMenuCheckboxItem
                    key={item.cellId}
                    checked={dependsOn.includes(item.cellId)}
                    onCheckedChange={(checked) => toggleDependency(item.cellId, checked === true)}
                  >
                    <span className="mr-2 inline-flex h-4 min-w-8 items-center justify-center rounded bg-muted px-1 text-[10px]">
                      {item.language}
                    </span>
                    <span className="truncate text-xs">{`${item.preview || '代码块'} (${displayNotebookCellId(item.cellId)})`}</span>
                  </DropdownMenuCheckboxItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" className="flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/20" onClick={handleCopy} title="复制代码">
            {copying ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <span className="material-symbols-outlined" style={{ fontSize: 14 }}>content_copy</span>}
            <span>{copying ? '已复制' : '复制'}</span>
          </button>
          {isRunnableNotebookLanguage(language) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200 disabled:text-muted-foreground"
              onClick={handleRun}
              disabled={running || !canRun}
              title={!canRun && unmetDependencies.length > 0 ? `缺少依赖：${unmetDependencies.join(', ')}` : '运行'}
            >
              {running || runState === 'running' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
              {running || runState === 'running' ? '运行中' : !canRun ? '缺依赖' : '运行'}
            </Button>
          )}
        </div>
      </div>
      {dependsOn.length > 0 && (
        <div contentEditable={false} className="border-b border-white/10 bg-black/15 px-3 py-1.5 text-[11px] text-slate-300">
          依赖：
          {dependsOn.map((id) => {
            const status = getCellRunStatus?.(id) ?? 'idle';
            const dot = status === 'success' ? 'bg-emerald-400' : status === 'failed' ? 'bg-red-400' : status === 'running' ? 'bg-blue-400' : 'bg-slate-400';
            return (
                <span key={id} className="ml-1 inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
                  {codeBlockLabelMap.get(id) || `已删除代码块 (${displayNotebookCellId(id)})`}
                </span>
              );
            })}
        </div>
      )}
      <pre className="m-0 overflow-x-auto px-4 py-4 text-[13px] leading-6 text-slate-100">
        <code className={`hljs language-${language}`}>
          <NodeViewContent as="div" className="whitespace-pre font-mono outline-none caret-white" />
        </code>
      </pre>
    </NodeViewWrapper>
  );
}

interface NotebookOutputBlockProps extends ReactNodeViewProps {}
interface NotebookAiSuggestionBlockProps extends ReactNodeViewProps {
  onAccept: (payload: { pos: number; original: string; optimized: string }) => void;
  onReject: (payload: { pos: number; original: string; optimized: string }) => void;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface NotebookMathBlockProps extends ReactNodeViewProps {}

export function NotebookMathBlock({ node, selected, updateAttributes }: NotebookMathBlockProps) {
  const latex = String(node.attrs.latex || '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latex);

  useEffect(() => {
    if (!editing) {
      setDraft(latex);
    }
  }, [editing, latex]);

  const commitDraft = () => {
    if (draft === latex) return;
    updateAttributes({ latex: draft });
  };

  const rendered = (() => {
    try {
      return katex.renderToString(latex || '\\;', {
        throwOnError: false,
        strict: 'ignore',
        displayMode: true,
      });
    } catch {
      return `<pre>${escapeHtml(latex || '公式渲染失败')}</pre>`;
    }
  })();

  return (
    <NodeViewWrapper className={`group notebook-math-block relative my-3 rounded-lg border bg-card/80 ${selected ? 'ring-1 ring-primary' : ''}`}>
      <div contentEditable={false} className="pointer-events-none absolute right-2 top-2 z-10">
        <button
          type="button"
          className={`pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition hover:bg-accent hover:text-foreground ${
            editing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          title={editing ? '预览公式' : '编辑公式'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (editing) {
              commitDraft();
              setEditing(false);
            } else {
              setEditing(true);
            }
          }}
        >
          <span className="material-symbols-outlined text-[16px]">{editing ? 'visibility' : 'edit'}</span>
        </button>
      </div>

      {editing ? (
        <div className="p-3">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              commitDraft();
              setEditing(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setDraft(latex);
                setEditing(false);
                return;
              }
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'enter') {
                commitDraft();
                setEditing(false);
              }
            }}
            className="w-full min-h-[96px] resize-y rounded-md border bg-[#1f2430] px-3 py-2 font-mono text-[13px] leading-6 text-slate-100 outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="输入 LaTeX，例如：\frac{a}{b}"
            autoFocus
          />
        </div>
      ) : (
        <div contentEditable={false} className="px-4 py-3">
          <div className="flex min-h-[48px] items-center justify-center rounded-md bg-background/60 px-3 py-2">
            <div className="max-w-full overflow-x-auto" dangerouslySetInnerHTML={{ __html: rendered }} />
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}

export function NotebookOutputBlock({ node }: NotebookOutputBlockProps) {
  const summary = String(node.attrs.summary || 'Output');
  const output = String(node.attrs.output || '');
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopyOutput = async () => {
    try {
      const ok = await copyText(output || '');
      if (!ok) {
        setCopied(false);
        return;
      }
      setCopied(true);
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <NodeViewWrapper className="my-3 rounded-lg border bg-muted/30">
      <div contentEditable={false} className="border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center justify-between gap-2">
        <span>{summary}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-normal normal-case tracking-normal hover:bg-accent"
          onClick={handleCopyOutput}
          title="复制输出"
        >
          <span className="material-symbols-outlined text-[14px]">{copied ? 'check' : 'content_copy'}</span>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <div contentEditable={false} className="px-3 py-3">
        <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-words rounded-md border bg-background px-3 py-2 text-[13px] leading-6 text-foreground">
          {output || '无输出'}
        </pre>
      </div>
    </NodeViewWrapper>
  );
}

export function NotebookAiSuggestionBlock({ node, getPos, onAccept, onReject }: NotebookAiSuggestionBlockProps) {
  const original = String(node.attrs.original || '');
  const optimized = String(node.attrs.optimized || '');
  const pos = typeof getPos === 'function' ? (getPos() ?? -1) : -1;

  return (
    <NodeViewWrapper className="my-2 rounded-lg border border-amber-300/60 bg-amber-50/40">
      <div contentEditable={false} className="border-b border-amber-300/50 px-3 py-2 text-xs font-medium text-amber-800 flex items-center justify-between">
        <span>AI 优化建议</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 hover:bg-emerald-500/20"
            onClick={() => {
              if (pos < 0) return;
              onAccept({ pos, original, optimized });
            }}
          >
            接受
          </button>
          <button
            type="button"
            className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-700 hover:bg-rose-500/20"
            onClick={() => {
              if (pos < 0) return;
              onReject({ pos, original, optimized });
            }}
          >
            拒绝
          </button>
        </div>
      </div>
      <div contentEditable={false} className="space-y-2 px-3 py-2">
        <div className="rounded border bg-background/80 p-2">
          <div className="mb-1 text-[11px] text-muted-foreground">原文</div>
          <pre className="whitespace-pre-wrap break-words text-xs">{original || '(空)'}</pre>
        </div>
        <div className="rounded border border-emerald-400/40 bg-emerald-500/10 p-2">
          <div className="mb-1 text-[11px] text-muted-foreground">建议</div>
          <pre className="whitespace-pre-wrap break-words text-xs">{optimized || '(空)'}</pre>
        </div>
      </div>
    </NodeViewWrapper>
  );
}
