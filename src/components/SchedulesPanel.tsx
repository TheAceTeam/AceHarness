'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SingleCombobox, ComboboxPortalProvider } from '@/components/ui/combobox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useTranslations } from '@/hooks/useTranslations';
import { useConfigOptionsQuery } from '@/client/query/configs';
import {
  useCreateScheduleMutation,
  useDeleteScheduleMutation,
  useSchedulesQuery,
  useToggleScheduleMutation,
  useTriggerScheduleMutation,
  useUpdateScheduleMutation,
  type ScheduleJob,
  type SchedulePayload,
} from '@/client/query/schedules';

function formatTime(iso?: string) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleString('zh-CN'); } catch { return iso; }
}

export default function SchedulesPanel({ configFile }: { configFile?: string }) {
  const { toast } = useToast();
  const { t } = useTranslations();
  const { confirm, dialogProps } = useConfirmDialog();
  const WEEKDAYS = [0,1,2,3,4,5,6].map(i => t(`schedules.weekdays.${i}`));
  const schedulesQuery = useSchedulesQuery();
  const configOptionsQuery = useConfigOptionsQuery();
  const createScheduleMutation = useCreateScheduleMutation();
  const updateScheduleMutation = useUpdateScheduleMutation();
  const deleteScheduleMutation = useDeleteScheduleMutation();
  const toggleScheduleMutation = useToggleScheduleMutation();
  const triggerScheduleMutation = useTriggerScheduleMutation();
  const jobs = useMemo(() => {
    const allJobs = schedulesQuery.data?.jobs || [];
    return configFile ? allJobs.filter((job) => job.configFile === configFile) : allJobs;
  }, [configFile, schedulesQuery.data?.jobs]);
  const configs = useMemo(() => (
    (configOptionsQuery.data?.configs || []).map((config) => ({
      filename: config.filename,
      name: config.name || config.filename,
    }))
  ), [configOptionsQuery.data?.configs]);
  const loading = schedulesQuery.isLoading || configOptionsQuery.isLoading;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<ScheduleJob | null>(null);

  const [formName, setFormName] = useState('');
  const [formConfig, setFormConfig] = useState('');
  const [formMode, setFormMode] = useState<'simple' | 'cron'>('simple');
  const [formIntervalValue, setFormIntervalValue] = useState(1);
  const [formIntervalUnit, setFormIntervalUnit] = useState<'hour' | 'day' | 'week'>('day');
  const [formHour, setFormHour] = useState(0);
  const [formMinute, setFormMinute] = useState(0);
  const [formWeekday, setFormWeekday] = useState(1);
  const [formCron, setFormCron] = useState('0 0 * * *');
  const [formEnabled, setFormEnabled] = useState(true);

  useEffect(() => {
    if (schedulesQuery.isError) {
      toast('error', (schedulesQuery.error as Error)?.message || t('schedules.messages.loadFailed'));
    } else if (configOptionsQuery.isError) {
      toast('error', (configOptionsQuery.error as Error)?.message || t('schedules.messages.loadFailed'));
    }
  }, [configOptionsQuery.error, configOptionsQuery.isError, schedulesQuery.error, schedulesQuery.isError, t, toast]);

  const resetForm = (job?: ScheduleJob) => {
    if (job) {
      setFormName(job.name); setFormConfig(job.configFile); setFormMode(job.mode);
      setFormIntervalValue(job.interval?.value ?? 1); setFormIntervalUnit(job.interval?.unit ?? 'day');
      setFormHour(job.fixedTime?.hour ?? 0); setFormMinute(job.fixedTime?.minute ?? 0);
      setFormWeekday(job.fixedTime?.weekday ?? 1); setFormCron(job.cronExpression || '0 0 * * *');
      setFormEnabled(job.enabled);
    } else {
      setFormName(''); setFormConfig(configFile || configs[0]?.filename || '');
      setFormMode('simple'); setFormIntervalValue(1); setFormIntervalUnit('day');
      setFormHour(0); setFormMinute(0); setFormWeekday(1); setFormCron('0 0 * * *'); setFormEnabled(true);
    }
  };

  const openCreate = () => { setEditingJob(null); resetForm(); setDialogOpen(true); };
  const openEdit = (job: ScheduleJob) => { setEditingJob(job); resetForm(job); setDialogOpen(true); };

  const handleSave = async () => {
    if (!formName.trim() || !formConfig) { toast('error', t('schedules.messages.fillRequired')); return; }
    const payload: SchedulePayload = { name: formName.trim(), configFile: formConfig, enabled: formEnabled, mode: formMode };
    if (formMode === 'simple') {
      payload.interval = { value: formIntervalValue, unit: formIntervalUnit };
      if (formIntervalUnit !== 'hour') {
        payload.fixedTime = { hour: formHour, minute: formMinute };
        if (formIntervalUnit === 'week') payload.fixedTime.weekday = formWeekday;
      }
    } else { payload.cronExpression = formCron; }
    try {
      if (editingJob) { await updateScheduleMutation.mutateAsync({ id: editingJob.id, payload }); toast('success', t('schedules.messages.updated')); }
      else { await createScheduleMutation.mutateAsync(payload); toast('success', t('schedules.messages.created')); }
      setDialogOpen(false);
    } catch (e: any) { toast('error', e.message); }
  };

  const handleToggle = async (job: ScheduleJob) => {
    try { await toggleScheduleMutation.mutateAsync(job.id); } catch { toast('error', t('schedules.messages.toggleFailed')); }
  };
  const handleTrigger = async (job: ScheduleJob) => {
    try { await triggerScheduleMutation.mutateAsync(job.id); toast('success', `${t('schedules.messages.triggered')} "${job.name}"`); } catch { toast('error', t('schedules.messages.triggerFailed')); }
  };
  const handleDelete = async (job: ScheduleJob) => {
    const ok = await confirm({ title: t('schedules.messages.deleteTitle'), description: `${t('schedules.messages.deleteConfirm')} "${job.name}"?`, confirmLabel: t('common.delete'), variant: 'destructive' });
    if (!ok) return;
    try { await deleteScheduleMutation.mutateAsync(job.id); toast('success', t('schedules.messages.deleted')); } catch { toast('error', t('schedules.messages.deleteFailed')); }
  };

  const describeSchedule = (job: ScheduleJob): string => {
    if (job.mode === 'cron') return `Cron: ${job.cronExpression}`;
    if (job.interval) {
      const { value, unit } = job.interval;
      let desc = `${t('schedules.units.every')} ${value} ${t(`schedules.units.${unit}`)}`;
      if (job.fixedTime && (unit === 'day' || unit === 'week'))
        desc += ` ${String(job.fixedTime.hour).padStart(2, '0')}:${String(job.fixedTime.minute).padStart(2, '0')}`;
      if (job.fixedTime?.weekday !== undefined && unit === 'week') desc += ` ${WEEKDAYS[job.fixedTime.weekday]}`;
      return desc;
    }
    return job.cronExpression || '-';
  };

  return (
    <div className="h-full flex flex-col p-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold">{t('schedules.title')}</h4>
        <Button size="sm" onClick={openCreate}><span className="material-symbols-outlined text-sm mr-1">add</span>{t('schedules.new')}</Button>
      </div>

      {loading ? (
        <div className="text-center py-10 text-muted-foreground text-sm">{t('common.loading')}</div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-10">
          <span className="material-symbols-outlined text-4xl text-muted-foreground/40 mb-3 block">schedule</span>
          <p className="text-sm text-muted-foreground mb-3">{t('schedules.empty')}</p>
          <Button size="sm" onClick={openCreate}>{t('schedules.createFirst')}</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {jobs.map(job => (
            <div key={job.id} className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{job.name}</div>
                <div className="text-xs text-muted-foreground font-mono">{describeSchedule(job)}</div>
                {job.lastRunTime && <div className="text-xs text-muted-foreground mt-0.5">{t('schedules.columns.lastRun')}: {formatTime(job.lastRunTime)}</div>}
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-2">
                <Switch checked={job.enabled} onCheckedChange={() => handleToggle(job)} />
                <Button variant="ghost" size="sm" onClick={() => openEdit(job)} title={t('schedules.actions.edit')}>
                  <span className="material-symbols-outlined text-sm">edit</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleTrigger(job)} title={t('schedules.actions.run')}>
                  <span className="material-symbols-outlined text-sm">play_arrow</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(job)} title={t('schedules.actions.delete')} className="text-destructive hover:bg-destructive/10 hover:text-destructive">
                  <span className="material-symbols-outlined text-sm">delete</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <ComboboxPortalProvider>
          <DialogHeader className="mb-2">
            <DialogTitle>{editingJob ? t('schedules.dialog.editTitle') : t('schedules.dialog.createTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label>{t('schedules.dialog.name')}</Label><Input value={formName} onChange={e => setFormName(e.target.value)} placeholder={t('schedules.dialog.namePlaceholder')} /></div>
            <div><Label>{t('schedules.dialog.configFile')}</Label>
              <SingleCombobox
                value={formConfig}
                onValueChange={setFormConfig}
                options={configs.map(c => ({ value: c.filename, label: `${c.name} (${c.filename})` }))}
                placeholder={t('schedules.dialog.selectConfig')}
              />
            </div>
            <div><Label>{t('schedules.dialog.scheduleMode')}</Label>
              <Tabs value={formMode} onValueChange={v => setFormMode(v as 'simple' | 'cron')}>
                <TabsList className="w-full">
                  <TabsTrigger value="simple" className="flex-1">{t('schedules.dialog.simpleMode')}</TabsTrigger>
                  <TabsTrigger value="cron" className="flex-1">{t('schedules.dialog.cronMode')}</TabsTrigger>
                </TabsList>
                <TabsContent value="simple" className="space-y-3 mt-3">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1"><Label>{t('schedules.dialog.intervalType')}</Label>
                      <SingleCombobox
                        value={formIntervalUnit}
                        onValueChange={v => setFormIntervalUnit(v as any)}
                        options={[
                          { value: 'hour', label: t('schedules.dialog.everyNHours') },
                          { value: 'day', label: t('schedules.dialog.daily') },
                          { value: 'week', label: t('schedules.dialog.weekly') },
                        ]}
                        searchable={false}
                      />
                    </div>
                    {formIntervalUnit === 'hour' && <div className="w-24"><Label>{t('schedules.dialog.interval')}</Label><Input type="number" min={1} max={23} value={formIntervalValue} onChange={e => setFormIntervalValue(Number(e.target.value))} /></div>}
                  </div>
                  {formIntervalUnit !== 'hour' && (
                    <div className="flex gap-2 items-end">
                      {formIntervalUnit === 'week' && <div className="flex-1"><Label>{t('schedules.dialog.weekday')}</Label>
                        <SingleCombobox
                          value={String(formWeekday)}
                          onValueChange={v => setFormWeekday(Number(v))}
                          options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))}
                          searchable={false}
                        /></div>}
                      <div className="w-20"><Label>{t('schedules.dialog.hour')}</Label><Input type="number" min={0} max={23} value={formHour} onChange={e => setFormHour(Number(e.target.value))} /></div>
                      <div className="w-20"><Label>{t('schedules.dialog.minute')}</Label><Input type="number" min={0} max={59} value={formMinute} onChange={e => setFormMinute(Number(e.target.value))} /></div>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="cron" className="space-y-3 mt-3">
                  <div><Label>{t('schedules.dialog.cronExpression')}</Label><Input value={formCron} onChange={e => setFormCron(e.target.value)} placeholder="0 0 * * *" className="font-mono" />
                    <p className="text-xs text-muted-foreground mt-1">{t('schedules.dialog.cronHelp')}</p></div>
                </TabsContent>
              </Tabs>
            </div>
            <div className="flex items-center gap-2"><Switch checked={formEnabled} onCheckedChange={setFormEnabled} /><Label>{t('schedules.dialog.enableOnCreate')}</Label></div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setDialogOpen(false)}>{t('schedules.dialog.cancel')}</Button>
              <Button onClick={handleSave}>{editingJob ? t('schedules.dialog.save') : t('schedules.dialog.create')}</Button>
            </div>
          </div>
          </ComboboxPortalProvider>
        </DialogContent>
      </Dialog>
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </div>
  );
}
