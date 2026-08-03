import { wrapAceProcessBlock } from '@/lib/chat/ai-process-blocks';

export const REAL_OPENCODE_CONNECTED_REPLAY = {
  backendSessionId: 'ses_1c0a69ce1ffew0vGluORt1Cqp1',
  replayDelta: '上一轮总结：共有 59 个 Agent 配置文件。',
} as const;

export const REAL_OPENCODE_SPLIT_THINKING_TRANSCRIPT = [
  { type: 'delta', content: 'There are a' },
  { type: 'delta', content: ' lot' },
  { type: 'delta', content: ' of' },
  { type: 'delta', content: ' agents.' },
  { type: 'delta', content: ' Let' },
  { type: 'thinking', content: wrapAceProcessBlock('reasoning', {}, ' me') },
  { type: 'thinking', content: wrapAceProcessBlock('reasoning', {}, ' group') },
  { type: 'thinking', content: wrapAceProcessBlock('reasoning', {}, ' them') },
  { type: 'thinking', content: wrapAceProcessBlock('reasoning', {}, ' by') },
  { type: 'thinking', content: wrapAceProcessBlock('reasoning', {}, ' category') },
  { type: 'thinking', content: wrapAceProcessBlock('reasoning', {}, ' to') },
  { type: 'thinking', content: wrapAceProcessBlock('reasoning', {}, ' make') },
  { type: 'thinking', content: wrapAceProcessBlock('reasoning', {}, ' it') },
  { type: 'thinking', content: wrapAceProcessBlock('reasoning', {}, ' more') },
  { type: 'thinking', content: wrapAceProcessBlock('reasoning', {}, ' readable') },
] as const;

export const REAL_OPENCODE_RESULT_TAIL_DELTAS = [
  { type: 'delta', content: '>`' },
  { type: 'delta', content: ' ' },
  { type: 'delta', content: '读取' },
  { type: 'delta', content: '单个' },
  { type: 'delta', content: '配置' },
  { type: 'delta', content: '。"' },
  { type: 'delta', content: '}]' },
  { type: 'delta', content: '}}\n' },
  { type: 'delta', content: '</' },
  { type: 'delta', content: 'result' },
  { type: 'delta', content: '>' },
] as const;

export const REAL_OPENCODE_DONE_RESULT = `共有 22 个 Agent 配置文件：

<result>
{"kind":"card","payload":{"header":{"icon":"smart_toy","title":"Agent 配置列表","subtitle":"系统数据目录 agents","badges":[{"text":"22 个 Agent","color":"blue"}]},"blocks":[{"type":"table","columns":[{"key":"group","label":"分组","width":"140px"},{"key":"count","label":"数量","width":"80px"},{"key":"examples","label":"示例","width":"auto"}],"rows":[{"id":"core","cells":{"group":"通用协作","count":"7","examples":"generalist, researcher, analyst, writer, fact-checker, evidence-judge, default-supervisor"}},{"id":"product","cells":{"group":"产品体验","count":"5","examples":"product-manager, experience-designer, copywriter, solution-breaker, design-judge"}},{"id":"software","cells":{"group":"软件交付","count":"10","examples":"architect, developer, tester, documentation-writer, code-hunter, issue-reproducer, ..."}}]},{"type":"text","content":"共 22 个 Agent。详细查看可输入 \`agent.get <name>\` 读取单个配置。"}]}}
</result>`;
