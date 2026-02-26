import type { SessionState } from "../state/types";
/**
 * 현재 phase/mode/targetType에 따라 에이전트가 사용해야 할
 * 핵심 Aegis 도구 목록을 간결하게 반환합니다. (~200 tokens 이내)
 */
export declare function buildToolGuide(state: SessionState): string;
