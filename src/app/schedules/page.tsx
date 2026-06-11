'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { scheduleApi, configApi } from '@/lib/core/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SingleCombobox, ComboboxPortalProvider } from '@/components/ui/combobox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { useTranslations } from '@/hooks/useTranslations';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

interface ScheduleJob {
  id: string;
  name: string;
  configFile: string;
  enabled: boolean;
  mode: 'simple' | 'cron';
  interval?: { value: number; unit: 'hour' | 'day' | 'week' };
  fixedTime?: { hour: number; minute: number; weekday?: number };
  cronExpression?: string;
  lastRunId?: string;
  lastRunTime?: string;
  lastRunStatus?: string;
  nextRunTime?: string;
  createdAt: string;
  runHistory: { runId: string; time: string; status: string }[];
}


function describeSchedule(job: ScheduleJob, t: (key: string) => string): string {
  const weekdays = [0,1,2,3,4,5,6].map(i => t(`schedules.weekdays.${i}`));
  if (job.mode === 'cron') return `Cron: ${job.cronExpression}`;
  if (job.interval) {
    const { value, unit } = job.interval;
    const unitLabel = t(`schedules.units.${unit}`);
    let desc = `${t('schedules.units.every')} ${value} ${unitLabel}`;
    if (job.fixedTime && (unit === 'day' || unit === 'week')) {
      desc += ` ${String(job.fixedTime.hour).padStart(2, '0')}:${String(job.fixedTime.minute).padStart(2, '0')}`;
    }
    if (job.fixedTime?.weekday !== undefined && unit === 'week') {
      desc += ` ${weekdays[job.fixedTime.weekday]}`;
    }
    return desc;
  }
  if (job.fixedTime) {
    const time = `${String(job.fixedTime.hour).padStart(2, '0')}:${String(job.fixedTime.minute).padStart(2, '0')}`;
    if (job.fixedTime.weekday !== undefined) return `${weekdays[job.fixedTime.weekday]} ${time}`;
    return `${t('schedules.dialog.daily')} ${time}`;
  }
  return job.cronExpression || '-';
}

function formatTime(iso?: string) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleString('zh-CN'); } catch { return iso; }
}

export default function SchedulesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useTranslations();
  useDocumentTitle(t('schedules.title'));
  const { confirm, dialogProps } = useConfirmDialog();
  const WEEKDAYS = [0,1,2,3,4,5,6].map(i => t(`schedules.weekdays.${i}`));
  const [jobs, setJobs] = useState<ScheduleJob[]>([]);
  const [configs, setConfigs] = useState<{ filename: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<ScheduleJob | null>(null);

  // Form state
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

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const [schedResult, cfgResult] = await Promise.allSettled([scheduleApi.list(), configApi.listAllConfigs()]);

      if (cfgResult.status === 'fulfilled') {
        setConfigs((cfgResult.value.configs || []).map((c: any) => ({ filename: c.filename, name: c.name })));
      } else {
        setConfigs([]);
      }

      if (schedResult.status === 'fulfilled') {
        setJobs(schedResult.value.jobs || []);
      } else {
        setJobs([]);
      }

      if (schedResult.status === 'rejected' || cfgResult.status === 'rejected') {
        const error = schedResult.status === 'rejected' ? schedResult.reason : cfgResult.status === 'rejected' ? cfgResult.reason : null;
        toast('error', error?.message || t('schedules.messages.loadFailed'));
      }
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  const resetForm = (job?: ScheduleJob) => {
    if (job) {
      setFormName(job.name);
      setFormConfig(job.configFile);
      setFormMode(job.mode);
      setFormIntervalValue(job.interval?.value ?? 1);
      setFormIntervalUnit(job.interval?.unit ?? 'day');
      setFormHour(job.fixedTime?.hour ?? 0);
      setFormMinute(job.fixedTime?.minute ?? 0);
      setFormWeekday(job.fixedTime?.weekday ?? 1);
      setFormCron(job.cronExpression || '0 0 * * *');
      setFormEnabled(job.enabled);
    } else {
      setFormName('');
      setFormConfig(configs[0]?.filename || '');
      setFormMode('simple');
      setFormIntervalValue(1);
      setFormIntervalUnit('day');
      setFormHour(0);
      setFormMinute(0);
      setFormWeekday(1);
      setFormCron('0 0 * * *');
      setFormEnabled(true);
    }
  };

  const openCreate = () => { setEditingJob(null); resetForm(); setDialogOpen(true); };
  const openEdit = (job: ScheduleJob) => { setEditingJob(job); resetForm(job); setDialogOpen(true); };

  const handleSave = async () => {
    if (!formName.trim() || !formConfig) { toast('error', t('schedules.messages.fillRequired')); return; }
    const payload: any = {
      name: formName.trim(),
      configFile: formConfig,
      enabled: formEnabled,
      mode: formMode,
    };
    if (formMode === 'simple') {
      payload.interval = { value: formIntervalValue, unit: formIntervalUnit };
      if (formIntervalUnit !== 'hour') {
        payload.fixedTime = { hour: formHour, minute: formMinute };
        if (formIntervalUnit === 'week') payload.fixedTime.weekday = formWeekday;
      }
    } else {
      payload.cronExpression = formCron;
    }
    try {
      if (editingJob) {
        await scheduleApi.update(editingJob.id, payload);
        toast('success', t('schedules.messages.updated'));
      } else {
        await scheduleApi.create(payload);
        toast('success', t('schedules.messages.created'));
      }
      setDialogOpen(false);
      loadJobs();
    } catch (e: any) { toast('error', e.message); }
  };

  const handleToggle = async (job: ScheduleJob) => {
    try {
      await scheduleApi.toggle(job.id);
      loadJobs();
    } catch { toast('error', t('schedules.messages.toggleFailed')); }
  };

  const handleTrigger = async (job: ScheduleJob) => {
    try {
      await scheduleApi.trigger(job.id);
      toast('success', `${t('schedules.messages.triggered')} "${job.name}"`);
      loadJobs();
    } catch { toast('error', t('schedules.messages.triggerFailed')); }
  };

  const handleDelete = async (job: ScheduleJob) => {
    const ok = await confirm({ title: t('schedules.messages.deleteTitle'), description: `${t('schedules.messages.deleteConfirm')} "${job.name}"?`, confirmLabel: t('common.delete'), variant: 'destructive' });
    if (!ok) return;
    try {
      await scheduleApi.delete(job.id);
      toast('success', t('schedules.messages.deleted'));
      loadJobs();
    } catch { toast('error', t('schedules.messages.deleteFailed')); }
  };

  const statusBadge = (s?: string) => {
    if (!s) return null;
    const map: Record<string, string> = { started: 'bg-green-500/15 text-green-600', failed: 'bg-red-500/15 text-red-600', error: 'bg-red-500/15 text-red-600' };
    return <Badge className={map[s] || 'bg-muted text-muted-foreground'}>{s}</Badge>;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
              <span className="material-symbols-outlined text-xl">arrow_back</span>
            </Link>
            <h1 className="text-lg font-semibold">{t('schedules.title')}</h1>
            <Badge variant="secondary">{jobs.length}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={openCreate}>
              <span className="material-symbols-outlined text-sm mr-1">add</span>{t('schedules.new')}
            </Button>
            <ThemeToggle />
            <LanguageToggle />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        {loading ? (
          <div className="text-center py-20 text-muted-foreground">{t('common.loading')}</div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-20">
            <span className="material-symbols-outlined text-5xl text-muted-foreground/40 mb-4 block">schedule</span>
            <p className="text-muted-foreground mb-4">{t('schedules.empty')}</p>
            <Button onClick={openCreate}>{t('schedules.createFirst')}</Button>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">{t('schedules.columns.name')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('schedules.columns.config')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('schedules.columns.schedule')}</th>
                  <th className="text-center px-4 py-3 font-medium">{t('schedules.columns.status')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('schedules.columns.lastRun')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('schedules.columns.nextRun')}</th>
                  <th className="text-right px-4 py-3 font-medium">{t('schedules.columns.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {jobs.map(job => (
                  <tr key={job.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{job.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{job.configFile}</td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{describeSchedule(job, t)}</td>
                    <td className="px-4 py-3 text-center">
                      <Switch checked={job.enabled} onCheckedChange={() => handleToggle(job)} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{formatTime(job.lastRunTime)}</span>
                        {statusBadge(job.lastRunStatus)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{job.enabled ? formatTime(job.nextRunTime) : '-'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <ComboboxPortalProvider>
          <DialogTitle>{editingJob ? t('schedules.dialog.editTitle') : t('schedules.dialog.createTitle')}</DialogTitle>
          <div className="space-y-4">
            <div>
              <Label>{t('schedules.dialog.name')}</Label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder={t('schedules.dialog.namePlaceholder')} />
            </div>
            <div>
              <Label>{t('schedules.dialog.configFile')}</Label>
              <SingleCombobox
                value={formConfig}
                onValueChange={setFormConfig}
                options={configs.map(c => ({ value: c.filename, label: `${c.name} (${c.filename})` }))}
                placeholder={t('schedules.dialog.selectConfig')}
              />
            </div>
            <div>
              <Label>{t('schedules.dialog.scheduleMode')}</Label>
              <Tabs value={formMode} onValueChange={v => setFormMode(v as 'simple' | 'cron')}>
                <TabsList className="w-full">
                  <TabsTrigger value="simple" className="flex-1">{t('schedules.dialog.simpleMode')}</TabsTrigger>
                  <TabsTrigger value="cron" className="flex-1">{t('schedules.dialog.cronMode')}</TabsTrigger>
                </TabsList>
                <TabsContent value="simple" className="space-y-3 mt-3">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Label>{t('schedules.dialog.intervalType')}</Label>
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
                    {formIntervalUnit === 'hour' && (
                      <div className="w-24">
                        <Label>{t('schedules.dialog.interval')}</Label>
                        <Input type="number" min={1} max={23} value={formIntervalValue} onChange={e => setFormIntervalValue(Number(e.target.value))} />
                      </div>
                    )}
                  </div>
                  {formIntervalUnit !== 'hour' && (
                    <div className="flex gap-2 items-end">
                      {formIntervalUnit === 'week' && (
                        <div className="flex-1">
                          <Label>{t('schedules.dialog.weekday')}</Label>
                          <SingleCombobox
                            value={String(formWeekday)}
                            onValueChange={v => setFormWeekday(Number(v))}
                            options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))}
                            searchable={false}
                          />
                        </div>
                      )}
                      <div className="w-20">
                        <Label>{t('schedules.dialog.hour')}</Label>
                        <Input type="number" min={0} max={23} value={formHour} onChange={e => setFormHour(Number(e.target.value))} />
                      </div>
                      <div className="w-20">
                        <Label>{t('schedules.dialog.minute')}</Label>
                        <Input type="number" min={0} max={59} value={formMinute} onChange={e => setFormMinute(Number(e.target.value))} />
                      </div>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="cron" className="space-y-3 mt-3">
                  <div>
                    <Label>{t('schedules.dialog.cronExpression')}</Label>
                    <Input value={formCron} onChange={e => setFormCron(e.target.value)} placeholder="0 0 * * *" className="font-mono" />
                    <p className="text-xs text-muted-foreground mt-1">{t('schedules.dialog.cronHelp')}</p>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={formEnabled} onCheckedChange={setFormEnabled} />
              <Label>{t('schedules.dialog.enableOnCreate')}</Label>
            </div>
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
