'use client';

import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import type { ChatroomState, ChatroomMessage, ChatroomActiveVote } from './types';
import { createInitialChatroomState } from './types';

export interface ChatroomPanelProps {
  /** Available agents to choose from */
  availableAgents: Array<{ name: string; description?: string }>;
  /** Call an agent and get streaming response */
  callAgent: (agentName: string, message: string) => Promise<string>;
  /** Toast notification */
  toast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void;
}

export function ChatroomPanel({ availableAgents, callAgent, toast }: ChatroomPanelProps) {
  const [state, setState] = useState<ChatroomState>(createInitialChatroomState());
  const [draft, setDraft] = useState('');
  const [topicInput, setTopicInput] = useState('');
  const [voteQuestion, setVoteQuestion] = useState('');
  const [voteOptions, setVoteOptions] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // --- Setup Phase ---
  const handleStartChatroom = () => {
    if (selectedAgents.size < 2) {
      toast('warning', '请至少选择 2 个 Agent');
      return;
    }
    if (!topicInput.trim()) {
      toast('warning', '请输入讨论话题');
      return;
    }
    setState({
      ...createInitialChatroomState(),
      phase: 'chatting',
      topic: topicInput.trim(),
      agents: Array.from(selectedAgents),
      topicHistory: [topicInput.trim()],
    });
    toast('success', `聊天室已创建，${selectedAgents.size} 位 Agent 加入讨论`);
  };

  // --- Chat Phase ---
  const buildPromptContext = (agentName: string, userMessage: string) => {
    const current = stateRef.current;
    const recentMessages = current.messages.slice(-20);
    const transcript = recentMessages
      .map((m) => `[${m.speaker}]: ${m.content}`)
      .join('\n');
    return [
      `你正在一个多人聊天室中讨论话题：「${current.topic}」`,
      `参与者：${current.agents.join('、')}`,
      `你是 ${agentName}，请自然地参与讨论。`,
      transcript ? `\n最近对话记录：\n${transcript}` : '',
      `\n用户刚才说：${userMessage}`,
      '\n请用简短自然的方式回应，像在群聊里说话一样。不要太长，1-3 句话即可。',
    ].filter(Boolean).join('\n');
  };

  const handleSendMessage = async () => {
    if (!draft.trim() || busy) return;
    const userMessage = draft.trim();
    setDraft('');

    // Add user message
    const currentState = stateRef.current;
    const userMsg: ChatroomMessage = {
      id: `msg-${Date.now()}-user`,
      speaker: '你',
      speakerType: 'human',
      content: userMessage,
      timestamp: Date.now(),
      mentioned: extractMentions(userMessage, currentState.agents),
    };
    setState((prev) => ({ ...prev, messages: [...prev.messages, userMsg] }));

    // Determine which agents should respond
    const mentions = extractMentions(userMessage, currentState.agents);
    const respondingAgents = mentions.length > 0
      ? currentState.agents.filter((a) => mentions.includes(a))
      : currentState.agents;

    setBusy(true);
    try {
      for (const agentName of respondingAgents) {
        const prompt = buildPromptContext(agentName, userMessage);
        const output = await callAgent(agentName, prompt);
        const agentMsg: ChatroomMessage = {
          id: `msg-${Date.now()}-${agentName}`,
          speaker: agentName,
          speakerType: 'agent',
          content: output,
          timestamp: Date.now(),
          replyTo: userMsg.id,
        };
        setState((prev) => ({ ...prev, messages: [...prev.messages, agentMsg] }));
        scrollToBottom();
      }
    } catch (error: any) {
      toast('error', error?.message || 'Agent 回复失败');
    } finally {
      setBusy(false);
    }
  };

  // --- Topic Change ---
  const handleChangeTopic = () => {
    if (!topicInput.trim()) return;
    const newTopic = topicInput.trim();
    const systemMsg: ChatroomMessage = {
      id: `msg-${Date.now()}-system`,
      speaker: '系统',
      speakerType: 'human',
      content: `话题已切换为：「${newTopic}」`,
      timestamp: Date.now(),
    };
    setState((prev) => ({
      ...prev,
      topic: newTopic,
      topicHistory: [...prev.topicHistory, newTopic],
      messages: [...prev.messages, systemMsg],
    }));
    setTopicInput('');
    toast('success', `话题已切换为：${newTopic}`);
  };

  // --- Voting ---
  const handleStartVote = () => {
    if (!voteQuestion.trim() || !voteOptions.trim()) {
      toast('warning', '请输入投票问题和选项');
      return;
    }
    const options = voteOptions.split(/[,，、]/).map((o) => o.trim()).filter(Boolean);
    if (options.length < 2) {
      toast('warning', '至少需要 2 个选项');
      return;
    }
    const vote: ChatroomActiveVote = {
      id: `vote-${Date.now()}`,
      question: voteQuestion.trim(),
      options,
      voted: {},
    };
    setState((prev) => ({ ...prev, activeVote: vote, phase: 'voting' }));
    setVoteQuestion('');
    setVoteOptions('');
    // Trigger agents to vote
    void runVoting(vote);
  };

  const runVoting = async (vote: ChatroomActiveVote) => {
    setBusy(true);
    try {
      const results: Record<string, string> = {};
      for (const agentName of state.agents) {
        const prompt = [
          `聊天室正在进行投票。`,
          `话题：「${state.topic}」`,
          `投票问题：${vote.question}`,
          `选项：${vote.options.join('、')}`,
          `请从以上选项中选择一个，只回复选项内容，不要解释。`,
        ].join('\n');
        const output = await callAgent(agentName, prompt);
        const chosen = vote.options.find((o) => output.includes(o)) || vote.options[0];
        results[agentName] = chosen;
      }
      const completedVote = {
        id: vote.id,
        question: vote.question,
        options: vote.options,
        results,
        initiatedBy: '你',
        completedAt: Date.now(),
      };
      const voteMsg: ChatroomMessage = {
        id: `msg-${Date.now()}-vote`,
        speaker: '系统',
        speakerType: 'human',
        content: `投票结果「${vote.question}」：\n${Object.entries(results).map(([a, v]) => `  ${a} → ${v}`).join('\n')}`,
        timestamp: Date.now(),
      };
      setState((prev) => ({
        ...prev,
        phase: 'chatting',
        activeVote: null,
        votes: [...prev.votes, completedVote],
        messages: [...prev.messages, voteMsg],
      }));
      toast('success', '投票完成');
    } catch (error: any) {
      toast('error', error?.message || '投票失败');
      setState((prev) => ({ ...prev, phase: 'chatting', activeVote: null }));
    } finally {
      setBusy(false);
    }
  };

  // --- Helpers ---
  const extractMentions = (text: string, agents: string[]): string[] => {
    const mentions: string[] = [];
    for (const agent of agents) {
      if (text.includes(`@${agent}`)) mentions.push(agent);
    }
    return mentions;
  };

  const handleReset = () => {
    setState(createInitialChatroomState());
    setSelectedAgents(new Set());
    setTopicInput('');
    setDraft('');
  };

  // --- Render ---
  if (state.phase === 'setup') {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border p-4">
          <h3 className="text-sm font-medium">创建 Agent 聊天室</h3>
          <p className="mt-2 text-xs text-muted-foreground leading-5">
            选择多个 Agent 加入聊天室，设定话题后开始自由讨论。
          </p>
        </div>

        <div className="rounded-2xl border p-4 space-y-3">
          <div className="text-sm font-medium">选择参与 Agent</div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {availableAgents.map((agent) => (
              <label key={agent.name} className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox
                  checked={selectedAgents.has(agent.name)}
                  onCheckedChange={(checked) => {
                    setSelectedAgents((prev) => {
                      const next = new Set(prev);
                      if (checked) next.add(agent.name);
                      else next.delete(agent.name);
                      return next;
                    });
                  }}
                />
                <span>{agent.name}</span>
                {agent.description && (
                  <span className="text-xs text-muted-foreground truncate">{agent.description}</span>
                )}
              </label>
            ))}
          </div>
          {selectedAgents.size > 0 && (
            <div className="text-xs text-muted-foreground">
              已选择 {selectedAgents.size} 个 Agent
            </div>
          )}
        </div>

        <div className="rounded-2xl border p-4 space-y-3">
          <div className="text-sm font-medium">讨论话题</div>
          <Input
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            placeholder="例如：如何设计一个高可用的微服务架构"
          />
        </div>

        <Button className="w-full" onClick={handleStartChatroom} disabled={selectedAgents.size < 2 || !topicInput.trim()}>
          创建聊天室 ({selectedAgents.size} 位 Agent)
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="rounded-2xl border p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground">当前话题</div>
            <div className="text-sm font-medium mt-0.5">{state.topic}</div>
          </div>
          <div className="flex gap-1.5">
            <Badge variant="outline">{state.agents.length} 人</Badge>
            <Badge variant="outline">{state.messages.length} 条</Badge>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="rounded-2xl border p-3 max-h-64 overflow-y-auto space-y-2">
        {state.messages.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-8">
            聊天室已就绪，发送消息开始讨论
          </div>
        ) : (
          state.messages.map((msg) => (
            <div key={msg.id} className={`text-xs ${msg.speakerType === 'human' ? 'text-primary' : 'text-foreground'}`}>
              <span className="font-medium">{msg.speaker}：</span>
              <span className="text-muted-foreground">{msg.content}</span>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`发送消息... 用 @Agent名 指定回复者`}
            rows={2}
            className="flex-1 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSendMessage();
              }
            }}
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {state.agents.map((agent) => (
            <button
              key={agent}
              className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted-foreground/20 transition-colors"
              onClick={() => setDraft((prev) => `${prev}@${agent} `)}
            >
              @{agent}
            </button>
          ))}
        </div>
        <Button className="w-full" size="sm" onClick={handleSendMessage} disabled={!draft.trim() || busy}>
          {busy ? '回复中...' : '发送'}
        </Button>
      </div>

      {/* Actions */}
      <div className="rounded-2xl border p-3 space-y-2">
        <div className="text-xs font-medium text-muted-foreground">操作</div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => {
            const input = window.prompt('输入新话题：');
            if (input?.trim()) {
              const newTopic = input.trim();
              const systemMsg: ChatroomMessage = {
                id: `msg-${Date.now()}-system`,
                speaker: '系统',
                speakerType: 'human',
                content: `话题已切换为：「${newTopic}」`,
                timestamp: Date.now(),
              };
              setState((prev) => ({
                ...prev,
                topic: newTopic,
                topicHistory: [...prev.topicHistory, newTopic],
                messages: [...prev.messages, systemMsg],
              }));
              toast('success', `话题已切换为：${newTopic}`);
            }
          }}>
            切换话题
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => {
            const q = window.prompt('投票问题：');
            const o = window.prompt('选项（逗号分隔）：');
            if (q?.trim() && o?.trim()) {
              const options = o.split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
              if (options.length < 2) { toast('warning', '至少需要 2 个选项'); return; }
              const vote: ChatroomActiveVote = { id: `vote-${Date.now()}`, question: q.trim(), options, voted: {} };
              setState((prev) => ({ ...prev, activeVote: vote, phase: 'voting' }));
              void runVoting(vote);
            }
          }}>
            发起投票
          </Button>
          <Button size="sm" variant="ghost" onClick={handleReset}>
            结束聊天室
          </Button>
        </div>
        {state.votes.length > 0 && (
          <details className="mt-2">
            <summary className="text-xs cursor-pointer text-muted-foreground">投票历史 ({state.votes.length})</summary>
            <div className="mt-2 space-y-1">
              {state.votes.map((v) => (
                <div key={v.id} className="text-[10px] text-muted-foreground">
                  {v.question}：{Object.entries(v.results).map(([a, r]) => `${a}→${r}`).join('、')}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
