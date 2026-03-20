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
export declare function formatDelegationContract(p: DelegationContractParams): string;
/**
 * Issue 8: 세션 연속성 규약 - 위임 프롬프트에 session_id 재사용 지침 포함.
 * Issue 4 + Issue 8 통합.
 */
export declare function buildDelegationContractSection(state: SessionState): string;
