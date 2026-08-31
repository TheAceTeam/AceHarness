/**
 * GitCode's CI bot recognizes an exact natural-language comment. Keep this
 * policy close to the runtime, rather than relying on every workflow prompt
 * or skill to remember the spelling independently.
 */

export const GITCODE_CI_TRIGGER_COMMAND = 'start build';
export const GITCODE_CI_DELIVERY_SKILL = 'aceharness-gitcode-ci-delivery';

export type GitCodeCiCommandValidation =
  | { ok: true; command: typeof GITCODE_CI_TRIGGER_COMMAND }
  | { ok: false; reason: string };

export type GitCodeCiToolCommandViolation = {
  code: 'GITCODE_CI_TRIGGER_COMMAND_INVALID';
  command: string;
  message: string;
};

export type GitCodeCiGateRecoverySnapshot = {
  headSha: string;
  labels: readonly string[];
  /** Raw body from the latest operator trigger comment, without normalization. */
  latestTriggerBody?: string | null;
  /** A cangjie-ci retry request observed after the current head was pushed. */
  botRequestedRetry: boolean;
  /** A CI-running label or bot pipeline-start acknowledgement is already present. */
  ciRunning: boolean;
  /** Persisted evidence says ACEHarness already retried for this exact head. */
  retryAlreadyAttempted: boolean;
  /**
   * The latest exact trigger comment predates the bot's current
   * "please reply start build" event. Such a comment was not consumable by
   * the bot and must not consume the one post-ready trigger allowance.
   */
  latestTriggerPredatesBotReady?: boolean;
  /** A replacement trigger was already sent after that exact bot-ready event. */
  postReadyTriggerAlreadyAttempted?: boolean;
  /** Current step, approval, or user input explicitly permits CI triggering. */
  triggerAuthorized: boolean;
  /**
   * Evidence-backed classification of the latest terminal gate failure.  This
   * must be produced from the current PR head, labels, bot output and task
   * logs; it is deliberately not inferred merely from a failed label.
   */
  failureKind?: GitCodeCiGateFailureKind;
  /** Number of completed failed gate runs observed for this exact head. */
  currentHeadFailureCount?: number;
  /**
   * For a code defect, records that the repair was locally verified and the
   * current PR head is the newly pushed repair head, rather than the old one.
   */
  repairedAndVerifiedForCurrentHead?: boolean;
};

export type GitCodeCiGateFailureKind =
  | 'suspected_transient'
  | 'code_defect'
  | 'external_dependency'
  | 'unknown';

export type GitCodeCiGateRecoveryDecision = {
  action:
    | 'trigger_once'
    | 'monitor'
    | 'wait_authorization'
    | 'repair_required'
    | 'human_review_required'
    | 'external_blocked'
    | 'not_applicable';
  reason: string;
};

export type GitCodePullRequestRef = {
  owner: string;
  repo: string;
  number: number;
  url: string;
};

export type GitCodeCiGateStatus = 'passed' | 'failed' | 'running' | 'waiting' | 'unknown';

export type GitCodeCiGateObservation = {
  status: GitCodeCiGateStatus;
  labels: string[];
  headSha: string | null;
  merged: boolean;
  checkedAt: string;
  reason: string;
};

/** A review comment that can block an otherwise green PR from being merged. */
export type GitCodePullRequestReviewComment = {
  id: string;
  body: string;
  resolved: boolean;
  file?: string;
  line?: number;
};

export type GitCodePullRequestReadinessStatus =
  | 'merged'
  | 'gate_recovery_required'
  | 'repair_required'
  | 'waiting_external'
  | 'ready_for_merge'
  | 'unknown';

/**
 * A normalized platform snapshot.  The workflow routes on this data instead
 * of asking an agent to infer merge readiness from a green CI message.
 */
export type GitCodePullRequestReadinessObservation = GitCodeCiGateObservation & {
  readiness: GitCodePullRequestReadinessStatus;
  blockers: string[];
  unresolvedReviewComments: GitCodePullRequestReviewComment[];
  mergeableState: Record<string, unknown>;
};

type ToolCommandInput = {
  input?: {
    command?: string;
  };
};

/**
 * The bot comment body is a protocol token, not a shell identifier. Do not
 * normalize underscores or hyphens here: accepting them would silently turn a
 * typo into an outbound side effect with a different platform meaning.
 */
export function validateGitCodeCiTriggerCommand(command: unknown): GitCodeCiCommandValidation {
  if (typeof command !== 'string') {
    return { ok: false, reason: 'GitCode CI 指令必须是字符串。' };
  }
  if (command === GITCODE_CI_TRIGGER_COMMAND) {
    return { ok: true, command: GITCODE_CI_TRIGGER_COMMAND };
  }
  return {
    ok: false,
    reason: `GitCode CI 触发评论必须完全等于 \`${GITCODE_CI_TRIGGER_COMMAND}\`；收到 \`${command}\`。`,
  };
}

/**
 * An evidence-bounded recovery rule for GitCode's strict comment-triggered
 * gate.  It distinguishes a likely transient failure from a source defect:
 * one retry is safe only for the former, whereas a source defect must first
 * be repaired, locally verified, amended and pushed as a new PR head.
 */
export function decideGitCodeCiGateRecovery(
  snapshot: GitCodeCiGateRecoverySnapshot,
): GitCodeCiGateRecoveryDecision {
  const labels = new Set(snapshot.labels.map((label) => label.trim().toLowerCase()));
  const isWaiting = labels.has('waiting-start-build');
  if (!isWaiting) {
    return { action: 'not_applicable', reason: 'PR 不处于 waiting-start-build，不能把普通门禁状态当作重试触发条件。' };
  }
  if (snapshot.ciRunning || labels.has('ci-running')) {
    return { action: 'monitor', reason: '门禁已进入运行态，只能轮询结果，不能再次发送触发评论。' };
  }
  const failureKind = snapshot.failureKind;
  const failureCount = snapshot.currentHeadFailureCount ?? (snapshot.retryAlreadyAttempted ? 2 : 1);

  // A comment sent before the bot observes the new head is not a retry of the
  // current ready-to-trigger event. Treating it as one strands a repaired PR
  // in waiting-start-build and incorrectly asks the user to repeat a routine
  // platform operation. This remains bounded by the authoritative bot event,
  // current-head authorization, and one post-ready attempt.
  const mayRetryAfterBotReady = snapshot.latestTriggerPredatesBotReady === true
    && snapshot.postReadyTriggerAlreadyAttempted !== true
    && snapshot.botRequestedRetry
    && snapshot.triggerAuthorized
    && failureKind !== 'external_dependency'
    && failureKind !== 'unknown';
  if (mayRetryAfterBotReady) {
    return {
      action: 'trigger_once',
      reason: '最近一次精确 start build 早于机器人对当前 head 的就绪事件，未被消费；可在该事件后补发一次，并记录 bot-ready 事件与 CI-running 回执。',
    };
  }

  if (failureKind === 'code_defect') {
    if (!snapshot.repairedAndVerifiedForCurrentHead) {
      return {
        action: 'repair_required',
        reason: '已归因为代码缺陷：必须先在本地修复并验证，amend 到现有 PR 提交、force-with-lease 推送并回读新的 PR head；不得对旧 head 直接重跑门禁。',
      };
    }
    if (snapshot.retryAlreadyAttempted) {
      return {
        action: 'human_review_required',
        reason: `修复后的当前 head ${snapshot.headSha} 已执行过一次受控触发但仍未闭合；停止自动重试并交由人工核对新的失败证据。`,
      };
    }
    if (!snapshot.triggerAuthorized) {
      return { action: 'wait_authorization', reason: '已完成本地修复、验证和新 head 推送，但当前运行没有触发 CI 的明确授权。' };
    }
    return {
      action: 'trigger_once',
      reason: '已归因为代码缺陷且已在修复后的新 head 完成本地验证；可对该新 head 精确触发一次门禁。',
    };
  }

  if (failureKind === 'suspected_transient') {
    if (snapshot.retryAlreadyAttempted || failureCount >= 2) {
      return {
        action: 'human_review_required',
        reason: `当前 head ${snapshot.headSha} 已出现 ${failureCount} 次同类失败；一次受控重试仍复现，不能继续按随机问题处理，需人工判断环境、依赖或隐藏代码原因。`,
      };
    }
    if (!snapshot.triggerAuthorized) {
      return { action: 'wait_authorization', reason: '疑似一次性环境/平台波动，但当前运行没有触发 CI 的明确授权。' };
    }
    return {
      action: 'trigger_once',
      reason: '已基于当前 head 的失败日志归因为疑似一次性环境/平台波动；可记录证据后受控重试一次。',
    };
  }

  if (failureKind === 'external_dependency' || failureKind === 'unknown') {
    return {
      action: 'human_review_required',
      reason: failureKind === 'external_dependency'
        ? '失败指向外部依赖或基础设施，不能把它当作随机问题盲目重跑；需要人工确认依赖状态与后续处置。'
        : '失败原因尚未形成可复核分类；必须先补充当前 head 的日志和证据，再决定修复、重试或升级人工。',
    };
  }
  if (!snapshot.botRequestedRetry) {
    return { action: 'external_blocked', reason: '平台未请求重新触发；保留 waiting 状态并报告，不要猜测性刷评论。' };
  }
  if (snapshot.retryAlreadyAttempted) {
    return { action: 'external_blocked', reason: `当前 head ${snapshot.headSha} 已执行过一次受控重试但未获平台确认，停止重发并升级外部依赖。` };
  }
  if (!snapshot.triggerAuthorized) {
    return { action: 'wait_authorization', reason: '满足恢复条件，但当前运行没有触发 CI 的明确授权。' };
  }

  const rawBody = snapshot.latestTriggerBody ?? '';
  if (rawBody === GITCODE_CI_TRIGGER_COMMAND) {
    return { action: 'external_blocked', reason: '最近一次评论已是字节级精确的 start build；机器人仍未确认时不能重复发送。' };
  }
  if (rawBody.trim() === GITCODE_CI_TRIGGER_COMMAND || rawBody === '') {
    return {
      action: 'trigger_once',
      reason: rawBody
        ? '最近触发评论语义正确但原始正文不精确（例如带换行）；可对当前 head 发送一次无尾随字符的修复性评论。'
        : '平台已要求重新触发但尚无对应触发评论；可对当前 head 发送一次精确评论。',
    };
  }
  return { action: 'external_blocked', reason: '最近评论不是可安全纠正的 start build 变体；需要先核对 PR 评论和触发权限。' };
}

/**
 * Extract only canonical GitCode PR URLs. Issue URLs deliberately do not
 * match: an issue is not evidence that a CI gate has passed.
 */
export function findGitCodePullRequestRef(text: unknown): GitCodePullRequestRef | null {
  return findGitCodePullRequestRefs(text)[0] || null;
}

/** Extract every distinct PR reference so a joint delivery cannot be reduced to its first repository. */
export function findGitCodePullRequestRefs(text: unknown): GitCodePullRequestRef[] {
  if (typeof text !== 'string') return [];
  const refs: GitCodePullRequestRef[] = [];
  const seen = new Set<string>();
  const pattern = /https?:\/\/gitcode\.com\/([^/\s?#]+)\/([^/\s?#]+)\/(?:pull|merge_requests)\/(\d+)(?:[/?#][^\s]*)?/gi;
  for (const match of text.matchAll(pattern)) {
    const [, owner, repo, rawNumber] = match;
    const number = Number.parseInt(rawNumber, 10);
    if (!owner || !repo || !Number.isSafeInteger(number) || number <= 0) continue;
    const url = `https://gitcode.com/${owner}/${repo}/pull/${number}`;
    if (seen.has(url)) continue;
    seen.add(url);
    refs.push({ owner, repo, number, url });
  }
  return refs;
}

/**
 * CI is only considered passed when the two gate labels relevant to this
 * workflow are both present. A green-looking PR page or a bot comment alone
 * is not sufficient evidence for automatic progression.
 */
export function classifyGitCodeCiGate(labelsInput: readonly string[]): Pick<GitCodeCiGateObservation, 'status' | 'labels' | 'reason'> {
  const labels = labelsInput
    .filter((label): label is string => typeof label === 'string')
    .map((label) => label.trim())
    .filter(Boolean);
  const normalized = new Set(labels.map((label) => label.toLowerCase()));
  const has = (label: string) => normalized.has(label);

  if (has('build-test-passed') && has('codecheck-passed')) {
    return { status: 'passed', labels, reason: '已同时获得 build-test-passed 与 codecheck-passed。' };
  }
  if (has('codecheck-failed') || has('build-test-failed') || has('build-failed')) {
    return { status: 'failed', labels, reason: 'GitCode 门禁标签显示失败。' };
  }
  if (has('ci-running')) {
    return { status: 'running', labels, reason: 'GitCode CI 正在运行。' };
  }
  if (has('waiting-start-build')) {
    return { status: 'waiting', labels, reason: 'GitCode 正等待精确的 start build 触发。' };
  }
  return { status: 'unknown', labels, reason: '未发现可判定 GitCode 门禁状态的标签。' };
}

export function createGitCodeCiGateObservation(input: {
  labels?: readonly string[];
  headSha?: unknown;
  merged?: unknown;
  checkedAt?: string;
}): GitCodeCiGateObservation {
  const classified = classifyGitCodeCiGate(input.labels || []);
  return {
    ...classified,
    headSha: typeof input.headSha === 'string' && input.headSha.trim() ? input.headSha.trim() : null,
    merged: input.merged === true,
    checkedAt: input.checkedAt || new Date().toISOString(),
  };
}

export function createGitCodePullRequestReadinessObservation(input: {
  labels?: readonly string[];
  headSha?: unknown;
  merged?: unknown;
  checkedAt?: string;
  mergeableState?: unknown;
  reviewComments?: readonly GitCodePullRequestReviewComment[];
}): GitCodePullRequestReadinessObservation {
  const gate = createGitCodeCiGateObservation(input);
  const mergeableState = input.mergeableState && typeof input.mergeableState === 'object'
    ? input.mergeableState as Record<string, unknown>
    : {};
  const unresolvedReviewComments = (input.reviewComments || []).filter((comment) => !comment.resolved);
  const blockers: string[] = [];
  const isFalse = (key: string) => mergeableState[key] === false;

  if (gate.merged) {
    return { ...gate, readiness: 'merged', blockers, unresolvedReviewComments, mergeableState };
  }
  if (gate.status === 'failed') {
    blockers.push(gate.reason);
    // A gate label by itself does not prove a source defect.  Route the
    // workflow through its evidence-gathering recovery step before deciding
    // between one bounded retry, source repair, or human escalation.
    return { ...gate, readiness: 'gate_recovery_required', blockers, unresolvedReviewComments, mergeableState };
  }
  if (unresolvedReviewComments.length > 0) {
    blockers.push(`存在 ${unresolvedReviewComments.length} 条未解决的行级检视意见。`);
  }
  if (isFalse('resolve_discussion_passed')) {
    blockers.push('PR 仍有未解决讨论。');
  }
  if (isFalse('conflict_passed')) {
    blockers.push('PR 与目标分支存在冲突。');
  }
  if (blockers.length > 0) {
    return { ...gate, readiness: 'repair_required', blockers, unresolvedReviewComments, mergeableState };
  }

  if (gate.status !== 'passed') {
    blockers.push(gate.reason);
    return { ...gate, readiness: 'waiting_external', blockers, unresolvedReviewComments, mergeableState };
  }

  for (const [key, message] of [
    ['approval_reviewers_required_passed', '尚未满足必需评审人数。'],
    ['approval_approvers_required_passed', '尚未满足必需审批人数。'],
    ['approval_testers_required_passed', '尚未满足必需测试人确认。'],
    ['branch_missing_passed', '源分支不可用。'],
  ] as const) {
    if (isFalse(key)) blockers.push(message);
  }
  if (blockers.length > 0) {
    return { ...gate, readiness: 'waiting_external', blockers, unresolvedReviewComments, mergeableState };
  }
  return { ...gate, readiness: 'ready_for_merge', blockers, unresolvedReviewComments, mergeableState };
}

/**
 * Returns a violation only for an outbound GitCode PR comment command. This
 * deliberately does not scan ordinary agent prose or source files, where an
 * example such as "start_build" may be harmless documentation.
 */
export function findGitCodeCiToolCommandViolation(tool: ToolCommandInput): GitCodeCiToolCommandViolation | null {
  const command = typeof tool.input?.command === 'string' ? tool.input.command : '';
  if (!command || !looksLikeGitCodePrCommentCommand(command)) return null;
  if (!/\bstart(?:_|-)build\b/i.test(command)) return null;

  return {
    code: 'GITCODE_CI_TRIGGER_COMMAND_INVALID',
    command,
    message: [
      '已阻止 GitCode CI 触发：评论命令包含无效拼写 `start_build` 或 `start-build`。',
      `GitCode 只接受完全一致的评论内容：\`${GITCODE_CI_TRIGGER_COMMAND}\`。`,
      '请不要重试该错误命令；改为在获得当前运行的明确授权后发送唯一允许的评论，并确认 CI 已创建。',
    ].join(' '),
  };
}

export function buildGitCodeCiCommandPolicyPrompt(skillPath: string): string {
  return [
    '# GitCode CI 触发规则（强制）',
    `涉及 GitCode PR 评论、构建或 CI 时，先阅读 \`${skillPath}\`。`,
    `GitCode 的构建触发评论是严格协议，唯一允许的评论内容是：\`${GITCODE_CI_TRIGGER_COMMAND}\`。`,
    '绝不能发送 `start_build`、`start-build`、`Start Build` 或附带其他文字的变体。它们不是等价命令。',
    '只有当前步骤任务、当前运行的人类审批或用户明确指令授权触发 CI 时才可发送该评论；没有授权时只报告建议，不要触发。',
    '发送后必须读取/查询 PR 门禁，确认本次提交对应的 CI 已实际创建；未创建时如实报告，不要把评论已发送当作门禁已触发。',
    '',
    '## GitCode 门禁恢复流转（强制）',
    '先读取当前 PR 的 head、标签、机器人评论、失败任务日志，以及本 head 的已失败次数。输出结构化归因：`failureKind` 只能是 `suspected_transient`、`code_defect`、`external_dependency` 或 `unknown`，并列出证据；仅凭“失败”或等待时长不能归为随机问题。',
    '对 `suspected_transient`：仅在 `waiting-start-build`、没有 `CI-running`、当前步骤有触发授权、同一 head 此类失败尚未重试过一次时，才可重试一次。先在 `.aceharness-evidence/gitcode-ci-retry.json` 记录 head、失败证据、时间、`failureKind`、`failureCountForHead: 1` 和 `retryCount: 1`。第二次在同一 head 复现则输出 `human_review_required`，不得再发评论。',
    '对 `code_defect`：绝不能对旧 head 直接重跑。先回到修复与验证：本地修复、运行相关验证、用 `git commit --amend` 更新已有 PR 提交、以 `git push --force-with-lease` 推送，并回读新 PR head。只有“已验证的新 head”且有触发授权时，才可精确触发一次。',
    '对 `external_dependency` 或 `unknown`：输出 `human_review_required`，附失败日志和所需人工判断；不得猜测性触发。',
    '协议拼写恢复是例外：如果当前 head 的最新评论是 `start build\\n` 等“trim 后正确、原文不正确”的变体，可按同样的一次上限发送无尾随字符的精确 `start build`。',
    '触发时序也必须记录：`botReadyEventId`、`botReadyAt`、`triggerCommentId`、`triggerAt` 和是否已出现 `CI-running`。若精确 `start build` 早于机器人针对当前 head 的“请回复 start build”事件，说明该评论未被消费；在有触发授权且尚未在该 bot-ready 事件后发送过时，可自动补发一次。该补发不计入随机失败重试；补发后仍无 `CI-running` 才输出 `external_blocked`，不得循环发送。',
    '运行时会拦截已观测到的无效 GitCode 评论命令并取消本回合，防止它继续被当作成功交付。',
    '',
    '## 联合 PR 与测试仓约束（强制）',
    '用户启动时只提供 Issue 来源。若修复需要新增或更新独立测试仓（例如 `cangjie_test`）的回归用例，工作流必须在上下文固化阶段自动发现测试归属并写入内部 `jointPrContract` / `gateContract.requiredPrs`；测试仓 PR 是同一 Issue 的联合交付成员，不是可随意延期的 follow-up。创建或更新对应测试仓 PR，并让它与主仓 PR 一并通过门禁、检视和合入前检查。',
    '主仓 PR 在任何必需联合 PR 缺失、未推送、门禁失败、存在未解决检视意见或未合入时，均不得被裁决为交付完成。只有用户明确豁免，且豁免理由、风险与跟踪项已写入 Gate 契约时，才可不创建测试仓 PR。',
    '',
    ...buildGitCodePrCommitTopologyPolicyPrompt(),
  ].join('\n');
}

/**
 * Keep a PR's review unit stable while responding to its gates.  This is part
 * of the runtime prompt (rather than only a Skill) because every delivery
 * agent must obey it even if it does not independently discover the Skill.
 */
export function buildGitCodePrCommitTopologyPolicyPrompt(): string[] {
  return [
    '# GitCode PR 提交形态规则（强制）',
    '当当前工作分支已经存在对应的开放 PR 时，默认目标是“一个 PR、一个提交”。',
    '对 codecheck、CI 或评审反馈做的同一修复，必须先核对 PR head 与本地 HEAD；随后使用 `git commit --amend` 更新现有提交，而不是创建第二个提交。',
    'amend 后必须用 `git push --force-with-lease` 更新同一 PR 分支；禁止使用不带 lease 的强推，禁止 `--no-verify`。',
    '推送后必须回读 PR head，并验证相对目标分支的提交数仍为 1；若无法安全 amend、发现并发远端更新或仓库明确要求提交序列，停止并报告原因，等待用户明确授权新增提交。',
    '只有“尚未创建 PR 的首次交付”或用户明确要求保留多个提交时，才允许普通 `git commit` 创建新提交。',
  ];
}

function looksLikeGitCodePrCommentCommand(command: string): boolean {
  return /(?:\bgc\s+pr\s+comment\b|\bpr\s+comment\b|\bpower-gitcode\b|\bgitcode(?:\.com)?\b.*\bcomment\b|\bcomment\b.*\bgitcode(?:\.com)?\b)/i.test(command);
}
