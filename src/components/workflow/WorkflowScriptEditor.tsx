'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { Maximize2, Minimize2, Terminal } from 'lucide-react';
import dynamic from '@/lib/navigation/dynamic';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { SCRIPT_INTERPRETER_LABELS, SCRIPT_LANGUAGES } from '@/lib/workflow/script-presentation';
import type { WorkflowScriptInterpreter } from '@/lib/core/schemas';
import type { editor } from 'monaco-editor';

const CodeEditor = dynamic(async () => {
  const { default: EditorWorker } = await import('monaco-editor/esm/vs/editor/editor.worker?worker');
  const scope = globalThis as typeof globalThis & { MonacoEnvironment?: import('monaco-editor').Environment };
  scope.MonacoEnvironment ??= { getWorker: () => new EditorWorker() };
  const monaco = await import('monaco-editor');
  const { loader, default: Editor } = await import('@monaco-editor/react');
  loader.config({ monaco });
  return Editor;
}, { ssr: false, loading: () => <div className="grid h-60 place-items-center text-xs text-muted-foreground">正在加载代码编辑器…</div> });

export default function WorkflowScriptEditor({ value, interpreter, onChange }: { value: string; interpreter: WorkflowScriptInterpreter; onChange: (value: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const { resolvedTheme } = useTheme();
  const id = useId();
  const model = useRef<editor.ITextModel | null>(null);
  useEffect(() => () => model.current?.dispose(), []);
  const renderEditor = (large: boolean) => <CodeEditor height={large ? '100%' : 260}
    path={'workflow-script://' + encodeURIComponent(id)} keepCurrentModel saveViewState
    language={SCRIPT_LANGUAGES[interpreter]} value={value} theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
    onMount={(instance: editor.IStandaloneCodeEditor) => { model.current = instance.getModel(); }}
    onChange={(next: string | undefined) => onChange(next ?? '')}
    options={{ ariaLabel: '脚本内容', minimap: { enabled: large }, automaticLayout: true, fontSize: large ? 14 : 12,
      tabSize: 2, occurrencesHighlight: 'off', selectionHighlight: false, scrollBeyondLastLine: false, wordWrap: 'on', padding: { top: 12 }, fixedOverflowWidgets: true }} />;
  return <>
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="flex h-9 items-center justify-between border-b bg-muted/30 px-2.5">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Terminal className="size-3.5" />{SCRIPT_INTERPRETER_LABELS[interpreter]}</span>
        <Button type="button" size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={() => setExpanded(true)}><Maximize2 className="size-3.5" />放大编辑</Button>
      </div>
      {expanded ? <div className="grid h-[260px] place-items-center text-xs text-muted-foreground">正在放大编辑</div> : renderEditor(false)}
    </div>
    {expanded && <Dialog open onOpenChange={setExpanded}>
      <DialogContent fullscreen overlayClassName="z-[80]" className="z-[90] gap-0 p-0" aria-describedby={undefined}>
        <div className="flex h-14 shrink-0 items-center justify-between border-b px-5">
          <DialogTitle className="flex items-center gap-2 text-sm"><Terminal className="size-4" />脚本内容 · {SCRIPT_INTERPRETER_LABELS[interpreter]}</DialogTitle>
          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setExpanded(false)}><Minimize2 className="size-4" />返回配置</Button>
        </div>
        <div className="min-h-0 flex-1">{expanded && renderEditor(true)}</div>
      </DialogContent>
    </Dialog>}
  </>;
}
