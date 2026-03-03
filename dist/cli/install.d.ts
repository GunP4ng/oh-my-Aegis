export declare function printInstallHelp(): void;
interface RunCommandResult {
    ok: boolean;
    exitCode: number | null;
    errorMessage: string | null;
}
interface InstallCliRuntime {
    commandExists(command: string): Promise<boolean>;
    runInteractive(command: string, args: string[]): Promise<RunCommandResult>;
}
export declare function __setInstallCliRuntimeForTests(runtime: InstallCliRuntime | null): void;
export declare function runInstall(commandArgs?: string[]): Promise<number>;
export {};
