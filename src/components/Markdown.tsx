'use client';

import { Children, isValidElement, useMemo, useState, useCallback, useEffect, useId } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { useToast } from '@/components/ui/toast';
import { workspaceApi } from '@/lib/api';
import { NOTEBOOK_OUTPUT_ATTR } from '@/lib/notebook-markdown';
import { copyText } from '@/lib/clipboard';
import { AnsiLogBlock } from '@/components/AnsiLogBlock';
import { Button } from '@/components/ui/button';
import styles from './Markdown.module.css';

function normalizeWindowsSeparators(input: string): string {
  return input.replace(/\\/g, '/');
}

function isUnixAbsolutePath(input: string): boolean {
  return input.startsWith('/');
}

function isWindowsDrivePath(input: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(input);
}

function isUncPath(input: string): boolean {
  return /^\\\\[^\\]+\\[^\\]+/.test(input) || /^\/\/[^/]+\/[^/]+/.test(input);
}

function toWorkspaceAbsolutePath(href: string): string | null {
  if (!href) return null;
  const raw = decodeURIComponent(String(href).trim());
  if (!raw) return null;

  if (isUnixAbsolutePath(raw) || isWindowsDrivePath(raw) || isUncPath(raw)) {
    return normalizeWindowsSeparators(raw);
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const path = decodeURIComponent(url.pathname || '');
      const normalizedPath = normalizeWindowsSeparators(path);
      if (/^\/[a-zA-Z]:\//.test(normalizedPath)) {
        return normalizedPath.slice(1);
      }
      if (isUnixAbsolutePath(normalizedPath) && (
        normalizedPath.startsWith('/root/') ||
        normalizedPath.startsWith('/usr') ||
        normalizedPath.startsWith('/home/') ||
        normalizedPath.startsWith('/tmp/') ||
        normalizedPath.startsWith('/mnt/') ||
        normalizedPath.startsWith('/var/') ||
        normalizedPath.startsWith('/opt/')
      )) {
        return normalizedPath;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function getWorkspaceLinkParts(absolutePath: string): { workspacePath: string; filePath: string | null } {
  const normalized = normalizeWindowsSeparators(absolutePath);
  const trimmed = normalized.replace(/\/+$/g, '');
  const slashIndex = trimmed.lastIndexOf('/');
  if (slashIndex <= 0) {
    return {
      workspacePath: trimmed || normalized,
      filePath: null,
    };
  }
  return {
    workspacePath: trimmed.slice(0, slashIndex) || '/',
    filePath: trimmed.slice(slashIndex + 1) || null,
  };
}

function isSummaryElement(child: unknown): child is React.ReactElement<any> {
  return isValidElement(child) && (
    child.type === 'summary' ||
    (child.props as any)?.node?.tagName === 'summary'
  );
}

function CopyButton({ text, className = 'absolute top-2 right-2' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      className={`${className} p-1.5 rounded text-xs bg-white/10 hover:bg-white/20 text-gray-300 transition-colors`}
      title="复制代码"
    >
      {copied ? (
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>check</span>
      ) : (
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>content_copy</span>
      )}
    </button>
  );
}

const verdictConfig: Record<string, { icon: string; label: string; color: string; bg: string; border: string }> = {
  pass: { icon: 'check_circle', label: '通过', color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/30' },
  conditional_pass: { icon: 'warning', label: '有条件通过', color: 'text-yellow-500', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
  fail: { icon: 'cancel', label: '未通过', color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/30' },
};

let basicHljsLanguagesRegistered = false;
let cangjieLanguageRegistered = false;
let highlightReady = false;
let mermaidInitialized = false;

function VerdictCard({ data }: { data: { verdict: string; remaining_issues?: number; summary?: string } }) {
  const cfg = verdictConfig[data.verdict] || verdictConfig.fail;
  return (
    <div className={`${cfg.bg} ${cfg.border} border rounded-lg p-3 my-2`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`material-symbols-outlined text-lg ${cfg.color}`}>{cfg.icon}</span>
        <span className={`font-semibold text-sm ${cfg.color}`}>{cfg.label}</span>
        {data.remaining_issues !== undefined && (
          <span className="text-xs text-muted-foreground ml-auto">
            剩余问题: <span className="font-mono font-semibold">{data.remaining_issues}</span>
          </span>
        )}
      </div>
      {data.summary && (
        <p className="text-xs leading-relaxed text-muted-foreground mt-1">{data.summary}</p>
      )}
    </div>
  );
}

function tryParseVerdict(code: string): { verdict: string; remaining_issues?: number; summary?: string } | null {
  try {
    const obj = JSON.parse(code.trim());
    if (obj && typeof obj.verdict === 'string' && (obj.verdict === 'pass' || obj.verdict === 'fail' || obj.verdict === 'conditional_pass')) {
      return obj;
    }
  } catch { /* not verdict json */ }
  return null;
}

function normalizeFenceLanguage(className?: string) {
  const raw = (className || '').match(/language-([A-Za-z0-9_-]+)/)?.[1]?.toLowerCase() || '';
  if (raw === 'cj' || raw === 'cangjie') return 'cangjie';
  return raw;
}

function renderHighlightedCode(code: string, language: string) {
  const normalizedLanguage = normalizeLanguage(language);

  if (shouldUseSyntaxHighlighter(normalizedLanguage)) {
    return (
      <SyntaxHighlighter
        language={normalizedLanguage}
        style={atomOneDark}
        customStyle={{
          margin: 0,
          background: '#282c34',
          color: '#e2e8f0',
          borderRadius: '0.375rem',
          padding: '1rem',
          fontSize: '13px',
          lineHeight: '1.5rem',
          overflowX: 'auto',
        }}
        codeTagProps={{
          style: {
            fontFamily: 'inherit',
            color: '#e2e8f0',
          },
        }}
        useInlineStyles
        wrapLongLines={false}
        PreTag="pre"
      >
        {code}
      </SyntaxHighlighter>
    );
  }

  return (
    <pre className="!mt-0 overflow-x-auto rounded-md bg-[#282c34] p-4 text-[13px] leading-6 text-slate-100">
      <code>{code}</code>
    </pre>
  );
}

function NotebookOutputDetails({ node, children, ...props }: any) {
  const summary = node?.properties?.['data-summary'] || 'Output';
  const output = node?.properties?.['data-output'] || '';
  const isNotebookOutput = node?.properties?.[NOTEBOOK_OUTPUT_ATTR] === 'true';

  if (!isNotebookOutput) {
    return (
      <details className="my-2 border border-border/50 rounded-md" {...props}>
        {children}
      </details>
    );
  }

  return (
    <div className="my-3 rounded-lg border bg-muted/30">
      <div className="border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{summary}</div>
      <div className="px-3 py-3">
        {renderHighlightedCode(String(output || ''), 'text')}
      </div>
    </div>
  );
}

function renderMarkdownFragment(content: string) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, rehypePreserveUnknownHtmlAsText]}
      components={components}
    >
      {preprocessMarkdown(content)}
    </ReactMarkdown>
  );
}

function normalizeLanguage(language: string) {
  if (language === 'cangjie') return cangjieLanguageRegistered ? 'cangjie' : 'text';
  if (language === 'shell') return 'bash';
  if (language === 'plaintext') return 'text';
  return language || 'text';
}

function shouldUseSyntaxHighlighter(language: string) {
  if (!highlightReady) return false;
  return ['cangjie', 'javascript', 'js', 'typescript', 'ts', 'json', 'html', 'xml', 'bash', 'shell', 'yaml', 'yml', 'markdown', 'md', 'python', 'py', 'java', 'cpp', 'c', 'sql'].includes(language);
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  return renderHighlightedCode(code, language);
}

function MermaidBlock({ code }: { code: string }) {
  const diagramId = useId().replace(/:/g, '-');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mod = await import('mermaid');
        const mermaid = mod.default || mod;
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'loose',
            theme: 'neutral',
          });
          mermaidInitialized = true;
        }
        const result = await mermaid.render(`mermaid-${diagramId}`, code);
        if (cancelled) return;
        setSvg(result.svg);
        setError(null);
      } catch (err: any) {
        if (cancelled) return;
        setSvg('');
        setError(err?.message || 'Mermaid 渲染失败');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, diagramId]);

  return (
    <div className="my-3 rounded-lg border border-border/60 bg-background/70 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">Mermaid</div>
        <CopyButton text={code} className="static" />
      </div>
      {svg ? (
        <div
          className="overflow-x-auto rounded-md bg-white p-3 dark:bg-slate-950"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          {error || 'Mermaid 渲染中...'}
        </div>
      )}
      {error ? (
        <details className="mt-3 rounded-md border border-border/50">
          <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">查看 Mermaid 源码</summary>
          <div className="p-3">
            <CodeBlock code={code} language="text" />
          </div>
        </details>
      ) : null}
    </div>
  );
}

const DETAILS_LAZY_CHAR_THRESHOLD = 120000;
const DETAILS_LAZY_LINE_THRESHOLD = 2000;

function LazyDetailsBody({
  bodyText,
  bodyNodes,
  open,
}: {
  bodyText: string;
  bodyNodes: any[];
  open: boolean;
}) {
  const [contentLoaded, setContentLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    const lineCount = bodyText ? bodyText.split(/\r?\n/).length : 0;
    const shouldLazyLoad = bodyText.length > DETAILS_LAZY_CHAR_THRESHOLD || lineCount > DETAILS_LAZY_LINE_THRESHOLD;
    if (!shouldLazyLoad) {
      setContentLoaded(true);
    }
  }, [bodyText, open]);

  useEffect(() => {
    if (!open) {
      setContentLoaded(false);
    }
  }, [open]);

  if (!open) return null;

  const lineCount = bodyText ? bodyText.split(/\r?\n/).length : 0;
  const shouldLazyLoad = bodyText.length > DETAILS_LAZY_CHAR_THRESHOLD || lineCount > DETAILS_LAZY_LINE_THRESHOLD;

  if (shouldLazyLoad && !contentLoaded) {
    return (
      <div className="px-3 py-3 space-y-3">
        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs leading-6 text-muted-foreground">
          这段详情较大，约 {lineCount.toLocaleString()} 行 / {bodyText.length.toLocaleString()} 字符。默认不立即渲染，避免实时输出卡顿。
        </div>
        <Button size="sm" variant="outline" onClick={() => setContentLoaded(true)}>
          加载详情内容
        </Button>
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      {bodyText ? renderMarkdownFragment(bodyText) : null}
      {bodyNodes}
    </div>
  );
}

function RunnableCodeBlock({ code, language }: { code: string; language: string }) {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);

  const isCangjie = language === 'cangjie';

  const runCode = useCallback(async () => {
    setRunning(true);
    try {
      const data = await workspaceApi.runCangjie(code, 'snippet.cj', 'markdown');
      setResult(data);
    } catch (error: any) {
      toast('error', error.message || '运行失败');
    } finally {
      setRunning(false);
    }
  }, [code, toast]);

  return (
    <div className="relative group my-2">
      <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
        {isCangjie && (
          <button
            onClick={runCode}
            disabled={running}
            className="p-1.5 rounded text-xs bg-primary/20 hover:bg-primary/30 text-primary transition-colors disabled:opacity-50"
            title="运行仓颉代码"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{running ? 'progress_activity' : 'play_arrow'}</span>
          </button>
        )}
        <CopyButton text={code} className="static" />
      </div>
      <CodeBlock code={code} language={language} />
      {isCangjie && (running || result) && (
        <div className="mt-2 rounded-md border bg-muted/30 p-3 text-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium text-foreground">运行结果</span>
            {result?.exitCode != null && <span className="text-xs text-muted-foreground">exit code: {result.exitCode}</span>}
          </div>
          {running ? (
            <div className="text-muted-foreground">运行中...</div>
          ) : (
            <div className="space-y-2">
              {result?.stdout && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">stdout</div>
                  <AnsiLogBlock text={result.stdout} />
                </div>
              )}
              {result?.stderr && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">stderr</div>
                  <AnsiLogBlock text={result.stderr} />
                </div>
              )}
              {!result?.stdout && !result?.stderr && <div className="text-muted-foreground">无输出</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const components = {
  code({ className, children, ...props }: any) {
    const language = normalizeFenceLanguage(className);
    const code = String(children).replace(/\n$/, '');
    const isMultiLine = code.includes('\n');

    if (language === 'mermaid') {
      return <MermaidBlock code={code} />;
    }

    if (language === 'json') {
      const verdict = tryParseVerdict(code);
      if (verdict) return <VerdictCard data={verdict} />;
    }

    if (language || isMultiLine) {
      return <RunnableCodeBlock code={code} language={language || 'text'} />;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  pre({ node: _node, children, ...props }: any) {
    const parts = Children.toArray(children);
    if (parts.length === 1 && isValidElement(parts[0])) {
      return <>{parts[0]}</>;
    }
    return <pre {...props}>{children}</pre>;
  },
  a({ href, children, ...props }: any) {
    const isGitCode = href && href.includes('gitcode.com');
    const workspaceAbsolutePath = href ? toWorkspaceAbsolutePath(href) : null;

    if (workspaceAbsolutePath) {
      const { workspacePath, filePath } = getWorkspaceLinkParts(workspaceAbsolutePath);
      return (
        <button
          type="button"
          className="font-semibold text-current underline decoration-current/70 underline-offset-4 hover:opacity-80"
          onClick={() => {
            if (typeof window === 'undefined') return;
            window.dispatchEvent(new CustomEvent('ace:open-workspace-path', {
              detail: {
                absolutePath: workspaceAbsolutePath,
                workspacePath,
                filePath,
              },
            }));
          }}
        >
          {children}
        </button>
      );
    }

    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
          {isGitCode && (
            <svg className="inline-block w-4 h-4 mr-1 align-text-bottom" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
              <path d="M685.679715 183.998617l-40.447039 22.783459-9.343778 5.418538a203.259173 203.259173 0 0 1-124.583708 30.463276 239.268984 239.268984 0 0 0-81.192739 5.20521c-46.71889 12.714365-89.171216 4.778553-132.348856-12.543702a316.749811 316.749811 0 0 0-33.791198-9.045119l1.023976 24.106094c0.597319 14.506322 1.151973 27.988669 2.133283 41.471015 2.389277 31.572583-6.058523 60.286568-21.418158 88.189906a387.190804 387.190804 0 0 0-50.601465 196.390002c2.389277 111.570684 69.630346 194.427382 182.438334 230.010538 99.069647 31.31659 198.736613 29.951289 298.232917 5.546534a279.502695 279.502695 0 0 0 141.649969-83.752677c9.258447-10.026429 17.492918-20.991501 24.575416-32.681891 28.841982-48.68151 9.557106-94.205763-46.505562-103.464209a312.184586 312.184586 0 0 0-44.798936-3.413252l-15.146307-0.255994c-14.079666-0.127997-28.116666-0.255994-42.068334-1.450632-48.169523-3.92524-96.424377-8.277137-144.124577-15.786292-23.679438-3.839909-43.561632-19.412872-46.3349-45.35359-2.986596-28.500656 4.693222-57.214641 31.401921-71.038312a202.917847 202.917847 0 0 1 76.968839-23.46611c81.022076-5.759863 162.470808-0.511988 242.127582 15.487632 139.431355 28.585988 212.261625 166.268051 145.27655 292.259726-94.504422 177.489118-242.468908 279.886686-447.98936 284.707905-160.422857 3.839909-301.731501-47.102881-413.003525-165.244076C-122.365094 582.410488 3.071927 132.074517 369.612555 23.917085c169.979963-49.918814 327.800215-21.332827 471.45547 82.302046 51.625441 37.247115 64.851793 99.112313 34.473848 149.628446-25.258067 42.111-72.104954 61.182547-121.853106 49.66282-31.99924-7.466489-55.124024-38.996407-61.395876-82.472707l-0.98131-8.277137a123.474401 123.474401 0 0 0-1.791957-11.434395l-3.839909-19.327541z" fill="#DA203E"></path>
            </svg>
          )}
          {children}
        </a>
      );
    }
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
  details({ node, children, ...props }: any) {
    if (node?.properties?.[NOTEBOOK_OUTPUT_ATTR] === 'true') {
      return <NotebookOutputDetails node={node} {...props}>{children}</NotebookOutputDetails>;
    }

    const [open, setOpen] = useState(Boolean(props.open));
    const parts = Children.toArray(children);
    const summaryNode = parts.find(isSummaryElement) || null;
    const bodyText = parts
      .filter((child) => child !== summaryNode && typeof child === 'string')
      .join('')
      .trim();
    const bodyNodes = parts.filter((child) => child !== summaryNode && typeof child !== 'string');

    return (
      <details
        className="my-2 border border-border/50 rounded-md"
        {...props}
        onToggle={(event: any) => {
          setOpen(Boolean(event.currentTarget?.open));
          props.onToggle?.(event);
        }}
      >
        {summaryNode}
        {(bodyText || bodyNodes.length > 0) ? (
          <LazyDetailsBody bodyText={bodyText} bodyNodes={bodyNodes} open={open} />
        ) : null}
      </details>
    );
  },
  summary({ node: _node, children, ...props }: any) {
    return (
      <summary className="cursor-pointer px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground select-none" {...props}>
        {children}
      </summary>
    );
  },
};

const ALLOWED_RAW_HTML_TAGS = new Set([
  'a','abbr','address','area','article','aside','audio','b','base','bdi','bdo','blockquote',
  'body','br','button','canvas','caption','cite','code','col','colgroup','data','datalist',
  'dd','del','details','dfn','dialog','div','dl','dt','em','embed','fieldset','figcaption',
  'figure','footer','form','h1','h2','h3','h4','h5','h6','head','header','hgroup','hr',
  'html','i','iframe','img','input','ins','kbd','label','legend','li','link','main','map',
  'mark','menu','meta','meter','nav','noscript','object','ol','optgroup','option','output',
  'p','param','picture','pre','progress','q','rp','rt','ruby','s','samp','script','search',
  'section','select','slot','small','source','span','strong','style','sub','summary','sup',
  'table','tbody','td','template','textarea','tfoot','th','thead','time','title','tr','track',
  'u','ul','var','video','wbr',
]);

function stringifyUnknownHtmlNode(node: any): string {
  if (!node) return '';

  if (node.type === 'text') {
    return String(node.value || '');
  }

  if (node.type === 'element') {
    const inner = Array.isArray(node.children) ? node.children.map(stringifyUnknownHtmlNode).join('') : '';
    return `<${node.tagName}>${inner}</${node.tagName}>`;
  }

  if (Array.isArray(node.children)) {
    return node.children.map(stringifyUnknownHtmlNode).join('');
  }

  return '';
}

function rehypePreserveUnknownHtmlAsText() {
  function transform(node: any) {
    if (!Array.isArray(node?.children)) return;

    node.children = node.children.map((child: any) => {
      if (child?.type === 'element' && !ALLOWED_RAW_HTML_TAGS.has(child.tagName?.toLowerCase?.() || '')) {
        return { type: 'text', value: stringifyUnknownHtmlNode(child) };
      }

      transform(child);
      return child;
    });
  }

  return transform;
}

function normalizeMarkdownInput(content: unknown): string {
  return typeof content === 'string' ? content : '';
}

function closeUnterminatedFences(content: unknown): string {
  const safeContent = normalizeMarkdownInput(content);
  const lines = safeContent.split('\n');
  let inCodeBlock = false;
  let fenceWidth = 0;
  let fenceChar: '`' | '~' | null = null;

  for (const line of lines) {
    if (!inCodeBlock) {
      const m = line.match(/^(`{3,}|~{3,})/);
      if (m) {
        inCodeBlock = true;
        fenceWidth = m[1].length;
        fenceChar = m[1][0] as '`' | '~';
      }
    } else {
      const closeRe = fenceChar === '~' ? /^(~{3,})\s*$/ : /^(`{3,})\s*$/;
      const m = line.match(closeRe);
      if (m && m[1].length >= fenceWidth) {
        inCodeBlock = false;
        fenceChar = null;
      }
    }
  }

  if (inCodeBlock && fenceChar) {
    return safeContent + '\n' + fenceChar.repeat(fenceWidth);
  }
  return safeContent;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTaskStatusLines(content: string): string {
  const lines = content.split('\n');
  let inCodeBlock = false;
  let fenceWidth = 0;
  let fenceChar: '`' | '~' | null = null;

  return lines.map((line) => {
    if (!inCodeBlock) {
      const fenceOpen = line.match(/^(`{3,}|~{3,})/);
      if (fenceOpen) {
        inCodeBlock = true;
        fenceWidth = fenceOpen[1].length;
        fenceChar = fenceOpen[1][0] as '`' | '~';
        return line;
      }

      const taskLine = line.match(/^(\s*)-\s+\[([ xX-])\]\s+(.+)$/);
      if (!taskLine) return line;

      const marker = taskLine[2].toLowerCase();
      const body = taskLine[3];
      const bodyWithoutComment = body.replace(/\s*<!--[\s\S]*?-->\s*$/g, '').trim();
      const escapedBody = escapeHtml(bodyWithoutComment);

      if (marker === 'x') {
        return `${taskLine[1]}- <span class="ace-task-line ace-task-line--completed"><span class="ace-task-badge ace-task-badge--completed">[x] 已完成</span><span class="ace-task-text">${escapedBody}</span></span>`;
      }
      if (marker === '-') {
        return `${taskLine[1]}- <span class="ace-task-line ace-task-line--active"><span class="ace-task-badge ace-task-badge--active"><span class="ace-task-dot"></span>[-] 进行中</span><span class="ace-task-text">${escapedBody}</span></span>`;
      }
      return `${taskLine[1]}- <span class="ace-task-line ace-task-line--pending"><span class="ace-task-badge ace-task-badge--pending">[ ] 待处理</span><span class="ace-task-text">${escapedBody}</span></span>`;
    }

    const closeRe = fenceChar === '~' ? /^(~{3,})\s*$/ : /^(`{3,})\s*$/;
    const fenceClose = line.match(closeRe);
    if (fenceClose && fenceClose[1].length >= fenceWidth) {
      inCodeBlock = false;
      fenceChar = null;
    }
    return line;
  }).join('\n');
}

function stripHiddenOpenSpecComments(content: string): string {
  return content.replace(/\s*<!--\s*openspec-task:[\s\S]*?-->\s*$/gm, '');
}

function preprocessMarkdown(content: unknown): string {
  const closed = closeUnterminatedFences(content);
  return renderTaskStatusLines(stripHiddenOpenSpecComments(closed)).replace(
    /(?<![<"\[])(https?:\/\/[^\s<>\]")]+)/g,
    '<$1>'
  );
}

export default function Markdown({ children }: { children?: string | null }) {
  const processedContent = useMemo(() => preprocessMarkdown(children), [children]);
  const [, forceRefresh] = useState(0);

  useEffect(() => {
    if (highlightReady) return;

    let cancelled = false;

    (async () => {
      try {
        const [
          { default: javascript },
          { default: typescript },
          { default: json },
          { default: xml },
          { default: bash },
          { default: yaml },
          { default: markdown },
          { default: python },
          { default: java },
          { default: cpp },
          { default: sql },
        ] = await Promise.all([
          import('react-syntax-highlighter/dist/esm/languages/hljs/javascript'),
          import('react-syntax-highlighter/dist/esm/languages/hljs/typescript'),
          import('react-syntax-highlighter/dist/esm/languages/hljs/json'),
          import('react-syntax-highlighter/dist/esm/languages/hljs/xml'),
          import('react-syntax-highlighter/dist/esm/languages/hljs/bash'),
          import('react-syntax-highlighter/dist/esm/languages/hljs/yaml'),
          import('react-syntax-highlighter/dist/esm/languages/hljs/markdown'),
          import('react-syntax-highlighter/dist/esm/languages/hljs/python'),
          import('react-syntax-highlighter/dist/esm/languages/hljs/java'),
          import('react-syntax-highlighter/dist/esm/languages/hljs/cpp'),
          import('react-syntax-highlighter/dist/esm/languages/hljs/sql'),
        ]);

        if (cancelled) return;

        if (!basicHljsLanguagesRegistered) {
          SyntaxHighlighter.registerLanguage('javascript', javascript);
          SyntaxHighlighter.registerLanguage('js', javascript);
          SyntaxHighlighter.registerLanguage('typescript', typescript);
          SyntaxHighlighter.registerLanguage('ts', typescript);
          SyntaxHighlighter.registerLanguage('json', json);
          SyntaxHighlighter.registerLanguage('html', xml);
          SyntaxHighlighter.registerLanguage('xml', xml);
          SyntaxHighlighter.registerLanguage('bash', bash);
          SyntaxHighlighter.registerLanguage('shell', bash);
          SyntaxHighlighter.registerLanguage('yaml', yaml);
          SyntaxHighlighter.registerLanguage('yml', yaml);
          SyntaxHighlighter.registerLanguage('markdown', markdown);
          SyntaxHighlighter.registerLanguage('md', markdown);
          SyntaxHighlighter.registerLanguage('python', python);
          SyntaxHighlighter.registerLanguage('py', python);
          SyntaxHighlighter.registerLanguage('java', java);
          SyntaxHighlighter.registerLanguage('cpp', cpp);
          SyntaxHighlighter.registerLanguage('c', cpp);
          SyntaxHighlighter.registerLanguage('sql', sql);
          basicHljsLanguagesRegistered = true;
        }

        if (!cangjieLanguageRegistered) {
          const mod = await import('@/lib/cangjie-highlight');
          if (cancelled) return;
          const cangjie = mod.default || mod;
          if (typeof cangjie === 'function') {
            SyntaxHighlighter.registerLanguage('cangjie', cangjie);
            SyntaxHighlighter.registerLanguage('cj', cangjie);
            cangjieLanguageRegistered = true;
          }
        }

        highlightReady = basicHljsLanguagesRegistered && cangjieLanguageRegistered;
        if (!cancelled && highlightReady) {
          forceRefresh((value) => value + 1);
        }
      } catch {
        // ignore and fall back to plain text rendering
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.markdownContent}>
      {renderMarkdownFragment(processedContent)}
    </div>
  );
}
