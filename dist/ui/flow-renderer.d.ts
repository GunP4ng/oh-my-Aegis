/**
 * flow-renderer.ts
 *
 * ANSI 트리 형태로 서브에이전트 워크플로우를 렌더링합니다.
 * - renderFlowToStderr(): 즉시 stderr에 ANSI 트리 출력
 * - writeFlowJson():      .Aegis/FLOW.json에 스냅샷 저장 (tmux 패널용)
 * - buildFlowLines():     ANSI 라인 배열 반환 (watch 루프에서 재사용)
 */
import type { FlowGroupSnapshot } from "../orchestration/parallel";
export interface FlowSnapshot {
    at: string;
    sessionID: string;
    mode: string;
    phase: string;
    target: string;
    nextRoute: string;
    nextReason: string;
    oraclePassCount: number;
    oracleTotalTests: number;
    noNewEvidenceLoops: number;
    groups: FlowGroupSnapshot[];
}
export declare function buildFlowLines(snap: FlowSnapshot): string[];
/** stderr에 ANSI 플로우 트리를 즉시 출력 */
export declare function renderFlowToStderr(snap: FlowSnapshot): void;
/** .Aegis/FLOW.json 갱신 (tmux watch 패널용) */
export declare function writeFlowJson(rootDir: string, snap: FlowSnapshot): void;
