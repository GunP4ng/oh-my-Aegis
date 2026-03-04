export type AgentOverrideProfile = {
  model: string;
  variant?: string;
};

export const AGENT_OVERRIDES: Record<string, AgentOverrideProfile> = {};
