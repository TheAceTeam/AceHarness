'use client';

import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CollaborationRoomSurface } from '@/components/collaboration/CollaborationRoomSurface';
import HumanQuestionInbox from '@/components/workflow/HumanQuestionInbox';
import {
  getCollaborationInitials,
  getCollaborationMessageKindLabel,
  getCollaborationSpeakerAvatarSrc,
  handleCollaborationMentionKeyDown,
} from './collaboration-surface-adapters';
import type { CommanderPanelContext } from './types';

export interface CommanderPanelProps {
  ctx: CommanderPanelContext;
}

export function CommanderPanel({ ctx }: CommanderPanelProps) {
  const collaborationBottomRef = useRef<HTMLDivElement | null>(null);
  const {
    shouldShowWorkflowRuntimePanels = true,
    boundHumanQuestions = [],
    otherHumanQuestions = [],
    unansweredHumanQuestions = [],
    answerHumanQuestion,
    navigateToHumanQuestion,
    submittingHumanQuestionId,
    binding,
    boundCommander,
    boundWorkflow,
    effectiveWorkflowTarget,
    workflowStatus,
    persistedPreflight,
    startingWorkflow,
    handleStartWorkflow,
    collaborationRoom,
    collaborationDraft = '',
    collaborationTopic = '',
    collaborationBusy = false,
    collaborationMessages = [],
    collaborationTextareaRef,
    mentionSuggestions = [],
    activeMentionIndex = 0,
    renderMentionSuggestions,
    setCollaborationDraft,
    setCollaborationTopic,
    setActiveMentionIndex,
    insertCollaborationMention,
    updateCollaborationRoom,
    handleWorkflowGroupChat,
    workflowCollaborationGuests = [],
    preflightChecks = [],
    reports = [],
    onQuickPrompt,
    formatSupervisorReviewType,
    activeSessionId,
  } = ctx;

  const visibleCollaborationMessages = [...collaborationMessages].slice(-10);

  return (
    <div className="space-y-4">
      {shouldShowWorkflowRuntimePanels && boundHumanQuestions.length > 0 ? (
        <HumanQuestionInbox
          questions={boundHumanQuestions}
          title="当前工作流待审批"
          emptyText="当前绑定工作流暂无待审批消息。"
          compact={false}
          submittingQuestionId={submittingHumanQuestionId}
          onSubmit={answerHumanQuestion}
        />
      ) : null}

      {shouldShowWorkflowRuntimePanels ? (
        <HumanQuestionInbox
          questions={binding ? otherHumanQuestions : unansweredHumanQuestions}
          onNavigate={navigateToHumanQuestion}
        />
      ) : null}

      {shouldShowWorkflowRuntimePanels ? (
        <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-background to-background p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">当前指挥官</p>
              <div className="mt-1 text-base font-semibold">{boundCommander || 'default-supervisor'}</div>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-stone-900 text-white shadow-lg">
              <span className="material-symbols-outlined">military_tech</span>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            指挥官会跟随当前会话最近一次启动的 workflow 运行自动切换。
          </p>
        </div>
      ) : null}

      <div className="space-y-4 rounded-2xl border p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Supervisor 协作</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              补充当前议题，Supervisor 会按 @ 提及顺序把下一轮响应路由给对应 Agent 或全员。
            </p>
          </div>
          <Badge variant={collaborationBusy ? 'secondary' : 'outline'}>
            {collaborationBusy ? '讨论中' : `${collaborationMessages.length} 条`}
          </Badge>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">议题</label>
          <Input
            value={collaborationTopic}
            onChange={(event) => setCollaborationTopic(event.target.value)}
            onBlur={() => {
              const topic = collaborationTopic.trim();
              if (!topic && !collaborationRoom?.topic) return;
              updateCollaborationRoom((room: any) => ({ ...room, topic }));
            }}
            placeholder="例如：请评估当前修复方案的风险和下一步动作"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs text-muted-foreground">本工作流 Agent</label>
            <Badge variant="outline" className="text-[10px]">
              {workflowCollaborationGuests.length} 位
            </Badge>
          </div>
          {workflowCollaborationGuests.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 rounded-xl border bg-muted/10 p-3">
              {workflowCollaborationGuests.map((name: string) => (
                <span key={name} className="rounded-full border bg-background px-2 py-1 text-[11px] text-muted-foreground">
                  @{name}
                </span>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
              当前没有可路由的 Agent。
            </div>
          )}
        </div>

        <CollaborationRoomSurface
          messages={visibleCollaborationMessages}
          draft={collaborationDraft}
          onDraftChange={setCollaborationDraft}
          onSubmit={handleWorkflowGroupChat}
          submitLabel={collaborationBusy ? '协作处理中...' : '发送到协作线程'}
          submitDisabled={collaborationBusy || workflowCollaborationGuests.length === 0}
          placeholder="写下本轮目标，并用 @名称 或 @全员 指定下一位响应者。"
          mentionTargets={workflowCollaborationGuests}
          onInsertMention={insertCollaborationMention}
          inputRef={collaborationTextareaRef}
          bottomRef={collaborationBottomRef}
          emptyText="还没有协作记录。可以先补一条指令，用 @名称 或 @全员 指定下一位响应者。"
          helperText="Supervisor 会在同一个协作议题里维护上下文，并按 @名称 或 @全员 路由下一轮响应。"
          composerOverlay={renderMentionSuggestions()}
          onDeleteMessage={(message: any) => updateCollaborationRoom((room: any) => ({
            ...room,
            messages: (room.messages || []).filter((item: any) => item.id !== message.id),
          }))}
          onTextareaKeyDown={(event) => {
            handleCollaborationMentionKeyDown({
              event,
              mentionSuggestions,
              activeMentionIndex,
              setActiveMentionIndex,
              insertMention: insertCollaborationMention,
              setDraft: setCollaborationDraft,
            });
          }}
          getSpeakerAvatarSrc={getCollaborationSpeakerAvatarSrc}
          getInitials={getCollaborationInitials}
          getMessageKindLabel={getCollaborationMessageKindLabel}
        />
      </div>

      {shouldShowWorkflowRuntimePanels ? (
        <div className="space-y-3 rounded-2xl border p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">工作流状态</span>
            <Badge variant="secondary">{workflowStatus?.status || 'idle'}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border bg-muted/20 p-3">
              <div className="text-[11px] text-muted-foreground">当前阶段</div>
              <div className="mt-1 text-sm font-medium">{workflowStatus?.currentPhase || '未开始'}</div>
            </div>
            <div className="rounded-xl border bg-muted/20 p-3">
              <div className="text-[11px] text-muted-foreground">当前步骤</div>
              <div className="mt-1 text-sm font-medium">{workflowStatus?.currentStep || '未开始'}</div>
            </div>
          </div>
          <details className="rounded-xl border bg-muted/10 p-3">
            <summary className="cursor-pointer text-xs font-medium text-foreground">展开运行上下文</summary>
            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
              <div>当前会话：{activeSessionId || '未创建'}</div>
              <div>运行配置：{boundWorkflow || '尚未通过当前会话启动 workflow'}</div>
              <div>候选配置：{effectiveWorkflowTarget || '未选择'}</div>
              <div>指挥官：{boundCommander || 'default-supervisor'}</div>
            </div>
          </details>

          {workflowStatus?.specCodingSummary ? (
            <div className="space-y-1 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">运行绑定的 Spec Coding 制品</div>
              <div>版本：v{workflowStatus.specCodingSummary.version}</div>
              <div>状态：{workflowStatus.specCodingSummary.status}</div>
              <div>阶段：{workflowStatus.specCodingSummary.phaseCount}</div>
              {typeof workflowStatus.specCodingSummary.taskCount === 'number' ? (
                <div>任务：{workflowStatus.specCodingSummary.taskCount}</div>
              ) : null}
              <div>修订：{workflowStatus.specCodingSummary.revisionCount}</div>
              {workflowStatus.specCodingSummary.progress?.summary ? (
                <div>进度：{workflowStatus.specCodingSummary.progress.summary}</div>
              ) : null}
            </div>
          ) : null}

          {workflowStatus?.latestSupervisorReview?.content ? (
            <div className="space-y-1 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">最近一次 Supervisor 审阅</div>
              <div>类型：{formatSupervisorReviewType(workflowStatus.latestSupervisorReview.type)}</div>
              <div>阶段：{workflowStatus.latestSupervisorReview.stateName}</div>
              <div className="leading-5">{workflowStatus.latestSupervisorReview.content}</div>
              {workflowStatus.latestSupervisorReview.affectedArtifacts?.length ? (
                <div>影响制品：{workflowStatus.latestSupervisorReview.affectedArtifacts.join('、')}</div>
              ) : null}
            </div>
          ) : null}

          {workflowStatus?.finalReview ? (
            <div className="space-y-1 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">运行结算</div>
              <div>状态：{workflowStatus.finalReview.status}</div>
              <div>总评：{workflowStatus.finalReview.summary}</div>
            </div>
          ) : null}

          {persistedPreflight || preflightChecks.length > 0 ? (
            <div className="space-y-2 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">最近一次启动前检查</div>
              {persistedPreflight?.configFile ? <div>目标：{persistedPreflight.configFile}</div> : null}
              {persistedPreflight ? (
                <div className="flex flex-wrap gap-2">
                  <Badge variant={persistedPreflight.ok ? 'secondary' : 'destructive'}>
                    {persistedPreflight.ok ? '通过' : '未通过'}
                  </Badge>
                  {persistedPreflight.warningCount > 0 ? <Badge variant="outline">警告 {persistedPreflight.warningCount}</Badge> : null}
                </div>
              ) : null}
              {preflightChecks.slice(0, 4).map((check: any) => (
                <div key={check.id} className="rounded-lg border bg-background/70 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span>{check.summary}</span>
                    <Badge variant={check.status === 'failed' ? 'destructive' : 'outline'}>{check.category}</Badge>
                  </div>
                  <div className="mt-1 truncate text-[11px]" title={check.commands?.[0]?.command || ''}>
                    {check.commands?.[0]?.command || ''}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex gap-2 pt-2">
            <Button size="sm" className="flex-1" onClick={handleStartWorkflow} disabled={startingWorkflow || !effectiveWorkflowTarget}>
              {startingWorkflow ? '检查并启动中...' : '检查并启动'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onQuickPrompt(`请结合当前会话最近对话历史，以指挥官 ${boundCommander || 'default-supervisor'} 的视角，汇报当前会话最新运行 ${boundWorkflow || effectiveWorkflowTarget || '（暂无运行）'} 的进度、风险和下一步建议。`)}
            >
              询问
            </Button>
          </div>
        </div>
      ) : null}

      {shouldShowWorkflowRuntimePanels ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">最近汇报</h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onQuickPrompt(`请结合当前会话最近对话历史，以指挥官 ${boundCommander || 'default-supervisor'} 的视角，生成一份结构化进度汇报。`)}
            >
              立即汇报
            </Button>
          </div>
          {reports.length === 0 ? (
            <div className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
              还没有进度汇报。绑定并启动一个工作流后，指挥官会在这里持续汇报。
            </div>
          ) : reports.map((report: any) => (
            <div key={report.id} className="rounded-2xl border p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">{report.title}</div>
                <Badge variant={report.tone === 'warning' ? 'destructive' : 'secondary'}>
                  {new Date(report.timestamp).toLocaleTimeString()}
                </Badge>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{report.content}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
