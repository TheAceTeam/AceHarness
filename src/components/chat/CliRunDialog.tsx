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

export default function CliRunDialog({ open, request, onOpenChange }: CliRunDialogProps) {
  const { toast } = useToast();
  const [inputValue, setInputValue] = useState('');
  const [running, setRunning] = useState(false);
  const [stdout, setStdout] = useState('');
  const [stderr, setStderr] = useState('');
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
    return [stdout, stderr].filter(Boolean).join(stdout && stderr ? '\n' : '');
  }, [stdout, stderr]);

  const clearOutput = useCallback(() => {
    setStdout('');
    setStderr('');
    setExitCode(null);
    setErrorMessage('');
  }, []);

  const execute = useCallback(async () => {
    if (!request) return;

    const runId = ++runSeqRef.current;
    const trimmedInput = inputValue.trim();
    if (request.input) {
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
    setStdout('');
    setStderr('');
    setExitCode(null);

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
          args: request.input
            ? [...request.args, trimmedInput]
            : request.args,
        }),
      });
      const data = await response.json().catch(() => null);
      const stdoutText = typeof data?.stdout === 'string' ? data.stdout : '';
      const stderrText = typeof data?.stderr === 'string' ? data.stderr : '';
      const resultExitCode = typeof data?.exitCode === 'number' ? data.exitCode : null;
      const success = response.ok && data?.success !== false;

      if (runSeqRef.current !== runId) return;

      setStdout(stdoutText);
      setStderr(stderrText);
      setExitCode(resultExitCode);
      setErrorMessage(success ? '' : (typeof data?.error === 'string' && data.error.trim()
        ? data.error
        : `${request.title} 执行失败`));

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
    } finally {
      if (runSeqRef.current !== runId) return;
      setRunning(false);
    }
  }, [inputValue, request, toast]);

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

            <TerminalContent className="max-h-[calc(100%-108px)] px-4 py-3 text-[12px] leading-5 text-zinc-100" />
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
