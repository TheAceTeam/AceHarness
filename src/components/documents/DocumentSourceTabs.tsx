'use client';

import type { RunDocumentSource } from '@/lib/core/api';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type DocumentSourceTabOption = {
  value: RunDocumentSource | 'all';
  label: string;
  count: number;
};

interface DocumentSourceTabsProps {
  activeSource: RunDocumentSource | 'all';
  lockedSource?: RunDocumentSource;
  options: DocumentSourceTabOption[];
  onSourceChange: (source: RunDocumentSource | 'all') => void;
}

export function DocumentSourceTabs({
  activeSource,
  lockedSource,
  options,
  onSourceChange,
}: DocumentSourceTabsProps) {
  if (lockedSource) return null;

  return (
    <Tabs value={activeSource} onValueChange={(value) => onSourceChange(value as RunDocumentSource | 'all')}>
      <TabsList className="h-7">
        {options.map((option) => (
          <TabsTrigger key={option.value} value={option.value} className="h-6 px-2 text-[11px]">
            {option.label}
            <span className="ml-1 text-[9px] opacity-70">{option.count}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
