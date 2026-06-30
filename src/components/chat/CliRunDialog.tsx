'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/core/utils';
import {
  Terminal,
  TerminalActions,
  TerminalClearButton,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalTitle,
} from '@/components/ai-elements/terminal';
import Ansi from 'ansi-to-react';

export type CliRunDialogRequest = {
  commandName: string;
  title: string;
  workingDirectory: string;
  args: string[];
  successMessage: string;
  refreshSlashCommandsOnSuccess?: {
    reason: string;
    workingDirectory: string;
  };
  input?: {
    title: string;
    description: string;
    label: string;
    placeholder: string;
    validationPattern: string;
    validationMessage: string;
  };
};

export interface CliRunDialogProps {
  open: boolean;
  request: CliRunDialogRequest | null;
  onOpenChange: (open: boolean) => void;
}

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem('auth-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function joinCommandLine(commandName: string, args: string[], inputValue?: string) {
  const parts = [commandName, ...args];
  if (inputValue?.trim()) parts.push(inputValue.trim());
  return parts.join(' ');
}

function shellSplit(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function extractCodespecSyncCommands(output: string): Array<{ commandLine: string; args: string[] }> {
  const seen = new Set<string>();
  const commands: Array<{ commandLine: string; args: string[] }> = [];
  const pattern = /\bcodespec\s+sync\s+--zone\s+(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s\r\n;&|]+))/gi;

  for (const match of output.matchAll(pattern)) {
    const commandLine = match[0].trim();
    const parts = shellSplit(commandLine);
    if (parts[0] !== 'codespec' || parts[1] !== 'sync') continue;
    const zoneIndex = parts.indexOf('--zone');
    if (zoneIndex < 0 || !parts[zoneIndex + 1]) continue;
    const key = parts.join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    commands.push({ commandLine, args: parts.slice(1) });
  }

  return commands;
}

export default function CliRunDialog({ open, request, onOpenChange }: CliRunDialogProps) {
  const { toast } = useToast();
  const [inputValue, setInputValue] = useState('');
  const [running, setRunning] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState('');
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const autoRunKeyRef = useRef('');
  const runSeqRef = useRef(0);

  const requestKey = useMemo(() => {
    if (!request) return '';
    return [
      request.commandName,
      request.workingDirectory,
      request.args.join('\u0000'),
      request.input ? '1' : '0',
    ].join('|');
  }, [request]);

  const combinedOutput = useMemo(() => {
    return terminalOutput;
  }, [terminalOutput]);

  const clearOutput = useCallback(() => {
    setTerminalOutput('');
    setExitCode(null);
    setErrorMessage('');
  }, []);

  const appendTerminalOutput = useCallback((text: string) => {
    if (!text) return;
    setTerminalOutput((prev) => {
      const prefix = prev && !prev.endsWith('\n') ? '\n' : '';
      return `${prev}${prefix}${text}`;
    });
  }, []);

  const executableCommands = useMemo(() => {
    if (request?.commandName !== 'codespec') return [];
    return extractCodespecSyncCommands(terminalOutput);
  }, [request?.commandName, terminalOutput]);

  const execute = useCallback(async (overrideArgs?: string[]) => {
    if (!request) return;

    const runId = ++runSeqRef.current;
    const trimmedInput = inputValue.trim();
    const effectiveArgs = overrideArgs || (request.input
      ? [...request.args, trimmedInput]
      : request.args);

    if (request.input && !overrideArgs) {
      if (!trimmedInput) {
        toast('warning', `${request.input.label} 不能为空`);
        inputRef.current?.focus();
        return;
      }

      try {
        const pattern = new RegExp(request.input.validationPattern);
        if (!pattern.test(trimmedInput)) {
          setErrorMessage(request.input.validationMessage);
          inputRef.current?.focus();
          return;
        }
      } catch {
        setErrorMessage('输入校验规则无效');
        return;
      }
    }

    setRunning(true);
    setErrorMessage('');
    setExitCode(null);
    const commandLine = joinCommandLine(
      request.commandName,
      effectiveArgs,
    );
    appendTerminalOutput(`${combinedOutput ? '\n' : ''}$ ${commandLine}\n`);

    try {
      const response = await fetch('/api/cli/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          workspace: request.workingDirectory,
          commandName: request.commandName,
          args: effectiveArgs,
        }),
      });
      const data = await response.json().catch(() => null);
      const stdoutText = typeof data?.stdout === 'string' ? data.stdout : '';
      const stderrText = typeof data?.stderr === 'string' ? data.stderr : '';
      const resultExitCode = typeof data?.exitCode === 'number' ? data.exitCode : null;
      const success = response.ok && data?.success !== false;

      if (runSeqRef.current !== runId) return;

      const nextChunks = [
        stdoutText.trimEnd(),
        stderrText.trimEnd(),
        resultExitCode != null ? `[exit ${resultExitCode}]` : '',
      ].filter(Boolean);
      appendTerminalOutput(nextChunks.join(stdoutText && stderrText ? '\n' : ''));
      setExitCode(resultExitCode);
      setErrorMessage(success ? '' : (typeof data?.error === 'string' && data.error.trim()
        ? data.error
        : `${request.title} 执行失败`));
      if (request.input && !overrideArgs && success) {
        setInputValue('');
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }

      if (success && request.refreshSlashCommandsOnSuccess && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ace:slash-commands-refresh', {
          detail: request.refreshSlashCommandsOnSuccess,
        }));
      }
      if (success && request.successMessage) {
        toast('success', request.successMessage);
      }
    } catch (error: any) {
      if (runSeqRef.current !== runId) return;
      const message = error?.message || `${request.title} 执行失败`;
      setErrorMessage(message);
      setExitCode(null);
      appendTerminalOutput(`${message}\n[request failed]`);
    } finally {
      if (runSeqRef.current !== runId) return;
      setRunning(false);
    }
  }, [appendTerminalOutput, combinedOutput, inputValue, request, toast]);

  useEffect(() => {
    if (!open || !request) {
      autoRunKeyRef.current = '';
      runSeqRef.current += 1;
      return;
    }

    setInputValue('');
    clearOutput();
    setRunning(false);
    autoRunKeyRef.current = '';
    runSeqRef.current += 1;

    if (request.input) {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [clearOutput, open, request, requestKey]);

  useEffect(() => {
    if (!open || !request || request.input) return;
    if (autoRunKeyRef.current === requestKey) return;
    autoRunKeyRef.current = requestKey;
    void execute();
  }, [execute, open, request, requestKey]);

  if (!request) {
    return null;
  }

  const previewCommandLine = request.input
    ? joinCommandLine(request.commandName, request.args, inputValue.trim() || `<${request.input.placeholder}>`)
    : joinCommandLine(request.commandName, request.args);

  const primaryLabel = request.input
    ? (running ? '执行中' : '执行')
    : (running ? '执行中' : combinedOutput ? '重新执行' : '执行');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex w-[min(96vw,1080px)] max-w-none flex-col gap-0 overflow-hidden p-0"
        resizableHeight
        defaultHeight={760}
        minHeight={520}
        maxHeight={920}
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <DialogHeader className="min-w-0 flex-1 text-left">
            <DialogTitle className="truncate">{request.title}</DialogTitle>
            <DialogDescription className="break-words">
              {request.input
                ? request.input.description
                : '命令执行完成后会在下面的终端区域展示输入和输出。'}
            </DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="shrink-0">
              <X className="h-4 w-4" />
            </Button>
          </DialogClose>
        </div>

        {request.input ? (
          <div className="border-b px-5 py-4">
            <div className="grid gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="codespec-cli-input">{request.input.label}</Label>
                <Input
                  id="codespec-cli-input"
                  ref={inputRef}
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  placeholder={request.input.placeholder}
                  disabled={running}
                  className={cn('font-mono')}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void execute();
                    }
                  }}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="break-all font-mono">{previewCommandLine}</span>
                <Button type="button" onClick={() => void execute()} disabled={running}>
                  {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  {primaryLabel}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="min-h-0 flex-1">
          <Terminal
            output={combinedOutput}
            isStreaming={running}
            onClear={clearOutput}
            className="h-full rounded-none border-0 bg-zinc-950 shadow-none"
          >
            <TerminalHeader className="border-zinc-800/80 bg-zinc-950/95">
              <TerminalTitle>{request.commandName}</TerminalTitle>
              <div className="flex items-center gap-2">
                <div className="hidden max-w-[42vw] truncate text-xs text-zinc-400 md:block">
                  {request.workingDirectory}
                </div>
                <div className="text-xs text-zinc-400">
                  {running ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      执行中
                    </span>
                  ) : exitCode != null ? (
                    `exit ${exitCode}`
                  ) : '待执行'}
                </div>
                <TerminalActions>
                  <TerminalCopyButton />
                  <TerminalClearButton />
                </TerminalActions>
              </div>
            </TerminalHeader>

            <div className="border-b border-zinc-800/80 px-4 py-2 text-xs text-zinc-400">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span className="font-mono break-all">cwd: {request.workingDirectory}</span>
                <span className="font-mono break-all">cmd: {previewCommandLine}</span>
              </div>
            </div>

            {!running && !combinedOutput ? (
              <div className="px-4 py-3 text-sm text-zinc-500">等待执行结果</div>
            ) : null}

            <TerminalContent className="max-h-[calc(100%-108px)] px-4 py-3 text-[12px] leading-5 text-zinc-100">
              {executableCommands.length > 0 ? (
                <div className="mb-3 rounded-lg border border-sky-400/20 bg-sky-400/10 p-2 font-sans text-xs text-sky-100">
                  <div className="mb-2 flex items-center gap-2 text-sky-200">
                    <span className="material-symbols-outlined text-[15px]">bolt</span>
                    <span>检测到可继续执行的 CodeSpec 命令</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {executableCommands.map((command) => (
                      <button
                        key={command.args.join('\u0000')}
                        type="button"
                        disabled={running}
                        onClick={() => void execute(command.args)}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-sky-300/25 bg-zinc-950/70 px-2 py-1 font-mono text-[11px] text-sky-100 transition-colors hover:border-sky-300/45 hover:bg-sky-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Play className="h-3 w-3 shrink-0" />
                        <span className="truncate">{command.commandLine}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <pre className="whitespace-pre-wrap break-words">
                <Ansi>{combinedOutput}</Ansi>
                {running && (
                  <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-zinc-100" />
                )}
              </pre>
            </TerminalContent>
          </Terminal>
        </div>

        {errorMessage ? (
          <div className="border-t border-red-500/20 bg-red-500/10 px-5 py-3 text-sm text-red-600">
            {errorMessage}
          </div>
        ) : null}

        <DialogFooter className="border-t px-5 py-4">
          <DialogClose asChild>
            <Button variant="outline">关闭</Button>
          </DialogClose>
          <Button type="button" onClick={() => void execute()} disabled={running}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
            {primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
