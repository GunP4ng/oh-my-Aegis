import type { AegisTodoEntry } from "../state/types";
type IsRecord = (value: unknown) => value is Record<string, unknown>;
type LoopGuardState = {
    loopGuard: {
        recentActionSignatures: string[];
        blockedActionSignature: string;
        blockedReason: string;
    };
    timeoutFailCount: number;
    samePayloadLoops: number;
};
type SharedChannelMessage = {
    seq: number;
    from: string;
    to?: string;
    kind: string;
    summary: string;
    refs: string[];
};
export declare const stableActionSignature: (toolName: string, args: unknown, deps: {
    isRecord: IsRecord;
    hashAction: (input: string) => string;
}) => string;
export declare const applyLoopGuard: (params: {
    sessionID: string;
    toolName: string;
    args: unknown;
    stuckThreshold: number;
    getState: (sessionID: string) => LoopGuardState;
    setLoopGuardBlock: (sessionID: string, signature: string, reason: string) => void;
    recordActionSignature: (sessionID: string, signature: string) => void;
    stableActionSignature: (toolName: string, args: unknown) => string;
    createPolicyDenyError: (message: string) => Error;
}) => void;
export declare const normalizeTodoEntry: (todo: unknown, index: number, isRecord: IsRecord) => AegisTodoEntry | null;
export declare const normalizeTodoEntries: (todos: unknown[], isRecord: IsRecord) => AegisTodoEntry[];
export declare const buildSharedChannelPrompt: (sessionID: string, subagentType: string, readSharedMessages: (sessionID: string, channelID: string, sinceSeq: number, limit: number) => SharedChannelMessage[]) => string;
export {};
