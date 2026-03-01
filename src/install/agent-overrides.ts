export type AgentOverrideProfile = {
  model: string;
  variant?: string;
};

export const AGENT_OVERRIDES: Record<string, AgentOverrideProfile> = {
  "aegis-plan": { model: "openai/gpt-5.3-codex", variant: "low" },
  "aegis-exec": { model: "openai/gpt-5.3-codex", variant: "high" },
  "aegis-deep": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-web": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-web3": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-pwn": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-rev": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-crypto": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-forensics": { model: "openai/gpt-5.3-codex", variant: "low" },
  "ctf-explore": { model: "openai/gpt-5.3-codex", variant: "low" },
  "ctf-solve": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-research": { model: "openai/gpt-5.3-codex", variant: "low" },
  "ctf-hypothesis": { model: "openai/gpt-5.3-codex", variant: "low" },
  "ctf-decoy-check": { model: "openai/gpt-5.3-codex", variant: "low" },
  "ctf-verify": { model: "openai/gpt-5.3-codex", variant: "medium" },
  "bounty-scope": { model: "openai/gpt-5.3-codex", variant: "medium" },
  "bounty-triage": { model: "openai/gpt-5.3-codex", variant: "high" },
  "bounty-research": { model: "openai/gpt-5.3-codex", variant: "low" },
  "deep-plan": { model: "openai/gpt-5.3-codex", variant: "low" },
  "md-scribe": { model: "openai/gpt-5.3-codex", variant: "low" },
  "explore-fallback": { model: "openai/gpt-5.3-codex", variant: "low" },
  "librarian-fallback": { model: "openai/gpt-5.3-codex", variant: "low" },
  "oracle-fallback": { model: "openai/gpt-5.3-codex", variant: "low" },
};
