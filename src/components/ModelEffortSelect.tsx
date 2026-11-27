'use client';

export function ModelEffortSelect({ value, efforts, onChange }: {
  value: string;
  efforts?: string[];
  onChange: (value: string) => void;
}) {
  const choices = [...new Set([...(efforts || []), ...(value ? [value] : [])])];
  return <select aria-label="Effort" title={choices.length ? '选择模型的推理强度' : '尚无支持的 effort，请检测并导入模型'} disabled={!choices.length} className="h-8 max-w-36 shrink-0 rounded-md border bg-background px-2 text-xs disabled:opacity-60" value={value} onChange={event => onChange(event.target.value)}>
    <option value="">{choices.length ? 'Effort：默认' : 'Effort：未检测'}</option>
    {choices.map(effort => <option key={effort} value={effort}>{effort}</option>)}
  </select>;
}
