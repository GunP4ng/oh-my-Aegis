import { syncPluginPackages } from "../install/plugin-packages";
export declare function __setInstallPluginPackageSyncForTests(impl: typeof syncPluginPackages | null): void;
export declare function printInstallHelp(): void;
export declare function runInstall(commandArgs?: string[]): Promise<number>;
