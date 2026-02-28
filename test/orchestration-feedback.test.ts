import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionStore } from "../src/state/session-store";
import { buildSignalGuidance, buildPhaseInstruction } from "../src/orchestration/signal-actions";
import { buildToolGuide } from "../src/orchestration/tool-guide";
import { OrchestratorConfigSchema } from "../src/config/schema";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

function makeStore(): { store: SessionStore; root: string } {
  const root = join(tmpdir(), `aegis-feedback-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  const store = new SessionStore(root);
  return { store, root };
}

describe("orchestration-feedback: tool call tracking", () => {
  it("toolCallCount starts at 0", () => {
    const { store } = makeStore();
    store.setMode("s1", "CTF");
    const state = store.get("s1");
    expect(state.toolCallCount).toBe(0);
    expect(state.aegisToolCallCount).toBe(0);
    expect(state.toolCallHistory).toEqual([]);
  });

  it("update increments toolCallCount correctly", () => {
    const { store } = makeStore();
    store.setMode("s1", "CTF");
    let state = store.get("s1");

    store.update("s1", {
      toolCallCount: state.toolCallCount + 1,
      aegisToolCallCount: state.aegisToolCallCount,
      lastToolCallAt: Date.now(),
      toolCallHistory: [...state.toolCallHistory, "bash"],
    });

    state = store.get("s1");
    expect(state.toolCallCount).toBe(1);
    expect(state.toolCallHistory).toEqual(["bash"]);
  });

  it("aegisToolCallCount increments only for aegis/ctf_ tools", () => {
    const { store } = makeStore();
    store.setMode("s1", "CTF");

    for (const tool of ["bash", "ctf_orch_status", "aegis_memory_save", "readelf"]) {
      const cur = store.get("s1");
      const isAegis = tool.startsWith("ctf_") || tool.startsWith("aegis_");
      store.update("s1", {
        toolCallCount: cur.toolCallCount + 1,
        aegisToolCallCount: cur.aegisToolCallCount + (isAegis ? 1 : 0),
        lastToolCallAt: Date.now(),
        toolCallHistory: [...cur.toolCallHistory, tool].slice(-20),
      });
    }

    const state = store.get("s1");
    expect(state.toolCallCount).toBe(4);
    expect(state.aegisToolCallCount).toBe(2); // ctf_orch_status, aegis_memory_save
  });

  it("toolCallHistory is capped at 20 entries", () => {
    const { store } = makeStore();
    store.setMode("s1", "CTF");

    for (let i = 0; i < 25; i++) {
      const cur = store.get("s1");
      store.update("s1", {
        toolCallCount: cur.toolCallCount + 1,
        aegisToolCallCount: cur.aegisToolCallCount,
        lastToolCallAt: Date.now(),
        toolCallHistory: [...cur.toolCallHistory, `tool_${i}`].slice(-20),
      });
    }

    const state = store.get("s1");
    expect(state.toolCallHistory.length).toBe(20);
    expect(state.toolCallHistory[0]).toBe("tool_5"); // first 5 dropped
    expect(state.toolCallHistory[19]).toBe("tool_24");
  });
});

describe("orchestration-feedback: auto phase transitions", () => {
  it("SCAN → PLAN after N tool calls (simulated via applyEvent)", () => {
    const { store } = makeStore();
    store.setMode("s1", "CTF");
    expect(store.get("s1").phase).toBe("SCAN");
    store.applyEvent("s1", "scan_completed");
    expect(store.get("s1").phase).toBe("PLAN");
  });

  it("PLAN → EXECUTE after plan_completed event", () => {
    const { store } = makeStore();
    store.setMode("s1", "CTF");
    store.applyEvent("s1", "scan_completed");
    expect(store.get("s1").phase).toBe("PLAN");
    store.applyEvent("s1", "plan_completed");
    expect(store.get("s1").phase).toBe("EXECUTE");
  });

  it("EXECUTE → VERIFY after candidate_found", () => {
    const { store } = makeStore();
    store.setMode("s1", "CTF");
    store.applyEvent("s1", "scan_completed");
    store.applyEvent("s1", "plan_completed");
    store.applyEvent("s1", "candidate_found");
    expect(store.get("s1").phase).toBe("VERIFY");
  });
});

describe("orchestration-feedback: signal guidance", () => {
  it("buildSignalGuidance returns empty array when no signals", () => {
    const { store } = makeStore();
    store.setMode("s1", "CTF");
    const state = store.get("s1");
    const guidance = buildSignalGuidance(state);
    expect(Array.isArray(guidance)).toBe(true);
    expect(guidance.length).toBe(0);
  });

  it("revVmSuspected signal generates guidance", () => {
    const { store } = makeStore();
    store.setMode("s1", "CTF");
    store.update("s1", { revVmSuspected: true });
    const state = store.get("s1");
    const guidance = buildSignalGuidance(state);
    expect(guidance.some((g) => g.includes("REV VM"))).toBe(true);
  });

  it("decoySuspect signal generates guidance with reason", () => {
    const { store } = makeStore();
    store.setMode("s1", "CTF");
    store.update("s1", { decoySuspect: true, decoySuspectReason: "pattern mismatch" });
    const state = store.get("s1");
    const guidance = buildSignalGuidance(state);
    expect(guidance.some((g) => g.includes("DECOY"))).toBe(true);
    expect(guidance.some((g) => g.includes("pattern mismatch"))).toBe(true);
  });

  it("verifyFailCount >= 2 triggers warning", () => {
    const { store } = makeStore();
    store.setMode("s1", "CTF");
    store.update("s1", { verifyFailCount: 3 });
    const state = store.get("s1");
    const guidance = buildSignalGuidance(state);
    expect(guidance.some((g) => g.includes("VERIFY FAILURES"))).toBe(true);
  });

  it("toolCallCount > 20 with zero aegis calls triggers warning", () => {
    const { store } = makeStore();
    store.setMode("s1", "CTF");
    store.update("s1", { toolCallCount: 25, aegisToolCallCount: 0 });
    const state = store.get("s1");
    const guidance = buildSignalGuidance(state);
    expect(guidance.some((g) => g.includes("AEGIS TOOLS NOT USED"))).toBe(true);
  });

  it("noNewEvidenceLoops >= 2 triggers stuck warning", () => {
    const { store } = makeStore();
    store.setMode("s1", "CTF");
    store.update("s1", { noNewEvidenceLoops: 3 });
    const state = store.get("s1");
    const guidance = buildSignalGuidance(state);
    expect(guidance.some((g) => g.includes("STUCK"))).toBe(true);
  });

  it("appends playbook next action guidance when a playbook rule matches", () => {
    const { store } = makeStore();
    store.setMode("s1", "CTF");
    store.setTargetType("s1", "WEB_API");
    store.update("s1", { decoySuspect: true });
    const state = store.get("s1");
    const guidance = buildSignalGuidance(state);
    expect(guidance.some((g) => g.includes("PLAYBOOK NEXT ACTION"))).toBe(true);
    expect(guidance.some((g) => g.includes("rule="))).toBe(true);
  });
});

describe("orchestration-feedback: phase instruction", () => {
  it("SCAN phase instruction mentions ctf_orch_event scan_completed", () => {
    const { store } = makeStore();
    store.setMode("s1", "CTF");
    const state = store.get("s1");
    expect(state.phase).toBe("SCAN");
    const instruction = buildPhaseInstruction(state);
    expect(instruction).toContain("scan_completed");
    expect(instruction).toContain("ctf_auto_triage");
  });

  it("PLAN phase instruction mentions plan_completed", () => {
    const { store } = makeStore();
    store.setMode("s1", "CTF");
    store.applyEvent("s1", "scan_completed");
    const state = store.get("s1");
    expect(state.phase).toBe("PLAN");
    const instruction = buildPhaseInstruction(state);
    expect(instruction).toContain("plan_completed");
    expect(instruction).toContain("ctf_hypothesis_register");
  });

  it("EXECUTE phase instruction mentions ctf_evidence_ledger", () => {
    const { store } = makeStore();
    store.setMode("s1", "CTF");
    store.applyEvent("s1", "scan_completed");
    store.applyEvent("s1", "plan_completed");
    const state = store.get("s1");
    expect(state.phase).toBe("EXECUTE");
    const instruction = buildPhaseInstruction(state);
    expect(instruction).toContain("ctf_evidence_ledger");
    expect(instruction).toContain("candidate_found");
  });
});

describe("orchestration-feedback: tool guide", () => {
  it("SCAN phase tool guide includes ctf_auto_triage", () => {
    const { store } = makeStore();
    store.setMode("s1", "CTF");
    const state = store.get("s1");
    const guide = buildToolGuide(state);
    expect(guide).toContain("ctf_auto_triage");
    expect(guide).toContain("ctf_orch_status");
  });

  it("REV target in EXECUTE phase includes ctf_rev_loader_vm_detect", () => {
    const { store } = makeStore();
    store.setMode("s1", "CTF");
    store.applyEvent("s1", "scan_completed");
    store.applyEvent("s1", "plan_completed");
    store.setTargetType("s1", "REV");
    const state = store.get("s1");
    const guide = buildToolGuide(state);
    expect(guide).toContain("ctf_rev_loader_vm_detect");
    expect(guide).toContain("ctf_rev_entry_patch");
  });

  it("tool guide stays within ~200 token budget", () => {
    const { store } = makeStore();
    store.setMode("s1", "CTF");
    const state = store.get("s1");
    const guide = buildToolGuide(state);
    // 200 tokens ≈ 800 chars (rough estimate: 1 token ≈ 4 chars)
    expect(guide.length).toBeLessThan(1600);
  });

  it("tool guide uses real tool names and excludes drifted names", () => {
    const { store: scanStore } = makeStore();
    scanStore.setMode("scan", "CTF");
    const scanGuide = buildToolGuide(scanStore.get("scan"));
    expect(scanGuide).toContain("ctf_recon_pipeline");
    expect(scanGuide).toContain("ctf_report_generate");
    expect(scanGuide).not.toContain("ctf_orch_recon_plan");
    expect(scanGuide).not.toContain("ctf_orch_report_generate");

    const { store: executeStore } = makeStore();
    executeStore.setMode("exec", "CTF");
    executeStore.setTargetType("exec", "PWN");
    executeStore.applyEvent("exec", "scan_completed");
    executeStore.applyEvent("exec", "plan_completed");
    const executeGuide = buildToolGuide(executeStore.get("exec"));
    expect(executeGuide).toContain("ctf_env_parity");
    expect(executeGuide).not.toContain("ctf_orch_env_parity");
  });
});

describe("orchestration-feedback: stuck detection", () => {
  it("staleToolPatternLoops increments when last 5 tools are identical", () => {
    const { store } = makeStore();
    store.setMode("s1", "CTF");

    const tools = ["bash", "bash", "bash", "bash", "bash"];
    for (const tool of tools) {
      const cur = store.get("s1");
      store.update("s1", {
        toolCallCount: cur.toolCallCount + 1,
        aegisToolCallCount: cur.aegisToolCallCount,
        lastToolCallAt: Date.now(),
        toolCallHistory: [...cur.toolCallHistory, tool].slice(-20),
      });
    }

    const state = store.get("s1");
    const last5 = state.toolCallHistory.slice(-5);
    const allSame = last5.length === 5 && new Set(last5).size === 1;
    expect(allSame).toBe(true);

    if (allSame && last5[0] !== state.lastToolPattern) {
      store.update("s1", {
        staleToolPatternLoops: state.staleToolPatternLoops + 1,
        lastToolPattern: last5[0],
      });
    }

    expect(store.get("s1").staleToolPatternLoops).toBe(1);
    expect(store.get("s1").lastToolPattern).toBe("bash");
  });
});

describe("orchestration-feedback: AutoPhaseSchema defaults", () => {
  it("auto_phase config has expected defaults", () => {
    const config = OrchestratorConfigSchema.parse({});
    expect(config.auto_phase.enabled).toBe(true);
    expect(config.auto_phase.scan_to_plan_tool_count).toBe(8);
    expect(config.auto_phase.plan_to_execute_on_todo).toBe(true);
  });

  it("debug config has expected defaults", () => {
    const config = OrchestratorConfigSchema.parse({});
    expect(config.debug.log_all_hooks).toBe(false);
    expect(config.debug.log_tool_call_counts).toBe(true);
  });

  it("auto_phase can be disabled via config", () => {
    const config = OrchestratorConfigSchema.parse({ auto_phase: { enabled: false } });
    expect(config.auto_phase.enabled).toBe(false);
  });
});
