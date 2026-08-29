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
  /** Current step, approval, or user input explicitly permits CI triggering. */
  triggerAuthorized: boolean;
};

export type GitCodeCiGateRecoveryDecision = {
  action: 'trigger_once' | 'monitor' | 'wait_authorization' | 'external_blocked' | 'not_applicable';
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
 * A narrow, idempotent recovery rule for GitCode's strict comment-triggered
 * gate. A trailing newline is intentionally treated as a distinct body: the
 * observed bot behavior is byte-sensitive, not whitespace-normalizing.
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
  if (typeof text !== 'string') return null;
  const match = text.match(/https?:\/\/gitcode\.com\/([^/\s?#]+)\/([^/\s?#]+)\/(?:pull|merge_requests)\/(\d+)(?:[/?#][^\s]*)?/i);
  if (!match) return null;
  const [, owner, repo, rawNumber] = match;
  const number = Number.parseInt(rawNumber, 10);
  if (!owner || !repo || !Number.isSafeInteger(number) || number <= 0) return null;
  return {
    owner,
    repo,
    number,
    url: `https://gitcode.com/${owner}/${repo}/pull/${number}`,
  };
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
    '先读取当前 PR 的 head、标签和最新评论。只有同时满足：`waiting-start-build`、没有 `CI-running`、机器人已在当前 head 后请求重新触发、当前步骤有触发授权，才进入恢复判断。',
    '把最新评论正文按原始字符串比对：若它是 `start build\\n` 等“trim 后正确、原文不正确”的变体，针对该 head 最多发送一次无换行的精确 `start build`。先在 `.aceharness-evidence/gitcode-ci-retry.json` 记录 head、评论正文、时间和 `retryCount: 1`，防止跨步骤重复触发。',
    '发出后轮询标签和机器人评论：发现 `CI-running` 或流水线启动通知则转为 `wait_external` 监控；若仍无确认，输出 `external_blocked`，说明“机器人未消费精确指令”，不要循环发送。',
    '若最新评论已经是字节级精确的 `start build`，不得重发；直接作为外部依赖异常上报。',
    '运行时会拦截已观测到的无效 GitCode 评论命令并取消本回合，防止它继续被当作成功交付。',
  ].join('\n');
}

function looksLikeGitCodePrCommentCommand(command: string): boolean {
  return /(?:\bgc\s+pr\s+comment\b|\bpr\s+comment\b|\bpower-gitcode\b|\bgitcode(?:\.com)?\b.*\bcomment\b|\bcomment\b.*\bgitcode(?:\.com)?\b)/i.test(command);
}
