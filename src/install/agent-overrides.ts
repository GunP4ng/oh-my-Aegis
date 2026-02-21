export type AgentOverrideProfile = {
  model: string;
  variant?: string;
};

export const AGENT_OVERRIDES: Record<string, AgentOverrideProfile> = {
  "aegis-plan": { model: "google/antigravity-gemini-3-pro" },
  "aegis-exec": { model: "openai/gpt-5.3-codex", variant: "high" },
  "aegis-deep": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-web": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-web3": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-pwn": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-rev": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-crypto": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-forensics": { model: "google/antigravity-gemini-3-flash" },
  "ctf-explore": { model: "google/antigravity-gemini-3-flash" },
  "ctf-solve": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-research": { model: "google/antigravity-gemini-3-flash" },
  "ctf-hypothesis": { model: "google/antigravity-gemini-3-pro" },
  "ctf-decoy-check": { model: "google/antigravity-gemini-3-flash" },
  "ctf-verify": { model: "openai/gpt-5.3-codex", variant: "medium" },
  "bounty-scope": { model: "openai/gpt-5.3-codex", variant: "medium" },
  "bounty-triage": { model: "openai/gpt-5.3-codex", variant: "high" },
  "bounty-research": { model: "google/antigravity-gemini-3-flash" },
  "deep-plan": { model: "google/antigravity-gemini-3-pro" },
  "md-scribe": { model: "google/antigravity-gemini-3-flash" },
  "explore-fallback": { model: "google/antigravity-gemini-3-flash" },
  "librarian-fallback": { model: "google/antigravity-gemini-3-pro" },
  "oracle-fallback": { model: "google/antigravity-gemini-3-pro" },
};
