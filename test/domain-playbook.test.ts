import { describe, expect, it } from "bun:test";
import { OrchestratorConfigSchema, type OrchestratorConfig } from "../src/config/schema";
import { buildTaskPlaybook } from "../src/orchestration/playbook";
import { isStuck } from "../src/orchestration/router";
import { DEFAULT_STATE, type SessionState, type TargetType } from "../src/state/types";

function makeState(overrides: Partial<SessionState>): SessionState {
  return { ...DEFAULT_STATE, ...overrides, lastUpdatedAt: 0 };
}

function legacyBuildTaskPlaybook(state: SessionState, config: OrchestratorConfig): string {
  const CTF_TARGET_RULES: Record<TargetType, string[]> = {
    WEB_API: [
      "Use OWASP-style hypothesis and verify with reproducible request/response evidence.",
      "Treat UI-only changes as candidate until server-side state change is confirmed.",
    ],
    WEB3: [
      "Validate on-chain effects against transaction/event evidence before claiming success.",
      "Assume web3-specific edge cases (reentrancy/allowance/oracle assumptions) and disconfirm cheaply first.",
    ],
    PWN: [
      "Prioritize deterministic local exploit loop and prove shell/primitive with reproducible command output.",
      "Use built-in templates when helpful: ctf_orch_exploit_template_list / ctf_orch_exploit_template_get.",
    ],
    REV: [
      "Use REV strategy ladder in order: static reconstruction -> dynamic validation -> contradiction-triggered patch-and-dump extraction -> loader internals last.",
      "If static/dynamic contradict, stop trace-only loops and extract runtime out/expected values first (patch-and-dump) before deeper semantics.",
    ],
    CRYPTO: [
      "Use smallest disconfirming test vectors first; do not proceed on intuition-only parameter choices.",
      "Use built-in templates when helpful: ctf_orch_exploit_template_list / ctf_orch_exploit_template_get.",
    ],
    FORENSICS: [
      "Confirm file/container types first and keep provenance for every extracted artifact.",
      "Treat OCR/strings-only findings as candidate until validated by structure or checker.",
    ],
    MISC: [
      "Use quick disconfirm tests and escalate only on new evidence.",
      "OSINT workflows are intentionally grouped under MISC and require source-citable evidence.",
    ],
    UNKNOWN: [
      "Start with broad scan, narrow to strongest hypothesis, then maintain a plan-backed TODO list.",
      "Do not claim solved status without verifier-aligned evidence.",
    ],
  };

  const BOUNTY_TARGET_RULES: Record<TargetType, string[]> = {
    WEB_API: [
      "Respect scope and use minimal-impact validation before any aggressive testing.",
      "Require reproducible request/response evidence and impact narrative.",
    ],
    WEB3: [
      "Confirm scope (contracts/chains) and use read-only/state-safe checks first.",
      "Prefer simulation or non-destructive validation before broadcasting impactful transactions.",
    ],
    PWN: [
      "Use controlled local reproduction and avoid destructive payloads.",
      "Demonstrate exploitability with least-impact proof aligned to program rules.",
    ],
    REV: [
      "Keep reverse-engineering artifacts reproducible and tie findings to real exploit surface.",
      "Avoid unverifiable theoretical claims without runtime evidence.",
    ],
    CRYPTO: [
      "Provide concrete break conditions and measurable security impact.",
      "Use conservative assumptions until validated by reproducible tests.",
    ],
    FORENSICS: [
      "Maintain chain-of-custody style artifact notes and avoid modifying originals.",
      "Report only verified timeline/fact claims with source references.",
    ],
    MISC: [
      "Stay scope-safe and impact-minimal; gather evidence before escalation.",
      "OSINT workflows are intentionally grouped under MISC and require source-citable evidence.",
    ],
    UNKNOWN: [
      "Use triage-first mode and do not run high-risk actions before scope confidence.",
      "Escalate to research when two low-impact checks are inconclusive.",
    ],
  };

  const header = "[oh-my-Aegis domain-playbook]";
  const rules = state.mode === "CTF" ? CTF_TARGET_RULES[state.targetType] : BOUNTY_TARGET_RULES[state.targetType];
  const lines = [header, `mode=${state.mode}`, `target=${state.targetType}`, "rules:", `- ${rules[0]}`, `- ${rules[1]}`];

  if (state.targetType === "FORENSICS") {
    lines.push("- If you encounter images/PDFs, analyze with look_at before deeper binary parsing.");
    lines.push("- Hash every artifact (sha256) before and after manipulation for chain-of-custody.");
    lines.push("- Try multiple extraction tools (binwalk, foremost, photorec) — they detect different patterns.");
  }

  if (state.targetType === "PWN" || state.targetType === "REV") {
    const interactiveEnabled = config.interactive.enabled || config.interactive.enabled_in_ctf;
    if (interactiveEnabled) {
      lines.push("- Use ctf_orch_pty_* tools for interactive workflows (gdb/nc) instead of blocking non-interactive bash.");
    }
    lines.push("- Container fidelity guard: when challenge requires docker/runtime parity, treat host-only experiments as reference and do not use them as final decision evidence.");
  }

  if (state.targetType === "WEB_API") {
    lines.push("- For SQLi: prefer time-based/boolean-based blind extraction over error-based guessing.");
    lines.push("- For SSTI: test {{7*7}} first to identify template engine before crafting exploit.");
    lines.push("- For SSRF: map internal network before attempting flag exfiltration.");
    const interactiveEnabled = config.interactive.enabled || config.interactive.enabled_in_ctf;
    if (interactiveEnabled) {
      lines.push("- For Docker-based web challenges: use ctf_orch_pty_* for interactive debugging sessions.");
    }
  }

  if (state.targetType === "WEB3") {
    lines.push("- Always verify exploit via local simulation (forge test) before claiming success.");
    lines.push("- Check for reentrancy on ALL external calls, not just Ether transfers.");
    lines.push("- For proxy patterns: map storage layout before attempting storage slot manipulation.");
  }

  if (state.targetType === "CRYPTO") {
    lines.push("- For RSA: check factordb.com FIRST before attempting expensive factorization.");
    lines.push("- Verify decryption with at least 2 independent test vectors before claiming success.");
    lines.push("- For custom ciphers: identify mathematical structure before brute-forcing.");
  }

  if (state.targetType === "MISC" || state.targetType === "UNKNOWN") {
    lines.push("- Try multiple decoding layers: base64 → hex → rot13 → custom alphabets.");
    lines.push("- For images: try zsteg, steghide, stegsolve, exiftool before custom analysis.");
    lines.push("- Do not spend more than 2 iterations on a single hypothesis without new evidence.");
  }

  if (state.decoySuspect) {
    const decoyStrats: Record<string, string> = {
      WEB_API: "DECOY active: try alternative vulnerability class (if SQLi failed, try SSTI/SSRF/deserialization).",
      WEB3: "DECOY active: check for proxy contracts, hidden state variables, or alternative entry points.",
      PWN: "DECOY active: extract runtime buffers via gdb/ptrace instead of static analysis.",
      REV: "DECOY active: use patch-and-dump to extract runtime out/expected values.",
      CRYPTO: "DECOY active: the obvious mathematical weakness may be a decoy. Try implementation flaws or side-channels.",
      FORENSICS: "DECOY active: obvious embedded data may be planted. Try deeper layers, alternate tools, or timeline analysis.",
      MISC: "DECOY active: the surface-level answer is wrong. Try alternative interpretations or encoding layers.",
      UNKNOWN: "DECOY active: re-evaluate the approach from scratch with fresh hypothesis.",
    };
    lines.push(`- ${decoyStrats[state.targetType] || decoyStrats.UNKNOWN}`);
  }

  if (state.staleToolPatternLoops >= 3 && state.noNewEvidenceLoops > 0) {
    const stuckStrats: Record<string, string> = {
      WEB_API: "Stale hypothesis kill-switch: try a completely different attack vector (SSTI→SQLi→SSRF→deserialization→path-traversal).",
      WEB3: "Stale hypothesis kill-switch: switch between static analysis (slither) and dynamic testing (foundry fork).",
      PWN: "Stale hypothesis kill-switch: try different exploit primitives (ret2libc→ROP→format-string→heap).",
      REV: "Stale hypothesis kill-switch: cancel static-only approach and switch to dynamic extraction.",
      CRYPTO: "Stale hypothesis kill-switch: reconsider the cryptosystem identification. Check for custom/non-standard implementations.",
      FORENSICS: "Stale hypothesis kill-switch: try different file carving tools or analysis layers (metadata→binary→steganography).",
      MISC: "Stale hypothesis kill-switch: try different interpretation frameworks (encoding→crypto→steganography→OSINT).",
      UNKNOWN: "Stale hypothesis kill-switch: cancel repeated tool pattern and generate a new extraction/transform hypothesis.",
    };
    lines.push(`- ${stuckStrats[state.targetType] || stuckStrats.UNKNOWN}`);
  }

  if (!state.contradictionPatchDumpDone && state.contradictionPivotDebt > 0) {
    lines.push(`- Contradiction pivot active: run ONE extraction-first pivot within ${state.contradictionPivotDebt} dispatch loops and record artifact paths.`);
  }

  if (config.sequential_thinking.enabled) {
    const targetOk = config.sequential_thinking.activate_targets.includes(state.targetType);
    const phaseOk = config.sequential_thinking.activate_phases.includes(state.phase);
    const stuckOk = config.sequential_thinking.activate_on_stuck && isStuck(state, config);
    const thinkingOk = !config.sequential_thinking.disable_with_thinking_model || state.thinkMode === "none";
    if (thinkingOk && ((targetOk && phaseOk) || stuckOk)) {
      lines.push(`- Use ${config.sequential_thinking.tool_name} to log sequential reasoning (branches/revisions) when planning or pivoting.`);
    }
  }

  lines.push("- Execute from your TODO list with one in_progress item and attach verifier-aligned evidence.");
  return lines.join("\n");
}

describe("domain-playbook parity", () => {
  it("renders deterministically for same state/config", () => {
    const config = OrchestratorConfigSchema.parse({});
    const state = makeState({
      mode: "CTF",
      targetType: "REV",
      phase: "PLAN",
      contradictionPivotDebt: 2,
      contradictionPatchDumpDone: false,
      staleToolPatternLoops: 3,
      noNewEvidenceLoops: 1,
      decoySuspect: true,
    });
    const first = buildTaskPlaybook(state, config);
    const second = buildTaskPlaybook(state, config);
    expect(first).toBe(second);
  });

  it("matches legacy TS behavior snapshot matrix", () => {
    const baseConfig = OrchestratorConfigSchema.parse({});
    const interactiveConfig = OrchestratorConfigSchema.parse({
      interactive: {
        ...baseConfig.interactive,
        enabled: true,
      },
    });

    const cases: Array<{ name: string; state: SessionState; config: OrchestratorConfig }> = [
      {
        name: "ctf-web-api-baseline",
        state: makeState({ mode: "CTF", targetType: "WEB_API" }),
        config: baseConfig,
      },
      {
        name: "ctf-web-api-interactive",
        state: makeState({ mode: "CTF", targetType: "WEB_API" }),
        config: interactiveConfig,
      },
      {
        name: "ctf-forensics",
        state: makeState({ mode: "CTF", targetType: "FORENSICS" }),
        config: baseConfig,
      },
      {
        name: "ctf-misc-decoy-stale",
        state: makeState({ mode: "CTF", targetType: "MISC", decoySuspect: true, staleToolPatternLoops: 3, noNewEvidenceLoops: 1 }),
        config: baseConfig,
      },
      {
        name: "ctf-rev-full",
        state: makeState({
          mode: "CTF",
          targetType: "REV",
          phase: "PLAN",
          decoySuspect: true,
          staleToolPatternLoops: 3,
          noNewEvidenceLoops: 1,
          contradictionPivotDebt: 2,
          contradictionPatchDumpDone: false,
          thinkMode: "none",
        }),
        config: interactiveConfig,
      },
      {
        name: "bounty-unknown",
        state: makeState({ mode: "BOUNTY", targetType: "UNKNOWN" }),
        config: baseConfig,
      },
      {
        name: "bounty-web3",
        state: makeState({ mode: "BOUNTY", targetType: "WEB3" }),
        config: baseConfig,
      },
    ];

    for (const testCase of cases) {
      const rendered = buildTaskPlaybook(testCase.state, testCase.config);
      const legacy = legacyBuildTaskPlaybook(testCase.state, testCase.config);
      expect(rendered, testCase.name).toBe(legacy);
    }
  });
});
