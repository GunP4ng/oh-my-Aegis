export type AgentOverrideProfile = {
  model: string;
  variant: string;
};

export const AGENT_OVERRIDES: Record<string, AgentOverrideProfile> = {
  "ctf-web": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-web3": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-pwn": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-rev": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-crypto": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-forensics": { model: "google/antigravity-gemini-3-flash", variant: "medium" },
  "ctf-explore": { model: "google/antigravity-gemini-3-flash", variant: "minimal" },
  "ctf-solve": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-research": { model: "google/antigravity-gemini-3-flash", variant: "medium" },
  "ctf-hypothesis": { model: "google/antigravity-claude-opus-4-6-thinking", variant: "low" },
  "ctf-decoy-check": { model: "google/antigravity-gemini-3-flash", variant: "minimal" },
  "ctf-verify": { model: "openai/gpt-5.3-codex", variant: "medium" },
  "bounty-scope": { model: "openai/gpt-5.3-codex", variant: "medium" },
  "bounty-triage": { model: "openai/gpt-5.3-codex", variant: "high" },
  "bounty-research": { model: "google/antigravity-gemini-3-flash", variant: "medium" },
  "deep-plan": { model: "google/antigravity-claude-opus-4-6-thinking", variant: "low" },
  "md-scribe": { model: "google/antigravity-gemini-3-flash", variant: "medium" },
  "explore-fallback": { model: "google/antigravity-gemini-3-flash", variant: "medium" },
  "librarian-fallback": { model: "google/antigravity-gemini-3-pro", variant: "low" },
  "oracle-fallback": { model: "google/antigravity-gemini-3-pro", variant: "high" },
};
