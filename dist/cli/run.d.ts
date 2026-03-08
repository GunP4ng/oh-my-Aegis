type Mode = "CTF" | "BOUNTY";
interface ParsedRunArgs {
    help: boolean;
    mode: Mode;
    ultrawork: boolean;
    godMode: boolean;
    message: string;
    passthrough: string[];
}
export declare function validatePassthroughCommand(passthrough: string[]): string | null;
export declare function printRunHelp(): void;
export declare function parseRunArgs(args: string[]): {
    ok: true;
    value: ParsedRunArgs;
} | {
    ok: false;
    error: string;
};
export declare function buildRunEnv(baseEnv: NodeJS.ProcessEnv, godMode: boolean): NodeJS.ProcessEnv;
export declare function buildRunMessage(input: {
    mode: Mode;
    ultrawork: boolean;
    message: string;
}): string;
export declare function runAegis(commandArgs?: string[]): Promise<number>;
export {};
