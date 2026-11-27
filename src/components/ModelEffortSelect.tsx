'use client';

export function ModelEffortSelect({ value, efforts, onChange }: {
  value: string;
  efforts?: string[];
  onChange: (value: string) => void;
}) {
  const choices = [...new Set([...(efforts || []), ...(value ? [value] : [])])];
  if (!choices.length) return null;
  return <select aria-label="Effort" className="h-8 max-w-32 shrink-0 rounded-md border bg-background px-2 text-xs" value={value} onChange={event => onChange(event.target.value)}>
    <option value="">默认 effort</option>
    {choices.map(effort => <option key={effort} value={effort}>{effort}</option>)}
  </select>;
}
