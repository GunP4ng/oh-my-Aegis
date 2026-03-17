export declare function hasOpencodeConfigFile(opencodeDir: string): boolean;
export declare function hasAegisInstallMarker(opencodeDir: string): boolean;
export declare function resolveOpencodeDirCandidates(environment?: NodeJS.ProcessEnv): string[];
export declare function resolveDefaultOpencodeDirCandidates(environment?: NodeJS.ProcessEnv): string[];
export declare function resolveDefaultAegisUserConfigCandidates(environment?: NodeJS.ProcessEnv): string[];
export declare function resolveOpencodeConfigPathInDir(opencodeDir: string): string;
export declare function resolveProjectOpencodeConfigPath(projectDir: string, environment?: NodeJS.ProcessEnv): string | null;
