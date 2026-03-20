import type { SessionState } from "../state/types";
/**
 * 현재 의도가 명시적 구현 요청인지 확인.
 * non-implement 의도일 때 바로 구현으로 달려가는 걸 방지.
 */
export declare function isActionableIntent(intentType: string): boolean;
/**
 * Intent Gate 섹션을 system prompt에 주입할 문자열로 반환.
 */
export declare function buildIntentGateSection(state: SessionState): string;
