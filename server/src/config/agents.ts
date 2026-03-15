/**
 * Agent Registry — fully dynamic
 * 
 * Agents are discovered from the Gateway at runtime.
 * No hardcoded agent data — works with any OpenClaw setup.
 */

export type Zone = 'work' | 'lounge' | 'bugzone';

export interface AgentMeta {
  id: string;
  name: string;
  role: string;
  emoji: string;
  hasSprite: boolean;
}

// Dynamic registry — populated from Gateway sessions
const dynamicAgents = new Map<string, AgentMeta>();

const DEFAULT_EMOJIS = ['🤖', '👨‍💻', '👩‍💻', '🧑‍💻', '🎨', '🔧', '📊', '🔍', '📋', '💡', '🎯', '⚡', '🌟', '🔮', '🎪', '🦊'];

export const AGENT_REGISTRY = dynamicAgents;

export function registerAgent(id: string, meta?: Partial<AgentMeta>): AgentMeta {
  const existing = dynamicAgents.get(id);
  if (existing) return existing;
  
  const index = dynamicAgents.size;
  const agent: AgentMeta = {
    id,
    name: meta?.name ?? id,
    role: meta?.role ?? 'Agent',
    emoji: meta?.emoji ?? DEFAULT_EMOJIS[index % DEFAULT_EMOJIS.length],
    hasSprite: meta?.hasSprite ?? false,
  };
  dynamicAgents.set(id, agent);
  return agent;
}

export function getAgentMeta(id: string): AgentMeta {
  return dynamicAgents.get(id) ?? registerAgent(id);
}

export function getAllAgentIds(): string[] {
  return Array.from(dynamicAgents.keys());
}

/**
 * Map agent ID to OpenClaw session key prefix.
 * The Gateway uses "main" as the primary agent ID.
 */
export function toGatewayAgentId(agentId: string): string {
  return agentId;
}

export function fromGatewayAgentId(gatewayId: string): string {
  return gatewayId;
}

export default [];
