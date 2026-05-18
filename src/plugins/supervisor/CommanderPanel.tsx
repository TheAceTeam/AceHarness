// @ts-nocheck
'use client';

import { useRef } from 'react';
import { cn } from '@/lib/core/utils';
import { Button } from '@/components/ui/button';
import { EngineSelect } from '@/components/EngineSelect';
import { Input } from '@/components/ui/input';
import { ModelSelect } from '@/components/ModelSelect';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { SingleCombobox } from '@/components/ui/combobox';
import { CollaborationRoomSurface } from '@/components/collaboration/CollaborationRoomSurface';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import HumanQuestionInbox from '@/components/workflow/HumanQuestionInbox';
import { WEREWOLF_ROLE_ASSETS, WEREWOLF_ROLEBOOK_ENTRIES } from '@/plugins/werewolf/role-assets';
import { WEREWOLF_LAB_BOARDS, TEMP_WEREWOLF_AGENTS, describeWerewolfBoardRoles, getWerewolfBoardAbsentRoles } from '@/plugins/werewolf/agents';
import {
  getCollaborationInitials,
  getCollaborationMessageKindLabel,
  getCollaborationSpeakerAvatarSrc,
  getVisibleWerewolfMessages,
  handleCollaborationMentionKeyDown,
  renderWerewolfSurfaceMessage,
  shouldShowWerewolfSummaryCard,
} from './collaboration-surface-adapters';
import type { CommanderPanelContext } from './types';

export interface CommanderPanelProps {
  ctx: CommanderPanelContext;
}

/**
 * Commander Panel
 *
 * Contains the Supervisor roundtable, workflow runtime panels,
 * and Werewolf Lab UI. All state is received via the ctx prop.
 */
export function CommanderPanel({ ctx }: CommanderPanelProps) {
  const collaborationBottomRef = useRef<HTMLDivElement | null>(null);
  const {
    shouldShowWorkflowRuntimePanels, boundHumanQuestions, otherHumanQuestions,
    unansweredHumanQuestions, answerHumanQuestion, navigateToHumanQuestion,
    submittingHumanQuestionId, binding, boundCommander, boundWorkflow,
    effectiveWorkflowTarget, workflowStatus, latestSupervisorReview,
    latestRevision, specCodingSummary, persistedPreflight, startingWorkflow,
    handleStartWorkflow, currentCreationSession, effectiveCreationSession,
    isWerewolfLab, isWerewolfConfigured, werewolfMode, werewolfState,
    werewolfViewMode, werewolfAutoRunning, werewolfStepDelay,
    werewolfAdvancedSettingsOpen, werewolfLabConfig, werewolfDefaultEngine,
    werewolfDefaultModel, werewolfRehearsalStatus, werewolfRehearsing,
    werewolfHistoryEntries, werewolfRoundtableSeats, workflowRoundtableSeats,
    activeRoundtableSeat, selectedWerewolfBoard, plannedWerewolfAgents,
    autoWerewolfPlayers, collaborationRoom, collaborationDraft,
    collaborationTopic, collaborationBusy, collaborationMessages,
    collaborationRounds, collaborationTextareaRef, mentionSuggestions,
    activeMentionIndex, renderMentionSuggestions, phaseTransitionBanner,
    recentlyEliminatedSeatIds, effectiveWerewolfNightViewer,
    effectiveWerewolfNightViewerRole, werewolfViewCandidateNames,
    werewolfNextActionLabel, werewolfHumanInterventionLabel,
    werewolfSectionClass, werewolfCardClass, werewolfBadgeClass,
    werewolfGhostButtonClass, werewolfGoldButtonClass,
    setCollaborationDraft, setCollaborationTopic, setSelectedSeatId,
    setActiveMentionIndex, setWerewolfAdvancedSettingsOpen,
    setWerewolfRolebookOpen, setWerewolfStepDelay, setWerewolfDefaultRuntime,
    setWerewolfAgentOverrideEnabled, setWerewolfAgentOverrideRuntime,
    handleWerewolfSupervisorStep, handleWerewolfAutoRun, handleWerewolfPause,
    handleWerewolfBoardChange, handleWorkflowGroupChat,
    refreshRandomWerewolfPlayers, runWerewolfRehearsal, persistWerewolfView,
    insertCollaborationMention, updateCollaborationRoom, onQuickPrompt,
    formatWerewolfRole, formatWerewolfActionLabel, formatSupervisorReviewType,
    getCreationSessionStatusLabel, getWerewolfCurrentActionLabel,
    getWerewolfCurrentActorLabel, getWerewolfSpeakerInitial,
    getWerewolfSpeakerVisual, getWerewolfSurvivalSummary,
    getWerewolfSpeechOrder, getWerewolfRoleSpriteStyle,
    canSeeWerewolfMessage, shouldRevealWerewolfRoleForViewer,
    shouldHideWerewolfMessageFromChat, prepareWerewolfMessageForChat,
    listTemporaryWerewolfAgentNames, resolveWerewolfAgentRuntimeConfig,
    workflowRoundtableAgents, preflightChecks, availableCollaborationAgents, reports,
    effectiveEngine, engine, model, activeSessionId, router,
  } = ctx;

  const visibleCollaborationMessages = [...collaborationMessages].slice(-10);
  const visibleWerewolfMessages = getVisibleWerewolfMessages({
    collaborationMessages,
    shouldHideWerewolfMessageFromChat,
    canSeeWerewolfMessage,
    werewolfState,
    werewolfViewMode,
    effectiveWerewolfNightViewer,
  });
  const shouldShowWerewolfLastSummary = shouldShowWerewolfSummaryCard({
    lastSummary: werewolfState?.lastSummary,
    visibleWerewolfMessages,
    prepareWerewolfMessageForChat,
  });

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
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-amber-400 to-stone-900 text-white flex items-center justify-center shadow-lg">
                    <span className="material-symbols-outlined">military_tech</span>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  指挥官会跟随当前会话最近一次启动的 workflow 运行自动切换，不再要求手动绑定。
                </p>
              </div>
              ) : null}

              <div className="rounded-2xl border p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">协作室</div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {isWerewolfLab
                        ? 'Supervisor 主导回合制流程；人类负责开局、暂停、补充指令和关键节点推进。'
                        : '由你主持当前议题，点名空闲 Agent 发言，或发起一轮多 Agent 圆桌讨论。'}
                    </p>
                  </div>
                  <Badge variant={collaborationBusy ? 'secondary' : 'outline'}>
                    {collaborationBusy ? '讨论中' : `${collaborationMessages.length} 条`}
                  </Badge>
                </div>

                {!isWerewolfLab ? (
                  <>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">议题</label>
                      <Input
                        value={collaborationTopic}
                        onChange={(event) => setCollaborationTopic(event.target.value)}
                        onBlur={() => {
                          const topic = collaborationTopic.trim();
                          if (!topic && !collaborationRoom?.topic) return;
                          updateCollaborationRoom((room) => ({ ...room, topic }));
                        }}
                        placeholder="例如：请评估当前修复方案的风险和下一步动作"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs text-muted-foreground">本工作流圆桌席位</label>
                        <Badge variant="outline" className="text-[10px]">
                          {workflowRoundtableAgents.length} 位
                        </Badge>
                      </div>
                      {workflowRoundtableSeats.length > 0 ? (
                        <div className="rounded-2xl border bg-muted/10 p-3">
                          <div className="mb-2 flex items-center justify-between text-[10px] text-muted-foreground">
                            <span>顺时针发言</span>
                            <span>由被 @ 的 Agent 依次接话</span>
                          </div>
                          <div className="relative mx-auto aspect-square max-w-[360px]">
                            {workflowRoundtableSeats.map((seat, index) => {
                              const total = workflowRoundtableSeats.length;
                              const angle = (Math.PI * 2 * index) / Math.max(total, 1) - Math.PI / 2;
                              const radius = total <= 4 ? 34 : total <= 6 ? 38 : 41;
                              const x = 50 + radius * Math.cos(angle);
                              const y = 50 + radius * Math.sin(angle);
                              const nextAngle = (Math.PI * 2 * ((index + 0.5) % Math.max(total, 1))) / Math.max(total, 1) - Math.PI / 2;
                              const arrowX = 50 + (radius - 7) * Math.cos(nextAngle);
                              const arrowY = 50 + (radius - 7) * Math.sin(nextAngle);
                              return (
                                <div key={seat.id}>
                                  {total > 1 ? (
                                    <div
                                      className="absolute -translate-x-1/2 -translate-y-1/2 text-[11px] text-muted-foreground/70"
                                      style={{ left: `${arrowX}%`, top: `${arrowY}%` }}
                                    >
                                      ↻
                                    </div>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="absolute -translate-x-1/2 -translate-y-1/2"
                                    style={{ left: `${x}%`, top: `${y}%` }}
                                    onClick={() => setSelectedSeatId(seat.id)}
                                  >
                                    <div className={`relative flex h-16 w-16 items-center justify-center rounded-full border bg-background transition-all duration-300 hover:scale-105 ${seat.avatarClass} ${seat.ringClass || ''} ${seat.active ? 'scale-105' : ''}`}>
                                      {seat.speaking ? <span className="absolute inset-[-5px] animate-ping rounded-full border border-primary/40" /> : null}
                                      {seat.seatNumber ? (
                                        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border bg-background px-1 text-[9px] font-semibold text-muted-foreground shadow-sm">
                                          {seat.seatNumber}
                                        </span>
                                      ) : null}
                                      <span className={`text-lg font-semibold ${seat.speaking ? 'animate-[spin_4s_linear_infinite]' : ''}`}>{getWerewolfSpeakerInitial(seat.name)}</span>
                                    </div>
                                    <div className={`mt-1 max-w-[92px] truncate text-center text-[10px] font-medium ${seat.nameClass || 'text-foreground'}`}>{seat.name}</div>
                                  </button>
                                </div>
                              );
                            })}
                            <div className="absolute left-1/2 top-1/2 flex h-32 w-32 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border bg-background/95 p-3 text-center shadow-sm">
                              <div className="text-[10px] text-muted-foreground">当前席位</div>
                              <div className={`mt-1 line-clamp-2 text-xs font-semibold ${activeRoundtableSeat?.nameClass || 'text-foreground'}`}>
                                {activeRoundtableSeat?.name || '未选中'}
                              </div>
                              {activeRoundtableSeat?.seatNumber ? (
                                <div className="mt-1 text-[10px] text-muted-foreground">{activeRoundtableSeat.seatNumber} 号位</div>
                              ) : null}
                              <div className="mt-1 text-[10px] text-muted-foreground">{activeRoundtableSeat?.statusLabel || '待命'}</div>
                              {activeRoundtableSeat?.meta ? (
                                <div className="mt-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[9px] text-muted-foreground">
                                  {activeRoundtableSeat.meta}
                                </div>
                              ) : null}
                            </div>
                          </div>
                          {activeRoundtableSeat ? (
                            <div className={`mt-3 rounded-xl border p-3 text-xs ${activeRoundtableSeat.accentClass || 'bg-background'}`}>
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className={`font-medium ${activeRoundtableSeat.nameClass || 'text-foreground'}`}>{activeRoundtableSeat.name}</div>
                                  {activeRoundtableSeat.seatNumber ? (
                                    <div className="text-[10px] text-muted-foreground">{activeRoundtableSeat.seatNumber} 号位</div>
                                  ) : null}
                                </div>
                                <Badge variant="outline" className="text-[9px]">{activeRoundtableSeat.subtitle}</Badge>
                              </div>
                              <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{activeRoundtableSeat.detail}</div>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="px-2 py-3 text-xs text-muted-foreground">暂无可用 Agent。</div>
                      )}
                      <div className="text-[11px] leading-5 text-muted-foreground">
                        工作流下的 Agent 天然构成一个群聊圆桌。用 <span className="font-medium">@agent</span> 或 <span className="font-medium">@全员</span> 控制下一轮顺序发言；没有新的 @ 时，本轮自然结束。
                      </div>
                    </div>

                    <CollaborationRoomSurface
                      messages={visibleCollaborationMessages}
                      draft={collaborationDraft}
                      onDraftChange={setCollaborationDraft}
                      onSubmit={handleWorkflowGroupChat}
                      submitLabel={collaborationBusy ? '群聊进行中...' : '发送到工作流群聊'}
                      submitDisabled={collaborationBusy || workflowRoundtableAgents.length === 0}
                      placeholder="写下本轮目标，并用 @agent 或 @全员 指定下一位发言者。"
                      mentionTargets={workflowRoundtableAgents}
                      onInsertMention={insertCollaborationMention}
                      inputRef={collaborationTextareaRef}
                      bottomRef={collaborationBottomRef}
                      emptyText="还没有协作记录。可以先写一条主持人消息，用 @agent 或 @全员 指定下一位发言者。"
                      helperText="工作流下的 Agent 天然构成一个群聊圆桌。用 @agent 或 @全员 控制下一轮顺序发言；没有新的 @ 时，本轮自然结束。"
                      composerOverlay={renderMentionSuggestions()}
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
                  </>
                ) : null}

                {isWerewolfLab ? (
                <div className={cn('rounded-xl border border-dashed p-3 space-y-3', werewolfSectionClass)}>
                  <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">AI 狼人杀测试</div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {isWerewolfLab
                          ? '先选择板子，由系统随机抽取临时人格；Supervisor 按流程推进，人类只在关键节点接入。'
                          : '用当前 Agent 做回合制身份推理测试，验证多 Agent 发言、@点名、主持总结和投票结算。'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={cn('h-7 gap-1 px-2 text-xs', werewolfGhostButtonClass)}
                        onClick={() => setWerewolfRolebookOpen(true)}
                      >
                        <span className="material-symbols-outlined text-sm">style</span>
                        角色图鉴
                      </Button>
                      <Badge variant={werewolfState?.enabled ? 'secondary' : 'outline'} className={cn('text-[10px]', werewolfBadgeClass)}>
                        {werewolfState?.enabled ? `${werewolfState.phase} · D${werewolfState.dayNumber}` : '未开始'}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">板子</label>
                      <select
                        value={selectedWerewolfBoard.id}
                        onChange={(event) => handleWerewolfBoardChange(event.target.value)}
                        disabled={collaborationBusy || Boolean(werewolfState?.players?.length && werewolfState.phase !== 'setup')}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {WEREWOLF_LAB_BOARDS.map((board) => (
                          <option key={board.id} value={board.id}>{board.name}</option>
                        ))}
                      </select>
                      <div className={cn('rounded-lg border bg-muted/20 p-2 text-[10px] leading-5 text-muted-foreground', werewolfCardClass)}>
                        {selectedWerewolfBoard.description}
                      </div>
                      <div className={cn('rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-[10px] leading-5 text-muted-foreground', werewolfCardClass)}>
                        规则：{selectedWerewolfBoard.winRuleLabel}。{selectedWerewolfBoard.winRuleDescription}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs text-muted-foreground">流程</label>
                        <Badge variant="outline" className={cn('text-[9px]', werewolfBadgeClass)}>
                          {isWerewolfConfigured ? 'Supervisor 主导中' : '等待确认开局'}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-5 gap-1 text-[10px]">
                        {[
                          ['setup', '配置'],
                          ['night', '黑夜'],
                          ['sheriff-election', '警长'],
                          ['last-words', '遗言'],
                          ['day', '发言'],
                          ['voting', '投票'],
                        ].map(([phase, label]) => {
                          const active = werewolfState?.phase === phase || werewolfState?.currentAction === phase;
                          return (
                            <div key={phase} className={cn('rounded-md border px-2 py-1 text-center', active ? 'border-primary bg-primary/10 text-primary' : 'bg-muted/20 text-muted-foreground', werewolfMode && !active ? 'border-amber-800/30 bg-stone-800/15 text-stone-300' : undefined)}>
                              {label}
                            </div>
                          );
                        })}
                      </div>
                      <div className={cn('rounded-lg border bg-muted/20 p-2 text-[10px] leading-5 text-muted-foreground', werewolfCardClass)}>
                        {isWerewolfConfigured
                          ? `当前：${selectedWerewolfBoard.name}，第 ${werewolfState?.dayNumber || 1} 天。可以在人工介入里补充指令，再让 Supervisor 推进。`
                          : `选择板子后会随机选择 ${selectedWerewolfBoard.playerCount} 个临时人格，并按 ${selectedWerewolfBoard.name} 分配身份。`}
                      </div>
                    </div>
                  </div>

                  <div className={cn('grid gap-3 rounded-lg border bg-muted/10 p-3 sm:grid-cols-[1fr_auto] sm:items-start', werewolfCardClass)}>
                    <div className="min-w-0">
                      <div className="text-xs font-medium">视角</div>
                      <div className="text-[10px] leading-5 text-muted-foreground">
                        {werewolfViewMode === 'god'
                          ? '上帝视角会显示所有身份。'
                          : effectiveWerewolfNightViewer
                            ? isWerewolfConfigured
                              ? `黑夜视角绑定：${effectiveWerewolfNightViewer}（${formatWerewolfRole(effectiveWerewolfNightViewerRole || 'villager')}）。狼人视角可见狼队，其余玩家只看自己。`
                              : `黑夜视角预绑定：${effectiveWerewolfNightViewer}。开局分配身份后会自动沿用。`
                            : werewolfViewCandidateNames.length
                              ? '黑夜视角未绑定玩家时，只显示公开信息。请在下方选择一名玩家。'
                              : '开局后可绑定任意玩家查看其黑夜视角。'}
                      </div>
                      {werewolfViewMode === 'night' && werewolfViewCandidateNames.length ? (
                        <div className="mt-2 grid gap-1.5">
                          <label className="text-[10px] font-medium text-foreground">选择绑定玩家</label>
                          <select
                            value={effectiveWerewolfNightViewer}
                            onChange={(event) => persistWerewolfView(werewolfViewMode, event.target.value)}
                            className={cn('h-8 w-full rounded-md border border-input bg-background px-2 text-xs', werewolfMode && 'border-amber-800/30 bg-stone-950/20')}
                          >
                            <option value="">未绑定，只看公开信息</option>
                            {werewolfViewCandidateNames.map((agentName) => (
                              <option key={agentName} value={agentName}>
                                {agentName}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                    </div>
                    <div className={cn('inline-flex rounded-md border bg-background p-0.5', werewolfMode && 'border-amber-800/40 bg-stone-950/20')}>
                      <Button
                        type="button"
                        size="sm"
                        variant={werewolfViewMode === 'night' ? 'default' : 'ghost'}
                        className={cn('h-7 px-2 text-xs', werewolfViewMode === 'night' ? werewolfGoldButtonClass : werewolfGhostButtonClass)}
                        onClick={() => persistWerewolfView('night', effectiveWerewolfNightViewer)}
                      >
                        黑夜视角
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={werewolfViewMode === 'god' ? 'default' : 'ghost'}
                        className={cn('h-7 px-2 text-xs', werewolfViewMode === 'god' ? werewolfGoldButtonClass : werewolfGhostButtonClass)}
                        onClick={() => persistWerewolfView('god', effectiveWerewolfNightViewer)}
                      >
                        上帝视角
                      </Button>
                    </div>
                  </div>

                  {isWerewolfConfigured ? (
                    <div className={cn('grid gap-2 rounded-lg border bg-muted/10 p-3 text-xs sm:grid-cols-3', werewolfCardClass)}>
                      <div>
                        <div className="text-[10px] text-muted-foreground">当前环节</div>
                        <div className="mt-1 font-medium">{getWerewolfCurrentActionLabel({
                          state: werewolfState,
                          viewMode: werewolfViewMode,
                          viewer: effectiveWerewolfNightViewer,
                        })}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">正在行动</div>
                        <div className="mt-1 truncate font-medium">{getWerewolfCurrentActorLabel({
                          state: werewolfState,
                          viewMode: werewolfViewMode,
                          viewer: effectiveWerewolfNightViewer,
                        })}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">存活情况</div>
                        <div className="mt-1 line-clamp-3 leading-5">
                          {getWerewolfSurvivalSummary(werewolfState, werewolfViewMode === 'god' || Boolean(werewolfState?.revealedRoles))}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {isWerewolfConfigured ? (
                    <div className={cn('grid gap-2 rounded-lg border bg-muted/10 p-3 text-xs sm:grid-cols-2', werewolfCardClass)}>
                      <div>
                        <div className="text-[10px] text-muted-foreground">警长 / 警徽</div>
                        <div className="mt-1 leading-5">
                          {werewolfState?.badgeDestroyed
                            ? '警徽已撕'
                            : werewolfState?.sheriff
                              ? `${werewolfState.sheriff} 持有警徽`
                              : werewolfState?.sheriffElectionDone
                                ? '本局无警长'
                                : '待上警举手与警长竞选'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">发言顺序</div>
                        <div className="mt-1 line-clamp-3 leading-5">
                          {werewolfState ? getWerewolfSpeechOrder(werewolfState).join(' -> ') : '未定'}
                        </div>
                      </div>
                      {werewolfViewMode === 'god' && werewolfState?.night ? (
                        <div className="sm:col-span-2">
                          <div className="text-[10px] text-muted-foreground">上帝夜间记录</div>
                          <div className="mt-1 leading-5">
                            N{werewolfState.night.round}：
                            {werewolfState.night.guarded ? ` 守护 ${werewolfState.night.guarded};` : ''}
                            {werewolfState.night.wolfTarget ? ` 狼刀 ${werewolfState.night.wolfTarget};` : ''}
                            {werewolfState.night.saved ? ` 解药 ${werewolfState.night.saved};` : ''}
                            {werewolfState.night.poisoned ? ` 毒药 ${werewolfState.night.poisoned};` : ''}
                            {werewolfState.night.seerTarget ? ` 查验 ${werewolfState.night.seerTarget};` : ''}
                            {werewolfState.night.deaths?.length ? ` 出局 ${werewolfState.night.deaths.join('、')}` : ' 平安夜'}
                          </div>
                        </div>
                      ) : null}
                      {werewolfViewMode === 'night' && effectiveWerewolfNightViewerRole === 'witch' && werewolfState?.night?.wolfTarget ? (
                        <div className="sm:col-span-2">
                          <div className="text-[10px] text-muted-foreground">女巫夜间已知</div>
                          <div className="mt-1 leading-5">
                            今夜被袭击：{werewolfState.night.wolfTarget}
                            {werewolfState.dayNumber === 1 ? '；首夜可以自救。' : '。'}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {!isWerewolfConfigured ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-medium">随机角色</div>
                        <div className="flex items-center gap-2">
                          <div className="text-[10px] text-muted-foreground">
                            将启用 {selectedWerewolfBoard.playerCount} / {listTemporaryWerewolfAgentNames().length}
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className={cn('h-7 px-2 text-xs', werewolfGhostButtonClass)}
                            onClick={refreshRandomWerewolfPlayers}
                            disabled={collaborationBusy}
                          >
                            刷新随机
                          </Button>
                        </div>
                      </div>
                      <div className={cn('grid max-h-44 gap-2 overflow-y-auto rounded-xl border bg-muted/10 p-2 sm:grid-cols-2', werewolfCardClass)}>
                        {listTemporaryWerewolfAgentNames().map((agentName) => {
                          const checked = autoWerewolfPlayers.includes(agentName);
                          return (
                            <label key={agentName} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${checked ? 'bg-background' : 'opacity-50'}`}>
                              <Checkbox
                                checked={checked}
                                disabled
                              />
                              <span className="min-w-0 flex-1 truncate">{agentName}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div className={cn('space-y-3 rounded-xl border bg-muted/10 p-3', werewolfCardClass)}>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-medium">高级设置</div>
                        <div className="text-[10px] leading-5 text-muted-foreground">
                          支持默认 engine/model，并为每个临时玩家和 Supervisor 单独覆盖。演练会提前创建 session，成功项会保留。
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className={cn('h-7 px-2 text-xs', werewolfGhostButtonClass)}
                        onClick={() => setWerewolfAdvancedSettingsOpen((prev) => !prev)}
                      >
                        {werewolfAdvancedSettingsOpen ? '收起' : '展开'}
                      </Button>
                    </div>

                    {werewolfAdvancedSettingsOpen ? (
                      <div className="space-y-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <div className="text-[10px] text-muted-foreground">默认引擎</div>
                            <EngineSelect
                              value={werewolfDefaultEngine}
                              onChange={(value) => setWerewolfDefaultRuntime({ engine: value })}
                              className="h-8"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <div className="text-[10px] text-muted-foreground">默认模型</div>
                            <ModelSelect
                              value={werewolfDefaultModel}
                              onChange={(value) => setWerewolfDefaultRuntime({ model: value })}
                              className="h-8"
                              engine={werewolfDefaultEngine}
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          {plannedWerewolfAgents.map((agentName) => {
                            const override = werewolfLabConfig?.agentOverrides?.[agentName];
                            const overrideEnabled = override?.enabled === true;
                            const { effectiveEngine, effectiveModel } = resolveWerewolfAgentRuntimeConfig(agentName);
                            const rehearsal = werewolfRehearsalStatus[agentName];
                            const statusLabel = rehearsal?.status === 'ready'
                              ? '已就绪'
                              : rehearsal?.status === 'failed'
                                ? '失败'
                                : rehearsal?.status === 'running'
                                  ? '演练中'
                                  : '未演练';
                            return (
                              <div key={agentName} className="rounded-lg border bg-background/70 p-2.5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="truncate text-xs font-medium">{agentName}</div>
                                    <div className="text-[10px] text-muted-foreground">
                                      当前生效：{effectiveEngine || '-'} / {effectiveModel || '-'}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Badge variant={rehearsal?.status === 'ready' ? 'secondary' : rehearsal?.status === 'failed' ? 'destructive' : 'outline'} className="text-[9px]">
                                      {statusLabel}
                                    </Badge>
                                    <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                      <Checkbox
                                        checked={overrideEnabled}
                                        onCheckedChange={(checked) => setWerewolfAgentOverrideEnabled(agentName, checked === true)}
                                      />
                                      独立配置
                                    </label>
                                  </div>
                                </div>
                                {overrideEnabled ? (
                                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                    <EngineSelect
                                      value={override?.engine || ''}
                                      onChange={(value) => setWerewolfAgentOverrideRuntime(agentName, { engine: value })}
                                      className="h-8"
                                    />
                                    <ModelSelect
                                      value={override?.model || ''}
                                      onChange={(value) => setWerewolfAgentOverrideRuntime(agentName, { model: value })}
                                      className="h-8"
                                      engine={override?.engine || effectiveEngine}
                                    />
                                  </div>
                                ) : null}
                                {rehearsal?.error ? (
                                  <div className="mt-2 rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1.5 text-[10px] leading-5 text-destructive">
                                    {rehearsal.error}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className={cn('h-8 text-xs', werewolfGhostButtonClass)}
                            onClick={() => void runWerewolfRehearsal()}
                            disabled={collaborationBusy || werewolfRehearsing}
                          >
                            {werewolfRehearsing ? '演练中...' : '演练并创建 Session'}
                          </Button>
                          <div className="text-[10px] text-muted-foreground">
                            已就绪 {plannedWerewolfAgents.filter((agentName) => werewolfRehearsalStatus[agentName]?.status === 'ready').length} / {plannedWerewolfAgents.length}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {werewolfState?.players?.length ? (
                    <div className="space-y-2">
                      <div className={cn('rounded-2xl border bg-muted/10 p-3', werewolfSectionClass)}>
                        <div className="mb-2 flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>顺时针发言</span>
                          <span>警长位高亮，死亡席位断线显示</span>
                        </div>
                        <div className="relative mx-auto aspect-square max-w-[420px]">
                            {werewolfRoundtableSeats.map((seat, index) => {
                            const total = werewolfRoundtableSeats.length;
                            const angle = (Math.PI * 2 * index) / Math.max(total, 1) - Math.PI / 2;
                            const radius = total <= 6 ? 38 : total <= 9 ? 41 : 43;
                            const x = 50 + radius * Math.cos(angle);
                            const y = 50 + radius * Math.sin(angle);
                            const nextAngle = (Math.PI * 2 * ((index + 0.5) % Math.max(total, 1))) / Math.max(total, 1) - Math.PI / 2;
                            const arrowX = 50 + (radius - 8) * Math.cos(nextAngle);
                            const arrowY = 50 + (radius - 8) * Math.sin(nextAngle);
                            const player = werewolfState.players.find((item) => item.agentName === seat.id);
                            const revealRole = player ? shouldRevealWerewolfRoleForViewer({
                              player,
                              state: werewolfState,
                              viewMode: werewolfViewMode,
                              viewer: effectiveWerewolfNightViewer,
                            }) : false;
                              const roleSpriteStyle = player && revealRole ? getWerewolfRoleSpriteStyle(player.role) : null;
                              const justEliminated = recentlyEliminatedSeatIds.includes(seat.id);
                              return (
                                <div key={seat.id}>
                                  {total > 1 ? (
                                    <div
                                      className="absolute -translate-x-1/2 -translate-y-1/2 text-[11px] text-muted-foreground/70"
                                      style={{ left: `${arrowX}%`, top: `${arrowY}%` }}
                                    >
                                      ↻
                                    </div>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="absolute -translate-x-1/2 -translate-y-1/2"
                                  style={{ left: `${x}%`, top: `${y}%` }}
                                  onClick={() => setSelectedSeatId(seat.id)}
                                >
                                  <div className={`relative flex h-16 w-16 items-center justify-center rounded-full border bg-background transition-all duration-300 hover:scale-105 ${seat.avatarClass} ${seat.ringClass || ''} ${player?.sheriff ? 'ring-2 ring-amber-400/80 shadow-[0_0_0_8px_rgba(251,191,36,0.18)]' : ''} ${seat.active ? 'scale-105' : ''} ${seat.dimmed ? 'opacity-45 grayscale animate-[seatDisconnect_240ms_ease-out_forwards]' : ''} ${justEliminated ? 'animate-[seatFall_1.2s_ease-out]' : ''}`}>
                                    {seat.speaking ? <span className="absolute inset-[-5px] animate-ping rounded-full border border-primary/40" /> : null}
                                    {justEliminated ? <span className="absolute inset-[-6px] rounded-full border border-destructive/50 animate-ping" /> : null}
                                    {seat.seatNumber ? (
                                      <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border bg-background px-1 text-[9px] font-semibold text-muted-foreground shadow-sm">
                                        {seat.seatNumber}
                                      </span>
                                    ) : null}
                                    {player?.sheriff ? (
                                      <span className="absolute -left-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border border-amber-500/50 bg-amber-500/15 px-1 text-[9px] font-semibold text-amber-700 shadow-sm dark:text-amber-300">
                                        警
                                      </span>
                                    ) : null}
                                    {roleSpriteStyle ? (
                                      <span
                                        className={`h-10 w-8 rounded border border-amber-500/35 bg-cover shadow-sm ${seat.speaking ? 'animate-[spin_6s_linear_infinite]' : ''}`}
                                        style={roleSpriteStyle}
                                        aria-label={player ? formatWerewolfRole(player.role) : seat.name}
                                      />
                                    ) : (
                                      <span className={`text-lg font-semibold ${seat.speaking ? 'animate-[spin_4s_linear_infinite]' : ''}`}>{getWerewolfSpeakerInitial(seat.name)}</span>
                                    )}
                                  </div>
                                  <div className={`mt-1 max-w-[92px] truncate text-center text-[10px] font-medium ${seat.nameClass || 'text-foreground'}`}>{seat.name}</div>
                                </button>
                                </div>
                              );
                            })}
                          <div className={cn('absolute left-1/2 top-1/2 flex h-36 w-36 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border bg-background/95 p-3 text-center shadow-sm', werewolfCardClass)}>
                            {phaseTransitionBanner ? (
                              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/88 animate-[fadeIn_220ms_ease-out]">
                                <div className={cn('rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary shadow-sm', werewolfBadgeClass)}>
                                  {phaseTransitionBanner.label}
                                </div>
                              </div>
                            ) : null}
                            <div className="text-[10px] text-muted-foreground">当前席位</div>
                            <div className={`mt-1 line-clamp-2 text-xs font-semibold ${activeRoundtableSeat?.nameClass || 'text-foreground'}`}>
                              {activeRoundtableSeat?.name || '未选中'}
                            </div>
                            {activeRoundtableSeat?.seatNumber ? (
                              <div className="mt-1 text-[10px] text-muted-foreground">{activeRoundtableSeat.seatNumber} 号位</div>
                            ) : null}
                            <div className="mt-1 text-[10px] text-muted-foreground">{activeRoundtableSeat?.statusLabel || '待命'}</div>
                            {activeRoundtableSeat?.meta ? (
                              <div className="mt-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[9px] text-muted-foreground">
                                {activeRoundtableSeat.meta}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        {activeRoundtableSeat ? (
                          <div className={cn(`mt-3 rounded-xl border p-3 text-xs ${activeRoundtableSeat.accentClass || 'bg-background'}`, werewolfCardClass)}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className={`font-medium ${activeRoundtableSeat.nameClass || 'text-foreground'}`}>{activeRoundtableSeat.name}</div>
                                {activeRoundtableSeat.seatNumber ? (
                                  <div className="text-[10px] text-muted-foreground">{activeRoundtableSeat.seatNumber} 号位</div>
                                ) : null}
                              </div>
                              <Badge variant="outline" className={cn('text-[9px]', werewolfBadgeClass)}>{activeRoundtableSeat.statusLabel}</Badge>
                            </div>
                            <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{activeRoundtableSeat.detail}</div>
                            {(() => {
                              const player = werewolfState.players.find((item) => item.agentName === activeRoundtableSeat.id);
                              if (!player) return null;
                              const revealRole = shouldRevealWerewolfRoleForViewer({
                                player,
                                state: werewolfState,
                                viewMode: werewolfViewMode,
                                viewer: effectiveWerewolfNightViewer,
                              });
                              return (
                                <div className="mt-2 text-[10px] text-foreground">
                                  身份：{revealRole ? formatWerewolfRole(player.role) : '隐藏'}
                                  {player.sheriff ? ' · 警长' : ''}
                                  {player.sheriffCandidate ? ' · 上警' : ''}
                                  {player.idiotRevealed ? ' · 白痴已翻牌' : ''}
                                </div>
                              );
                            })()}
                          </div>
                        ) : null}
                      </div>
                      {werewolfState.votes.length > 0 ? (
                        <div className={cn('rounded-lg border bg-muted/20 p-2 text-[10px] leading-5 text-muted-foreground', werewolfCardClass)}>
                          最近票流：{werewolfState.votes.slice(-6).map((vote) => `${vote.voter}->${vote.target}`).join('；')}
                        </div>
                      ) : null}
                      {werewolfHistoryEntries.length > 0 ? (
                        <div className={cn('space-y-2 rounded-lg border bg-muted/10 p-2.5', werewolfCardClass)}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-[11px] font-medium text-foreground">历史对局记忆</div>
                            <Badge variant="outline" className={cn('text-[9px]', werewolfBadgeClass)}>
                              {werewolfHistoryEntries.length} 条
                            </Badge>
                          </div>
                          <div className="space-y-1.5">
                            {werewolfHistoryEntries.slice(0, 6).map((entry) => (
                              <div key={entry.id} className={cn('rounded-lg border bg-background/70 p-2 text-[10px] leading-5 text-muted-foreground', werewolfCardClass)}>
                                <div className="font-medium text-foreground">{entry.boardName} · {entry.result}</div>
                                <div className="mt-0.5">{entry.summary}</div>
                                {entry.lessons?.length ? <div className="mt-1 text-[10px]">经验：{entry.lessons.join('；')}</div> : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                        {shouldShowWerewolfLastSummary ? (
                        <div className={cn('rounded-lg border bg-muted/20 p-2 text-[10px] leading-5 text-muted-foreground', werewolfCardClass)}>
                          {werewolfState.lastSummary}
                        </div>
                      ) : null}
                      {werewolfState.lastError ? (
                        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-[10px] leading-5 text-destructive">
                          上次推进失败：{werewolfState.lastError}。可点击“{werewolfNextActionLabel}”重试。
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className={cn('rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground', werewolfCardClass)}>
                      {isWerewolfLab
                        ? '请选择板子，系统会随机选择参与人格并分配身份。临时人格不进入业务 Agent 列表。'
                        : '先选择 3 到 6 个 Agent，然后初始化测试局。Supervisor 会作为主持人，不参与玩家列表。'}
                    </div>
                  )}

                  {isWerewolfConfigured ? (
                    <CollaborationRoomSurface
                      messages={visibleWerewolfMessages}
                      draft={collaborationDraft}
                      onDraftChange={setCollaborationDraft}
                      onSubmit={handleWerewolfSupervisorStep}
                      submitLabel={collaborationBusy ? 'Supervisor 推进中...' : werewolfNextActionLabel}
                      submitDisabled={collaborationBusy || werewolfAutoRunning || werewolfState?.phase === 'ended' || (!isWerewolfLab && availableCollaborationAgents.length < 3)}
                      placeholder="可选：写给 Supervisor 的补充指令，例如指定重点追问、暂停观察或调整发言顺序。"
                      mentionTargets={[]}
                      onInsertMention={insertCollaborationMention}
                      inputRef={collaborationTextareaRef}
                      bottomRef={collaborationBottomRef}
                      emptyText="还没有狼人杀记录。开始开局后，这里会显示回合消息、发言、票流和系统结算。"
                      helperText={`当前介入点：${werewolfHumanInterventionLabel}。补充内容会交给 Supervisor 带入下一步。`}
                      customControls={
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-xs font-medium">人工介入</div>
                            <div className="text-[10px] leading-5 text-muted-foreground">
                              Supervisor 主导回合推进；你可以在关键节点补充约束、追问方向或暂停观察。
                            </div>
                          </div>
                          <Badge variant="outline" className={cn('text-[9px]', werewolfBadgeClass)}>
                            {werewolfAutoRunning ? '自动中' : '可暂停'}
                          </Badge>
                        </div>
                      }
                      composerOverlay={renderMentionSuggestions()}
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
                      renderMessage={(message) => renderWerewolfSurfaceMessage({
                        message,
                        werewolfState,
                        prepareWerewolfMessageForChat,
                        getWerewolfSpeakerVisual,
                        getWerewolfSpeakerInitial,
                        formatWerewolfRole,
                        formatWerewolfActionLabel,
                      })}
                      getSpeakerAvatarSrc={getCollaborationSpeakerAvatarSrc}
                      getInitials={getCollaborationInitials}
                      getMessageKindLabel={getCollaborationMessageKindLabel}
                    />
                  ) : null}

                  <div className={cn('grid gap-2 rounded-lg border bg-muted/10 p-3 sm:grid-cols-[1fr_auto]', werewolfCardClass)}>
                    <div className="space-y-1">
                      <div className="text-xs font-medium">推进节奏</div>
                      <div className="text-[10px] leading-5 text-muted-foreground">
                        自动推进会在每个关键节点停顿，可随时暂停后补充人工指令。
                      </div>
                      <select
                        value={werewolfStepDelay}
                        onChange={(event) => setWerewolfStepDelay(Number(event.target.value))}
                        className={cn('mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs', werewolfMode && 'border-amber-800/30 bg-stone-950/20')}
                        disabled={collaborationBusy}
                      >
                        <option value={600}>快速 · 0.6s</option>
                        <option value={1200}>标准 · 1.2s</option>
                        <option value={2400}>慢速 · 2.4s</option>
                      </select>
                    </div>
                    <div className="flex items-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={werewolfGhostButtonClass}
                        onClick={handleWerewolfAutoRun}
                        disabled={collaborationBusy || werewolfAutoRunning || werewolfState?.phase === 'ended'}
                      >
                        全流程自动推进
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={werewolfGhostButtonClass}
                        onClick={handleWerewolfPause}
                        disabled={!werewolfAutoRunning && !collaborationBusy}
                      >
                        暂停
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    {!isWerewolfConfigured ? (
                      <Button
                        type="button"
                        className={werewolfGoldButtonClass}
                        onClick={handleWerewolfSupervisorStep}
                        disabled={collaborationBusy || werewolfAutoRunning || werewolfState?.phase === 'ended' || (!isWerewolfLab && availableCollaborationAgents.length < 3)}
                      >
                        {collaborationBusy ? 'Supervisor 推进中...' : werewolfNextActionLabel}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className={werewolfGhostButtonClass}
                      onClick={() => handleWerewolfBoardChange(selectedWerewolfBoard.id)}
                      disabled={collaborationBusy}
                    >
                      重置配置
                    </Button>
                  </div>
                  {!isWerewolfLab ? (
                    <div className="text-[10px] leading-5 text-muted-foreground">
                      圆桌只会由 <span className="font-mono">@agent</span> 或 <span className="font-mono">@全员</span> 触发；没有新的 @ 时，本轮自然结束。
                    </div>
                  ) : null}
                </div>
                ) : null}

                {null}
              </div>

              {shouldShowWorkflowRuntimePanels ? (
              <div className="rounded-2xl border p-4 space-y-2">
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
                  <div className="mt-3 text-xs text-muted-foreground space-y-1">
                    <div>当前会话：{activeSessionId || '未创建'}</div>
                    <div>运行配置：{boundWorkflow || '尚未通过当前会话启动 workflow'}</div>
                    <div>候选配置：{effectiveWorkflowTarget || '未选择'}</div>
                    <div>指挥官：{boundCommander}</div>
                    {currentCreationSession ? (
                      <div>创建进度：{currentCreationSession.workflowName} / {getCreationSessionStatusLabel(currentCreationSession.status)}</div>
                    ) : null}
                  </div>
                </details>
                {workflowStatus?.specCodingSummary ? (
                  <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                    <div className="font-medium text-foreground">运行绑定的 Spec Coding 制品</div>
                    <div>版本：v{workflowStatus.specCodingSummary.version}</div>
                    <div>状态：{workflowStatus.specCodingSummary.status}</div>
                    {workflowStatus.specCodingSummary.source ? (
                      <div>来源：{workflowStatus.specCodingSummary.source === 'run' ? 'run snapshot' : 'creation baseline'}</div>
                    ) : null}
                    <div>阶段：{workflowStatus.specCodingSummary.phaseCount}</div>
                    {typeof workflowStatus.specCodingSummary.taskCount === 'number' ? (
                      <div>任务：{workflowStatus.specCodingSummary.taskCount}</div>
                    ) : null}
                    <div>修订：{workflowStatus.specCodingSummary.revisionCount}</div>
                    {workflowStatus.specCodingSummary.progress?.summary ? (
                      <div>进度：{workflowStatus.specCodingSummary.progress.summary}</div>
                    ) : null}
                    {workflowStatus.specCodingSummary.latestRevision?.summary ? (
                      <div>最近修订：{workflowStatus.specCodingSummary.latestRevision.summary}</div>
                    ) : null}
                  </div>
                ) : null}
                {workflowStatus?.latestSupervisorReview?.content ? (
                  <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                    <div className="font-medium text-foreground">最近一次 Supervisor 审阅</div>
                    <div>类型：{formatSupervisorReviewType(workflowStatus.latestSupervisorReview.type)}</div>
                    <div>阶段：{workflowStatus.latestSupervisorReview.stateName}</div>
                    <div className="leading-5">{workflowStatus.latestSupervisorReview.content}</div>
                    {workflowStatus.latestSupervisorReview.affectedArtifacts?.length ? (
                      <div>
                        影响制品：{workflowStatus.latestSupervisorReview.affectedArtifacts.join('、')}
                      </div>
                    ) : null}
                    {workflowStatus.latestSupervisorReview.impact?.length ? (
                      <div className="space-y-1 pt-1">
                        <div className="text-foreground">影响范围</div>
                        {workflowStatus.latestSupervisorReview.impact.map((item: string) => (
                          <div key={item}>- {item}</div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {workflowStatus?.finalReview ? (
                  <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                    <div className="font-medium text-foreground">运行结算</div>
                    <div>状态：{workflowStatus.finalReview.status}</div>
                    <div>总评：{workflowStatus.finalReview.summary}</div>
                    {workflowStatus.finalReview.scoreCards?.length ? (
                      <div>评分卡：{workflowStatus.finalReview.scoreCards.length}</div>
                    ) : null}
                  </div>
                ) : null}
                {workflowStatus?.rehearsal?.enabled ? (
                  <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3 text-xs text-muted-foreground space-y-1">
                    <div className="font-medium text-foreground">演练模式</div>
                    <div>{workflowStatus.rehearsal.summary}</div>
                    {workflowStatus.rehearsal.recommendedNextSteps?.length ? (
                      <div className="space-y-1 pt-1">
                        {workflowStatus.rehearsal.recommendedNextSteps.map((item: string) => (
                          <div key={item}>- {item}</div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {preflightChecks.length > 0 ? (
                  <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground space-y-2">
                    <div className="font-medium text-foreground">最近一次启动前检查</div>
                    {persistedPreflight?.configFile ? (
                      <div>目标：{persistedPreflight.configFile}</div>
                    ) : null}
                    {persistedPreflight ? (
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={persistedPreflight.ok ? 'secondary' : 'destructive'}>
                          {persistedPreflight.ok ? '通过' : '未通过'}
                        </Badge>
                        {persistedPreflight.warningCount > 0 ? (
                          <Badge variant="outline">警告 {persistedPreflight.warningCount}</Badge>
                        ) : null}
                        {persistedPreflight.policy?.inferredCommandCount ? (
                          <Badge variant="outline">推断命令 {persistedPreflight.policy.inferredCommandCount}</Badge>
                        ) : null}
                      </div>
                    ) : null}
                    {persistedPreflight?.checkedAt ? (
                      <div className="text-[11px] text-muted-foreground">
                        检查时间：{new Date(persistedPreflight.checkedAt).toLocaleString()}
                      </div>
                    ) : null}
                    {preflightChecks.slice(0, 4).map((check) => (
                      <div key={check.id} className="rounded-lg border bg-background/70 px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span>{check.summary}</span>
                          <Badge variant={check.status === 'failed' ? 'destructive' : 'outline'}>
                            {check.category}
                          </Badge>
                        </div>
                        {check.origin === 'inferred' ? (
                          <div className="mt-1 text-[11px] text-muted-foreground">来源：项目默认推断。说明当前 workflow 没显式配置 preflight，系统按项目类型自动补了检查命令。</div>
                        ) : null}
                        <div className="mt-1 truncate text-[11px]" title={check.commands[0]?.command || ''}>
                          {check.commands[0]?.command || ''}
                        </div>
                        {check.commands[0]?.exitCode !== undefined && check.commands[0]?.exitCode !== null ? (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            退出码：{check.commands[0]?.exitCode}
                          </div>
                        ) : null}
                        {check.status !== 'passed' ? (
                          <details className="mt-2 rounded-md border bg-muted/30 px-2.5 py-2">
                            <summary className="cursor-pointer text-[11px] font-medium text-foreground">
                              查看失败原因与处理建议
                            </summary>
                            <div className="mt-2 space-y-2 text-[11px] text-muted-foreground">
                              {check.commands[0]?.errorText ? (
                                <div>
                                  <div className="font-medium text-foreground">错误摘要</div>
                                  <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-background p-2">{check.commands[0]?.errorText}</pre>
                                </div>
                              ) : null}
                              {check.commands[0]?.stderr ? (
                                <div>
                                  <div className="font-medium text-foreground">标准错误</div>
                                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-2">{check.commands[0]?.stderr}</pre>
                                </div>
                              ) : null}
                              {check.commands[0]?.stdout ? (
                                <div>
                                  <div className="font-medium text-foreground">标准输出</div>
                                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-2">{check.commands[0]?.stdout}</pre>
                                </div>
                              ) : null}
                              <div className="rounded bg-amber-500/10 px-2 py-1.5 text-amber-700 dark:text-amber-300">
                                {check.category === 'compile'
                                  ? '先确认当前工作目录能否手动执行这条编译命令；如果是推断出来的命令不适合你的项目，可以在 workflow 里显式配置 preCommands 覆盖它。'
                                  : check.category === 'test'
                                    ? '先手动执行这条测试命令确认失败原因，再决定是否修复环境、依赖或用更准确的预检查命令替换。'
                                    : '先手动执行这条命令确认环境与路径是否正确，再决定是否调整 workflow 的预检查命令。'}
                              </div>
                            </div>
                          </details>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="pt-2 flex gap-2">
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
                ) : reports.map((report) => (
                  <div key={report.id} className="rounded-2xl border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium">{report.title}</div>
                      <Badge variant={report.tone === 'warning' ? 'destructive' : 'secondary'}>
                        {new Date(report.timestamp).toLocaleTimeString()}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground leading-5">{report.content}</p>
                  </div>
                ))}
              </div>
              ) : null}
            
    </div>
  );
}
