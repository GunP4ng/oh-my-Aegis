import type { SessionState } from "../state/types";
import { OrchestratorConfigSchema, type OrchestratorConfig } from "../config/schema";
import { findPlaybookNextAction } from "./playbook-engine";

/**
 * 세션 상태에서 활성 신호를 읽어 에이전트 지침 문자열 배열을 생성.
 * 각 문자열은 system prompt에 직접 주입됩니다.
 */
export function buildSignalGuidance(
  state: SessionState,
  config: OrchestratorConfig = OrchestratorConfigSchema.parse({})
): string[] {
  const lines: string[] = [];

  if (state.revVmSuspected || state.revLoaderVmDetected) {
    lines.push(
      "⚠ REV VM DETECTED: Static analysis is unreliable. Use ctf_rev_loader_vm_detect to map the VM and ctf_rev_entry_patch for dynamic extraction."
    );
  }

  if (state.decoySuspect) {
    const reason = state.decoySuspectReason ? ` (${state.decoySuspectReason})` : "";
    lines.push(
      `⚠ DECOY SUSPECT${reason}: Current flag candidate may be a decoy. Run ctf_decoy_guard to verify before submitting.`
    );
  }

  if (state.contradictionArtifactLockActive) {
    lines.push(
      "⚠ CONTRADICTION ACTIVE: Patch-and-dump extraction is mandatory. Use ctf_rev_entry_patch to extract runtime state."
    );
  }

  if (state.contradictionSLADumpRequired) {
    lines.push(
      "⚠ CONTRADICTION SLA: Direct state extraction required within this dispatch. Do not skip ctf_rev_entry_patch."
    );
  }

  if (state.noNewEvidenceLoops >= 2) {
    lines.push(
      `⚠ STUCK: No new evidence for ${state.noNewEvidenceLoops} loops. Change approach — use ctf_hypothesis_register to record alternatives.`
    );
  }

  if (state.revRiskScore > 0.3) {
    const signals = state.revRiskSignals.length > 0 ? ` signals=[${state.revRiskSignals.join(", ")}]` : "";
    lines.push(
      `⚠ HIGH REV RISK (score=${state.revRiskScore.toFixed(2)})${signals}: Prioritize dynamic analysis over static assumptions.`
    );
  }

  if (state.verifyFailCount >= 2) {
    lines.push(
      `⚠ REPEATED VERIFY FAILURES (${state.verifyFailCount}x): Consider whether the candidate is a decoy or constraints are wrong.`
    );
  }

  if (state.toolCallCount > 20 && state.aegisToolCallCount === 0) {
    lines.push(
      "⚠ AEGIS TOOLS NOT USED: You have made many tool calls without using any Aegis orchestration tools. Run ctf_orch_status to check state, then use ctf_orch_event to advance the phase."
    );
  }

  const playbookNextAction = findPlaybookNextAction(state, config);
  if (playbookNextAction && lines.length > 0) {
    lines.push(
      `PLAYBOOK NEXT ACTION (rule=${playbookNextAction.ruleId}): tool=${playbookNextAction.tool ?? "-"} route=${playbookNextAction.route ?? "-"}`
    );
  }

  return lines;
}

/**
 * 현재 phase에 대한 행동 지침을 반환합니다.
 */
export function buildPhaseInstruction(state: SessionState): string {
  switch (state.phase) {
    case "SCAN":
      return (
        "PHASE INSTRUCTION (SCAN): Analyze the target and identify its type. " +
        "Use ctf_auto_triage to classify the target. " +
        "Launch 2-3 parallel independent analyses. " +
        "When analysis is complete, call: ctf_orch_event scan_completed"
      );
    case "PLAN":
      return (
        "PHASE INSTRUCTION (PLAN): Form hypotheses and build a TODO list. " +
        "Use ctf_hypothesis_register to record at least 2 alternative hypotheses. " +
        "Delegate deep analysis to domain sub-agents before committing to one path. " +
        "When the plan is ready, call: ctf_orch_event plan_completed"
      );
    case "EXECUTE":
      return (
        "PHASE INSTRUCTION (EXECUTE): Execute the in_progress TODO items. " +
        "Delegate atomic domain tasks to specialized sub-agents. " +
        "Use ctf_evidence_ledger to record evidence. " +
        "When a flag candidate is found, call: ctf_orch_event candidate_found"
      );
    case "VERIFY":
      return (
        "PHASE INSTRUCTION (VERIFY): Validate the flag candidate against the oracle. " +
        "Run flag validation and decoy check in parallel. " +
        "On success call: ctf_orch_event verify_success — On failure call: ctf_orch_event verify_fail"
      );
    case "SUBMIT":
      return "PHASE INSTRUCTION (SUBMIT): Submit the verified flag.";
    default:
      return "";
  }
}

/**
 * Issue 3: Default Bias — 위임 편향 명문화
 * 메인 오케스트레이터는 조정자/검증자이며 직접 분석자가 아님.
 */
export function buildDelegateBiasSection(state: SessionState): string {
  const lines = [
    "[ORCHESTRATION ROLE]",
    "ORCHESTRATOR BIAS: Delegate first, verify second, synthesize third.",
    `  → Main orchestrator: coordinator & verifier (NOT direct analyst)`,
    `  → Domain work (${state.targetType}): delegate as atomic units to specialized sub-agents`,
    `  → Main focus: evidence integration, TODO management, verify-gate judgement`,
    "CHECK before acting directly:",
    "  1. Is there a specialized sub-agent for this domain/task?",
    "  2. Can this be expressed as an atomic delegation contract?",
    "  3. If yes → delegate. If no specialized agent exists → proceed directly.",
  ];
  return lines.join("\n");
}

/**
 * Issue 5: 병렬 탐색 규칙 표준화
 * Phase별 병렬 정찰 규약을 prompt contract 수준으로 명시.
 */
export function buildParallelRulesSection(state: SessionState): string {
  const lines = ["[PARALLEL EXPLORATION RULES]"];
  switch (state.phase) {
    case "SCAN":
      lines.push(
        "SCAN: Launch 2-3 independent parallel explorations minimum.",
        "  - Each exploration must cover a distinct attack surface or classification angle.",
        "  - Do not wait for one to finish before starting another.",
        "  - Aggregate results before calling ctf_orch_event scan_completed."
      );
      break;
    case "PLAN":
      lines.push(
        "PLAN: Compare alternative hypotheses in parallel.",
        "  - Register at least 2 alternative paths via ctf_hypothesis_register.",
        "  - Score alternatives before committing to a single path.",
        "  - Do not lock in one hypothesis until alternatives are evaluated."
      );
      break;
    case "EXECUTE":
      lines.push(
        "EXECUTE: Run independent sub-tasks in parallel where possible.",
        "  - Delegate domain-specific sub-tasks to specialized sub-agents simultaneously.",
        "  - If stuck: spawn parallel re-explorations on alternative hypotheses."
      );
      break;
    case "VERIFY":
      lines.push(
        "VERIFY: Separate flag validation and decoy check — run in parallel.",
        "  - Verification path: oracle/expected output check.",
        "  - Decoy check path: ctf_decoy_guard independently.",
        "  - Only call verify_success when BOTH paths confirm."
      );
      break;
    default:
      lines.push("No parallel rules for current phase.");
  }
  return lines.join("\n");
}

/**
 * Issue 6: 문제 상태 클래스 평가
 */
export function buildProblemStateSection(state: SessionState): string {
  if (state.problemStateClass === "unknown") {
    return "";
  }
  const descriptions: Record<string, string> = {
    clean:                "정석 풀이 가능 — 직접 접근 허용",
    deceptive:            "decoy/VM/anti-debug 가능성 높음 — 신뢰 임계값 상향 필요",
    environment_sensitive: "libc/loader/runtime parity 중요 — env 검증 필수",
    evidence_poor:        "추가 triage 우선 — 증거 불충분, 구현 보류",
  };
  const desc = descriptions[state.problemStateClass] ?? state.problemStateClass;
  return [
    "[PROBLEM STATE]",
    `class: ${state.problemStateClass} — ${desc}`,
  ].join("\n");
}

/**
 * Issue 7: 안티패턴/하드 블록 명문화
 */
export function buildHardBlocksSection(): string {
  return [
    "[HARD BLOCKS — NEVER DO THESE]",
    "  ✗ verify_success 선언: 검증 명령 실행 결과 없이 금지",
    "  ✗ flag 패턴만 보고 즉시 정답 확정 금지 — decoy 확인 필수",
    "  ✗ standalone 재실행 결과를 고신뢰로 취급 금지",
    "  ✗ TODO 없이 장기 루프 진입 금지",
    "  ✗ 근거 갱신 없이 동일 가설 반복 시도 금지",
    "  ✗ 직접 구현 전 위임 가능 여부 확인 생략 금지",
  ].join("\n");
}

/**
 * Issue 10: 라우팅 결정 투명성 — 현재 라우트 이유를 간결하게 표시.
 * index-core.ts의 NEXT_ROUTE 라인을 보완하는 더 상세한 설명.
 */
export function buildRouteTransparencySection(
  state: SessionState,
  routePrimary: string,
  routeReason: string
): string {
  const lines = [
    "[ROUTE DECISION]",
    `  primary_route: ${routePrimary}`,
    `  reason: ${routeReason}`,
    `  phase: ${state.phase} → target: ${state.targetType}`,
  ];
  if (state.activeSolveLane) {
    lines.push(`  active_solve_lane: ${state.activeSolveLane} (preserved)`);
  }
  if (state.noNewEvidenceLoops > 0) {
    lines.push(`  stuck_loops: ${state.noNewEvidenceLoops} (no new evidence)`);
  }
  return lines.join("\n");
}

/**
 * Issue 2: 동적 사용 가능 서브에이전트 목록 주입.
 * availableSubagents는 index-core.ts에서 config에서 추출해 전달.
 */
export function buildAvailableSubagentsSection(
  state: SessionState,
  availableSubagents: string[]
): string {
  if (availableSubagents.length === 0) {
    return "";
  }
  const lines = [
    "[AVAILABLE SUB-AGENTS]",
    ...availableSubagents.map((s) => `  ${s}`),
    `(use task tool to delegate — prefer specialised over generic)`,
  ];
  // Add domain-specific delegation hint
  const target = state.targetType;
  const domainHints: Partial<Record<string, string>> = {
    REV:       "→ prefer ctf-rev for static analysis, aegis-deep for dynamic",
    PWN:       "→ prefer ctf-pwn for exploit dev, ctf-verify for oracle",
    WEB_API:   "→ prefer ctf-web for recon, ctf-research for deep analysis",
    WEB3:      "→ prefer ctf-web3 for contract analysis",
    CRYPTO:    "→ prefer ctf-crypto for cryptanalysis",
    FORENSICS: "→ prefer ctf-forensics for artifact analysis",
  };
  if (domainHints[target]) {
    lines.push(domainHints[target]!);
  }
  return lines.join("\n");
}
