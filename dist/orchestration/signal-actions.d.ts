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
/**
 * Issue 3: Default Bias — 위임 편향 명문화
 * 메인 오케스트레이터는 조정자/검증자이며 직접 분석자가 아님.
 */
export declare function buildDelegateBiasSection(state: SessionState): string;
/**
 * Issue 5: 병렬 탐색 규칙 표준화
 * Phase별 병렬 정찰 규약을 prompt contract 수준으로 명시.
 */
export declare function buildParallelRulesSection(state: SessionState): string;
/**
 * Issue 6: 문제 상태 클래스 평가
 */
export declare function buildProblemStateSection(state: SessionState): string;
/**
 * Issue 7: 안티패턴/하드 블록 명문화
 */
export declare function buildHardBlocksSection(): string;
/**
 * Issue 10: 라우팅 결정 투명성 — 현재 라우트 이유를 간결하게 표시.
 * index-core.ts의 NEXT_ROUTE 라인을 보완하는 더 상세한 설명.
 */
export declare function buildRouteTransparencySection(state: SessionState, routePrimary: string, routeReason: string): string;
/**
 * Issue 2: 동적 사용 가능 서브에이전트 목록 주입.
 * availableSubagents는 index-core.ts에서 config에서 추출해 전달.
 */
export declare function buildAvailableSubagentsSection(state: SessionState, availableSubagents: string[]): string;
