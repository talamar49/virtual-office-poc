/**
 * Agent Registry — hybrid (known agents + dynamic discovery)
 * 
 * Known agents are always registered on startup so they appear even when offline.
 * New agents discovered from the Gateway are added dynamically.
 */

export type Zone = 'work' | 'lounge' | 'bugzone';

export interface AgentMeta {
  id: string;
  name: string;
  role: string;
  emoji: string;
  hasSprite: boolean;
}

// Dynamic registry — seeded with known agents, extended from Gateway sessions
const dynamicAgents = new Map<string, AgentMeta>();

const DEFAULT_EMOJIS = ['🤖', '👨‍💻', '👩‍💻', '🧑‍💻', '🎨', '🔧', '📊', '🔍', '📋', '💡', '🎯', '⚡', '🌟', '🔮', '🎪', '🦊'];

/**
 * Known team agents — always visible even when offline.
 * Add/remove agents here to control the office roster.
 */
const KNOWN_AGENTS: AgentMeta[] = [
  { id: 'main',    name: 'יוגי',  role: 'COO',              emoji: '🐻', hasSprite: false },
  { id: 'monitor', name: 'שחר',   role: 'Monitor',          emoji: '👁️', hasSprite: false },
  { id: 'omer',    name: 'עומר',  role: 'Senior Developer', emoji: '👨‍💻', hasSprite: false },
  { id: 'noa',     name: 'נועה',  role: 'QA Lead',          emoji: '🔍', hasSprite: false },
  { id: 'itai',    name: 'איתי',  role: 'Frontend Dev',     emoji: '🎨', hasSprite: false },
  { id: 'michal',  name: 'מיכל',  role: 'QA Engineer',      emoji: '🧪', hasSprite: false },
  { id: 'gil',     name: 'גיל',   role: 'DevOps',           emoji: '🔧', hasSprite: false },
  { id: 'roni',    name: 'רוני',  role: 'Product Manager',  emoji: '📋', hasSprite: false },
  { id: 'dana',    name: 'דנה',   role: 'Designer',         emoji: '🎭', hasSprite: false },
  { id: 'lior',    name: 'ליאור', role: 'Marketing',        emoji: '📣', hasSprite: false },
  { id: 'tomer',   name: 'תומר',  role: 'Business',         emoji: '💼', hasSprite: false },
  { id: 'ido',     name: 'עידו',  role: 'Backend Dev',      emoji: '⚙️', hasSprite: false },
  { id: 'אלון',   name: 'אלון',  role: 'Chat Backend',     emoji: '💬', hasSprite: false },
  { id: 'אמיר',   name: 'אמיר',  role: 'Animations',       emoji: '🎮', hasSprite: false },
  { id: 'coach',   name: 'רועי',  role: 'Coach',            emoji: '🏋️', hasSprite: false },
];

// Seed known agents on module load
for (const agent of KNOWN_AGENTS) {
  dynamicAgents.set(agent.id, agent);
}

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
 */
export function toGatewayAgentId(agentId: string): string {
  return agentId;
}

export function fromGatewayAgentId(gatewayId: string): string {
  return gatewayId;
}

export default [];
