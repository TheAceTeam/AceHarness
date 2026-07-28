type BuildAgentDraftPromptInput = {
  displayName: string;
  team: string;
  mission: string;
  style?: string;
  specialties?: string;
  workingDirectory?: string;
  referenceWorkflow?: string;
  experienceBlock?: string;
  projectMemoryBlock?: string;
  referenceWorkflowBlock?: string;
};

export function buildAgentDraftPrompt(input: BuildAgentDraftPromptInput): string {
  const defaultStyle = input.style || '专业、直接、可靠';

  return [
    '请按 ACEHarness Agent 创建引导流程生成结构化结果。',
    '',
    `显示名称: ${input.displayName}`,
    `建议队伍: ${input.team}`,
    `职责: ${input.mission}`,
    `风格: ${defaultStyle}`,
    `擅长领域: ${input.specialties || '未指定'}`,
    input.workingDirectory ? `工作目录: ${input.workingDirectory}` : '',
    input.referenceWorkflow ? `参考工作流: ${input.referenceWorkflow}` : '',
    input.experienceBlock || '',
    input.projectMemoryBlock || '',
    input.referenceWorkflowBlock || '',
    '',
    '输出由四个 result 结构块组成，每个 result 内是单个 JSON 对象，顶层包含 kind 和 data。',
    '结构块 1：{"kind":"agent_clarification_summary","data":{"summary":"1-2 句需求理解","knownFacts":["已确认事实"],"openQuestions":["仍可后续确认的问题"]}}',
    '结构块 2：{"kind":"agent_role_profile","data":{"displayName":"用户可读名称","name":"kebab-case 文件名","team":"blue|red|judge|black-gold","roleType":"normal|supervisor","mission":"职责边界","style":"沟通与执行风格","specialties":["擅长领域"]}}',
    '结构块 3：{"kind":"agent_execution_profile","data":{"capabilities":["能力标签"],"constraints":["执行约束"],"keywords":["路由关键词"],"systemPrompt":"完整可用的系统提示词","description":"能力说明","tags":["标签"],"category":"分类"}}',
    '结构块 4：{"kind":"agent_config","data":{"agent":{"name":"kebab-case 文件名","team":"blue|red|judge|black-gold","roleType":"normal|supervisor","avatar":{"mode":"deterministic","seed":"稳定 seed","style":"personas|adventurer|pixel-art"},"engineModels":{},"activeEngine":"","capabilities":["能力标签"],"systemPrompt":"完整可用的系统提示词","description":"能力说明","keywords":["路由关键词"],"tags":["标签"],"category":"分类"}}}',
    '',
    '字段取值说明：',
    '- team 取值为 blue、red、judge、black-gold；red 表示防守/实施方，blue 表示攻击/挑战方，black-gold 表示指挥官，judge 表示裁定席',
    '- roleType 取值为 normal、supervisor；black-gold 对应 supervisor',
    '- avatar.mode 取值为 deterministic、generated、uploaded、preset、sprite',
    '- avatar.style 取值为 personas、adventurer、pixel-art；judge 对应 pixel-art，black-gold/supervisor 对应 personas，blue/red 对应 adventurer',
    '- engineModels 为对象；沿用全局模型时使用空对象，activeEngine 使用空字符串',
    '- capabilities 至少包含一个字符串',
    '- systemPrompt 写成完整可直接注入 Agent 的提示词',
    '- 历史经验适合复用时，吸收到 capabilities、systemPrompt、tags',
    '- 参考工作流适合复用时，吸收其角色粒度、协作分工和命名风格',
  ].filter(Boolean).join('\n');
}

export function buildAgentCreationItemRepairPrompt(input: {
  kind: string;
  reason: string;
  displayName: string;
  team: string;
  mission: string;
  style?: string;
  specialties?: string;
  currentState?: unknown;
}): string {
  return [
    '请补发 ACEHarness Agent 创建流程中的当前结构块。',
    `当前 kind: ${input.kind}`,
    `显示名称: ${input.displayName}`,
    `建议队伍: ${input.team}`,
    `职责: ${input.mission}`,
    `风格: ${input.style || '专业、直接、可靠'}`,
    `擅长领域: ${input.specialties || '未指定'}`,
    input.currentState ? `已通过的结构化状态: ${JSON.stringify(input.currentState).slice(0, 4000)}` : '',
    input.reason ? `解析反馈: ${input.reason}` : '',
    '输出一个 result 结构块，result 内是单个 JSON 对象，顶层包含 kind 和 data。',
    input.kind === 'agent_clarification_summary'
      ? '目标结构：{"kind":"agent_clarification_summary","data":{"summary":"1-2 句需求理解","knownFacts":["已确认事实"],"openQuestions":["仍可后续确认的问题"]}}'
      : input.kind === 'agent_clarification_facts'
        ? '目标结构：{"kind":"agent_clarification_facts","data":{"facts":["已确认事实 1","已确认事实 2"]}}'
        : input.kind === 'agent_clarification_gaps'
          ? '目标结构：{"kind":"agent_clarification_gaps","data":{"gaps":["blocking: 待补信息","optional: 可后续补充的信息"]}}'
          : input.kind === 'agent_clarification_question'
            ? '目标结构：{"kind":"agent_clarification_question","data":{"id":"稳定 id","label":"短标签","question":"具体问题，并说明这个答案会影响什么决策","selectionMode":"single|multiple","options":[{"id":"recommended","label":"推荐选项","description":"说明默认方案和影响","recommended":true},{"id":"alternative","label":"备选方案","description":"说明取舍"}],"placeholder":"跳过时系统采用的保守假设","required":true}}'
            : input.kind === 'agent_role_profile'
              ? '目标结构：{"kind":"agent_role_profile","data":{"displayName":"用户可读名称","name":"kebab-case 文件名","team":"blue|red|judge|black-gold","roleType":"normal|supervisor","mission":"职责边界","style":"沟通与执行风格","specialties":["擅长领域"]}}'
              : input.kind === 'agent_execution_profile'
                ? '目标结构：{"kind":"agent_execution_profile","data":{"capabilities":["能力标签"],"constraints":["执行约束"],"keywords":["路由关键词"],"systemPrompt":"完整可用的系统提示词","description":"能力说明","tags":["标签"],"category":"分类"}}'
                : '目标结构：{"kind":"agent_config","data":{"agent":{"name":"kebab-case 文件名","team":"blue|red|judge|black-gold","roleType":"normal|supervisor","avatar":{"mode":"deterministic","seed":"稳定 seed","style":"personas|adventurer|pixel-art"},"engineModels":{},"activeEngine":"","capabilities":["能力标签"],"systemPrompt":"完整可用的系统提示词","description":"能力说明","keywords":["路由关键词"],"tags":["标签"],"category":"分类"}}}',
  ].filter(Boolean).join('\n');
}
