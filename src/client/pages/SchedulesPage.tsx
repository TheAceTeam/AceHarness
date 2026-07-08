'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from '@/lib/navigation/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { PageHeader } from '@/components/ui/page-header';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { StatusPill } from '@/components/ui/status-pill';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { ObjectEditDrawer } from '@/components/ui/object-edit-drawer';
import { FormField } from '@/components/ui/form-section';
import { SingleCombobox, ComboboxPortalProvider } from '@/components/ui/combobox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { useTranslations } from '@/hooks/useTranslations';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
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
  const { toast } = useToast();
  const { t } = useTranslations();
  useDocumentTitle(t('schedules.title'));
  const WEEKDAYS = [0,1,2,3,4,5,6].map(i => t(`schedules.weekdays.${i}`));
  const schedulesQuery = useSchedulesQuery();
  const configOptionsQuery = useConfigOptionsQuery();
  const createScheduleMutation = useCreateScheduleMutation();
  const updateScheduleMutation = useUpdateScheduleMutation();
  const deleteScheduleMutation = useDeleteScheduleMutation();
  const toggleScheduleMutation = useToggleScheduleMutation();
  const triggerScheduleMutation = useTriggerScheduleMutation();
  const jobs = schedulesQuery.data?.jobs || [];
  const configs = useMemo(() => (
    (configOptionsQuery.data?.configs || []).map((config) => ({
      filename: config.filename,
      name: config.name || config.filename,
    }))
  ), [configOptionsQuery.data?.configs]);
  const loading = schedulesQuery.isLoading || configOptionsQuery.isLoading;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<ScheduleJob | null>(null);
  const [deletingJob, setDeletingJob] = useState<ScheduleJob | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all');

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

  useEffect(() => {
    if (schedulesQuery.isError) {
      toast('error', (schedulesQuery.error as Error)?.message || t('schedules.messages.loadFailed'));
    } else if (configOptionsQuery.isError) {
      toast('error', (configOptionsQuery.error as Error)?.message || t('schedules.messages.loadFailed'));
    }
  }, [configOptionsQuery.error, configOptionsQuery.isError, schedulesQuery.error, schedulesQuery.isError, t, toast]);

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

  const openCreate = () => { setEditingJob(null); resetForm(); setDrawerOpen(true); };
  const openEdit = (job: ScheduleJob) => { setEditingJob(job); resetForm(job); setDrawerOpen(true); };

  const handleSave = async () => {
    if (!formName.trim() || !formConfig) { toast('error', t('schedules.messages.fillRequired')); return; }
    const payload: SchedulePayload = {
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
        await updateScheduleMutation.mutateAsync({ id: editingJob.id, payload });
        toast('success', t('schedules.messages.updated'));
      } else {
        await createScheduleMutation.mutateAsync(payload);
        toast('success', t('schedules.messages.created'));
      }
      setDrawerOpen(false);
    } catch (e: any) { toast('error', e.message); }
  };

  const handleToggle = async (job: ScheduleJob) => {
    try {
      await toggleScheduleMutation.mutateAsync(job.id);
    } catch { toast('error', t('schedules.messages.toggleFailed')); }
  };

  const handleTrigger = async (job: ScheduleJob) => {
    try {
      await triggerScheduleMutation.mutateAsync(job.id);
      toast('success', `${t('schedules.messages.triggered')} "${job.name}"`);
    } catch { toast('error', t('schedules.messages.triggerFailed')); }
  };

  const handleDelete = async (job: ScheduleJob) => {
    try {
      await deleteScheduleMutation.mutateAsync(job.id);
      toast('success', t('schedules.messages.deleted'));
      setDeletingJob(null);
    } catch { toast('error', t('schedules.messages.deleteFailed')); }
  };

  const statusBadge = (s?: string) => {
    if (!s) return null;
    const tone = s === 'started' ? 'success' : (s === 'failed' || s === 'error') ? 'danger' : 'neutral';
    return <StatusPill tone={tone}>{s}</StatusPill>;
  };
  const formDirty = useMemo(() => {
    if (!drawerOpen) return false;
    if (!editingJob) {
      return Boolean(
        formName.trim()
        || (formConfig && formConfig !== (configs[0]?.filename || ''))
        || formMode !== 'simple'
        || formIntervalValue !== 1
        || formIntervalUnit !== 'day'
        || formHour !== 0
        || formMinute !== 0
        || formWeekday !== 1
        || formCron !== '0 0 * * *'
        || !formEnabled
      );
    }
    return (
      formName !== editingJob.name
      || formConfig !== editingJob.configFile
      || formMode !== editingJob.mode
      || formIntervalValue !== (editingJob.interval?.value ?? 1)
      || formIntervalUnit !== (editingJob.interval?.unit ?? 'day')
      || formHour !== (editingJob.fixedTime?.hour ?? 0)
      || formMinute !== (editingJob.fixedTime?.minute ?? 0)
      || formWeekday !== (editingJob.fixedTime?.weekday ?? 1)
      || formCron !== (editingJob.cronExpression || '0 0 * * *')
      || formEnabled !== editingJob.enabled
    );
  }, [configs, drawerOpen, editingJob, formConfig, formCron, formEnabled, formHour, formIntervalUnit, formIntervalValue, formMinute, formMode, formName, formWeekday]);
  const filteredJobs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return jobs.filter((job) => {
      const matchesQuery = !query
        || job.name.toLowerCase().includes(query)
        || job.configFile.toLowerCase().includes(query)
        || describeSchedule(job, t).toLowerCase().includes(query);
      const matchesEnabled = enabledFilter === 'all'
        || (enabledFilter === 'enabled' && job.enabled)
        || (enabledFilter === 'disabled' && !job.enabled);
      return matchesQuery && matchesEnabled;
    });
  }, [enabledFilter, jobs, searchQuery, t]);
  const scheduleColumns = useMemo<DataTableColumn<ScheduleJob>[]>(() => [
    {
      id: 'name',
      header: t('schedules.columns.name'),
      render: (job) => <span className="font-medium">{job.name}</span>,
    },
    {
      id: 'config',
      header: t('schedules.columns.config'),
      render: (job) => <span className="text-muted-foreground">{job.configFile}</span>,
      priority: 2,
    },
    {
      id: 'schedule',
      header: t('schedules.columns.schedule'),
      render: (job) => <span className="font-mono text-xs text-muted-foreground">{describeSchedule(job, t)}</span>,
    },
    {
      id: 'status',
      header: t('schedules.columns.status'),
      align: 'center',
      render: (job) => (
        <Switch
          checked={job.enabled}
          onCheckedChange={() => handleToggle(job)}
          aria-label={job.enabled ? '停用定时任务' : '启用定时任务'}
        />
      ),
      width: 96,
    },
    {
      id: 'lastRun',
      header: t('schedules.columns.lastRun'),
      render: (job) => (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{formatTime(job.lastRunTime)}</span>
          {statusBadge(job.lastRunStatus)}
        </div>
      ),
      priority: 3,
    },
    {
      id: 'nextRun',
      header: t('schedules.columns.nextRun'),
      render: (job) => <span className="text-xs text-muted-foreground">{job.enabled ? formatTime(job.nextRunTime) : '-'}</span>,
      priority: 3,
    },
  ], [t]);
  const { isDashboardShell } = useDashboardShellHeader({
    title: t('schedules.title'),
    subtitle: `${jobs.length} 个定时任务`,
    actions: (
      <Button size="sm" onClick={openCreate}>
        <span className="material-symbols-outlined text-sm mr-1">add</span>{t('schedules.new')}
      </Button>
    ),
  }, [jobs.length, t]);

  return (
    <div className="min-h-screen bg-background">
      {!isDashboardShell ? (
        <PageHeader
          title={t('schedules.title')}
          subtitle={`${jobs.length} 个定时任务`}
          status={<StatusPill tone="accent">{jobs.length}</StatusPill>}
          leading={(
            <Button variant="ghost" size="icon" asChild>
              <Link href="/dashboard" aria-label="返回仪表盘">
                <span className="material-symbols-outlined text-xl">arrow_back</span>
              </Link>
            </Button>
          )}
          primaryAction={(
            <Button size="sm" onClick={openCreate}>
              <span className="material-symbols-outlined text-sm mr-1">add</span>{t('schedules.new')}
            </Button>
          )}
          secondaryActions={<><ThemeToggle /><LanguageToggle /></>}
        />
      ) : null}

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        <PageToolbar
          search={(
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索任务、工作流或计划..."
            />
          )}
          filters={(
            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'enabled', 'disabled'] as const).map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={enabledFilter === value ? 'secondary' : 'outline'}
                  onClick={() => setEnabledFilter(value)}
                >
                  {value === 'all' ? '全部' : value === 'enabled' ? '已启用' : '已停用'}
                </Button>
              ))}
            </div>
          )}
          refresh={(
            <Button
              variant="outline"
              size="sm"
              onClick={() => { schedulesQuery.refetch(); configOptionsQuery.refetch(); }}
            >
              刷新
            </Button>
          )}
          activeFilters={<span className="text-xs text-muted-foreground">显示 {filteredJobs.length} / {jobs.length} 个定时任务</span>}
        />
        <DataTable
          aria-label={t('schedules.title')}
          columns={scheduleColumns}
          rows={filteredJobs}
          rowKey="id"
          loading={loading}
          emptyState={jobs.length === 0 ? {
            icon: <span className="material-symbols-outlined text-xl">schedule</span>,
            title: t('schedules.empty'),
            primaryAction: <Button onClick={openCreate}>{t('schedules.createFirst')}</Button>,
          } : {
            icon: <span className="material-symbols-outlined text-xl">search_off</span>,
            title: '没有匹配的定时任务',
            description: '调整搜索词或启用状态筛选后重试。',
          }}
          rowActions={(job) => [
            {
              id: 'primary',
              actions: [
                {
                  id: 'edit',
                  label: t('schedules.actions.edit'),
                  icon: <span className="material-symbols-outlined text-sm">edit</span>,
                  primary: true,
                  onSelect: () => openEdit(job),
                },
                {
                  id: 'trigger',
                  label: t('schedules.actions.run'),
                  icon: <span className="material-symbols-outlined text-sm">play_arrow</span>,
                  onSelect: () => handleTrigger(job),
                },
              ],
            },
            {
              id: 'danger',
              actions: [
                {
                  id: 'delete',
                  label: t('schedules.actions.delete'),
                  icon: <span className="material-symbols-outlined text-sm">delete</span>,
                  destructive: true,
                  onSelect: () => setDeletingJob(job),
                },
              ],
            },
          ]}
        />
      </main>

      <ComboboxPortalProvider>
        <ObjectEditDrawer
          open={drawerOpen}
          mode={editingJob ? 'edit' : 'create'}
          title={editingJob ? t('schedules.dialog.editTitle') : t('schedules.dialog.createTitle')}
          subtitle={editingJob ? editingJob.name : t('schedules.new')}
          status={editingJob ? { label: editingJob.enabled ? '已启用' : '已停用', tone: editingJob.enabled ? 'success' : 'neutral' } : undefined}
          dirty={formDirty}
          saving={createScheduleMutation.isPending || updateScheduleMutation.isPending}
          onOpenChange={setDrawerOpen}
          onRequestDiscard={() => window.confirm('放弃未保存的定时任务更改？')}
          saveAction={{
            label: editingJob ? t('schedules.dialog.save') : t('schedules.dialog.create'),
            onClick: handleSave,
          }}
          cancelAction={{
            label: t('schedules.dialog.cancel'),
            onClick: () => {
              if (!formDirty || window.confirm('放弃未保存的定时任务更改？')) setDrawerOpen(false);
            },
          }}
          secondaryActions={editingJob ? [{
            label: t('schedules.actions.run'),
            onClick: () => handleTrigger(editingJob),
            disabled: triggerScheduleMutation.isPending,
          }] : undefined}
          dangerActions={editingJob ? [{
            label: t('schedules.actions.delete'),
            variant: 'destructive',
            onClick: () => setDeletingJob(editingJob),
          }] : undefined}
          sections={[
            {
              id: 'identity',
              title: 'Basic information',
              description: 'Name the schedule and choose the workflow configuration it runs.',
              content: (
                <>
                  <FormField
                    label={t('schedules.dialog.name')}
                    required
                    control={<Input value={formName} onChange={e => setFormName(e.target.value)} placeholder={t('schedules.dialog.namePlaceholder')} />}
                  />
                  <FormField
                    label={t('schedules.dialog.configFile')}
                    required
                    control={(
                      <SingleCombobox
                        value={formConfig}
                        onValueChange={setFormConfig}
                        options={configs.map(c => ({ value: c.filename, label: `${c.name} (${c.filename})` }))}
                        placeholder={t('schedules.dialog.selectConfig')}
                      />
                    )}
                  />
                </>
              ),
            },
            {
              id: 'schedule',
              title: t('schedules.dialog.scheduleMode'),
              description: 'Use the simple builder for common intervals, or enter a cron expression directly.',
              content: (
                <Tabs value={formMode} onValueChange={v => setFormMode(v as 'simple' | 'cron')}>
                  <TabsList className="w-full">
                    <TabsTrigger value="simple" className="flex-1">{t('schedules.dialog.simpleMode')}</TabsTrigger>
                    <TabsTrigger value="cron" className="flex-1">{t('schedules.dialog.cronMode')}</TabsTrigger>
                  </TabsList>
                  <TabsContent value="simple" className="space-y-4 mt-4">
                    <FormField
                      label={t('schedules.dialog.intervalType')}
                      control={(
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_96px]">
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
                          {formIntervalUnit === 'hour' ? (
                            <Input type="number" min={1} max={23} value={formIntervalValue} onChange={e => setFormIntervalValue(Number(e.target.value))} aria-label={t('schedules.dialog.interval')} />
                          ) : null}
                        </div>
                      )}
                    />
                    {formIntervalUnit !== 'hour' ? (
                      <FormField
                        label={formIntervalUnit === 'week' ? t('schedules.dialog.weekday') : t('schedules.dialog.daily')}
                        control={(
                          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_80px_80px]">
                            {formIntervalUnit === 'week' ? (
                              <SingleCombobox
                                value={String(formWeekday)}
                                onValueChange={v => setFormWeekday(Number(v))}
                                options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))}
                                searchable={false}
                              />
                            ) : <div className="hidden sm:block" />}
                            <Input type="number" min={0} max={23} value={formHour} onChange={e => setFormHour(Number(e.target.value))} aria-label={t('schedules.dialog.hour')} />
                            <Input type="number" min={0} max={59} value={formMinute} onChange={e => setFormMinute(Number(e.target.value))} aria-label={t('schedules.dialog.minute')} />
                          </div>
                        )}
                      />
                    ) : null}
                  </TabsContent>
                  <TabsContent value="cron" className="space-y-4 mt-4">
                    <FormField
                      label={t('schedules.dialog.cronExpression')}
                      description={t('schedules.dialog.cronHelp')}
                      control={<Input value={formCron} onChange={e => setFormCron(e.target.value)} placeholder="0 0 * * *" className="font-mono" />}
                    />
                  </TabsContent>
                </Tabs>
              ),
            },
            {
              id: 'state',
              title: 'State',
              description: 'Control whether this schedule is active after saving.',
              content: (
                <FormField
                  label={t('schedules.dialog.enableOnCreate')}
                  control={<Switch checked={formEnabled} onCheckedChange={setFormEnabled} />}
                />
              ),
            },
          ]}
        />
      </ComboboxPortalProvider>

      <ConfirmModal
        open={Boolean(deletingJob)}
        variant="delete"
        title={t('schedules.messages.deleteTitle')}
        objectName={deletingJob?.name}
        consequence={deletingJob ? `${t('schedules.messages.deleteConfirm')} "${deletingJob.name}"?` : ''}
        confirmLabel={t('common.delete')}
        loading={deleteScheduleMutation.isPending}
        onCancel={() => setDeletingJob(null)}
        onOpenChange={(open) => { if (!open) setDeletingJob(null); }}
        onConfirm={() => deletingJob ? handleDelete(deletingJob) : undefined}
      />
    </div>
  );
}
