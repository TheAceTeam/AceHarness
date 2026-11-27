'use client';
import { SingleCombobox } from '@/components/ui/combobox';
import { useTranslations } from '@/hooks/useTranslations';

export function ModelEffortSelect({ value, efforts, onChange }: {
  value: string;
  efforts?: string[];
  onChange: (value: string) => void;
}) {
  const { t } = useTranslations();
  const choices = [...new Set([...(efforts || []), ...(value ? [value] : [])])];
  return <div className="w-28 shrink-0" aria-label={t('modelEfforts.label')}>
    <SingleCombobox value={value} onValueChange={onChange}
      options={[{ value: '', label: t('modelEfforts.default') }, ...choices.map(effort => ({ value: effort, label: effort }))]}
      disabled={!choices.length} placeholder={t('modelEfforts.label')}
      triggerLabel={value || t('modelEfforts.label')}
      triggerClassName="h-8 rounded-full border-0 bg-transparent text-xs shadow-none focus-within:ring-1"
      emptyText={t('modelEfforts.empty')} />
  </div>;
}
