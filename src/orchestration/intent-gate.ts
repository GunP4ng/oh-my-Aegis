import type { SessionState } from "../state/types";

/**
 * Issue 1: Intent Gate
 * Phase 0 - 요청 의도를 분류하는 층. Phase Engine 이전에 작동.
 * CTF: 풀이(implement) vs 설명/정리(research) 분리
 * BOUNTY: 증거 수집(investigate) vs 실제 액션(implement/fix) 분리
 */

const INTENT_DESCRIPTIONS: Record<string, string> = {
  research:    "정보 수집 / 설명 / 보고서 작성 — 직접 실행 없음",
  implement:   "명시적 구현 / exploit 작성 / 실행",
  investigate: "증거 수집 / triage / 탐색 — 결론 보류",
  evaluate:    "후보 평가 / verify 판단",
  fix:         "실패 수정 / 재시도",
  unknown:     "의도 미분류 — 아래 Intent Gate 통과 필요",
};

/**
 * 현재 의도가 명시적 구현 요청인지 확인.
 * non-implement 의도일 때 바로 구현으로 달려가는 걸 방지.
 */
export function isActionableIntent(intentType: string): boolean {
  return intentType === "implement" || intentType === "fix";
}

/**
 * Intent Gate 섹션을 system prompt에 주입할 문자열로 반환.
 */
export function buildIntentGateSection(state: SessionState): string {
  const intent = state.intentType;
  const lines: string[] = [
    "[INTENT GATE]",
    `current_intent: ${intent} — ${INTENT_DESCRIPTIONS[intent] ?? intent}`,
  ];

  if (intent === "unknown") {
    lines.push(
      "ACTION REQUIRED: Before proceeding, classify this request.",
      "  research      → report/explain/summarize only, no implementation",
      "  implement     → explicit build/exploit/execute requested",
      "  investigate   → collect evidence, defer conclusions",
      "  evaluate      → assess a candidate/hypothesis",
      "  fix           → correct a specific known failure",
      "Use ctf_orch_event with intent_type=<type> to set intent."
    );
  } else if (intent === "research") {
    lines.push(
      "RESEARCH MODE: Summarize, explain, or document only.",
      "Do NOT write or execute exploit code unless explicitly re-classified as implement."
    );
  } else if (intent === "investigate") {
    lines.push(
      "INVESTIGATE MODE: Collect evidence and triage. Defer implementation decisions.",
      "Record findings via ctf_evidence_ledger. Do NOT attempt exploitation yet."
    );
  } else if (intent === "evaluate") {
    lines.push(
      "EVALUATE MODE: Assess the current candidate/hypothesis against evidence.",
      "Use ctf_decoy_guard and ctf_flag_scan. Record result via ctf_orch_event."
    );
  } else if (intent === "implement" || intent === "fix") {
    const prefix = intent === "fix" ? "FIX MODE" : "IMPLEMENT MODE";
    lines.push(`${prefix}: Direct execution authorized. Delegate to specialized sub-agent.`);
  }

  return lines.join("\n");
}
