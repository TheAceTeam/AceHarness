'use client';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { EffortSlider } from '@/components/ui/effort-slider';
import { useTranslations } from '@/hooks/useTranslations';

export function ModelEffortSelect({ value, efforts, onChange }: {
  value: string;
  efforts?: string[];
  onChange: (value: string) => void;
}) {
  const { t } = useTranslations();
  const choices = [...new Set([...(efforts || []), ...(value ? [value] : [])])];
  if (!choices.length) return null;
  return <Popover>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="sm" className="h-8 shrink-0 rounded-full px-2 text-xs font-normal" aria-label={t('modelEfforts.label')}>
        {value || t('modelEfforts.label')}
      </Button>
    </PopoverTrigger>
    <PopoverContent side="top" align="end" className="w-[min(280px,calc(100vw-2rem))] border-0 bg-transparent p-0 shadow-none">
      <EffortSlider value={value || choices[0]} efforts={choices} onValueChange={onChange} className="w-full" />
      <Button variant="ghost" size="sm" className="mt-1 h-7 bg-popover text-xs shadow-sm" onClick={() => onChange('')}>{t('modelEfforts.default')}</Button>
    </PopoverContent>
  </Popover>;
}
