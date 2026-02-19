type Mode = "CTF" | "BOUNTY";
export declare function printRunHelp(): void;
export declare function buildRunMessage(input: {
    mode: Mode;
    ultrawork: boolean;
    message: string;
}): string;
export declare function runAegis(commandArgs?: string[]): Promise<number>;
export {};
