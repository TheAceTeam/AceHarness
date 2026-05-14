/**
 * Chatroom Plugin Types
 */

export interface ChatroomState {
  /** 聊天室状态 */
  phase: 'setup' | 'chatting' | 'voting' | 'ended';
  /** 当前话题 */
  topic: string;
  /** 参与的 Agent 列表 */
  agents: string[];
  /** 消息列表 */
  messages: ChatroomMessage[];
  /** 投票记录 */
  votes: ChatroomVote[];
  /** 当前投票（进行中） */
  activeVote: ChatroomActiveVote | null;
  /** 话题历史 */
  topicHistory: string[];
}

export interface ChatroomMessage {
  id: string;
  speaker: string;
  speakerType: 'human' | 'agent';
  content: string;
  timestamp: number;
  replyTo?: string;
  mentioned?: string[];
}

export interface ChatroomVote {
  id: string;
  question: string;
  options: string[];
  results: Record<string, string>; // agent -> chosen option
  initiatedBy: string;
  completedAt?: number;
}

export interface ChatroomActiveVote {
  id: string;
  question: string;
  options: string[];
  voted: Record<string, string>; // agent -> chosen option (partial)
}

export function createInitialChatroomState(): ChatroomState {
  return {
    phase: 'setup',
    topic: '',
    agents: [],
    messages: [],
    votes: [],
    activeVote: null,
    topicHistory: [],
  };
}
