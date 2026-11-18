import { useEffect, useId, useState } from 'react';
import { renderMermaidDiagram } from '@/lib/markdown/pele';

export function WorkflowBoardDiagram({ code }: { code: string }) {
  const id = useId();
  const [result, setResult] = useState<{ code: string; svg?: string; error?: string }>();

  useEffect(() => {
    let active = true;
    void renderMermaidDiagram(code, id).then(({ svg }) => {
      if (active) setResult({ code, svg });
    }, (error: unknown) => {
      if (active) setResult({ code, error: error instanceof Error ? error.message : '图表渲染失败' });
    });
    return () => { active = false; };
  }, [code, id]);

  if (result?.code === code && result.svg) {
    return (
      <div
        className="h-full min-h-0 w-full min-w-0 overflow-hidden [&>svg]:block [&>svg]:!h-full [&>svg]:!w-full"
        dangerouslySetInnerHTML={{ __html: result.svg }}
      />
    );
  }

  const error = result?.code === code ? result.error : undefined;
  return <div className="truncate px-2 text-sm text-muted-foreground" title={error} role="status">{error || '正在渲染图表…'}</div>;
}
