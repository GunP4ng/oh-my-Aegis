import type { SessionState } from "../state/types";
import { type OrchestratorConfig } from "../config/schema";
/**
 * 세션 상태에서 활성 신호를 읽어 에이전트 지침 문자열 배열을 생성.
 * 각 문자열은 system prompt에 직접 주입됩니다.
 */
export declare function buildSignalGuidance(state: SessionState, config?: OrchestratorConfig): string[];
/**
 * 현재 phase에 대한 행동 지침을 반환합니다.
 */
export declare function buildPhaseInstruction(state: SessionState): string;
