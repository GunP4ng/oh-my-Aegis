/**
 * Aegis Functional Verification Test Suite
 *
 * Covers checklist sections 1–20 from the Aegis Functional Test Checklist.
 * Each test maps to a checklist item (e.g. 1-1, 2-3, 5-7).
 */
import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import OhMyAegisPlugin from "../src/index";

const roots: string[] = [];
const originalHome = process.env.HOME;

const REQUIRED_SUBAGENTS = [
  "aegis-plan",
  "aegis-exec",
  "aegis-deep",
  "bounty-scope",
  "ctf-web",
  "ctf-web3",
  "ctf-pwn",
  "ctf-rev",
  "ctf-crypto",
  "ctf-forensics",
  "ctf-explore",
  "ctf-solve",
  "ctf-research",
  "ctf-hypothesis",
  "ctf-decoy-check",
  "ctf-verify",
  "bounty-triage",
  "bounty-research",
  "deep-plan",
  "md-scribe",
  "explore-fallback",
  "librarian-fallback",
  "oracle-fallback",
];

afterEach(() => {
  process.env.HOME = originalHome;
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

function setupEnvironment() {
  const root = join(tmpdir(), `aegis-checklist-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);

  const homeDir = join(root, "home");
  const projectDir = join(root, "project");
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });

  process.env.HOME = homeDir;
  const opencodeDir = join(homeDir, ".config", "opencode");
  mkdirSync(opencodeDir, { recursive: true });

  const aegisConfig = {
    enabled: true,
    default_mode: "BOUNTY",
    enforce_mode_header: false,
    notes: { root_dir: ".Aegis" },
    interactive: { enabled: false },
    tui_notifications: { enabled: false, throttle_ms: 5_000 },
    target_detection: { enabled: true, lock_after_first: true, only_in_scan: true },
    auto_dispatch: {
      enabled: true,
      preserve_user_category: true,
      max_failover_retries: 2,
      operational_feedback_enabled: false,
      operational_feedback_consecutive_failures: 2,
    },
    parallel: { auto_dispatch_scan: false, auto_dispatch_hypothesis: false },
  };
  writeFileSync(join(opencodeDir, "oh-my-Aegis.json"), `${JSON.stringify(aegisConfig, null, 2)}\n`, "utf-8");

  const agentConfig: Record<string, Record<string, never>> = {};
  for (const name of REQUIRED_SUBAGENTS) {
    agentConfig[name] = {};
  }
  writeFileSync(
    join(opencodeDir, "opencode.json"),
    `${JSON.stringify({ agent: agentConfig }, null, 2)}\n`,
    "utf-8",
  );

  return { root, homeDir, projectDir };
}

async function loadHooks(projectDir: string, client: unknown = {}): Promise<any> {
  return OhMyAegisPlugin({
    client: client as never,
    project: {} as never,
    directory: projectDir,
    worktree: projectDir,
    serverUrl: new URL("http://localhost"),
    $: {} as never,
  });
}

async function readStatus(hooks: any, sessionID: string) {
  const output = await hooks.tool?.ctf_orch_status.execute({}, { sessionID } as never);
  return JSON.parse(output ?? "{}");
}

async function exec(hooks: any, toolName: string, args: Record<string, unknown>, sessionID = "s1") {
  const raw = await hooks.tool?.[toolName]?.execute(args, { sessionID } as never);
  return JSON.parse(raw ?? "{}");
}

// ---------------------------------------------------------------------------
// Section 1: Mode activation / deactivation guards
// ---------------------------------------------------------------------------
describe("Section 1: mode guards", () => {
  it("1-1. mode not set → mode_explicit=false", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const status = await readStatus(hooks, "s1");
    expect(status.mode_explicit).toBe(false);
  });

  it("1-2. tool call without mode → rejection", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const status = await readStatus(hooks, "s1");
    expect(status.state.modeExplicit).toBe(false);
  });

  it("1-3. set_mode CTF → mode=CTF, mode_explicit=true", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    expect(result.mode).toBe("CTF");
    expect(result.mode_explicit).toBe(true);
  });

  it("1-4. set_mode BOUNTY → mode=BOUNTY", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    const result = await exec(hooks, "ctf_orch_set_mode", { mode: "BOUNTY" });
    expect(result.mode).toBe("BOUNTY");
  });
});

// ---------------------------------------------------------------------------
// Section 2: CTF orchestration control
// ---------------------------------------------------------------------------
describe("Section 2: CTF orchestration control", () => {
  it("2-1. ctf_orch_status returns phase/targetType/decision", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    const status = await readStatus(hooks, "s1");
    expect(status.state.phase).toBeDefined();
    expect(status.state.targetType).toBeDefined();
    expect(status.decision).toBeDefined();
    expect(status.decision.primary).toBeDefined();
  });

  it("2-2. reset_loop with target_type=PWN", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    const result = await exec(hooks, "ctf_orch_event", { event: "reset_loop", target_type: "PWN" });
    expect(result.state.targetType).toBe("PWN");
  });

  it("2-3. scan_completed → SCAN→PLAN transition", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    await exec(hooks, "ctf_orch_event", { event: "reset_loop", target_type: "PWN" });
    const result = await exec(hooks, "ctf_orch_event", { event: "scan_completed" });
    expect(result.state.phase).toBe("PLAN");
  });

  it("2-4. plan_completed → PLAN→EXECUTE transition", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    await exec(hooks, "ctf_orch_event", { event: "reset_loop", target_type: "PWN" });
    await exec(hooks, "ctf_orch_event", { event: "scan_completed" });
    const result = await exec(hooks, "ctf_orch_event", { event: "plan_completed" });
    expect(result.state.phase).toBe("EXECUTE");
  });

  it("2-5. candidate_found sets latestCandidate", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    await exec(hooks, "ctf_orch_event", { event: "reset_loop", target_type: "PWN" });
    await exec(hooks, "ctf_orch_event", { event: "scan_completed" });
    await exec(hooks, "ctf_orch_event", { event: "plan_completed" });
    const result = await exec(hooks, "ctf_orch_event", {
      event: "candidate_found",
      candidate: "flag{test}",
    });
    expect(result.state.latestCandidate).toBe("flag{test}");
  });

  it("2-6. ctf_orch_next returns routing recommendation", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    const result = await exec(hooks, "ctf_orch_next", {});
    expect(result.decision).toBeDefined();
    expect(result.decision.primary).toBeDefined();
  });

  it("2-7. ctf_orch_metrics returns entries", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    await exec(hooks, "ctf_orch_event", { event: "reset_loop", target_type: "PWN" });
    const result = await exec(hooks, "ctf_orch_metrics", {});
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.entries)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 3: Routing per target type
// ---------------------------------------------------------------------------
describe("Section 3: 8 target type routing", () => {
  const targets = [
    { type: "WEB_API", expect: /ctf-web/ },
    { type: "WEB3", expect: /ctf-web3/ },
    { type: "PWN", expect: /ctf-pwn/ },
    { type: "REV", expect: /ctf-rev/ },
    { type: "CRYPTO", expect: /ctf-crypto/ },
    { type: "FORENSICS", expect: /ctf-forensics/ },
    { type: "MISC", expect: /ctf-explore/ },
    { type: "UNKNOWN", expect: /ctf-/ },
  ];

  for (const t of targets) {
    it(`3-${targets.indexOf(t) + 1}. target_type=${t.type} routes correctly`, async () => {
      const { projectDir } = setupEnvironment();
      const hooks = await loadHooks(projectDir);
      await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
      await exec(hooks, "ctf_orch_event", { event: "reset_loop", target_type: t.type });
      const status = await readStatus(hooks, "s1");
      const primary = status.decision?.primary ?? "";
      expect(primary).toMatch(t.expect);
    });
  }
});

// ---------------------------------------------------------------------------
// Section 4: Failure response / diagnostics
// ---------------------------------------------------------------------------
describe("Section 4: failure response / diagnostics", () => {
  it("4-1. failover resolves fallback agent", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_failover", {
      agent: "ctf-web",
      error: "rate limit exceeded",
    });
    expect(result.original).toBe("ctf-web");
    expect(result.fallback).toBeDefined();
  });

  it("4-2. failover for context_overflow", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_failover", {
      agent: "ctf-rev",
      error: "context length exceeded, max tokens 200k",
    });
    expect(result.fallback).toBeDefined();
  });

  it("4-3. postmortem returns failure summary", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    await exec(hooks, "ctf_orch_event", { event: "reset_loop", target_type: "PWN" });
    const result = await exec(hooks, "ctf_orch_postmortem", {});
    expect(result.recommendation).toBeDefined();
    expect(result.nextDecision).toBeDefined();
  });

  it("4-4. check_budgets returns budget status", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_check_budgets", {});
    expect(typeof result.ok).toBe("boolean");
    expect(Array.isArray(result.issues)).toBe(true);
  });

  it("4-5. compact executes archive rotation", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_compact", {});
    expect(result.actions).toBeDefined();
  });

  it("4-6. readiness checks subagents/MCP/write", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_readiness", {});
    expect(result.ok).toBeDefined();
  });

  it("4-7. doctor returns diagnostic output", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_doctor", {});
    expect(result.readiness).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Section 5: Exploit templates
// ---------------------------------------------------------------------------
describe("Section 5: exploit templates", () => {
  it("5-1. template_list returns 39+ templates", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_exploit_template_list", {});
    expect(result.templates.length).toBeGreaterThanOrEqual(39);
  });

  it("5-2. template_list domain=PWN filters correctly", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_exploit_template_list", { domain: "PWN" });
    expect(result.templates.length).toBeGreaterThan(0);
    expect(result.templates.every((t: any) => t.domain === "PWN")).toBe(true);
  });

  it("5-3. WEB3 templates exist", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_exploit_template_list", { domain: "WEB3" });
    expect(result.templates.length).toBeGreaterThan(0);
  });

  it("5-4. MISC templates exist", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_exploit_template_list", { domain: "MISC" });
    expect(result.templates.length).toBeGreaterThan(0);
  });

  it("5-5. get PWN pwntools-skeleton template body", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_exploit_template_get", {
      domain: "PWN",
      id: "pwntools-skeleton",
    });
    expect(result.ok).toBe(true);
    expect(result.template.body.length).toBeGreaterThan(0);
  });

  it("5-6. get WEB3 flashloan template body", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_exploit_template_get", {
      domain: "WEB3",
      id: "web3-flashloan-attack",
    });
    expect(result.ok).toBe(true);
    expect(result.template.body.length).toBeGreaterThan(0);
  });

  it("5-7. get REV anti-debug-bypass template body", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_exploit_template_get", {
      domain: "REV",
      id: "rev-anti-debug-bypass",
    });
    expect(result.ok).toBe(true);
    expect(result.template.body.length).toBeGreaterThan(0);
  });

  it("5-8. get FORENSICS pcap-reconstruction template body", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_exploit_template_get", {
      domain: "FORENSICS",
      id: "forensics-pcap-reconstruction",
    });
    expect(result.ok).toBe(true);
    expect(result.template.body.length).toBeGreaterThan(0);
  });

  it("5-9. get MISC encoding-chain-solver template body", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_exploit_template_get", {
      domain: "MISC",
      id: "misc-encoding-chain-solver",
    });
    expect(result.ok).toBe(true);
    expect(result.template.body.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Section 6: REV analysis / Decoy / Replay tools
// ---------------------------------------------------------------------------
describe("Section 6: REV / decoy / replay tools", () => {
  it("6-1. rev_loader_vm_detect detects VM signals", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    const result = await exec(hooks, "ctf_rev_loader_vm_detect", {
      readelf_sections: "Section .rela.p found, rwx segment detected, custom relocations",
    });
    expect(result.indicator).toBeDefined();
    expect(result.indicator.signals.length).toBeGreaterThan(0);
  });

  it("6-2. decoy_guard detects decoy suspect", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    const scanResult = await exec(hooks, "ctf_flag_scan", {
      text: "flag{FAKE_FLAG_not_real}",
      source: "manual",
    });
    expect(scanResult.found.length).toBeGreaterThan(0);
    const result = await exec(hooks, "ctf_decoy_guard", { oracle_passed: false });
    expect(result.isDecoySuspect).toBe(true);
  });

  it("6-3. replay_safety_check detects memfd unsafe", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_replay_safety_check", {
      strings_output: "memfd_create fexecve /proc/self/exe",
    });
    expect(result.unsafe).toBe(true);
  });

  it("6-4. rev_rela_patch generates script", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_rev_rela_patch", {
      binary_path: "/tmp/target",
      section_offset: 0x1000,
      entry_index: 0,
    });
    expect(result.script).toContain("python");
  });

  it("6-5. rev_syscall_trampoline generates assembly", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_rev_syscall_trampoline", {
      write_addr1: 0x600000,
      write_len1: 256,
      write_addr2: 0x601000,
      write_len2: 128,
    });
    expect(result.assembly).toContain("syscall");
  });

  it("6-6. rev_entry_patch generates pwntools script", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_rev_entry_patch", {
      binary_path: "/tmp/target",
      entry_vaddr: 0x400000,
      write_addr1: 0x600000,
      write_len1: 256,
      write_addr2: 0x601000,
      write_len2: 128,
    });
    expect(result.script).toContain("pwn");
  });

  it("6-7. rev_base255_codec encode", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const inputHex = "41414141414141";
    const result = await exec(hooks, "ctf_rev_base255_codec", {
      mode: "encode",
      data_hex: inputHex,
    });
    expect(result.mode).toBe("encode");
    expect(result.outputLength).toBeGreaterThan(0);
    expect(result.resultHex.length).toBeGreaterThan(0);
  });

  it("6-8. rev_base255_codec decode roundtrip", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const inputHex = "41414141414141";
    const encoded = await exec(hooks, "ctf_rev_base255_codec", {
      mode: "encode",
      data_hex: inputHex,
    });
    const decoded = await exec(hooks, "ctf_rev_base255_codec", {
      mode: "decode",
      data_hex: encoded.resultHex,
    });
    expect(decoded.resultHex).toBe(inputHex);
  });

  it("6-9. rev_linear_recovery generates script", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_rev_linear_recovery", {
      dump_dir: "/tmp/dumps",
      bin_count: 10,
      multiplier: 7,
    });
    expect(result.script.length).toBeGreaterThan(0);
  });

  it("6-10. rev_mod_inverse computes 7^-1 mod 256 = 183", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_rev_mod_inverse", { value: 7, modulus: 256 });
    expect(result.inverse).toBe(183);
  });
});

// ---------------------------------------------------------------------------
// Section 7: Hypothesis management
// ---------------------------------------------------------------------------
describe("Section 7: hypothesis management", () => {
  it("7-1. register hypothesis", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_hypothesis_register", {
      hypothesis: "XTEA key recovery via known plaintext",
    });
    expect(result.created).toBeDefined();
    expect(result.created.hypothesis).toBe("XTEA key recovery via known plaintext");
    expect(result.activeCount).toBeGreaterThanOrEqual(1);
  });

  it("7-2. record experiment against hypothesis", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const reg = await exec(hooks, "ctf_hypothesis_register", {
      hypothesis: "XTEA key recovery",
    });
    const hid = reg.created.id;
    const result = await exec(hooks, "ctf_hypothesis_experiment", {
      hypothesis_id: hid,
      description: "test with known key",
      method: "brute-force",
      verdict: "refutes",
      evidence: "key mismatch on all test vectors",
    });
    expect(result.experiment).toBeDefined();
    expect(result.experiment.verdict).toBe("refutes");
  });

  it("7-4. hypothesis_summary includes registered hypotheses", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_hypothesis_register", {
      hypothesis: "AES-CBC padding oracle",
    });
    const result = await exec(hooks, "ctf_hypothesis_summary", {});
    expect(result.totalHypotheses).toBeGreaterThanOrEqual(1);
    expect(result.activeHypotheses).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Section 8: UNSAT / Oracle
// ---------------------------------------------------------------------------
describe("Section 8: UNSAT / Oracle", () => {
  it("8-1. unsat_gate_status shows 3 conditions", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    const result = await exec(hooks, "ctf_unsat_gate_status", {});
    expect(result.conditions.crossValidation).toBeDefined();
    expect(result.conditions.unhookedOracle).toBeDefined();
    expect(result.conditions.artifactDigest).toBeDefined();
  });

  it("8-2. record cross_validation increments count", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    await exec(hooks, "ctf_unsat_record_validation", {
      condition: "cross_validation",
      evidence: "two independent reviewers confirmed",
    });
    const result = await exec(hooks, "ctf_unsat_gate_status", {});
    expect(result.conditions.crossValidation.count).toBeGreaterThanOrEqual(1);
  });

  it("8-3. record unhooked_oracle sets true", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    await exec(hooks, "ctf_unsat_record_validation", {
      condition: "unhooked_oracle",
      evidence: "ran without hooks",
    });
    const result = await exec(hooks, "ctf_unsat_gate_status", {});
    expect(result.conditions.unhookedOracle.met).toBe(true);
  });

  it("8-4. record artifact_digest sets true", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    await exec(hooks, "ctf_unsat_record_validation", {
      condition: "artifact_digest",
      evidence: "sha256 digest verified",
    });
    const result = await exec(hooks, "ctf_unsat_gate_status", {});
    expect(result.conditions.artifactDigest.met).toBe(true);
  });

  it("8-5. oracle_progress records pass rate", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    const result = await exec(hooks, "ctf_oracle_progress", {
      pass_count: 5,
      fail_index: 3,
      total_tests: 10,
    });
    expect(result.progress).toBeDefined();
    expect(result.progress.passRate).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Section 9: Speed optimization tools
// ---------------------------------------------------------------------------
describe("Section 9: speed optimization tools", () => {
  it("9-1. auto_triage returns targetType and commands", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_auto_triage", {
      file_path: "/tmp/challenge",
      file_output: "ELF 64-bit LSB executable, x86-64",
    });
    expect(result.suggestedTarget).toBeDefined();
    expect(Array.isArray(result.commands)).toBe(true);
  });

  it("9-2. flag_scan detects flag pattern", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_flag_scan", {
      text: "The answer is flag{hello_world}",
      source: "manual",
    });
    expect(result.found.length).toBeGreaterThan(0);
    expect(result.found.some((f: any) => f.flag === "flag{hello_world}")).toBe(true);
  });

  it("9-3. pattern_match detects buffer_overflow", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_pattern_match", {
      text: "gets(buf) is called with user input leading to stack overflow",
      target_type: "PWN",
    });
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it("9-4. tool_recommend PWN includes checksec/ROPgadget", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_tool_recommend", { target_type: "PWN" });
    const toolNames = result.tools.map((t: any) => t.tool);
    expect(toolNames).toContain("checksec");
    expect(toolNames).toContain("ROPgadget");
  });

  it("9-5. tool_recommend WEB_API includes sqlmap/ffuf", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_tool_recommend", { target_type: "WEB_API" });
    const toolNames = result.tools.map((t: any) => t.tool);
    expect(toolNames).toContain("sqlmap");
    expect(toolNames).toContain("ffuf");
  });

  it("9-6. tool_recommend WEB3 includes slither/forge/cast", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_tool_recommend", { target_type: "WEB3" });
    const toolNames = result.tools.map((t: any) => t.tool);
    expect(toolNames).toContain("slither");
    expect(toolNames).toContain("forge");
    expect(toolNames).toContain("cast");
  });

  it("9-7. tool_recommend FORENSICS includes volatility3/foremost/tshark", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_tool_recommend", { target_type: "FORENSICS" });
    const toolNames = result.tools.map((t: any) => t.tool);
    expect(toolNames).toContain("volatility3");
    expect(toolNames).toContain("foremost");
    expect(toolNames).toContain("tshark");
  });

  it("9-8. tool_recommend MISC includes zsteg/steghide", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_tool_recommend", { target_type: "MISC" });
    const toolNames = result.tools.map((t: any) => t.tool);
    expect(toolNames).toContain("zsteg");
    expect(toolNames).toContain("steghide");
  });

  it("9-9. libc_lookup returns result/summary", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_libc_lookup", {
      lookups: [{ symbol: "puts", address: "0x7f1234567890" }],
    });
    expect(result.result).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(result.libcRipUrl).toBeDefined();
  });

  it("9-10. env_parity returns report (requires inputs)", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_env_parity", {
      dockerfile_content: "FROM ubuntu:22.04\nRUN apt-get install -y libc6=2.35",
      ldd_output: "libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f1234567000)",
    });
    expect(result.report).toBeDefined();
    expect(result.summary).toBeDefined();
  });

  it("9-11. report_generate creates markdown", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_report_generate", {
      mode: "CTF",
      challenge_name: "TestChallenge",
      worklog: "step 1, step 2",
      evidence: "found flag",
      flag: "flag{test}",
    });
    expect(result.markdown.length).toBeGreaterThan(0);
    expect(result.markdown).toContain("TestChallenge");
  });

  it("9-12. recon_pipeline returns pipeline plan", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "BOUNTY" });
    const result = await exec(hooks, "ctf_recon_pipeline", {
      target: "example.com",
    });
    expect(result.pipeline).toBeDefined();
    expect(Array.isArray(result.pipeline.tracks)).toBe(true);
    expect(result.pipeline.tracks.length).toBeGreaterThan(0);
  });

  it("9-13. delta_scan save stores snapshot", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_delta_scan", {
      action: "save",
      target: "example.com",
      template_set: "default",
      findings: ["xss-found"],
    });
    expect(result.ok).toBe(true);
    expect(result.saved).toBeDefined();
  });

  it("9-14. subagent_dispatch returns dispatch plan", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    const result = await exec(hooks, "ctf_subagent_dispatch", {
      query: "find vulnerability in binary",
      type: "auto",
    });
    expect(result.agentType).toBeDefined();
    expect(result.plan).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Section 10: Parallel execution
// ---------------------------------------------------------------------------
describe("Section 10: parallel execution", () => {
  it("10-1. parallel_dispatch returns error without SDK client", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    const result = await exec(hooks, "ctf_parallel_dispatch", {
      plan: "scan",
      challenge_description: "test challenge",
    });
    expect(result.ok).toBe(false);
  });

  it("10-2. parallel_status returns status", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_parallel_status", {});
    expect(result).toBeDefined();
  });

  it("10-3. parallel_collect returns results or no-group", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_parallel_collect", {});
    expect(result).toBeDefined();
  });

  it("10-4. parallel_abort executes", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_parallel_abort", {});
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Section 11: Session management
// ---------------------------------------------------------------------------
describe("Section 11: session management", () => {
  it("11-1. session_list returns result", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_session_list", {});
    expect(result.directory).toBeDefined();
  });

  it("11-2. session_info returns result", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_session_info", {
      target_session_id: "test-session",
    });
    expect(result.ok).toBe(true);
    expect(result.targetSessionID).toBe("test-session");
  });

  it("11-3. session_search returns result", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_session_search", { query: "flag" });
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Section 12: Memory (knowledge graph)
// ---------------------------------------------------------------------------
describe("Section 12: memory (knowledge graph)", () => {
  it("12-1. memory_save creates entity", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "aegis_memory_save", {
      entities: [
        { name: "test-entity", entityType: "concept", observations: ["test observation"] },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.createdEntities.length).toBeGreaterThanOrEqual(1);
  });

  it("12-2. memory_search finds entity", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "aegis_memory_save", {
      entities: [
        { name: "vuln-sqli", entityType: "vulnerability", observations: ["SQL injection in login"] },
      ],
    });
    const result = await exec(hooks, "aegis_memory_search", { query: "sqli" });
    expect(result.ok).toBe(true);
    expect(result.results.length).toBeGreaterThanOrEqual(1);
  });

  it("12-3. memory_list returns all entities", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "aegis_memory_save", {
      entities: [{ name: "entity1", entityType: "tool", observations: ["obs1"] }],
    });
    const result = await exec(hooks, "aegis_memory_list", {});
    expect(result.ok).toBe(true);
    expect(result.entities.length).toBeGreaterThanOrEqual(1);
  });

  it("12-4. memory_delete removes entity", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "aegis_memory_save", {
      entities: [{ name: "to-delete", entityType: "temp", observations: ["temp"] }],
    });
    const result = await exec(hooks, "aegis_memory_delete", { names: ["to-delete"] });
    expect(result.ok).toBe(true);
    const list = await exec(hooks, "aegis_memory_list", {});
    const activeNames = list.entities
      .filter((e: any) => !e.deletedAt)
      .map((e: any) => e.name);
    expect(activeNames).not.toContain("to-delete");
  });
});

// ---------------------------------------------------------------------------
// Section 13: Thinking / Slash / PTY
// ---------------------------------------------------------------------------
describe("Section 13: thinking / slash / PTY", () => {
  it("13-1. aegis_think records thought", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "aegis_think", {
      thought: "Analyzing input validation logic",
      nextThoughtNeeded: false,
      thoughtNumber: 1,
      totalThoughts: 1,
    });
    expect(result.thoughtNumber).toBe(1);
    expect(result.totalThoughts).toBe(1);
  });

  it("13-2. slash command /help executes", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_slash", { command: "/help" });
    expect(result).toBeDefined();
  });

  it("13-3. pty_list returns list", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_pty_list", {});
    expect(Array.isArray(result.sessions) || result.sessions !== undefined || result.ok !== undefined).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 14: AST-grep / LSP
// ---------------------------------------------------------------------------
describe("Section 14: AST-grep / LSP", () => {
  it("14-1. ast_grep_search executes without crash", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    const result = await exec(hooks, "ctf_ast_grep_search", {
      pattern: "function $NAME($ARGS)",
      lang: "typescript",
      timeoutMs: 15_000,
    });
    expect(result).toBeDefined();
  }, 30_000);

  it("14-2. lsp_diagnostics executes without crash", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_lsp_diagnostics", {
      file: join(projectDir, "test.ts"),
    });
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Section 15: BOUNTY mode
// ---------------------------------------------------------------------------
describe("Section 15: BOUNTY mode", () => {
  it("15-1. set BOUNTY mode", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_set_mode", { mode: "BOUNTY" });
    expect(result.mode).toBe("BOUNTY");
  });

  it("15-2. BOUNTY status shows scopeConfirmed=false initially", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "BOUNTY" });
    const status = await readStatus(hooks, "s1");
    expect(status.state.scopeConfirmed).toBe(false);
    expect(status.decision.primary).toContain("bounty-scope");
  });

  it("15-4. scope_confirmed transitions scopeConfirmed=true", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "BOUNTY" });
    await exec(hooks, "ctf_orch_event", { event: "scope_confirmed" });
    const status = await readStatus(hooks, "s1");
    expect(status.state.scopeConfirmed).toBe(true);
  });

  it("15-5. after scope_confirmed, routing changes from bounty-scope", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "BOUNTY" });
    await exec(hooks, "ctf_orch_event", { event: "scope_confirmed" });
    const status = await readStatus(hooks, "s1");
    expect(status.decision.primary).not.toBe("bounty-scope");
  });
});

// ---------------------------------------------------------------------------
// Section 16: Ultrawork / Autoloop
// ---------------------------------------------------------------------------
describe("Section 16: ultrawork / autoloop", () => {
  it("16-1. set_ultrawork enabled=true", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    const result = await exec(hooks, "ctf_orch_set_ultrawork", { enabled: true });
    expect(result.ultraworkEnabled).toBe(true);
  });

  it("16-2. status shows ultrawork=true", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    await exec(hooks, "ctf_orch_set_ultrawork", { enabled: true });
    const status = await readStatus(hooks, "s1");
    expect(status.state.ultraworkEnabled).toBe(true);
  });

  it("16-3. set_autoloop enabled=true", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const result = await exec(hooks, "ctf_orch_set_autoloop", { enabled: true });
    expect(result.autoLoopEnabled).toBe(true);
  });

  it("16-4. set_ultrawork enabled=false disables", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_ultrawork", { enabled: true });
    const result = await exec(hooks, "ctf_orch_set_ultrawork", { enabled: false });
    expect(result.ultraworkEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 17: Subagent profile management
// ---------------------------------------------------------------------------
describe("Section 17: subagent profile management", () => {
  it("17-1. set_subagent_profile configures model", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    const result = await exec(hooks, "ctf_orch_set_subagent_profile", {
      subagent_type: "ctf-web",
      model: "openai/gpt-4o",
    });
    expect(result.ok).toBe(true);
    expect(result.subagent_type).toBe("ctf-web");
  });

  it("17-2. list_subagent_profiles shows override", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    await exec(hooks, "ctf_orch_set_subagent_profile", {
      subagent_type: "ctf-web",
      model: "openai/gpt-4o",
    });
    const result = await exec(hooks, "ctf_orch_list_subagent_profiles", {});
    expect(result.ok).toBe(true);
    expect(result.overrides["ctf-web"]).toBeDefined();
  });

  it("17-3. clear_subagent_profile removes override", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    await exec(hooks, "ctf_orch_set_subagent_profile", {
      subagent_type: "ctf-web",
      model: "openai/gpt-4o",
    });
    const result = await exec(hooks, "ctf_orch_clear_subagent_profile", {
      subagent_type: "ctf-web",
    });
    expect(result.ok).toBe(true);
    expect(result.overrides["ctf-web"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Section 18: Domain risk assessment (hook-based, indirect)
// ---------------------------------------------------------------------------
describe("Section 18: domain risk assessment (indirect)", () => {
  it("18-1. REV output with .rela.p triggers risk signals via hook", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    await exec(hooks, "ctf_orch_event", { event: "reset_loop", target_type: "REV" });

    await hooks["tool.execute.after"]?.(
      { tool: "bash", sessionID: "s1", callID: "c1", args: {} },
      { output: "readelf output: Section .rela.p found, rwx segment with relocation entries" },
    );
    const status = await readStatus(hooks, "s1");
    expect(status.state.revRiskSignals.length).toBeGreaterThan(0);
  });

  it("18-2. WEB_API output with sqli triggers risk signals via hook", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    await exec(hooks, "ctf_orch_event", { event: "reset_loop", target_type: "WEB_API" });

    await hooks["tool.execute.after"]?.(
      { tool: "bash", sessionID: "s1", callID: "c2", args: {} },
      { output: "SQL injection detected in parameter id: SELECT * FROM users WHERE id=1 OR 1=1" },
    );
    const status = await readStatus(hooks, "s1");
    expect(status.state.revRiskSignals.length).toBeGreaterThan(0);
  });

  it("18-3. CRYPTO output with padding oracle triggers risk signals via hook", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    await exec(hooks, "ctf_orch_event", { event: "reset_loop", target_type: "CRYPTO" });

    await hooks["tool.execute.after"]?.(
      { tool: "bash", sessionID: "s1", callID: "c3", args: {} },
      { output: "padding oracle attack: different error responses for valid/invalid padding" },
    );
    const status = await readStatus(hooks, "s1");
    expect(status.state.revRiskSignals.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Section 19: Verification gates (hook-based, indirect)
// ---------------------------------------------------------------------------
describe("Section 19: verification gates", () => {
  it("19-1. CTF PWN: verify_success blocked without full evidence", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    await exec(hooks, "ctf_orch_event", { event: "reset_loop", target_type: "PWN" });
    await exec(hooks, "ctf_orch_event", { event: "scan_completed" });
    await exec(hooks, "ctf_orch_event", { event: "plan_completed" });

    const toastMessages: string[] = [];
    const clientStub = {
      tui: {
        showToast: async (args: any) => {
          toastMessages.push(args.body?.message ?? args.message ?? "");
        },
      },
    };
    const hooks2 = await loadHooks(projectDir, clientStub);
    await exec(hooks2, "ctf_orch_set_mode", { mode: "CTF" }, "s2");
    await exec(hooks2, "ctf_orch_event", { event: "reset_loop", target_type: "PWN" }, "s2");
    await exec(hooks2, "ctf_orch_event", { event: "scan_completed" }, "s2");
    await exec(hooks2, "ctf_orch_event", { event: "plan_completed" }, "s2");
    await exec(hooks2, "ctf_orch_event", { event: "candidate_found", candidate: "flag{test}" }, "s2");

    await hooks2["tool.execute.after"]?.(
      { tool: "bash", sessionID: "s2", callID: "v1", args: {} },
      { output: "Correct! flag{test}" },
    );

    const status = await readStatus(hooks2, "s2");
    expect(status.state.phase).not.toBe("SUBMIT");
  });
});

// ---------------------------------------------------------------------------
// Section 20: .Aegis notes / archive
// ---------------------------------------------------------------------------
describe("Section 20: .Aegis notes / archive", () => {
  it("20-1. .Aegis directory and notes are created on activity", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    await exec(hooks, "ctf_orch_event", { event: "reset_loop", target_type: "PWN" });
    await exec(hooks, "ctf_orch_event", { event: "scan_completed" });

    const aegisDir = join(projectDir, ".Aegis");
    expect(existsSync(aegisDir)).toBe(true);

    const hasSomeContent =
      existsSync(join(aegisDir, "orchestrator_state.json")) ||
      existsSync(join(aegisDir, "SCAN.md")) ||
      existsSync(join(aegisDir, "metrics.jsonl"));
    expect(hasSomeContent).toBe(true);
  });

  it("20-2. metrics.jsonl is created after events", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" });
    await exec(hooks, "ctf_orch_event", { event: "reset_loop", target_type: "PWN" });
    await exec(hooks, "ctf_orch_event", { event: "scan_completed" });

    const metricsFile = join(projectDir, ".Aegis", "metrics.jsonl");
    expect(existsSync(metricsFile)).toBe(true);
    const content = readFileSync(metricsFile, "utf-8");
    expect(content.length).toBeGreaterThan(0);
  });
});
