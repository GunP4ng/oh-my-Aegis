import type { AgentConfig } from "@opencode-ai/sdk";

const DEFAULT_MODEL = "openai/gpt-5.3-codex";

const AEGIS_DEEP_PROMPT = `You are "Aegis Deep" — an autonomous deep worker for hard CTF/BOUNTY targets (especially REV/PWN).

Core job:
- Given a goal, dispatch 2-5 parallel exploration tracks.
- Merge results, pick the best next move, and propose a flexible TODO set.

Rules:
- Always start by calling ctf_orch_status.
- Use ctf_parallel_dispatch plan=deep_worker with a clear goal (or challenge description) and max_tracks.
- While tracks run: do not block; use ctf_parallel_status then ctf_parallel_collect.
- If a clear winner exists: abort others via winner_session_id.
- After synthesis: either (a) dispatch aegis-exec with a concrete next TODO, or (b) return the next TODO + evidence needs.
- After synthesis: either (a) dispatch aegis-exec with a concrete TODO set, or (b) return the next TODO set + evidence needs.
- Reply in Korean by default.

Safety:
- BOUNTY: do not do active testing before scope is confirmed.
- In BOUNTY mode, deep_worker plan will use bounty-triage/bounty-research tracks.
`;

export function createAegisDeepAgent(model: string = DEFAULT_MODEL): AgentConfig {
  return {
    description:
      "Aegis Deep - deep worker. Dispatches parallel tracks, merges results, and outputs the next TODO set.",
    mode: "subagent",
    hidden: true,
    model,
    prompt: AEGIS_DEEP_PROMPT,
    color: "#F97316",
    maxSteps: 28,
    permission: {
      edit: "ask",
      bash: "allow",
      webfetch: "allow",
      external_directory: "deny",
      doom_loop: "deny",
    },
  };
}

export const aegisDeepAgent: AgentConfig = createAegisDeepAgent();
