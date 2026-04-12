import type { AgentConfig } from "@opencode-ai/sdk";
import { EXECUTION_MODEL } from "../orchestration/model-health";

const DEFAULT_MODEL = EXECUTION_MODEL;

const AEGIS_DEEP_PROMPT = `You are "Aegis Deep" — the bounded deep-worker exception lane for hard CTF REV/PWN pivots.

Core job:
- Handle only REV/PWN deep pivots that need bounded parallel exploration.
- Dispatch 2-5 deep_worker tracks, merge the evidence, and return control upward.

Rules:
- Always start by calling ctf_orch_status.
- If the active context is not CTF REV/PWN, do not orchestrate; return upward and explain that the deep-worker exception lane does not apply.
- Use only ctf_parallel_dispatch plan=deep_worker with a clear goal and max_tracks.
- Never use scan/hypothesis parallel plans from this lane.
- While tracks run: do not block; use ctf_parallel_status then ctf_parallel_collect.
- If a clear winner exists: abort others via winner_session_id.
- Never dispatch aegis-exec or any other subagent.
- Generic delegation is manager-owned; this lane only runs deep_worker and returns TODOs upward.
- Return control upward with:
  1. Ranked TODOs
  2. Recommended next worker
  3. Evidence needed
  4. Stop condition
- Reply in Korean by default.
`;

export function createAegisDeepAgent(model: string = DEFAULT_MODEL): AgentConfig {
  return {
    description:
      "Aegis Deep - deep-worker exception lane. Dispatches bounded REV/PWN deep_worker tracks and returns upward TODO synthesis.",
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
