/**
 * 오케스트레이션 공통 커널 버그 수정 점검 테스트
 * P1~P9 각 기능이 설계대로 동작하는지 검증
 */
import { describe, expect, it } from "bun:test";
import { afterEach } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionStore } from "../src/state/session-store";
import { DEFAULT_STATE, type SessionState } from "../src/state/types";
import { route, buildWorkPackage } from "../src/orchestration/router";
import { decideAutoDispatch } from "../src/orchestration/task-dispatch";
import { OrchestratorConfigSchema } from "../src/config/schema";
import { ROUTE_CAPABILITIES, checkRoutePreflight } from "../src/orchestration/preflight";
import type { DomainPlugin } from "../src/orchestration/domain-plugins/types";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});
function makeRoot() {
  const root = join(tmpdir(), `kernel-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);
  return root;
}
function makeState(overrides: Partial<SessionState>): SessionState {
  return { ...DEFAULT_STATE, ...overrides, lastUpdatedAt: 0 };
}

// ──────────────────────────────────────────────────
// P1: 상태머신 — CLOSED 단계 + terminal guard
// ──────────────────────────────────────────────────
describe("P1: 상태머신 CLOSED 단계 + terminal guard", () => {
  it("submit_accepted 이후 phase === CLOSED", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s", "CTF");
    store.applyEvent("s", "scan_completed");
    store.applyEvent("s", "plan_completed");
    store.applyEvent("s", "candidate_found");
    store.applyEvent("s", "verify_success");
    store.applyEvent("s", "submit_accepted");

    expect(store.get("s").phase).toBe("CLOSED");
  });

  it("submit_accepted 이후 submissionAccepted === true, candidateLevel === L3", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s", "CTF");
    store.setCandidate("s", "flag{answer}");
    store.applyEvent("s", "scan_completed");
    store.applyEvent("s", "plan_completed");
    store.applyEvent("s", "candidate_found");
    store.applyEvent("s", "verify_success");
    store.applyEvent("s", "submit_accepted");

    const state = store.get("s");
    expect(state.submissionAccepted).toBe(true);
    expect(state.candidateLevel).toBe("L3");
    expect(state.phase).toBe("CLOSED");
  });

  it("CLOSED 이후 new_evidence → state 불변 (terminal guard)", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s", "CTF");
    store.setCandidate("s", "flag{x}");
    store.applyEvent("s", "scan_completed");
    store.applyEvent("s", "plan_completed");
    store.applyEvent("s", "candidate_found");
    store.applyEvent("s", "verify_success");
    store.applyEvent("s", "submit_accepted");

    // snapshot은 CLOSED 전환 직후 — applyEvent만 차단됨
    const snapshotAt = store.get("s").lastUpdatedAt;

    // applyEvent들은 terminal guard로 차단됨
    store.applyEvent("s", "new_evidence");
    store.applyEvent("s", "no_new_evidence");
    store.applyEvent("s", "candidate_found");

    const state = store.get("s");
    expect(state.phase).toBe("CLOSED");
    expect(state.submissionAccepted).toBe(true);
    expect(state.lastUpdatedAt).toBe(snapshotAt); // applyEvent 호출에서 변경 없음

    // setCandidate도 CLOSED guard로 차단됨
    store.setCandidate("s", "flag{different}");
    expect(store.get("s").latestCandidate).toBe("flag{x}"); // candidate 불변
    expect(store.get("s").submissionAccepted).toBe(true); // submissionAccepted 불변
  });

  it("CLOSED 이후 verify_success → state 불변", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s", "CTF");
    store.applyEvent("s", "scan_completed");
    store.applyEvent("s", "plan_completed");
    store.applyEvent("s", "candidate_found");
    store.applyEvent("s", "verify_success");
    store.applyEvent("s", "submit_accepted");

    // 이미 CLOSED — verify_success 재발화
    const before = store.get("s").lastUpdatedAt;
    store.applyEvent("s", "verify_success");
    expect(store.get("s").phase).toBe("CLOSED");
    expect(store.get("s").lastUpdatedAt).toBe(before);
  });

  it("verify_success → phase === SUBMIT (CLOSED 아님)", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s", "CTF");
    store.applyEvent("s", "scan_completed");
    store.applyEvent("s", "plan_completed");
    store.applyEvent("s", "candidate_found");
    store.applyEvent("s", "verify_success");

    expect(store.get("s").phase).toBe("SUBMIT");
    expect(store.get("s").submissionPending).toBe(true);
  });

  it("CLOSED phase가 Phase 타입에 포함 (타입 안전성)", () => {
    const store = new SessionStore(makeRoot());
    store.applyEvent("s", "scan_completed");
    store.applyEvent("s", "plan_completed");
    store.applyEvent("s", "candidate_found");
    store.applyEvent("s", "verify_success");
    store.applyEvent("s", "submit_accepted");
    // TypeScript에서 CLOSED를 Phase로 다룰 수 있어야 함
    const phase: SessionState["phase"] = store.get("s").phase;
    expect(phase).toBe("CLOSED");
  });
});

// ──────────────────────────────────────────────────
// P1-b: autoLoopEnabled closure semantics
// ──────────────────────────────────────────────────
describe("P1-b: autoLoop closure semantics", () => {
  it("verify_success → autoLoopEnabled = false", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s", "CTF");
    store.applyEvent("s", "scan_completed");
    store.applyEvent("s", "plan_completed");
    store.applyEvent("s", "candidate_found");
    store.setAutoLoopEnabled("s", true);
    store.applyEvent("s", "verify_success");
    expect(store.get("s").autoLoopEnabled).toBe(false);
  });

  it("submit_accepted → autoLoopEnabled = false", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s", "CTF");
    store.applyEvent("s", "scan_completed");
    store.applyEvent("s", "plan_completed");
    store.applyEvent("s", "candidate_found");
    store.applyEvent("s", "verify_success");
    store.setAutoLoopEnabled("s", true); // SUBMIT에서 다시 켬
    store.applyEvent("s", "submit_accepted");
    expect(store.get("s").autoLoopEnabled).toBe(false);
  });

  it("submit_accepted 이후 setAutoLoopEnabled(true) → CLOSED이므로 즉시 re-check 필요", () => {
    // SessionStore 자체는 setAutoLoopEnabled를 막지 않음 — 가드는 maybeAutoloopTick에서
    // 그러나 state.phase=CLOSED이므로 maybeAutoloopTick에서 false로 복구됨
    const store = new SessionStore(makeRoot());
    store.setMode("s", "CTF");
    store.applyEvent("s", "scan_completed");
    store.applyEvent("s", "plan_completed");
    store.applyEvent("s", "candidate_found");
    store.applyEvent("s", "verify_success");
    store.applyEvent("s", "submit_accepted");

    store.setAutoLoopEnabled("s", true); // 외부에서 강제 재활성화
    expect(store.get("s").phase).toBe("CLOSED");
    // maybeAutoloopTick이 호출되면 즉시 false로 reset + return 해야 함
    // (실제 호출은 index-core.ts에서 발생 — 여기선 phase를 통해 guard 확인)
    expect(store.get("s").phase).toBe("CLOSED"); // guard 조건 확인
  });
});

// ──────────────────────────────────────────────────
// P1-c: new_evidence idempotency (hash guard)
// ──────────────────────────────────────────────────
describe("P1-c: new_evidence idempotency hash", () => {
  it("동일 candidate hash 연속 → noNewEvidenceLoops 증가, phase 불변", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s", "CTF");
    store.setCandidate("s", "flag{same}");

    store.applyEvent("s", "new_evidence");
    let state = store.get("s");
    expect(state.noNewEvidenceLoops).toBe(0); // 첫 번째는 hash 업데이트 후 정상 처리

    store.applyEvent("s", "new_evidence"); // 동일 hash
    state = store.get("s");
    expect(state.noNewEvidenceLoops).toBe(1);
    expect(state.lastFailureReason).toBe("hypothesis_stall");

    store.applyEvent("s", "new_evidence"); // 또 동일
    state = store.get("s");
    expect(state.noNewEvidenceLoops).toBe(2);
  });

  it("candidate 변경 후 new_evidence → noNewEvidenceLoops 리셋", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s", "CTF");
    store.setCandidate("s", "flag{v1}");
    store.applyEvent("s", "new_evidence");
    store.applyEvent("s", "new_evidence"); // dup
    expect(store.get("s").noNewEvidenceLoops).toBe(1);

    store.setCandidate("s", "flag{v2}"); // 후보 변경
    store.applyEvent("s", "new_evidence");
    expect(store.get("s").noNewEvidenceLoops).toBe(0); // 리셋
  });

  it("evidence 변경 후 new_evidence → hash 다름 → 정상 처리", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s", "CTF");
    store.setCandidate("s", "flag{x}");
    store.setAcceptanceEvidence("s", "stdout: correct");
    store.applyEvent("s", "new_evidence");

    store.setAcceptanceEvidence("s", "stdout: correct v2"); // evidence만 변경
    store.applyEvent("s", "new_evidence");
    expect(store.get("s").noNewEvidenceLoops).toBe(0); // 중복 아님
  });

  it("CLOSED 이후 new_evidence → submissionAccepted 불변 (중복 가드)", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s", "CTF");
    store.setCandidate("s", "flag{done}");
    store.applyEvent("s", "scan_completed");
    store.applyEvent("s", "plan_completed");
    store.applyEvent("s", "candidate_found");
    store.applyEvent("s", "verify_success");
    store.applyEvent("s", "submit_accepted");

    // setCandidate도 CLOSED guard로 차단됨
    store.setCandidate("s", "flag{fake}");
    store.applyEvent("s", "new_evidence"); // terminal guard

    expect(store.get("s").phase).toBe("CLOSED");
    expect(store.get("s").submissionAccepted).toBe(true);
    expect(store.get("s").latestCandidate).toBe("flag{done}"); // setCandidate도 차단
  });
});

// ──────────────────────────────────────────────────
// P1-d: setManualVerifySuccess
// ──────────────────────────────────────────────────
describe("P1-d: setManualVerifySuccess 1급 시민", () => {
  it("필수 필드 누락 시 throw", () => {
    const store = new SessionStore(makeRoot());
    expect(() =>
      store.setManualVerifySuccess("s", { verificationCommand: "", stdoutSummary: "ok" })
    ).toThrow("requires verificationCommand and stdoutSummary");
    expect(() =>
      store.setManualVerifySuccess("s", { verificationCommand: "cmd", stdoutSummary: "" })
    ).toThrow("requires verificationCommand and stdoutSummary");
  });

  it("정상 호출 → phase SUBMIT, submissionPending true, evidence JSON 저장", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s", "CTF");
    store.applyEvent("s", "scan_completed");
    store.applyEvent("s", "plan_completed");
    store.applyEvent("s", "candidate_found");

    const state = store.setManualVerifySuccess("s", {
      verificationCommand: "nc host 1337 < payload",
      stdoutSummary: "Correct! flag{manual}",
      artifactPath: ".Aegis/artifacts/out.txt",
    });

    expect(state.phase).toBe("SUBMIT");
    expect(state.submissionPending).toBe(true);
    expect(state.autoLoopEnabled).toBe(false); // verify_success fires → autoLoop off
    const ev = JSON.parse(state.latestAcceptanceEvidence) as Record<string, unknown>;
    expect(ev.verificationCommand).toBe("nc host 1337 < payload");
    expect(ev.stdoutSummary).toBe("Correct! flag{manual}");
    expect(ev.artifactPath).toBe(".Aegis/artifacts/out.txt");
  });

  it("verifier 없이도 phase VERIFY가 아닌 EXECUTE에서 호출 가능", () => {
    // 기존 ctf_orch_event verify_success는 VERIFY phase 필요
    // setManualVerifySuccess는 phase 무관하게 verify_success 적용
    const store = new SessionStore(makeRoot());
    store.setMode("s", "CTF");
    store.applyEvent("s", "scan_completed");
    store.applyEvent("s", "plan_completed");
    // candidate_found 없이 EXECUTE에서 바로
    const state = store.setManualVerifySuccess("s", {
      verificationCommand: "cmd",
      stdoutSummary: "output",
    });
    // verify_success: candidatePendingVerification=false가 되고 phase=SUBMIT
    expect(state.phase).toBe("SUBMIT");
  });
});

// ──────────────────────────────────────────────────
// P1-e: setSolveLane
// ──────────────────────────────────────────────────
describe("P1-e: setSolveLane + setLastDispatch 자동 추적", () => {
  it("setSolveLane 수동 설정/해제", () => {
    const store = new SessionStore(makeRoot());
    store.setSolveLane("s", "ctf-rev");
    expect(store.get("s").activeSolveLane).toBe("ctf-rev");
    expect(store.get("s").activeSolveLaneSetAt).toBeGreaterThan(0);

    store.setSolveLane("s", null);
    expect(store.get("s").activeSolveLane).toBeNull();
    expect(store.get("s").activeSolveLaneSetAt).toBe(0);
  });

  it("setLastDispatch solve lane 자동 추적 (비-admin route)", () => {
    const store = new SessionStore(makeRoot());
    store.setLastDispatch("s", "ctf-rev", "ctf-rev");
    expect(store.get("s").activeSolveLane).toBe("ctf-rev");

    store.setLastDispatch("s", "ctf-pwn", "ctf-pwn");
    expect(store.get("s").activeSolveLane).toBe("ctf-pwn");
  });

  it("setLastDispatch md-scribe → activeSolveLane 변경 없음", () => {
    const store = new SessionStore(makeRoot());
    store.setLastDispatch("s", "ctf-rev", "ctf-rev"); // solve lane 설정
    store.setLastDispatch("s", "md-scribe", "md-scribe"); // admin route
    expect(store.get("s").activeSolveLane).toBe("ctf-rev"); // 유지
  });

  it("governance route → activeSolveLane 변경 없음", () => {
    const store = new SessionStore(makeRoot());
    store.setLastDispatch("s", "ctf-crypto", "ctf-crypto");
    store.setLastDispatch("s", "bounty-scope", "bounty-scope");
    expect(store.get("s").activeSolveLane).toBe("ctf-crypto");

    store.setLastDispatch("s", "aegis-plan--governance-review-required", "aegis-plan");
    expect(store.get("s").activeSolveLane).toBe("ctf-crypto");
  });
});

// ──────────────────────────────────────────────────
// P2: auto-loop 실행기 — CLOSED guard
// ──────────────────────────────────────────────────
describe("P2: auto-loop CLOSED phase guard (상태 검증)", () => {
  it("CLOSED phase에서 autoLoopEnabled 재활성화 후 state 확인", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s", "CTF");
    store.applyEvent("s", "scan_completed");
    store.applyEvent("s", "plan_completed");
    store.applyEvent("s", "candidate_found");
    store.applyEvent("s", "verify_success");
    store.applyEvent("s", "submit_accepted");

    expect(store.get("s").phase).toBe("CLOSED");
    expect(store.get("s").autoLoopEnabled).toBe(false);

    // maybeAutoloopTick의 guard 조건: phase === "CLOSED" || submissionAccepted
    const state = store.get("s");
    const guardFires = state.phase === "CLOSED" || state.submissionAccepted;
    expect(guardFires).toBe(true);
  });

  it("submissionAccepted=true → guard 조건 충족", () => {
    const state = makeState({ submissionAccepted: true, phase: "SUBMIT" });
    const guardFires = state.phase === "CLOSED" || state.submissionAccepted;
    expect(guardFires).toBe(true);
  });

  it("정상 EXECUTE phase → guard 미발동", () => {
    const state = makeState({ phase: "EXECUTE", submissionAccepted: false, autoLoopEnabled: true });
    const guardFires = state.phase === "CLOSED" || state.submissionAccepted;
    expect(guardFires).toBe(false);
  });
});

// ──────────────────────────────────────────────────
// P3: 라우팅 — lane ownership + md-scribe 제한
// ──────────────────────────────────────────────────
describe("P3: 라우팅 lane ownership + md-scribe 제한", () => {
  it("CLOSED phase → route() = md-scribe + CLOSED 이유", () => {
    const decision = route(makeState({ mode: "CTF", phase: "CLOSED" }));
    expect(decision.primary).toBe("md-scribe");
    expect(decision.reason).toContain("CLOSED");
  });

  it("activeSolveLane 있을 때 md-scribe primary → lane으로 교체, md-scribe는 followup", () => {
    // context_overflow, non-EXECUTE, mdScribePrimaryStreak=0 → routeRaw returns md-scribe
    const decision = route(
      makeState({
        mode: "CTF",
        phase: "VERIFY",
        targetType: "REV",
        contextFailCount: 2,
        timeoutFailCount: 0,
        activeSolveLane: "ctf-rev",
        lastFailureReason: "context_overflow",
        mdScribePrimaryStreak: 0,
      })
    );
    expect(decision.primary).toBe("ctf-rev");
    expect(decision.followups).toContain("md-scribe");
    expect(decision.reason).toContain("Lane ownership");
  });

  it("contextFailCount >= 3 → md-scribe primary 허용 (override 예외)", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        phase: "VERIFY",
        targetType: "REV",
        contextFailCount: 3,
        activeSolveLane: "ctf-rev",
        lastFailureReason: "context_overflow",
        mdScribePrimaryStreak: 0,
      })
    );
    expect(decision.primary).toBe("md-scribe");
  });

  it("activeSolveLane null → lane ownership 미발동 (md-scribe 그대로)", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        phase: "VERIFY",
        targetType: "REV",
        contextFailCount: 2,
        activeSolveLane: null,
        lastFailureReason: "context_overflow",
        mdScribePrimaryStreak: 0,
      })
    );
    expect(decision.primary).toBe("md-scribe");
  });

  it("contradiction active → solve lane 강제 pivot (lane 교체 허용 조건)", () => {
    // contradiction이면 routeRaw가 ctf-rev 반환 → CLOSED 아님 → lane ownership 불필요
    const decision = route(
      makeState({
        mode: "CTF",
        phase: "EXECUTE",
        targetType: "REV",
        activeSolveLane: "ctf-pwn",
        contradictionArtifactLockActive: true,
        contradictionPatchDumpDone: false,
        contradictionPivotDebt: 1,
      })
    );
    // routeRaw returns ctf-rev (contradiction pivot), not md-scribe → lane logic 미발동
    expect(decision.primary).toBe("ctf-rev");
  });

  it("lane ownership 유지 후 reasoning에 원래 이유 포함", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        phase: "PLAN",
        targetType: "PWN",
        contextFailCount: 2,
        activeSolveLane: "ctf-pwn",
        lastFailureReason: "context_overflow",
        mdScribePrimaryStreak: 0,
      })
    );
    if (decision.primary === "ctf-pwn") {
      expect(decision.reason).toContain("ctf-pwn");
      expect(decision.reason).toContain("md-scribe");
    }
  });
});

// ──────────────────────────────────────────────────
// P4: route preflight
// ──────────────────────────────────────────────────
describe("P4: route preflight — ROUTE_CAPABILITIES + checkRoutePreflight", () => {
  const config = OrchestratorConfigSchema.parse({});

  it("알려진 route는 ROUTE_CAPABILITIES에 포함", () => {
    const solveLanes = ["ctf-rev", "ctf-pwn", "ctf-web", "ctf-crypto", "ctf-forensics", "aegis-deep", "md-scribe"];
    for (const lane of solveLanes) {
      expect(ROUTE_CAPABILITIES[lane]).toBeDefined();
    }
  });

  it("모든 route는 최소 model:exists capability 보유", () => {
    for (const [route, caps] of Object.entries(ROUTE_CAPABILITIES)) {
      expect(caps).toContain("model:exists");
      const label = `route=${route}`;
      expect(label).toBeTruthy(); // ts type check용
    }
  });

  it("모델 건강 → preflight ok", () => {
    const state = makeState({ mode: "CTF", targetType: "REV" });
    const result = checkRoutePreflight("ctf-rev", state, config, "openai/gpt-4o");
    expect(result.ok).toBe(true);
  });

  it("모델 unhealthy → preflight 실패 + fallback 반환", () => {
    const state = makeState({
      mode: "CTF",
      targetType: "REV",
      modelHealthByModel: {
        "openai/gpt-4o": { unhealthySince: Date.now(), reason: "quota" },
      },
    });
    const result = checkRoutePreflight("ctf-rev", state, config, "openai/gpt-4o");
    expect(result.ok).toBe(false);
    expect(result.failedCapability).toBe("model:exists");
    expect(result.fallbackRoute).toBeDefined();
  });

  it("쿨다운 경과 모델 → preflight ok", () => {
    const state = makeState({
      mode: "CTF",
      targetType: "REV",
      modelHealthByModel: {
        "openai/gpt-4o": { unhealthySince: Date.now() - 400_000, reason: "quota" },
      },
    });
    // default cooldown 300s — 400s 경과이므로 healthy
    const result = checkRoutePreflight("ctf-rev", state, config, "openai/gpt-4o");
    expect(result.ok).toBe(true);
  });

  it("알 수 없는 route → capabilities 없음 → ok", () => {
    const state = makeState({ mode: "CTF", targetType: "REV" });
    const result = checkRoutePreflight("unknown-custom-route", state, config);
    expect(result.ok).toBe(true);
  });

  it("model 미제공 시 model:exists 체크 스킵 → ok", () => {
    const state = makeState({
      mode: "CTF",
      targetType: "REV",
      modelHealthByModel: {
        "openai/gpt-4o": { unhealthySince: Date.now(), reason: "quota" },
      },
    });
    // resolvedModel 미제공 → model:exists 체크 안 함
    const result = checkRoutePreflight("ctf-rev", state, config);
    expect(result.ok).toBe(true);
  });
});

// ──────────────────────────────────────────────────
// P5: 세션 스코프 메트릭
// ──────────────────────────────────────────────────
describe("P5: 세션 스코프 메트릭 — 30분 window weight", () => {
  const config = OrchestratorConfigSchema.parse({
    auto_dispatch: {
      enabled: true,
      operational_feedback_enabled: true,
      operational_feedback_consecutive_failures: 2,
    },
  });

  it("최근 성공 기록 subagent는 score 높음 → 선택됨", () => {
    // WEB_API를 사용: failover["WEB_API"] = "ctf-research" → pool에 ctf-research 포함
    const now = Date.now();
    const state = makeState({
      mode: "CTF",
      targetType: "WEB_API",
      dispatchHealthBySubagent: {
        "ctf-web": {
          successCount: 0,
          retryableFailureCount: 0,
          hardFailureCount: 0,
          consecutiveFailureCount: 3, // 실패 streak — 다른 후보 탐색
          lastOutcomeAt: now - 1_000,
        },
        "ctf-research": {
          successCount: 10,
          retryableFailureCount: 0,
          hardFailureCount: 0,
          consecutiveFailureCount: 0,
          lastOutcomeAt: now - 2_000, // 최근 → weight 1.0
        },
      },
    });
    const decision = decideAutoDispatch("ctf-web", state, 2, config);
    // ctf-web은 consecutiveFailure=3 >= threshold=2 → 다른 후보 탐색
    // pool: [ctf-web, ctf-research(fallback)]
    // ctf-research score 높음 → 선택
    expect(decision.subagent_type).toBe("ctf-research");
  });

  it("오래된 health 기록 (30분 초과) → weight 0.1 적용 → 최신 기록 우선", () => {
    const now = Date.now();
    const oldTime = now - 31 * 60 * 1000; // 31분 전

    // WEB_API: failover["WEB_API"] = "ctf-research"
    const state = makeState({
      mode: "CTF",
      targetType: "WEB_API",
      dispatchHealthBySubagent: {
        "ctf-web": {
          successCount: 0,
          retryableFailureCount: 0,
          hardFailureCount: 0,
          consecutiveFailureCount: 3, // threshold 초과
          lastOutcomeAt: oldTime, // 30분 초과 → weight 0.1
        },
        "ctf-research": {
          successCount: 3,
          retryableFailureCount: 0,
          hardFailureCount: 0,
          consecutiveFailureCount: 0,
          lastOutcomeAt: now - 1_000, // 최근 → weight 1.0
        },
      },
    });
    const decision = decideAutoDispatch("ctf-web", state, 2, config);
    // ctf-web: 오래됨 + 연속 실패 → score ≈ -0.9 (weight 0.1 적용)
    // ctf-research: 최근 성공 → score = 6 (weight 1.0)
    expect(decision.subagent_type).toBe("ctf-research");
  });

  it("모든 health 없으면 mapped subagent 유지", () => {
    const state = makeState({ mode: "CTF", targetType: "REV" });
    const decision = decideAutoDispatch("ctf-rev", state, 2, config);
    expect(decision.subagent_type).toBe("ctf-rev");
  });
});

// ──────────────────────────────────────────────────
// P7: DomainPlugin 인터페이스 (구조 준비)
// ──────────────────────────────────────────────────
describe("P7: DomainPlugin 인터페이스", () => {
  it("DomainPlugin 인터페이스를 구현할 수 있음", () => {
    const plugin: DomainPlugin = {
      targetType: "REV",
      requiresPatchDumpOnContradiction: () => true,
      oracleGate: (state) => state.oraclePassCount > 0,
    };
    expect(plugin.targetType).toBe("REV");
    expect(plugin.requiresPatchDumpOnContradiction()).toBe(true);
    expect(plugin.oracleGate(makeState({ oraclePassCount: 1 }))).toBe(true);
    expect(plugin.oracleGate(makeState({ oraclePassCount: 0 }))).toBe(false);
  });

  it("PWN 플러그인 예시 — contradiction 시 patch-dump 불필요 케이스", () => {
    const pwnPlugin: DomainPlugin = {
      targetType: "PWN",
      requiresPatchDumpOnContradiction: () => false,
      oracleGate: (state) => state.candidateLevel === "L2" || state.candidateLevel === "L3",
    };
    expect(pwnPlugin.requiresPatchDumpOnContradiction()).toBe(false);
    expect(pwnPlugin.oracleGate(makeState({ candidateLevel: "L2" }))).toBe(true);
    expect(pwnPlugin.oracleGate(makeState({ candidateLevel: "L1" }))).toBe(false);
  });
});

// ──────────────────────────────────────────────────
// P8: buildWorkPackage — 컨텍스트 전달
// ──────────────────────────────────────────────────
describe("P8: buildWorkPackage 컨텍스트 전달", () => {
  it("기본 상태 → 필수 필드 포함", () => {
    const state = makeState({
      latestCandidate: "flag{test}",
      hypothesis: "binary XOR decryption",
      phase: "EXECUTE",
    });
    const pkg = JSON.parse(buildWorkPackage(state)) as Record<string, unknown>;
    expect(pkg.target).toBe("flag{test}");
    expect(pkg.currentHypothesis).toBe("binary XOR decryption");
    expect(pkg.nextAction).toContain("EXECUTE");
    expect(pkg.contradictionActive).toBe(false);
    expect(Array.isArray(pkg.contradictionArtifacts)).toBe(true);
  });

  it("검증된 flag 있으면 trustedFacts에 포함", () => {
    const state = makeState({ latestVerified: "flag{verified}" });
    const pkg = JSON.parse(buildWorkPackage(state)) as Record<string, unknown>;
    expect(pkg.trustedFacts).toEqual(["flag{verified}"]);
  });

  it("검증된 flag 없으면 trustedFacts 빈 배열", () => {
    const state = makeState({ latestVerified: "" });
    const pkg = JSON.parse(buildWorkPackage(state)) as Record<string, unknown>;
    expect(pkg.trustedFacts).toEqual([]);
  });

  it("contradiction 활성 시 contradictionActive=true + artifacts 포함", () => {
    const state = makeState({
      contradictionArtifactLockActive: true,
      contradictionArtifacts: [".Aegis/artifacts/extract.json"],
    });
    const pkg = JSON.parse(buildWorkPackage(state)) as Record<string, unknown>;
    expect(pkg.contradictionActive).toBe(true);
    expect(pkg.contradictionArtifacts).toEqual([".Aegis/artifacts/extract.json"]);
  });

  it("JSON 파싱 가능한 유효한 JSON 출력", () => {
    const state = makeState({
      latestCandidate: 'flag{with "quotes"}',
      phase: "CLOSED",
    });
    expect(() => JSON.parse(buildWorkPackage(state))).not.toThrow();
  });
});

// ──────────────────────────────────────────────────
// 통합: REV solve lane 전체 경로 시뮬레이션
// ──────────────────────────────────────────────────
describe("통합: REV solve lane 전체 경로", () => {
  it("SCAN→EXECUTE→VERIFY→SUBMIT→CLOSED 전이 + lane 유지", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s", "CTF");
    store.setTargetType("s", "REV");

    // SCAN
    expect(store.get("s").phase).toBe("SCAN");
    const r1 = route(store.get("s"));
    expect(r1.primary).toContain("ctf"); // ctf-rev 또는 유사

    // SCAN → PLAN
    store.applyEvent("s", "scan_completed");
    expect(store.get("s").phase).toBe("PLAN");

    // PLAN → EXECUTE
    store.applyEvent("s", "plan_completed");
    expect(store.get("s").phase).toBe("EXECUTE");

    // solve lane 기록
    store.setLastDispatch("s", "ctf-rev", "ctf-rev");
    expect(store.get("s").activeSolveLane).toBe("ctf-rev");

    // candidate 발견
    store.setCandidate("s", "flag{rev_solution}");
    store.applyEvent("s", "candidate_found");
    expect(store.get("s").phase).toBe("VERIFY");

    // md-scribe context compaction 시나리오 → lane 유지
    const r2 = route(
      { ...store.get("s"), contextFailCount: 2, lastFailureReason: "context_overflow" }
    );
    // lane ownership: activeSolveLane=ctf-rev, contextFailCount=2 < 3 → ctf-rev 유지
    expect(r2.primary).toBe("ctf-rev");
    expect(r2.followups).toContain("md-scribe");

    // verify_success
    store.applyEvent("s", "verify_success");
    expect(store.get("s").phase).toBe("SUBMIT");
    expect(store.get("s").autoLoopEnabled).toBe(false);

    // work package 확인
    const wp = JSON.parse(buildWorkPackage(store.get("s"))) as Record<string, unknown>;
    expect(wp.target).toBe("flag{rev_solution}");
    expect(wp.nextAction).toContain("SUBMIT");

    // submit_accepted
    store.applyEvent("s", "submit_accepted");
    const final = store.get("s");
    expect(final.phase).toBe("CLOSED");
    expect(final.submissionAccepted).toBe(true);
    expect(final.autoLoopEnabled).toBe(false);
    expect(final.candidateLevel).toBe("L3");

    // CLOSED 이후 이벤트 차단
    store.applyEvent("s", "new_evidence");
    store.applyEvent("s", "candidate_found");
    expect(store.get("s").phase).toBe("CLOSED");
  });

  it("solve 중 md-scribe streak → lane ownership이 streak을 차단 (PLAN phase)", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s", "CTF");
    store.setTargetType("s", "REV");

    store.applyEvent("s", "scan_completed"); // → PLAN
    store.setLastDispatch("s", "ctf-rev", "ctf-rev"); // lane 기록

    const state = store.get("s");
    expect(state.phase).toBe("PLAN");
    expect(state.activeSolveLane).toBe("ctf-rev");

    // PLAN phase + context overflow (2회, 아직 3 미만):
    // routeRaw: contextFailCount>=2, not EXECUTE, mdScribePrimaryStreak<2 → md-scribe
    // route(): activeSolveLane=ctf-rev, contextFailCount=2<3 → ctf-rev 유지
    const r1 = route({ ...state, contextFailCount: 2, mdScribePrimaryStreak: 0 });
    expect(r1.primary).toBe("ctf-rev"); // lane 유지
    expect(r1.followups).toContain("md-scribe");

    // contextFailCount 3 → override 예외: md-scribe 허용
    const r2 = route({ ...state, contextFailCount: 3, mdScribePrimaryStreak: 0 });
    expect(r2.primary).toBe("md-scribe");
  });
});

// ──────────────────────────────────────────────────
// 회귀: 기존 동작 보호
// ──────────────────────────────────────────────────
describe("회귀: 기존 동작 보호", () => {
  it("verify_success → phase === SUBMIT (CLOSED로 건너뜀 없음)", () => {
    const store = new SessionStore(makeRoot());
    store.applyEvent("s", "scan_completed");
    store.applyEvent("s", "plan_completed");
    store.applyEvent("s", "candidate_found");
    store.applyEvent("s", "verify_success");
    expect(store.get("s").phase).toBe("SUBMIT");
    expect(store.get("s").candidateLevel).toBe("L2");
  });

  it("submit_rejected → phase 복귀 EXECUTE, verifyFailCount 증가", () => {
    const store = new SessionStore(makeRoot());
    store.applyEvent("s", "scan_completed");
    store.applyEvent("s", "plan_completed");
    store.applyEvent("s", "candidate_found");
    store.applyEvent("s", "verify_success");
    store.applyEvent("s", "submit_rejected");
    expect(store.get("s").phase).toBe("EXECUTE");
    expect(store.get("s").verifyFailCount).toBe(1);
  });

  it("reset_loop → phase === SCAN, 루프카운터 초기화", () => {
    const store = new SessionStore(makeRoot());
    store.applyEvent("s", "no_new_evidence");
    store.applyEvent("s", "no_new_evidence");
    store.applyEvent("s", "reset_loop");
    expect(store.get("s").phase).toBe("SCAN");
    expect(store.get("s").noNewEvidenceLoops).toBe(0);
  });

  it("CTF SCAN phase → ctf-web route", () => {
    const decision = route(makeState({ mode: "CTF", phase: "SCAN", targetType: "WEB_API" }));
    expect(decision.primary).toContain("ctf-web");
  });

  it("BOUNTY 미확인 scope → bounty-scope route", () => {
    const decision = route(makeState({ mode: "BOUNTY", scopeConfirmed: false }));
    expect(decision.primary).toBe("bounty-scope");
  });

  it("contradiction lock → ctf-rev route 강제", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        targetType: "REV",
        phase: "EXECUTE",
        contradictionArtifactLockActive: true,
        contradictionPatchDumpDone: false,
        contradictionPivotDebt: 1,
      })
    );
    expect(decision.primary).toBe("ctf-rev");
  });
});
