import type { SessionState } from "../state/types";

/**
 * Issue 4: 6-section delegation contract format
 * sub-agent에게 작업을 위임할 때 사용하는 구조화된 계약 포맷.
 * TASK / EXPECTED_OUTCOME / REQUIRED_TOOLS / MUST_DO / MUST_NOT_DO / CONTEXT
 */

export interface DelegationContractParams {
  task: string;
  expectedOutcome: string;
  requiredTools: string[];
  mustDo: string[];
  mustNotDo: string[];
  context: string;
}

/**
 * 6-section delegation contract를 포맷된 문자열로 반환.
 */
export function formatDelegationContract(p: DelegationContractParams): string {
  const lines = [
    "[DELEGATION CONTRACT]",
    `TASK: ${p.task}`,
    `EXPECTED_OUTCOME: ${p.expectedOutcome}`,
    `REQUIRED_TOOLS: ${p.requiredTools.join(", ")}`,
    "MUST_DO:",
    ...p.mustDo.map((s) => `  - ${s}`),
    "MUST_NOT_DO:",
    ...p.mustNotDo.map((s) => `  - ${s}`),
    `CONTEXT: ${p.context}`,
  ];
  return lines.join("\n");
}

/**
 * Issue 8: 세션 연속성 규약 - 위임 프롬프트에 session_id 재사용 지침 포함.
 * Issue 4 + Issue 8 통합.
 */
export function buildDelegationContractSection(state: SessionState): string {
  const lines: string[] = [
    "[DELEGATION PROTOCOL]",
    "RULE: Orchestrator delegates atomic work units to specialized sub-agents.",
    "RULE: Each delegation MUST follow the 6-section contract format:",
    "  TASK / EXPECTED_OUTCOME / REQUIRED_TOOLS / MUST_DO / MUST_NOT_DO / CONTEXT",
    "",
    "SESSION CONTINUITY (Issue 8):",
    "  - Reuse the same sub-agent session for follow-ups, corrections, and re-verification.",
    "  - Do NOT open a new session for the same task unless the previous session is closed.",
    "  - Pass session_id in all follow-up delegations.",
    "",
  ];

  // Domain-specific delegation templates
  const target = state.targetType;
  const mode = state.mode;

  if (mode === "CTF") {
    if (target === "REV") {
      lines.push(
        "EXAMPLE (REV):",
        formatDelegationContract({
          task: "VM 여부 판별 및 디스패치 전략 수립",
          expectedOutcome: "VM 근거 3개 이상 + 반례 여부 + 권장 추출 경로",
          requiredTools: ["readelf", "strings", "binwalk", "ctf_rev_loader_vm_detect"],
          mustDo: ["섹션/reloc/embedded ELF 확인", "ctf_rev_entry_patch 적용 가능성 판단"],
          mustNotDo: ["근거 없는 'VM 같다' 추정", "정적 분석만으로 결론 확정"],
          context: `phase=${state.phase} hypothesis=${state.hypothesis || "none"}`,
        }),
        ""
      );
    } else if (target === "PWN") {
      lines.push(
        "EXAMPLE (PWN):",
        formatDelegationContract({
          task: "취약점 클래스 확인 및 exploit 전략 수립",
          expectedOutcome: "취약점 위치 + offset + 권장 기법",
          requiredTools: ["checksec", "pwndbg", "ctf_env_parity"],
          mustDo: ["libc 버전/loader parity 확인", "exploit 경로 최소 2개 제시"],
          mustNotDo: ["환경 불일치 무시", "ASLR/NX 우회 근거 없이 시도"],
          context: `phase=${state.phase} envParity=${state.envParityChecked}`,
        }),
        ""
      );
    } else if (target === "WEB_API" || target === "WEB3") {
      lines.push(
        "EXAMPLE (WEB):",
        formatDelegationContract({
          task: "취약점 패턴 탐색 및 PoC 경로 수립",
          expectedOutcome: "취약 엔드포인트 + 공격 벡터 + 필요 권한",
          requiredTools: ["ctf_recon_pipeline", "ctf_auto_triage"],
          mustDo: ["인증/인가 경계 확인", "입력 검증 누락 지점 식별"],
          mustNotDo: ["결과 없이 스캔 반복", "scope 밖 엔드포인트 공격"],
          context: `phase=${state.phase} scopeConfirmed=${state.scopeConfirmed}`,
        }),
        ""
      );
    }
  }

  return lines.join("\n");
}
