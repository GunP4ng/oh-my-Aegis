export type AgentOverrideProfile = {
  model: string;
  variant?: string;
};

export const AGENT_OVERRIDES: Record<string, AgentOverrideProfile> = {
  "aegis-plan": { model: "opencode/glm-5-free" },
  "aegis-exec": { model: "openai/gpt-5.3-codex", variant: "high" },
  "aegis-deep": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-web": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-web3": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-pwn": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-rev": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-crypto": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-forensics": { model: "opencode/glm-5-free" },
  "ctf-explore": { model: "opencode/glm-5-free" },
  "ctf-solve": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-research": { model: "opencode/glm-5-free" },
  "ctf-hypothesis": { model: "opencode/glm-5-free" },
  "ctf-decoy-check": { model: "opencode/glm-5-free" },
  "ctf-verify": { model: "openai/gpt-5.3-codex", variant: "medium" },
  "bounty-scope": { model: "openai/gpt-5.3-codex", variant: "medium" },
  "bounty-triage": { model: "openai/gpt-5.3-codex", variant: "high" },
  "bounty-research": { model: "opencode/glm-5-free" },
  "deep-plan": { model: "opencode/glm-5-free" },
  "md-scribe": { model: "opencode/glm-5-free" },
  "explore-fallback": { model: "opencode/glm-5-free" },
  "librarian-fallback": { model: "opencode/glm-5-free" },
  "oracle-fallback": { model: "opencode/glm-5-free" },
};
