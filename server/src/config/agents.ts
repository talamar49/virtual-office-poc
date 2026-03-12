/**
 * Agent Registry — v2 with zone assignments
 * 
 * 12 agents matching the virtual-office-v2.md spec.
 */

export type Zone = 'work' | 'lounge' | 'bugzone';

export interface AgentMeta {
  id: string;
  name: string;
  role: string;
  emoji: string;
  hasSprite: boolean;
}

const AGENTS: AgentMeta[] = [
  { id: 'yogi',   name: 'יוגי',  role: 'COO',                              emoji: '🐻',  hasSprite: true },
  { id: 'omer',   name: 'עומר',  role: 'Tech Lead',                        emoji: '👨‍💻',  hasSprite: true },
  { id: 'noa',    name: 'נועה',  role: 'Frontend/UX',                      emoji: '🎨',  hasSprite: true },
  { id: 'itai',   name: 'איתי',  role: 'Backend/API',                      emoji: '🗄️',  hasSprite: true },
  { id: 'gil',    name: 'גיל',   role: 'DevOps',                           emoji: '⚙️',  hasSprite: true },
  { id: 'michal', name: 'מיכל',  role: 'QA Lead',                          emoji: '🔍',  hasSprite: true },
  { id: 'amir',   name: 'אמיר',  role: 'Game Artist',                      emoji: '🎮',  hasSprite: true },
  { id: 'roni',   name: 'רוני',  role: 'Product Manager',                  emoji: '📋',  hasSprite: false },
  { id: 'dana',   name: 'דנה',   role: 'HR',                               emoji: '💜',  hasSprite: false },
  { id: 'lior',   name: 'ליאור', role: 'Marketing',                        emoji: '📈',  hasSprite: false },
  { id: 'tomer',  name: 'תומר',  role: 'Sales',                            emoji: '💼',  hasSprite: false },
  { id: 'alon',   name: 'אלון',  role: 'Senior Dev',                       emoji: '🧑‍💻',  hasSprite: false },
];

export const AGENT_REGISTRY = new Map<string, AgentMeta>(
  AGENTS.map((a) => [a.id, a])
);

export function getAgentMeta(id: string): AgentMeta {
  return AGENT_REGISTRY.get(id) ?? {
    id,
    name: id,
    role: 'Unknown',
    emoji: '❓',
    hasSprite: false,
  };
}

export function getAllAgentIds(): string[] {
  return AGENTS.map((a) => a.id);
}

/**
 * Map agent ID to OpenClaw session key prefix.
 * The Gateway uses "main" as the agent ID for Yogi (the main agent).
 */
export function toGatewayAgentId(agentId: string): string {
  return agentId === 'yogi' ? 'main' : agentId;
}

export function fromGatewayAgentId(gatewayId: string): string {
  return gatewayId === 'main' ? 'yogi' : gatewayId;
}

export default AGENTS;
