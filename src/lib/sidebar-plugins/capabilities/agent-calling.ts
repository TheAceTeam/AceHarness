/**
 * Agent Calling Capability Implementation
 *
 * Wraps the streaming collaboration agent call pattern into a clean capability interface.
 */

import type { AgentCallingCapability, AgentCallInput } from './types';

export function createAgentCallingCapability(
  callAgent: (input: AgentCallInput) => Promise<string>,
  getAgentSession: (name: string) => string | undefined,
  setAgentSession: (name: string, sessionId: string) => void,
): AgentCallingCapability {
  return {
    call(input: AgentCallInput): Promise<string> {
      return callAgent(input);
    },
    getSession(agentName: string): string | undefined {
      return getAgentSession(agentName);
    },
    setSession(agentName: string, sessionId: string) {
      setAgentSession(agentName, sessionId);
    },
  };
}
