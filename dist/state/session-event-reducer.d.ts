import type { SessionEvent, SessionState } from "./types";
export declare const CONTRADICTION_PATCH_LOOP_BUDGET = 2;
type SessionEventReducerDeps = {
    now: () => number;
    computeCandidateHash: (state: SessionState) => string;
};
export declare function applySessionEvent(state: SessionState, event: SessionEvent, deps: SessionEventReducerDeps): void;
export {};
